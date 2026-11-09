import { projectAgent, runAgent, threadBlock } from "./agent-step.ts";
import { resumes } from "./agents.ts";
import type { Config } from "./config.ts";
import { labelPr } from "./github.ts";
import { cancelRunning, checkCancelled, claim, finalStatus, message, parked } from "./jobs.ts";
import { must } from "./proc.ts";
import { projectEnv } from "./project.ts";
import { openPullRequest, requestedBy } from "./pull-requests.ts";
import type {
    Child,
    JobKind,
    RunState,
    RunWait,
    Step,
    Store,
    Task,
    Usage,
    WorkflowRun,
} from "./store.ts";
import { emptyUsage, USAGE_FIELDS } from "./trace.ts";
import { notifyJob } from "./webhooks.ts";
import {
    type Advance,
    advance,
    type Definition,
    edgeKey,
    enter,
    forkShape,
    type GraphNode,
    isFailurePort,
    labelOf,
    mentionsTask,
    type NodeOf,
    nodeById,
    parseVerdict,
    render,
    SUMMARY_MAX,
    stripVerdict,
    type Transition,
    VERDICT_MARKER,
    verdictRequest,
    WALK_MAX,
} from "./workflow-graph.ts";
import {
    ahead,
    autosave,
    changedPaths,
    checkWrote,
    ciState,
    commentIssue,
    commentPr,
    commit,
    evaluate,
    markedIssue,
    type NodeResult,
    type NodeSite,
    prNumber,
    push,
    runCheck,
    sendWebhook,
    siteEnv,
    syncBase,
    updatePr,
} from "./workflow-nodes.ts";
import {
    branchOf,
    openWorktree,
    releaseWorktree,
    reopenWorktree,
    runFolder,
    setUp,
    type Worktree,
} from "./worktrees.ts";

const STEP_LOG_MAX = 20_000;

const runRequest = (body: string, input: string) =>
    `${body}\n\nThe user who started this workflow run asked:\n${input}`;

const prSummary = (run: WorkflowRun, steps: Step[], by: string) =>
    `${steps
        .filter((s) => s.type === "agent")
        .map((s) => {
            const node = nodeById(run.definition, s.node);
            return `- ${node ? labelOf(node) : s.node}: ${s.status}`;
        })
        .join("\n")}\n\n---\nOLIMP workflow \`${run.workflow}\`, run \`${run.id}\`${by}`;

// A field of the total is null only while no step reported it.
export function totalUsage(steps: Partial<Usage>[]): Usage {
    const total = emptyUsage();
    for (const step of steps)
        for (const field of USAGE_FIELDS) {
            const value = step[field];
            if (typeof value === "number") total[field] = (total[field] ?? 0) + value;
        }
    return total;
}

const newState = (): RunState => ({
    outputs: {},
    loops: {},
    sessions: {},
    transitions: [],
    wait: null,
    failedCheck: null,
    walked: 0,
});

const TRANSITIONS_MAX = 500;
const SUB_DEPTH_MAX = 3;
const REVIEW_REQUEST =
    "You are a reviewer in this step, not an implementer: read the changes on this branch " +
    "against its base (`git log`, `git diff`), report what you find and change no file.\n\n";

const budgetNote = (usd: number | undefined) =>
    usd ? `\n\nBudget: keep this work under $${usd} of agent usage.` : "";

interface Walk {
    store: Store;
    cfg: Config;
    wr: WorkflowRun;
    def: Definition;
    state: RunState;
    steps: Step[];
    w: Worktree;
    site: NodeSite;
    signal: AbortSignal;
    by: string;
    // The earlier runs of the thread, which every agent step reads first; empty for a first run.
    thread: string;
}

type Outcome = (NodeResult & { from?: string }) | { wait: Omit<RunWait, "node" | "since"> };

const text = (walk: Walk, value: string) =>
    render(value, walk.wr.input ?? "", walk.state.outputs, walk.state.loops, walk.def);

// A prompt that never names {{task}} gets the run's request after it, as before templates.
function agentPrompt(walk: Walk, prompt: string): string {
    const rendered = text(walk, prompt);
    const asked =
        walk.wr.input && !mentionsTask(prompt) ? runRequest(rendered, walk.wr.input) : rendered;
    return walk.thread + asked;
}

const inMs = (ms: number | undefined) => (ms ? new Date(Date.now() + ms).toISOString() : null);

async function agentNode(walk: Walk, node: NodeOf<"agent">, step: Step): Promise<NodeResult> {
    const { store, cfg, wr, state } = walk;
    const agent = node.agent ?? (await projectAgent(store, wr.repo));
    let prompt = agentPrompt(walk, node.prompt);
    const failedCheck = state.failedCheck;
    if (failedCheck && !node.prompt.includes(`nodes.${failedCheck.node}.output`))
        prompt += `\n\nThe check \`${failedCheck.node}\` failed with this output:\n${failedCheck.output}`;
    state.failedCheck = null;
    if (node.verdicts?.length) prompt += `\n\n${verdictRequest(node.verdicts)}`;
    const notes: string[] = [];
    let resume: string | null = null;
    const target = node.session?.continue;
    if (target) {
        const session = state.sessions[target];
        const why = !session
            ? `${target} has no session yet`
            : session.agent !== agent
              ? `${target} ran on ${session.agent}`
              : !resumes(agent)
                ? `${agent} cannot continue a session`
                : null;
        if (why) notes.push(`starting a fresh session: ${why}`);
        else resume = session?.id ?? null;
    }
    step.agent = agent;
    const call = (body: string, session: string | null) =>
        runAgent(
            store,
            cfg,
            walk.w.tree,
            {
                title: labelOf(node),
                body,
                agent,
                skill: node.skill ?? null,
                integrations: node.integrations ?? [],
                model: node.model ?? null,
                resume: session,
                ...(node.allowedTools && { tools: node.allowedTools }),
                ...(node.bashAllowlist && { commands: node.bashAllowlist }),
            },
            { repo: wr.repo, task: null, run: wr.id, node: node.id, author: wr.author },
            walk.signal,
        );
    let result = await call(prompt, resume);
    let usage = result.usage;
    let verdict: string | null = null;
    if (result.ok && node.verdicts?.length) {
        verdict = parseVerdict(result.output, node.verdicts);
        if (!verdict && result.sessionId && resumes(agent)) {
            checkCancelled(walk.signal);
            notes.push("no verdict marker: asking the agent once more");
            const nudge = await call(
                `You did not end with a verdict. ${verdictRequest(node.verdicts)}`,
                result.sessionId,
            );
            usage = totalUsage([usage, nudge.usage]);
            if (nudge.ok) verdict = parseVerdict(nudge.output, node.verdicts);
            result = { ...nudge, output: nudge.output || result.output };
        }
    }
    if (result.sessionId) state.sessions[node.id] = { agent, id: result.sessionId };
    Object.assign(step, usage);
    state.outputs[node.id] = {
        summary: stripVerdict(result.output.trim()).slice(-SUMMARY_MAX),
        verdict: verdict ?? "",
        costUsd: usage.costUsd ?? 0,
        status: result.ok ? "done" : "failed",
    };
    const log = [...notes, result.output].filter(Boolean).join("\n").slice(-STEP_LOG_MAX);
    if (!result.ok) return { port: "failed", log, error: result.error ?? "agent failed" };
    if (node.verdicts?.length && !verdict)
        return {
            port: "failed",
            log,
            error: `no verdict: expected one of ${node.verdicts.map((v) => `${VERDICT_MARKER} ${v}`).join(", ")}`,
        };
    return { port: verdict ?? "done", log };
}

async function checkNode(walk: Walk, node: NodeOf<"check">): Promise<NodeResult> {
    const command = text(walk, node.command);
    const before = walk.site.git ? await changedPaths(walk.site.tree) : null;
    const done = await runCheck(walk.site, command, walk.cfg.taskTimeoutMs);
    checkCancelled(walk.signal);
    if (before) Object.assign(walk.site.checkOwned, await checkWrote(walk.site.tree, before));
    walk.state.outputs[node.id] = { exitCode: done.code, output: done.output };
    if (done.code === 0) {
        walk.state.failedCheck = null;
        return { port: "pass", log: done.output };
    }
    if (node.retryOn?.length && !node.retryOn.includes(done.code))
        throw new Error(
            `check ${node.id} exited ${done.code}, which its retryOn (${node.retryOn.join(", ")}) ` +
                "does not retry",
        );
    walk.state.failedCheck = { node: node.id, output: done.output };
    return { port: "fail", log: done.output, error: `\`${command}\` exited ${done.code}` };
}

async function pullRequestNode(walk: Walk, node: NodeOf<"github.draft-pr">): Promise<NodeResult> {
    const { store, wr, w } = walk;
    // Open already (an earlier visit, or the thread's), it gets this run's commits.
    const existing = (await store.run(wr.id))?.prUrl ?? null;
    if (!w.commits)
        return {
            port: "created",
            log: "the project folder has no git: the change stays in it",
            outputs: { url: "", number: "" },
        };
    const title = node.title ? text(walk, node.title) : wr.name;
    const prUrl = await openPullRequest(
        walk.cfg,
        w,
        title,
        prSummary(wr, walk.steps, walk.by),
        existing,
        {
            committed: (await ahead(walk.site)) > 0,
            draft: node.draft ?? w.repo.settings.draftPr,
            checkOwned: walk.site.checkOwned,
        },
    );
    if (prUrl && prUrl !== existing) {
        await store.updateRun(wr.id, { prUrl });
        await labelPr(walk.cfg, w.repo, prUrl, w.repo.settings.prLabels);
    }
    return {
        port: "created",
        log: existing
            ? `pull request already open: ${existing}`
            : (prUrl ??
              (w.repo.github
                  ? "no changes, no pull request"
                  : "committed on the branch: a local project has no pull request")),
        outputs: { url: prUrl ?? "", number: prNumber(prUrl) ?? "" },
    };
}

async function subtaskOf(
    walk: Walk,
    node: { id: string; name?: string },
    body: string,
    template: Partial<Task>,
): Promise<Task> {
    return walk.store.createTask({
        repo: walk.wr.repo,
        title: `${walk.wr.name}: ${labelOf(node)}`,
        body,
        agent: template.agent ?? (await projectAgent(walk.store, walk.wr.repo)),
        skill: template.skill ?? null,
        integrations: template.integrations ?? [],
        model: template.model ?? null,
        author: walk.wr.author,
        parentRun: walk.wr.id,
    });
}

async function runDepth(store: Store, wr: WorkflowRun): Promise<number> {
    let depth = 0;
    for (let id = wr.parentRun; id && depth <= SUB_DEPTH_MAX; depth++)
        id = (await store.run(id))?.parentRun ?? null;
    return depth;
}

async function execute(walk: Walk, node: GraphNode, step: Step): Promise<Outcome> {
    const { store, wr, site, state } = walk;
    const prUrl = async () => (await store.run(wr.id))?.prUrl ?? null;
    const before = (what: string) => autosave(site, `olimp: ${wr.name}, before ${what}`);
    switch (node.type) {
        case "agent":
            return agentNode(walk, node, step);
        case "check":
            return checkNode(walk, node);
        case "if": {
            const { result, value } = await evaluate(site, node.condition, state.outputs);
            state.outputs[node.id] = { result: String(result), value };
            return { port: result ? "true" : "false", log: `${node.condition.kind}: ${value}` };
        }
        case "gate.human":
            return {
                wait: {
                    kind: "gate",
                    question: text(walk, node.message),
                    until: inMs(node.timeoutMs),
                },
            };
        case "ask-user":
            return {
                wait: {
                    kind: "ask",
                    question: text(walk, node.question),
                    ...(node.options && { options: node.options }),
                    until: inMs(node.timeoutMs),
                },
            };
        case "github.wait-ci": {
            const number = prNumber(await prUrl());
            if (number === null) {
                state.outputs[node.id] = { status: "no-pr" };
                return { port: "failed", log: "", error: "this run has no pull request" };
            }
            const sha = walk.w.commits
                ? await must("git", ["-C", walk.w.tree, "rev-parse", "HEAD"])
                : undefined;
            return {
                wait: {
                    kind: "ci",
                    pr: number,
                    ...(sha && { sha }),
                    pollMs: node.pollMs,
                    until: inMs(node.timeoutMs),
                },
            };
        }
        case "dispatch": {
            await before(`subtask ${node.id}`);
            const task = await subtaskOf(
                walk,
                node,
                agentPrompt(walk, node.prompt) + budgetNote(node.budgetUsd),
                { ...(node.agent && { agent: node.agent }), model: node.model ?? null },
            );
            return {
                wait: {
                    kind: "children",
                    children: [{ kind: "task", id: task.id, node: node.id }],
                    mode: "all",
                    until: null,
                },
            };
        }
        case "fork": {
            const shape = forkShape(walk.def, node.id);
            if ("code" in shape) throw new Error(`fork ${node.id}: ${shape.code}`);
            await before(`fork ${node.id}`);
            const children: Child[] = [];
            for (const { agent } of shape.branches) {
                const body =
                    (agent.review ? REVIEW_REQUEST : "") +
                    agentPrompt(walk, agent.prompt || "{{task}}") +
                    budgetNote(agent.budgetUsd);
                const task = await subtaskOf(walk, agent, body, {
                    ...(agent.agent && { agent: agent.agent }),
                    skill: agent.skill ?? null,
                    integrations: agent.integrations ?? [],
                    model: agent.model ?? null,
                });
                children.push({
                    kind: "task",
                    id: task.id,
                    node: agent.id,
                    ...(agent.review && { review: true }),
                });
            }
            return { wait: { kind: "children", children, mode: shape.wait, until: null } };
        }
        case "workflow": {
            const sub = await store.workflow(node.workflow);
            if (!sub || sub.repo !== wr.repo)
                return { port: "failed", log: "", error: `no workflow ${node.workflow} here` };
            if ((await runDepth(store, wr)) >= SUB_DEPTH_MAX)
                return {
                    port: "failed",
                    log: "",
                    error: `sub-workflows nest at most ${SUB_DEPTH_MAX} deep`,
                };
            await before(`sub-workflow ${node.id}`);
            const input = text(walk, node.prompt ?? "{{task}}") + budgetNote(node.budgetUsd);
            const child = await store.createRun(sub, null, wr.author, null, input || null, wr.id);
            return {
                wait: {
                    kind: "children",
                    children: [{ kind: "run", id: child.id, node: node.id }],
                    mode: "all",
                    until: null,
                },
            };
        }
        case "git.commit":
            return commit(site, text(walk, node.message));
        case "git.push":
            return push(site);
        case "git.sync-base":
            return syncBase(site);
        case "github.draft-pr":
            return pullRequestNode(walk, node);
        case "github.pr-update":
            return updatePr(site, await prUrl(), node);
        case "github.pr-comment":
            return commentPr(site, await prUrl(), text(walk, node.body));
        case "github.issue-comment":
            return commentIssue(
                site,
                node.issue ?? markedIssue(state.outputs),
                text(walk, node.body),
            );
        case "notify.webhook":
            return sendWebhook(site, text(walk, node.url), {
                text: text(walk, node.body ?? "OLIMP: {{task}}"),
                run: { id: wr.id, name: wr.name, status: "running", prUrl: await prUrl() },
                node: node.id,
            });
        default:
            return { port: "failed", log: "", error: `a ${node.type} node cannot run by itself` };
    }
}

async function childResult(store: Store, child: Child) {
    if (child.kind === "task") {
        const task = await store.task(child.id);
        return {
            status: task?.status ?? "failed",
            summary: (task?.log || task?.error || "").slice(-SUMMARY_MAX),
        };
    }
    const run = await store.run(child.id);
    const last = run?.steps.findLast((s) => s.type === "agent");
    return {
        status: run?.status ?? "failed",
        summary: (last?.log || run?.error || "").slice(-SUMMARY_MAX),
    };
}

// What ended the wait decides the port the node leaves by; a fork leaves from its join.
async function settle(walk: Walk, node: GraphNode, wait: RunWait): Promise<Outcome> {
    const { state } = walk;
    switch (wait.kind) {
        case "gate":
            if (wait.timedOut) return { port: "timeout", log: "no answer in time" };
            state.outputs[node.id] = { comment: wait.comment ?? "" };
            return {
                port: wait.answer === "approve" ? "approve" : "reject",
                log: [wait.answer, wait.comment].filter(Boolean).join(": "),
            };
        case "ask":
            if (wait.timedOut) return { port: "timeout", log: "no answer in time" };
            state.outputs[node.id] = { answer: wait.answer ?? "" };
            return { port: "answered", log: wait.answer ?? "" };
        case "ci":
            if (wait.timedOut) {
                state.outputs[node.id] = { status: "timeout" };
                return { port: "timeout", log: "CI did not settle in time" };
            }
            state.outputs[node.id] = { status: wait.ci ?? "" };
            return {
                port: wait.ci === "passing" ? "green" : "red",
                log:
                    wait.ci === "conflict"
                        ? "the pull request conflicts with its base branch"
                        : `CI ${wait.ci}`,
            };
        case "children": {
            const children = wait.children ?? [];
            const results = await Promise.all(children.map((c) => childResult(walk.store, c)));
            if (node.type !== "fork") {
                const [child, result] = [children[0], results[0]];
                if (!child || !result) return { port: "failed", log: "", error: "no subtask" };
                const key = child.kind === "task" ? "taskId" : "runId";
                state.outputs[node.id] = { [key]: child.id, ...result };
                const ok = result.status === "done";
                return {
                    port: ok ? "done" : "failed",
                    log: result.summary,
                    ...(!ok && { error: `the ${child.kind} ${child.id} ended ${result.status}` }),
                };
            }
            const shape = forkShape(walk.def, node.id);
            if ("code" in shape) throw new Error(`fork ${node.id}: ${shape.code}`);
            let succeeded = 0;
            const now = new Date().toISOString();
            children.forEach((child, i) => {
                const result = results[i] ?? { status: "failed", summary: "" };
                const ok = result.status === "done";
                if (ok) succeeded++;
                state.outputs[child.node] = { taskId: child.id, ...result };
                walk.steps.push({
                    node: child.node,
                    type: "agent",
                    status: ok ? "done" : "failed",
                    startedAt: wait.since,
                    finishedAt: now,
                    log: result.summary,
                    error: ok ? null : `the subtask ended ${result.status}`,
                    port: ok ? "done" : "failed",
                    children: [child],
                });
                const branch = shape.branches.find((b) => b.agent.id === child.node);
                if (branch)
                    walk.state.transitions.push(
                        { from: node.id, port: branch.port, to: child.node },
                        { from: child.node, port: ok ? "done" : "failed", to: shape.join },
                    );
            });
            const failedCount = children.length - succeeded;
            state.outputs[node.id] = { taskIds: children.map((c) => c.id).join(",") };
            state.outputs[shape.join] = { succeeded, failed: failedCount };
            const ok = shape.wait === "any" ? succeeded > 0 : failedCount === 0;
            return {
                port: ok ? "done" : "failed",
                from: shape.join,
                log: `${succeeded} of ${children.length} branches succeeded`,
                ...(!ok && { error: `${failedCount} of ${children.length} branches failed` }),
            };
        }
    }
}

const record = (state: RunState, transitions: Transition[]) => {
    state.transitions.push(...transitions);
    state.transitions = state.transitions.slice(-TRANSITIONS_MAX);
};

// Walks the graph in one worktree, so every step sees the changes of the steps before it. A node
// that waits parks the run: it gives its worker slot back and keeps its worktree, and an answer,
// CI or its subtasks queue it again, to go on from that node.
export async function runWorkflow(store: Store, cfg: Config, wr: WorkflowRun): Promise<void> {
    // A continuation works in its thread's worktree, on the branch of the thread's first run.
    const folder = runFolder(wr);
    const job = await claim(store, "run", wr.id, wr.branch ?? branchOf(folder));
    if (!job) return;
    const def = wr.definition;
    const state = wr.state ?? newState();
    const steps = [...wr.steps];
    let w: Worktree | null = null;
    let waiting = false;
    const save = (patch: Parameters<Store["updateRun"]>[1] = {}) =>
        store.updateRun(wr.id, { steps, state, ...totalUsage(steps), ...patch });
    try {
        checkCancelled(job.signal);
        const resumed = state.wait;
        if (resumed) w = await reopenWorktree(store, cfg, wr);
        else if (state.resumeAt) {
            w = await reopenWorktree(store, cfg, wr, true);
            await setUp(w);
        } else {
            const parent = wr.parentRun ? await store.run(wr.parentRun) : undefined;
            w = await openWorktree(
                store,
                cfg,
                wr.repo,
                folder,
                branchOf(folder),
                wr.thread !== null,
                parent ? (parent.branch ?? branchOf(parent.id)) : null,
                Boolean(parent) || wr.thread !== null,
            );
            await setUp(w);
        }
        // The thread's worktree is this run's now; parked, nothing reclaims it meanwhile.
        parked.add(folder);
        const earlier = wr.thread
            ? (await store.threadRuns(wr.thread)).filter(
                  (r) => r.id !== wr.id && r.createdAt <= wr.createdAt,
              )
            : [];
        // The thread's pull request gets the continuation's commits instead of a second one.
        const prUrl = earlier.findLast((r) => r.prUrl)?.prUrl;
        if (prUrl && !wr.prUrl) await store.updateRun(wr.id, { prUrl });
        state.checkOwned ??= {};
        const walk: Walk = {
            store,
            cfg,
            wr,
            def,
            state,
            steps,
            w,
            site: {
                cfg,
                repo: w.repo,
                tree: w.tree,
                branch: w.branch,
                git: w.commits,
                signal: job.signal,
                env: siteEnv(await projectEnv(store, cfg, wr.repo)),
                checkOwned: state.checkOwned,
            },
            signal: job.signal,
            by: await requestedBy(store, wr.author),
            thread: threadBlock(
                earlier.map((r) => ({
                    id: r.id,
                    status: r.status,
                    title: r.name,
                    body: r.input ?? "",
                    log: r.steps.findLast((s) => s.type === "agent")?.log ?? "",
                    issue: null,
                })),
            ),
        };
        const finish = (step: Step, out: NodeResult) =>
            Object.assign(step, {
                status: isFailurePort(out.port) ? "failed" : "done",
                port: out.port,
                log: out.log.slice(-STEP_LOG_MAX),
                error: out.error ?? (isFailurePort(out.port) ? `ended on ${out.port}` : null),
                finishedAt: new Date().toISOString(),
            });
        let at: Advance;
        if (resumed) {
            const node = nodeById(def, resumed.node);
            if (!node) throw new Error(`node ${resumed.node} is gone from the run`);
            const step =
                steps.findLast((s) => s.node === node.id && s.status === "waiting") ??
                (steps[steps.push(newStep(node)) - 1] as Step);
            step.status = "running";
            state.wait = null;
            await save({ currentNode: node.id });
            const out = await settle(walk, node, resumed);
            if ("wait" in out) throw new Error(`node ${node.id} cannot wait twice`);
            finish(step, out);
            // A fork leaves from its join, whose port is not one of the fork's.
            if (out.from) step.port = null;
            at = advance(def, out.from ?? node.id, out.port, state.loops);
        } else if (state.resumeAt) {
            const node = nodeById(def, state.resumeAt);
            if (!node) throw new Error(`node ${state.resumeAt} is gone from the run`);
            state.resumeAt = null;
            at = { kind: "node", node, transitions: [] };
        } else at = enter(def, state.loops);
        while (at.kind === "node") {
            record(state, at.transitions);
            if (++state.walked > WALK_MAX) throw new Error(`the run walked ${WALK_MAX} nodes`);
            checkCancelled(job.signal);
            const node = at.node;
            const step = newStep(node);
            steps.push(step);
            await save({ currentNode: node.id });
            try {
                const out = await execute(walk, node, step);
                checkCancelled(job.signal);
                if ("wait" in out) {
                    state.wait = { node: node.id, since: new Date().toISOString(), ...out.wait };
                    Object.assign(step, {
                        status: "waiting",
                        ...(out.wait.children && { children: out.wait.children }),
                    });
                    waiting = true;
                    await save({ status: "waiting", currentNode: node.id });
                    void notifyJob(store, cfg, "run", wr.id);
                    return;
                }
                if (out.outputs) state.outputs[node.id] = out.outputs;
                finish(step, out);
                await save();
                at = advance(def, out.from ?? node.id, out.port, state.loops);
            } catch (error) {
                if (step.status === "running") {
                    const { status, error: reason } = finalStatus(error);
                    Object.assign(step, {
                        status,
                        error: reason,
                        finishedAt: new Date().toISOString(),
                    });
                    await save();
                }
                throw error;
            }
        }
        record(state, at.transitions);
        const failedStep = steps.findLast((s) => s.status === "failed");
        const last = at.transitions.at(-1);
        await save({
            status: at.status,
            currentNode: null,
            error:
                at.status === "failed"
                    ? failedStep
                        ? `step ${failedStep.node}: ${failedStep.error}`
                        : `ended at ${last?.to ?? edgeKey(last?.from ?? "", last?.port ?? "")}`
                    : null,
        });
    } catch (error) {
        await store.updateRun(wr.id, { ...finalStatus(error), steps, state });
    } finally {
        if (w && !waiting) {
            // The worktree goes and the branch stays: a run with no git step would lose its changes.
            if (!w.inPlace)
                await autosave(
                    { tree: w.tree, git: w.commits, checkOwned: state.checkOwned ?? {} },
                    `olimp: ${wr.name}, end of run`,
                ).catch((error) => console.error(`run ${wr.id}: autosave ${error}`));
            await releaseWorktree(store, w);
        }
        job.done();
        if (!waiting) {
            parked.delete(folder);
            void notifyJob(store, cfg, "run", wr.id);
            await settleParent(store, cfg, "run", wr.id);
        }
    }
}

const newStep = (node: GraphNode): Step => ({
    node: node.id,
    type: node.type,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    log: "",
    error: null,
});

const FINAL = new Set(["done", "failed", "cancelled"]);
const ended = (status: string) => FINAL.has(status);

async function childStatus(store: Store, child: Child): Promise<string> {
    const job = child.kind === "task" ? await store.task(child.id) : await store.run(child.id);
    return job?.status ?? "failed";
}

async function cancelJob(store: Store, cfg: Config, child: Child, reason: string): Promise<void> {
    if (await store.cancelQueued(child.kind, child.id, reason)) return;
    const run = child.kind === "run" ? await store.run(child.id) : undefined;
    if (run?.status === "waiting") await cancelWaitingRun(store, cfg, run, reason);
    else await cancelRunning(child.id, reason);
}

// A run waiting for its subtasks goes on once they ended, or once one succeeded when it takes the
// first; the others are then cancelled.
async function wakeIfSettled(store: Store, cfg: Config, run: WorkflowRun): Promise<void> {
    const wait = run.state?.wait;
    if (run.status !== "waiting" || wait?.kind !== "children" || !run.state) return;
    const children = wait.children ?? [];
    const statuses = await Promise.all(children.map((c) => childStatus(store, c)));
    const winner = wait.mode === "any" && statuses.includes("done");
    if (!winner && !statuses.every(ended)) return;
    if (winner)
        for (const [i, child] of children.entries())
            if (!ended(statuses[i] ?? "failed"))
                await cancelJob(store, cfg, child, "cancelled: another branch finished first");
    await store.resumeRun(run.id, run.state);
}

export async function settleParent(
    store: Store,
    cfg: Config,
    kind: JobKind,
    id: string,
): Promise<void> {
    try {
        const job = kind === "task" ? await store.task(id) : await store.run(id);
        const parent = job?.parentRun ? await store.run(job.parentRun) : undefined;
        if (parent) await wakeIfSettled(store, cfg, parent);
    } catch (error) {
        console.error(`the run waiting for ${kind} ${id}: ${message(error)}`);
    }
}

// A person's answer to the gate or question a run waits at; false when it does not wait for one.
export async function answerRun(
    store: Store,
    run: WorkflowRun,
    answer: string,
    comment: string | null,
    by: string | null,
): Promise<boolean> {
    const wait = run.state?.wait;
    if (run.status !== "waiting" || !run.state || (wait?.kind !== "gate" && wait?.kind !== "ask"))
        return false;
    return store.resumeRun(run.id, {
        ...run.state,
        wait: { ...wait, answer, ...(comment && { comment }), answeredBy: by },
    });
}

// A failed run goes on from the step it failed at, with its outputs, loop counters and sessions;
// false when its last step did not fail (an end node that fails is the run's answer, not an error).
export async function resumeFailedRun(store: Store, run: WorkflowRun): Promise<boolean> {
    const last = run.steps.at(-1);
    if (run.status !== "failed" || !run.state || last?.status !== "failed") return false;
    return store.resumeRun(run.id, { ...run.state, resumeAt: last.node }, "failed");
}

export async function cancelWaitingRun(
    store: Store,
    cfg: Config,
    run: WorkflowRun,
    reason: string,
): Promise<boolean> {
    if (!(await store.cancelWaiting(run.id, reason))) return false;
    const now = new Date().toISOString();
    await store.updateRun(run.id, {
        currentNode: null,
        steps: run.steps.map((s) =>
            s.status === "waiting"
                ? { ...s, status: "cancelled", finishedAt: now, error: reason }
                : s,
        ),
    });
    for (const child of run.state?.wait?.children ?? []) await cancelJob(store, cfg, child, reason);
    parked.delete(runFolder(run));
    try {
        await releaseWorktree(store, await reopenWorktree(store, cfg, run));
    } catch (error) {
        console.error(`worktree of run ${run.id}: ${message(error)}`);
    }
    void notifyJob(store, cfg, "run", run.id);
    await settleParent(store, cfg, "run", run.id);
    return true;
}

// Timeouts, CI and subtasks that ended while nobody was told (a restart) wake waiting runs.
export async function checkWait(
    store: Store,
    cfg: Config,
    run: WorkflowRun,
    polled: Map<string, number> = new Map(),
): Promise<void> {
    const wait = run.state?.wait;
    if (run.status !== "waiting" || !wait || !run.state) return;
    if (wait.until && Date.parse(wait.until) <= Date.now()) {
        await store.resumeRun(run.id, { ...run.state, wait: { ...wait, timedOut: true } });
        return;
    }
    if (wait.kind === "children") return wakeIfSettled(store, cfg, run);
    if (wait.kind !== "ci" || !wait.pr || (polled.get(run.id) ?? 0) > Date.now()) return;
    polled.set(run.id, Date.now() + (wait.pollMs ?? 60_000));
    const repo = await store.repo(run.repo);
    const ci = repo ? await ciState(cfg, repo, wait.pr, wait.sha) : "pending";
    if (ci !== "pending") await store.resumeRun(run.id, { ...run.state, wait: { ...wait, ci } });
}

export function startWaits(store: Store, cfg: Config, intervalMs = 10_000): () => void {
    const polled = new Map<string, number>();
    let busy = false;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try {
            for (const run of await store.waitingRuns()) {
                parked.add(runFolder(run));
                await checkWait(store, cfg, run, polled);
            }
        } catch (error) {
            console.error(`waiting runs: ${message(error)}`);
        } finally {
            busy = false;
        }
    };
    void tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
}
