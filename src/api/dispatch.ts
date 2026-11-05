import type { IncomingMessage } from "node:http";
import { SUBTASKS_MAX, tokenTask } from "../dispatch.ts";
import { HttpError, readJson, text } from "../http.ts";
import { TASK_BODY_MAX, TITLE_MAX } from "../limits.ts";
import type { Store, Task } from "../store.ts";
import type { Answer } from "./shared.ts";

// The agent of a dispatched task, through its own MCP server, with the token issued for that task:
// no account, and nothing but that task's subtasks.
export async function dispatchRoute(store: Store, req: IncomingMessage): Promise<Answer> {
    const token = req.headers["x-olimp-dispatch"];
    const id = typeof token === "string" ? tokenTask(token) : null;
    const parent = id ? await store.task(id) : undefined;
    if (!parent) throw new HttpError(401, "dispatch.invalidToken");
    if (parent.status !== "running")
        throw new HttpError(409, "dispatch.notRunning", { task: parent.id });
    const subtasks = await store.subtasks(parent.id);
    const list = (tasks: Task[]) =>
        tasks.map((t) => ({ id: t.id, title: t.title, status: t.status }));
    if (req.method === "GET") return [200, list(subtasks)];
    if (req.method !== "POST") throw new HttpError(404, "request.notFound");
    const max = parent.dispatch?.maxSubtasks ?? SUBTASKS_MAX;
    if (subtasks.length >= max) throw new HttpError(409, "dispatch.limit", { max });
    const body = await readJson(req);
    const created = await store.createTask({
        repo: parent.repo,
        title: text(body.title, "title", TITLE_MAX),
        body: text(body.body, "body", TASK_BODY_MAX),
        // A subtask on another agent than its parent takes that agent's default model.
        agent: parent.dispatch?.agent ?? parent.agent,
        model:
            parent.dispatch?.model ??
            (parent.dispatch?.agent && parent.dispatch.agent !== parent.agent
                ? null
                : parent.model),
        integrations: parent.integrations,
        parent: parent.id,
        author: parent.author,
    });
    return [201, { id: created.id, title: created.title, status: created.status }];
}
