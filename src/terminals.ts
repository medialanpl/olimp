import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import type { IPty } from "@lydell/node-pty";
import { newId } from "./db/rows.ts";
import { message } from "./jobs.ts";
import { isOlimpVariable } from "./sandbox.ts";

export const SCROLLBACK_MAX = 256_000;
export const SESSIONS_MAX = 32;
export const URLS_MAX = 50;
const CHANGE_EVENT_MS = 25;
const EXITED_KEPT_MS = 60_000;
const HUP_TO_KILL_MS = 2000;
const PS_REUSE_MS = 1000;
const LABEL_MAX = 40;
const CELLS_MAX = 500;
// Raw output carried into the next chunk's scan, so an address split between chunks is found.
const URL_CARRY = 256;

export interface TerminalSession {
    id: string;
    // `task:<first task of the thread>` (its steps share a folder) or `run:<id>`.
    owner: string;
    repo: string;
    cwd: string;
    shell: string;
    cols: number;
    rows: number;
    startedAt: string;
    exitCode: number | null;
    // `Terminal <ordinal>` until a command runs; then that command, kept after it finishes.
    ordinal: number;
    label: string | null;
    // null: this host cannot read its process table, which the panel treats as "ask first".
    busy: boolean | null;
}

export interface TerminalOutput {
    data: string;
    cursor: number;
    // The cursor was older than the scrollback kept: some output was missed.
    truncated: boolean;
    exitCode: number | null;
}

export interface DetectedUrl {
    url: string;
    lastSeenAt: string;
    running: boolean | null;
}

export interface ProcessRow {
    pid: number;
    ppid: number;
    pgid: number;
    command: string;
}

export type Opened =
    | { session: TerminalSession }
    | { error: "unavailable"; reason: string }
    | { error: "tooMany" | "unknownShell" };

type Spawn = typeof import("@lydell/node-pty")["spawn"];

let binding: Promise<Spawn | string> | undefined;

// The PTY binding is an optional dependency: without it OLIMP runs and the terminal says why it is
// off. Imported once; the promise never rejects.
export function loadPty(): Promise<Spawn | string> {
    binding ??= import("@lydell/node-pty").then(
        ({ spawn }) => (typeof spawn === "function" ? spawn : "no spawn in the binding"),
        message,
    );
    return binding;
}

// A path the client names is never spawned: it may only pick one of the host's own shells.
export function shells(file = "/etc/shells"): string[] {
    let listed = "";
    try {
        listed = readFileSync(file, "utf8");
    } catch {}
    const offered = new Set<string>();
    const usual = [process.env.SHELL, "/bin/bash", "/bin/sh"].find(
        (path) => path && existsSync(path),
    );
    if (usual) offered.add(usual);
    for (const line of listed.split("\n")) {
        const path = line.trim();
        if (path.startsWith("/") && existsSync(path)) offered.add(path);
    }
    return [...offered];
}

// The last SCROLLBACK_MAX characters a shell printed, addressed by their offset in all it printed.
class Scrollback {
    private text = "";
    private start = 0;

    get end(): number {
        return this.start + this.text.length;
    }

    add(data: string): void {
        const all = this.text + data;
        this.text = all.slice(-SCROLLBACK_MAX);
        this.start += all.length - this.text.length;
    }

    since(cursor: number): Omit<TerminalOutput, "exitCode"> {
        const at = Math.min(Math.max(Math.trunc(cursor) || 0, 0), this.end);
        return {
            data: this.text.slice(Math.max(at - this.start, 0)),
            cursor: this.end,
            truncated: at < this.start,
        };
    }
}

const sessions = new Map<string, Shell>();
const watchers = new Set<(session: TerminalSession) => void>();

// One PTY: its session as the API shows it, its scrollback and the change events it sends.
class Shell {
    readonly pty: IPty;
    readonly session: TerminalSession;
    readonly output = new Scrollback();
    private carry = "";
    private pending: NodeJS.Timeout | undefined;
    private reap: NodeJS.Timeout | undefined;

    constructor(pty: IPty, session: TerminalSession) {
        this.pty = pty;
        this.session = session;
        pty.onData((data) => this.print(data));
        pty.onExit(({ exitCode }) => this.exit(exitCode));
    }

    get running(): boolean {
        return this.session.exitCode === null;
    }

    private print(data: string): void {
        const scanned = this.carry + data;
        rememberUrls(this.session.owner, findUrls(scanned));
        this.carry = scanned.slice(-URL_CARRY);
        this.output.add(data);
        this.pending ??= setTimeout(() => this.announce(), CHANGE_EVENT_MS);
    }

    private exit(code: number): void {
        this.session.exitCode = code;
        this.session.busy = false;
        this.announce();
        // A shell that exited by itself stays a while, so its last lines can still be read.
        this.reap = setTimeout(() => this.forget(), EXITED_KEPT_MS);
        this.reap.unref();
    }

    // Tells the watchers now, in place of an event still waiting.
    announce(): void {
        clearTimeout(this.pending);
        this.pending = undefined;
        for (const watcher of watchers) watcher(this.session);
    }

    forget(): void {
        if (!sessions.delete(this.session.id)) return;
        clearTimeout(this.reap);
        this.announce();
    }

    // Labels the tab with what runs in it; without a process table `busy` is unknown.
    inspect(rows: readonly ProcessRow[] | null): void {
        if (!rows) {
            this.session.busy = null;
            return;
        }
        const command = foreground(rows, this.pty.pid);
        this.session.busy = command !== null;
        if (command) this.session.label = command;
    }

    // SIGHUP, as a closing terminal sends, then SIGKILL for what ignores it, both to the groups read
    // before the first signal: after the HUP the survivors are reparented where no walk finds them.
    hangUp(): void {
        if (!this.running) return;
        const groups = groupsUnder(processTable(true) ?? [], this.pty.pid);
        this.signal(groups, "SIGHUP");
        setTimeout(() => this.signal(groups, "SIGKILL"), HUP_TO_KILL_MS).unref();
    }

    // Each group, then the shell; with no groups known, the shell's own group.
    signal(groups: readonly number[] | null, signal: NodeJS.Signals): void {
        for (const group of groups ?? [this.pty.pid]) quietly(() => process.kill(-group, signal));
        quietly(() => this.pty.kill(signal));
    }
}

const quietly = (act: () => void) => {
    try {
        act();
    } catch {}
};

// Called at most every CHANGE_EVENT_MS per session with output, at once on exit and when it is gone.
export function onTerminalChange(watcher: (session: TerminalSession) => void): () => void {
    watchers.add(watcher);
    return () => {
        watchers.delete(watcher);
    };
}

const cells = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value)
        ? Math.max(1, Math.min(CELLS_MAX, Math.trunc(value)))
        : fallback;

// OLIMP's environment without OLIMP's own variables, as worktree scripts get it.
function shellEnv(): Record<string, string> {
    const inherited = Object.entries(process.env).filter(
        (pair): pair is [string, string] => pair[1] !== undefined && !isOlimpVariable(pair[0]),
    );
    return { ...Object.fromEntries(inherited), TERM: "xterm-256color", COLORTERM: "truecolor" };
}

// The lowest number none of the owner's tabs uses, so a closed tab's number is given again.
function freeOrdinal(owner: string): number {
    const taken = new Set<number>();
    for (const { session } of sessions.values())
        if (session.owner === owner) taken.add(session.ordinal);
    for (let ordinal = 1; ; ordinal++) if (!taken.has(ordinal)) return ordinal;
}

export async function openTerminal(input: {
    owner: string;
    repo: string;
    cwd: string;
    shell?: string;
    cols?: number;
    rows?: number;
}): Promise<Opened> {
    const spawn = await loadPty();
    if (typeof spawn === "string") return { error: "unavailable", reason: spawn };
    if (sessions.size >= SESSIONS_MAX) return { error: "tooMany" };
    const offered = shells();
    const shell = input.shell ?? offered[0];
    if (!shell || !offered.includes(shell)) return { error: "unknownShell" };
    const size = { cols: cells(input.cols, 80), rows: cells(input.rows, 24) };
    const { owner, repo, cwd } = input;
    let pty: IPty;
    try {
        pty = spawn(shell, [], { name: "xterm-256color", ...size, cwd, env: shellEnv() });
    } catch (error) {
        return { error: "unavailable", reason: message(error) };
    }
    const session: TerminalSession = {
        id: newId(),
        owner,
        repo,
        cwd,
        shell,
        ...size,
        startedAt: new Date().toISOString(),
        exitCode: null,
        ordinal: freeOrdinal(owner),
        label: null,
        busy: false,
    };
    sessions.set(session.id, new Shell(pty, session));
    return { session };
}

export const terminal = (id: string): TerminalSession | null => sessions.get(id)?.session ?? null;

// The owner's sessions, labelled from one read of the process table.
export function terminalsOf(owner: string): TerminalSession[] {
    const own = [...sessions.values()].filter((shell) => shell.session.owner === owner);
    const live = own.filter((shell) => shell.running);
    if (live.length) {
        const rows = processTable();
        for (const shell of live) shell.inspect(rows);
    }
    return own.map((shell) => shell.session);
}

// Only a shell still running takes input or a new size.
function runningShell(id: string): Shell | undefined {
    const shell = sessions.get(id);
    return shell?.running ? shell : undefined;
}

export function writeTerminal(id: string, data: string): boolean {
    const shell = runningShell(id);
    shell?.pty.write(data);
    return shell !== undefined;
}

export function resizeTerminal(id: string, cols: unknown, rows: unknown): boolean {
    const shell = runningShell(id);
    if (!shell) return false;
    const { session, pty } = shell;
    Object.assign(session, { cols: cells(cols, session.cols), rows: cells(rows, session.rows) });
    pty.resize(session.cols, session.rows);
    return true;
}

// Output since `cursor`; 0 replays the scrollback kept, as a page opened again needs.
export function readTerminal(id: string, cursor: number): TerminalOutput | null {
    const shell = sessions.get(id);
    return shell ? { ...shell.output.since(cursor), exitCode: shell.session.exitCode } : null;
}

// Stops the shell and everything it started, if it still runs, and forgets the session.
export function closeTerminal(id: string): boolean {
    const shell = sessions.get(id);
    shell?.hangUp();
    shell?.forget();
    return shell !== undefined;
}

function closeMatching(test: (session: TerminalSession) => boolean): void {
    for (const { session } of sessions.values()) if (test(session)) closeTerminal(session.id);
}

// An archived thread, a removed worktree and a removed project take their terminals along.
export function closeOwnerTerminals(owner: string): void {
    closeMatching((session) => session.owner === owner);
    printed.delete(owner);
}
export const closeTerminalsIn = (cwd: string) => closeMatching((session) => session.cwd === cwd);
export const closeRepoTerminals = (repo: string) =>
    closeMatching((session) => session.repo === repo);

// On OLIMP's exit: a PTY's shell leads a session of its own, so the Ctrl-C reaching OLIMP's group
// never reaches it.
export function closeAllTerminals(): void {
    if (!sessions.size) return;
    const rows = processTable(true) ?? [];
    for (const shell of sessions.values())
        shell.signal(groupsUnder(rows, shell.pty.pid), "SIGKILL");
    sessions.clear();
}

const PS_LINE = /^(?<pid>\d+)\s+(?<ppid>\d+)\s+(?<pgid>\d+)\s+(?<command>.+)$/;

export const parseProcesses = (text: string): ProcessRow[] =>
    text.split("\n").flatMap((line) => {
        const fields = PS_LINE.exec(line.trim())?.groups;
        if (!fields) return [];
        const { pid, ppid, pgid, command = "" } = fields;
        return [{ pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), command }];
    });

let lastPs: { readAt: number; rows: ProcessRow[] | null } | undefined;

// One `ps` serves every tab for a second (`fresh` before signalling); null when this host cannot
// read its process table.
export function processTable(fresh = false): ProcessRow[] | null {
    const now = Date.now();
    if (fresh || !lastPs || now - lastPs.readAt >= PS_REUSE_MS)
        lastPs = { readAt: now, rows: readPs() };
    return lastPs.rows;
}

function readPs(): ProcessRow[] | null {
    try {
        const listing = execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], {
            encoding: "utf8",
            timeout: 2000,
            maxBuffer: 16 << 20,
            stdio: ["ignore", "pipe", "ignore"],
        });
        return parseProcesses(listing);
    } catch {
        return null;
    }
}

// The command line as a tab shows it: the program without its directory, and its arguments.
export function tidyCommand(command: string): string {
    const line = command
        .trim()
        .replace(/^\S*\//, "")
        .replace(/\s+/g, " ");
    return line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line;
}

// The shell's first direct child is the command typed: `npm run dev` rather than the node it
// starts at the bottom of the tree.
export function foreground(rows: readonly ProcessRow[], shell: number): string | null {
    for (const row of rows) if (row.ppid === shell) return tidyCommand(row.command);
    return null;
}

// Every process group under the shell, its own included: an interactive shell gives each job a
// group of its own, so a signal to the shell's group alone misses what it started. The shell must
// still be OLIMP's child: a recycled pid would name a stranger's tree.
export function groupsUnder(
    rows: readonly ProcessRow[],
    shell: number,
    self = process.pid,
): number[] | null {
    const root = rows.find((row) => row.pid === shell && row.ppid === self);
    if (!root) return null;
    const children = Map.groupBy(rows, (row) => row.ppid);
    const tree = new Set([root]);
    for (const row of tree) for (const child of children.get(row.pid) ?? []) tree.add(child);
    // -0 would signal OLIMP's own group and -1 every process it may signal.
    const spared = new Set([
        0,
        1,
        ...rows.filter((row) => row.pid === self).map((row) => row.pgid),
    ]);
    return [...new Set([...tree].map((row) => row.pgid))].filter((group) => !spared.has(group));
}

// This machine: loopback, 0.0.0.0 a server bound to, and `.local` names. Order matters: localhost
// before `.local`.
const LOCAL_HOST = String.raw`\[::1\]|0\.0\.0\.0|127\.0\.0\.1|localhost|[a-z\d-]+\.local`;
const LOCAL_URL = new RegExp(
    String.raw`https?://(?:${LOCAL_HOST})(?::\d{2,5})?(?:/[^\s"'()<>[\]]*)?`,
    "gi",
);
const ESCAPES =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences start with ESC.
    /\u001b(?:\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\][^\u0007\u001b]*(?:\u0007|\u001b\\))/g;

// 0.0.0.0 is where a server bound, not an address to open: the user means this machine.
function normalizeUrl(raw: string): string | null {
    const url = URL.parse(raw);
    if (!url) return null;
    if (url.hostname === "0.0.0.0" || url.hostname === "[::1]") url.hostname = "localhost";
    return url.origin + (url.pathname === "/" ? "" : url.pathname) + url.search;
}

export function findUrls(text: string): string[] {
    const found = new Set<string>();
    for (const [raw] of text.replace(ESCAPES, "").matchAll(LOCAL_URL)) {
        const url = normalizeUrl(raw);
        if (url) found.add(url);
    }
    return [...found];
}

// Per owner, each address printed and when it was last seen, in the order first seen.
const printed = new Map<string, Map<string, string>>();

function rememberUrls(owner: string, urls: readonly string[]): void {
    if (!urls.length) return;
    const seen = printed.get(owner) ?? new Map<string, string>();
    printed.set(owner, seen);
    const now = new Date().toISOString();
    for (const url of urls) {
        seen.set(url, now);
        if (seen.size <= URLS_MAX) continue;
        // The one seen longest ago goes; of those seen at once, the one printed first.
        const [stalest] = [...seen].reduce((a, b) => (b[1] < a[1] ? b : a));
        seen.delete(stalest);
    }
}

// A TCP connect, never an HTTP request: the server is the task's code, and a request might act.
function listens(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = connect({ host, port, timeout: 400 });
        const answer = (open: boolean) => () => {
            socket.destroy();
            resolve(open);
        };
        socket.on("connect", answer(true)).on("timeout", answer(false)).on("error", answer(false));
    });
}

// The addresses the owner's terminals printed, newest first, each port asked once whether it
// still listens.
export async function detectedUrls(owner: string): Promise<DetectedUrl[]> {
    const probes = new Map<string, Promise<boolean>>();
    const probe = (url: string) => {
        const { hostname, port } = new URL(url);
        const key = `${hostname}:${port}`;
        const answer = probes.get(key) ?? listens(hostname, Number(port || 80));
        probes.set(key, answer);
        return answer;
    };
    const found = await Promise.all(
        [...(printed.get(owner) ?? [])].map(
            async ([url, lastSeenAt]): Promise<DetectedUrl> => ({
                url,
                lastSeenAt,
                running: await probe(url),
            }),
        ),
    );
    return found.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}
