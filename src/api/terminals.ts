import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { hostname } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { AGENT_SPECS } from "../agents.ts";
import { isGitFolder, repoDir } from "../clones.ts";
import type { Config } from "../config.ts";
import { HttpError, readJson } from "../http.ts";
import { shellQuote } from "../proc.ts";
import { projectCommands } from "../project-commands.ts";
import type { Repo, Store } from "../store.ts";
import {
    closeTerminal,
    detectedUrls,
    loadPty,
    openTerminal,
    readTerminal,
    resizeTerminal,
    shells,
    terminal,
    terminalsOf,
    writeTerminal,
} from "../terminals.ts";
import { agentHome, TOKEN_FILE } from "../users.ts";
import { runFolder, worktreesDir } from "../worktrees.ts";
import type { Answer } from "./shared.ts";

const ROUTE =
    /^\/api\/(tasks|workflow-runs)\/([a-z0-9][a-z0-9-]*)\/terminals(?:\/(urls|commands|[0-9a-f]{12})(?:\/(output|input|resize))?)?$/;
const INPUT_MAX = 100_000;

// A job's folder: its worktree while it is there, or the project's folder for a job that works
// in it (in a folder without git, or a task in the checkout).
function folderOf(cfg: Config, repo: Repo, tree: string | null): string | null {
    const dir = repoDir(cfg, repo);
    const folder = tree && isGitFolder(dir) ? join(worktreesDir(cfg), tree) : dir;
    return existsSync(folder) ? folder : null;
}

// Whose terminals these are: a task's thread or a workflow run, and where they work.
async function ownerOf(store: Store, kind: string, id: string) {
    if (kind === "tasks") {
        const task = await store.task(id);
        if (!task) throw new HttpError(404, "task.notFound", { task: id });
        const thread = task.thread ?? task.id;
        const tree = task.workspace === "worktree" ? thread : null;
        return { owner: `task:${thread}`, repoId: task.repo, tree, thread };
    }
    const run = await store.run(id);
    if (!run) throw new HttpError(404, "run.notFound", { run: id });
    const folder = runFolder(run);
    return { owner: `run:${folder}`, repoId: run.repo, tree: folder, thread: null };
}

// The line that resumes the thread's last Claude session by hand, on the login it ran on; a
// pasted token stays in its file.
async function takeOver(store: Store, cfg: Config, repo: Repo, owner: string, folder: string) {
    const last = (await store.threadTasks(owner)).findLast(
        (step) => step.agent === "claude" && step.sessionId,
    );
    if (!last?.sessionId) return null;
    const spec = AGENT_SPECS.claude;
    const login = await agentHome(
        store,
        cfg,
        last.author,
        "claude",
        repo.agents.logins.claude ?? null,
    ).catch(() => null);
    if (!login) return null;
    const vars = [
        ...(login.home ? [`HOME=${shellQuote(login.home)}`] : []),
        ...(spec.configEnv && login.env[spec.configEnv]
            ? [`${spec.configEnv}=${shellQuote(login.env[spec.configEnv] as string)}`]
            : []),
        ...(spec.tokenEnv && login.env[spec.tokenEnv]
            ? [`${spec.tokenEnv}="$(cat ${shellQuote(join(login.dir, TOKEN_FILE))})"`]
            : []),
    ];
    const onPath = (process.env.PATH ?? "").split(delimiter).includes(dirname(cfg.claude));
    const bin = onPath ? basename(cfg.claude) : shellQuote(cfg.claude);
    return `cd ${shellQuote(folder)} && ${[...vars, bin, "--resume", last.sessionId].join(" ")}`;
}

// The terminals of a task's thread or a workflow run. REST only, as the maintainer decided: they are the panel's, for a
// person at the keyboard; a step's agent has its own shell.
export async function terminalsRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    url: URL,
): Promise<Answer | undefined> {
    const match = ROUTE.exec(url.pathname);
    if (!match) return undefined;
    const [, kind = "", id = "", sub, action] = match;
    const method = req.method;
    const { owner, repoId, tree, thread } = await ownerOf(store, kind, id);
    const repo = await store.repo(repoId);
    if (!repo) throw new HttpError(404, "repo.notRegistered", { repo: repoId });
    const folder = folderOf(cfg, repo, tree);
    if (!sub) {
        if (method === "GET") {
            const pty = await loadPty();
            return [
                200,
                {
                    available: typeof pty !== "string",
                    ...(typeof pty === "string" ? { reason: pty } : { shells: shells() }),
                    sessions: terminalsOf(owner),
                    folder,
                    host: hostname(),
                    takeOver:
                        folder && thread ? await takeOver(store, cfg, repo, thread, folder) : null,
                },
            ];
        }
        if (method === "POST") {
            if (!folder) throw new HttpError(409, "terminal.noFolder");
            const body = await readJson(req);
            if (body.shell !== undefined && typeof body.shell !== "string")
                throw new HttpError(400, "terminal.unknownShell", { shell: String(body.shell) });
            const input = body.input === undefined ? "" : inputOf(body.input);
            const opened = await openTerminal({
                owner,
                repo: repo.id,
                cwd: folder,
                ...(body.shell === undefined ? {} : { shell: body.shell }),
                ...(typeof body.cols === "number" ? { cols: body.cols } : {}),
                ...(typeof body.rows === "number" ? { rows: body.rows } : {}),
            });
            if ("error" in opened) {
                if (opened.error === "unavailable")
                    throw new HttpError(409, "terminal.unavailable", { reason: opened.reason });
                if (opened.error === "tooMany") throw new HttpError(409, "terminal.tooMany");
                throw new HttpError(400, "terminal.unknownShell", { shell: String(body.shell) });
            }
            // A command picked from the Run menu is typed into the new shell.
            if (input) writeTerminal(opened.session.id, input);
            return [201, opened.session];
        }
        throw new HttpError(404, "request.notFound");
    }
    if (sub === "urls" && method === "GET") return [200, { urls: await detectedUrls(owner) }];
    if (sub === "commands" && method === "GET")
        return [
            200,
            folder
                ? projectCommands(folder, repo.settings.worktreeScripts.afterCreate.length > 0)
                : { commands: [], install: null },
        ];
    const session = terminal(sub);
    if (!session || session.owner !== owner)
        throw new HttpError(404, "terminal.notFound", { terminal: sub });
    if (!action && method === "DELETE") return [200, { stopped: closeTerminal(session.id) }];
    if (action === "output" && method === "GET")
        return [200, readTerminal(session.id, Number(url.searchParams.get("cursor") ?? 0))];
    if (action === "input" && method === "POST")
        return [200, { delivered: writeTerminal(session.id, inputOf((await readJson(req)).data)) }];
    if (action === "resize" && method === "POST") {
        const body = await readJson(req);
        return [200, { resized: resizeTerminal(session.id, body.cols, body.rows) }];
    }
    throw new HttpError(404, "request.notFound");
}

function inputOf(value: unknown): string {
    if (typeof value !== "string" || value.length > INPUT_MAX)
        throw new HttpError(400, "terminal.invalidInput", { max: INPUT_MAX });
    return value;
}
