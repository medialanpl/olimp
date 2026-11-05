import { spawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface Result {
    code: number;
    stdout: string;
    stderr: string;
}

// The database URLs hold their passwords: git and gh get the rest of OLIMP's environment.
export function ownEnv(): NodeJS.ProcessEnv {
    const { OLIMP_DATABASE_URL: _, OLIMP_TEST_MYSQL_URL: __, ...env } = process.env;
    return env;
}

// Without `env` the child is one of OLIMP's own tools; an agent gets only the `env` it is given.
export function run(
    cmd: string,
    args: string[],
    opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<Result> {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, {
            cwd: opts.cwd,
            env: opts.env ?? ownEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            timeout: opts.timeoutMs,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error}` }));
        child.on("close", (code, signal) =>
            resolve({ code: code ?? (signal ? 124 : -1), stdout, stderr }),
        );
    });
}

export const shellQuote = (arg: string) =>
    /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;

export const KILL_GRACE_MS = 5000;
const LINE_MAX = 16 * 1024 * 1024;
const STDERR_MAX = 100_000;

export interface Streamed {
    code: number;
    stderr: string;
    // Why OLIMP stopped the process, if it did.
    stopped: "timeout" | "cancelled" | null;
}

// How a caller talks to an agent that reads its stdin (ACP, pi's RPC): `finish` ends a session the
// caller saw complete, so its exit (or the kill after KILL_GRACE_MS) counts as success.
export interface Stdin {
    write(line: string): void;
    finish(): void;
}

const groups = new Set<number>();

function signalGroup(pid: number, signal: NodeJS.Signals): void {
    try {
        process.kill(-pid, signal);
    } catch {}
}

// Kills every agent still running, e.g. when OLIMP itself is stopped.
export function killAgents(): void {
    for (const pid of groups) signalGroup(pid, "SIGKILL");
}

// Runs an agent in a process group of its own, handing stdout over line by line. A timeout or the
// signal stops the whole group, everything the agent started too: SIGTERM, then SIGKILL after
// KILL_GRACE_MS.
export function stream(
    cmd: string,
    args: string[],
    opts: {
        cwd: string;
        env: Record<string, string>;
        timeoutMs: number;
        signal?: AbortSignal;
        onLine: (line: string) => void;
        onStdin?: (stdin: Stdin) => void;
        // Written to stdin, which then closes.
        input?: string;
    },
): Promise<Streamed> {
    return new Promise((resolve) => {
        if (opts.signal?.aborted) {
            resolve({ code: -1, stderr: "", stopped: "cancelled" });
            return;
        }
        const child = spawn(cmd, args, {
            cwd: opts.cwd,
            env: opts.env,
            stdio: [opts.onStdin || opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
            detached: true,
        });
        const pid = child.pid;
        if (pid) groups.add(pid);
        let stopped: Streamed["stopped"] = null;
        let finished = false;
        let killer: NodeJS.Timeout | undefined;
        const stop = (why: "timeout" | "cancelled") => {
            if (stopped || !pid) return;
            stopped = why;
            signalGroup(pid, "SIGTERM");
            killer = setTimeout(() => signalGroup(pid, "SIGKILL"), KILL_GRACE_MS);
        };
        const timer = setTimeout(() => stop("timeout"), opts.timeoutMs);
        if (opts.onStdin && child.stdin) {
            const stdin = child.stdin;
            stdin.on("error", () => {});
            opts.onStdin({
                write: (line) => {
                    if (!finished && stdin.writable) stdin.write(`${line}\n`);
                },
                finish: () => {
                    if (finished || stopped || !pid) return;
                    finished = true;
                    stdin.end();
                    killer = setTimeout(() => signalGroup(pid, "SIGTERM"), KILL_GRACE_MS);
                },
            });
        }
        if (opts.input !== undefined && child.stdin) {
            child.stdin.on("error", () => {});
            child.stdin.end(opts.input);
        }
        const onAbort = () => stop("cancelled");
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        let pending = "";
        let stderr = "";
        // Both are pipes whatever stdin is; the spawn overloads cannot tell.
        const out = child.stdout as Readable;
        out.setEncoding("utf8");
        out.on("data", (chunk: string) => {
            pending += chunk;
            const lines = pending.split("\n");
            pending = lines.pop() ?? "";
            if (pending.length > LINE_MAX) pending = "";
            for (const line of lines) opts.onLine(line);
        });
        (child.stderr as Readable).on("data", (chunk) => {
            stderr = `${stderr}${chunk}`.slice(-STDERR_MAX);
        });
        let done = false;
        const finish = (code: number, extra = "") => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearTimeout(killer);
            opts.signal?.removeEventListener("abort", onAbort);
            if (pid) groups.delete(pid);
            if (pending) opts.onLine(pending);
            pending = "";
            resolve({ code, stderr: `${stderr}${extra}`, stopped });
        };
        child.on("error", (error) => finish(-1, String(error)));
        child.on("close", (code, signal) =>
            finish(finished && !stopped ? 0 : (code ?? (signal ? 124 : -1))),
        );
    });
}

// Runs a command that must succeed and returns its trimmed stdout.
export async function must(
    cmd: string,
    args: string[],
    opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
    const res = await run(cmd, args, opts);
    if (res.code !== 0) {
        const last = (res.stderr || res.stdout).trim().split("\n").at(-1);
        throw new Error(`${cmd} ${args[0] ?? ""}: ${last || `exit ${res.code}`}`);
    }
    return res.stdout.trim();
}
