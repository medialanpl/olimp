import { createHash, randomBytes } from "node:crypto";
import { extname, join } from "node:path";
import type { Servers } from "./agents.ts";
import type { Config } from "./config.ts";
import { run } from "./proc.ts";
import type { Dispatch, Store, Task } from "./store.ts";

// The server next to this module: .ts in a checkout, .js in the npm package.
const DISPATCH_SERVER_FILE = join(
    import.meta.dirname,
    `dispatch-mcp${extname(import.meta.filename)}`,
);
export const DISPATCH_SERVER = "olimp-dispatch";
export const SUBTASKS_MAX = 50;
export const IN_FLIGHT_MAX = 4;

// A dispatch token lets one task's agent add subtasks while it works; only its hash is kept, in
// this process, never in the database.
const tokens = new Map<string, string>();
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export function issueToken(task: string): string {
    const token = randomBytes(32).toString("base64url");
    tokens.set(digest(token), task);
    return token;
}

export function revokeToken(task: string): void {
    for (const [hash, owner] of tokens) if (owner === task) tokens.delete(hash);
}

export const tokenTask = (token: string): string | null => tokens.get(digest(token)) ?? null;

// The agent's own MCP server, the same Node as OLIMP's, talking to this API with the token.
export function dispatchServers(cfg: Config, token: string): Servers {
    return {
        [DISPATCH_SERVER]: {
            kind: "stdio",
            command: process.execPath,
            args: [DISPATCH_SERVER_FILE],
            env: { DISPATCH_URL: `http://127.0.0.1:${cfg.port}`, DISPATCH_TOKEN: token },
        },
    };
}

export const dispatchRequest = (dispatch: Dispatch) =>
    "\n\nDispatch mode: the user expects this task to be split. Do the shared groundwork " +
    "yourself, then add each independent part as a subtask with the dispatch_subtask tool of " +
    `the ${DISPATCH_SERVER} MCP server (at most ${dispatch.maxSubtasks}), with a title and a body that says ` +
    "exactly what to change and how to check it. Subtasks start after you finish, each in its " +
    "own worktree from your branch with your changes, so they must not depend on each other; a " +
    "later step of this thread merges them. Say in your answer which subtasks you added." +
    (dispatch.budgetUsd
        ? ` Size each subtask so that it costs at most about $${dispatch.budgetUsd}.`
        : "");

export const subtaskNote = (parent: Task) =>
    `\n\nThis is a subtask of the dispatched task "${parent.title}" (${parent.id}): do only this ` +
    "part, on top of that task's changes. A later step merges every subtask.";

// The merge step's request: what each subtask did, before OLIMP merges their branches.
export function mergeBody(subtasks: Task[]): string {
    const lines = subtasks.map(
        (t) =>
            `- ${t.title} (${t.id}, ${t.status}${t.branch ? `, branch ${t.branch}` : ""}): ` +
            `${(t.error ?? t.log).trim().split("\n")[0]?.slice(0, 300) || "no answer"}`,
    );
    return (
        "Merge the work of the subtasks below into this branch: OLIMP has already merged the " +
        "branches of the finished ones. Resolve any conflict markers left in files, make the " +
        "parts work together, run the project's checks and say what the result is.\n\n" +
        lines.join("\n")
    );
}

export interface Merged {
    merged: string[];
    conflicts: { branch: string; files: string[] }[];
    failed: { branch: string; error: string }[];
}

// Merge commits for each finished subtask; a conflict is committed with its markers, for the
// agent to resolve, so the next subtask still merges.
export async function mergeSubtasks(
    tree: string,
    subtasks: Task[],
    remote: string,
): Promise<Merged> {
    const result: Merged = { merged: [], conflicts: [], failed: [] };
    for (const task of subtasks) {
        if (task.status !== "done" || !task.branch) continue;
        const ref = `${remote}${task.branch}`;
        const message = `olimp: merge subtask ${task.title}`;
        const merge = await run("git", [
            "-C",
            tree,
            "merge",
            "--no-ff",
            "--no-edit",
            "-m",
            message,
            ref,
        ]);
        if (merge.code === 0) {
            result.merged.push(task.branch);
            continue;
        }
        const unmerged = await run("git", ["-C", tree, "diff", "--name-only", "--diff-filter=U"]);
        const files = unmerged.stdout.split("\n").filter(Boolean);
        if (files.length) {
            await run("git", ["-C", tree, "add", "-A"]);
            await run("git", ["-C", tree, "commit", "--no-edit", "-m", `${message} (conflicts)`]);
            result.conflicts.push({ branch: task.branch, files });
        } else {
            await run("git", ["-C", tree, "merge", "--abort"]);
            result.failed.push({
                branch: task.branch,
                error: (merge.stderr || merge.stdout).trim(),
            });
        }
    }
    return result;
}

export function mergedNote(merged: Merged): string {
    const parts = [
        merged.merged.length ? `Merged cleanly: ${merged.merged.join(", ")}.` : "",
        ...merged.conflicts.map(
            (c) =>
                `Merged ${c.branch} with conflicts, committed with their markers ` +
                `(<<<<<<< ======= >>>>>>>) in: ${c.files.join(", ")}. Resolve every one.`,
        ),
        ...merged.failed.map((f) => `Could not merge ${f.branch}: ${f.error}`),
    ].filter(Boolean);
    return parts.length ? `\n\n${parts.join("\n")}` : "";
}

// Once every subtask of a dispatched task has finished, one step of its thread merges them; the
// claim makes sure two subtasks finishing at once queue it only once.
export async function queueMerge(store: Store, parentId: string): Promise<Task | null> {
    const parent = await store.task(parentId);
    if (!parent) return null;
    const subtasks = await store.subtasks(parentId);
    if (!subtasks.length) return null;
    if (subtasks.some((t) => t.status === "queued" || t.status === "running")) return null;
    if (!subtasks.some((t) => t.status === "done")) return null;
    if (!(await store.claimDispatchMerge(parentId))) return null;
    const merge = await store.createTask({
        repo: parent.repo,
        title: parent.title,
        body: mergeBody(subtasks),
        agent: parent.agent,
        model: parent.model,
        skill: parent.skill,
        integrations: parent.integrations,
        thread: parent.thread ?? parent.id,
        parent: parent.id,
        author: parent.author,
    });
    await store.setDispatchMerge(parentId, merge.id);
    return merge;
}

// A dispatched task that did not finish well takes its queued subtasks with it.
export async function cancelSubtasks(
    store: Store,
    parentId: string,
    reason: string,
): Promise<void> {
    for (const task of await store.subtasks(parentId))
        if (task.status === "queued") await store.cancelQueued("task", task.id, reason);
}
