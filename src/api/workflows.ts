import type { IncomingMessage } from "node:http";
import type { Config } from "../config.ts";
import { HttpError, readJson, text } from "../http.ts";
import { BUILD_REQUEST_MAX, NAME_MAX, TASK_BODY_MAX, WORKFLOW_DESCRIPTION_MAX } from "../limits.ts";
import { listSkills } from "../skills.ts";
import type { Store, User, WorkflowInput } from "../store.ts";
import { buildWorkflow } from "../workflow-builder.ts";
import { answerRun, cancelWaitingRun, resumeFailedRun } from "../workflow-runner.ts";
import { type Definition, parseDefinition } from "../workflows.ts";
import {
    type Answer,
    cancel,
    changesOf,
    inputError,
    known,
    pinnerOf,
    registered,
    resolved,
} from "./shared.ts";

const agentNodes = (definition: Definition) => definition.nodes.filter((n) => n.type === "agent");

// Agent steps name skills the same way as tasks; the sources are fetched once per definition.
async function definitionOf(
    store: Store,
    cfg: Config,
    home: string,
    value: unknown,
): Promise<Definition> {
    let definition: Definition;
    try {
        definition = parseDefinition(value);
    } catch (error) {
        inputError(error);
    }
    const agents = agentNodes(definition);
    if (agents.some((n) => n.skill)) {
        const skills = await listSkills(store, cfg, home);
        for (const node of agents) if (node.skill) node.skill = resolved(skills, node.skill);
    }
    return definition;
}

// The integrations of agent steps are checked against the workflow's repository, also when only
// the repository changes.
async function workflowInput(
    store: Store,
    cfg: Config,
    home: string,
    body: Record<string, unknown>,
    base?: WorkflowInput,
): Promise<WorkflowInput> {
    const repo = base && body.repo === undefined ? base.repo : await registered(store, body.repo);
    const definition =
        base && body.definition === undefined
            ? base.definition
            : await definitionOf(store, cfg, home, body.definition);
    if (!base || body.definition !== undefined || repo !== base.repo) {
        for (const node of agentNodes(definition))
            await known(store, repo, node.integrations ?? []);
        // A sub-workflow node runs a workflow of the same repository, never the one it is in.
        for (const node of definition.nodes) {
            if (node.type !== "workflow") continue;
            const sub = await store.workflow(node.workflow);
            if (!sub || sub.repo !== repo || (base && "id" in base && sub.id === base.id))
                throw new HttpError(400, "workflow.unknownSubWorkflow", {
                    node: node.id,
                    workflow: node.workflow,
                });
        }
    }
    return {
        name: base && body.name === undefined ? base.name : text(body.name, "name", NAME_MAX),
        description:
            base && body.description === undefined
                ? (base.description ?? "")
                : text(body.description ?? "", "description", WORKFLOW_DESCRIPTION_MAX, false),
        repo,
        definition,
    };
}

export async function workflowsRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    actor: User | null,
    home: string,
): Promise<Answer | undefined> {
    const method = req.method;
    const author = actor?.id ?? null;
    const pinner = pinnerOf(actor);
    if (path === "/api/workflows") {
        if (method === "GET") return [200, await store.workflows()];
        if (method === "POST") {
            const input = await workflowInput(store, cfg, home, await readJson(req));
            return [201, await store.createWorkflow(input, author)];
        }
    }
    if (path === "/api/workflows/build" && method === "POST") {
        const body = await readJson(req);
        const repo = await registered(store, body.repo);
        const request = text(body.request, "request", BUILD_REQUEST_MAX);
        return [200, await buildWorkflow(store, cfg, home, author, repo, request)];
    }
    const flow = /^\/api\/workflows\/([0-9a-f]{12})(\/run)?$/.exec(path);
    const workflow = flow && (await store.workflow(flow[1] as string));
    if (flow && workflow) {
        if (flow[2] && method === "POST") {
            const input = text((await readJson(req)).input, "input", TASK_BODY_MAX, false);
            return [201, await store.createRun(workflow, null, author, null, input || null)];
        }
        if (!flow[2] && method === "GET") return [200, workflow];
        if (!flow[2] && method === "PATCH") {
            const input = await workflowInput(store, cfg, home, await readJson(req), workflow);
            return [200, await store.updateWorkflow(workflow.id, input)];
        }
        if (!flow[2] && method === "DELETE") {
            const users = await store.automationsOf(workflow.id);
            if (users.length)
                throw new HttpError(409, "workflow.inUse", {
                    workflow: workflow.id,
                    automations: users.map((a) => a.id).join(", "),
                });
            await store.deleteWorkflow(workflow.id);
            return [200, workflow];
        }
    }
    if (path === "/api/workflow-runs" && method === "GET") return [200, await store.runs()];
    const runId =
        /^\/api\/workflow-runs\/([0-9a-f]{12})(?:\/(trace|changes|cancel|retry|resume|read|answer|thread|continue))?$/.exec(
            path,
        );
    if (runId) {
        const [, id = "", action] = runId;
        const found = await store.run(id);
        if (!found) throw new HttpError(404, "run.notFound", { run: id });
        if (!action && method === "GET") return [200, found];
        if (action === "trace" && method === "GET")
            return [200, { run: id, events: await store.agentEvents({ run: id }) }];
        if (action === "changes" && method === "GET")
            return [200, { run: id, ...(await changesOf(store, cfg, found.repo, found.branch)) }];
        if (action === "cancel" && method === "POST") {
            const reason = actor ? `cancelled by ${actor.name}` : "cancelled";
            if (
                !(found.status === "waiting" && (await cancelWaitingRun(store, cfg, found, reason)))
            )
                await cancel(store, "run", id, found.status, actor);
            return [200, await store.run(id)];
        }
        if (action === "answer" && method === "POST") {
            const body = await readJson(req);
            const wait = found.state?.wait;
            if (found.status !== "waiting" || (wait?.kind !== "gate" && wait?.kind !== "ask"))
                throw new HttpError(409, "run.notAsking", { run: id });
            const answer = text(body.answer, "answer", TASK_BODY_MAX);
            if (wait.kind === "gate" && answer !== "approve" && answer !== "reject")
                throw new HttpError(400, "run.invalidAnswer", { answer });
            const comment = text(body.comment ?? "", "comment", TASK_BODY_MAX, false) || null;
            if (!(await answerRun(store, found, answer, comment, actor?.id ?? null)))
                throw new HttpError(409, "run.notAsking", { run: id });
            return [200, await store.run(id)];
        }
        if (action === "read" && (method === "PUT" || method === "DELETE")) {
            await store.markRead(pinner, "run", id, method === "PUT");
            return [200, await store.reads(pinner)];
        }
        if (action === "retry" && method === "POST") {
            if (
                found.status === "queued" ||
                found.status === "running" ||
                found.status === "waiting"
            )
                throw new HttpError(409, "run.notFinished", { run: id, status: found.status });
            const copy = { ...found, id: found.workflow };
            return [
                201,
                await store.createRun(copy, null, author, id, found.input, null, found.thread),
            ];
        }
        if (action === "thread" && method === "GET")
            return [200, await store.threadRuns(found.thread ?? found.id)];
        if (action === "continue" && method === "POST") {
            const input = text((await readJson(req)).input, "input", TASK_BODY_MAX);
            const thread = found.thread ?? found.id;
            const last = (await store.threadRuns(thread)).at(-1) ?? found;
            if (last.status === "queued" || last.status === "running" || last.status === "waiting")
                throw new HttpError(409, "run.threadBusy", { run: last.id, status: last.status });
            // The workflow as it is now, unless it is gone or moved to another project.
            const workflow = await store.workflow(found.workflow);
            const template =
                workflow?.repo === found.repo ? workflow : { ...found, id: found.workflow };
            return [201, await store.createRun(template, null, author, null, input, null, thread)];
        }
        if (action === "resume" && method === "POST") {
            if (!(await resumeFailedRun(store, found)))
                throw new HttpError(409, "run.notResumable", { run: id, status: found.status });
            return [200, await store.run(id)];
        }
    }
    return undefined;
}
