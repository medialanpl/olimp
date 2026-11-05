// Shared by the API and the panel, so it imports nothing at run time.
import type { AgentName } from "./agents.ts";

export const NODES_MAX = 50;
export const LOOP_MAX = 20;
export const FORK_MAX = 4;
export const OPTIONS_MAX = 6;
// A run walks at most this many nodes; loops are bounded, this only guards a broken graph.
export const WALK_MAX = 500;
export const WAIT_MIN_MS = 60_000;
export const WAIT_MAX_MS = 7 * 24 * 60 * 60_000;
export const POLL_MIN_MS = 10_000;
export const POLL_MAX_MS = 30 * 60_000;
export const SUMMARY_MAX = 4000;
export const CHECK_OUTPUT_MAX = 20_000;

export const NODE_ID = /^[A-Za-z\d][\w-]{0,49}$/;
export const VERDICT = /^[A-Za-z\d][\w-]{0,29}$/;

const ORDERING = [">", ">=", "<", "<="] as const;
export type NumericOp = (typeof ORDERING)[number] | "==";
export type OutputOp = (typeof ORDERING)[number] | "equals" | "not-equals" | "contains";
export const NUMERIC_OPS: NumericOp[] = [...ORDERING, "=="];
export const OUTPUT_OPS: OutputOp[] = ["equals", "not-equals", "contains", ...ORDERING];

export type Condition =
    | { kind: "diff-lines"; op: NumericOp; value: number }
    | { kind: "diff-files"; op: NumericOp; value: number }
    | { kind: "paths-changed"; glob: string }
    | { kind: "output"; ref: string; op: OutputOp; value: string | number }
    | { kind: "branch"; op: "equals" | "matches"; value: string };
export type ConditionKind = Condition["kind"];
export const CONDITION_KINDS: ConditionKind[] = [
    "diff-lines",
    "diff-files",
    "paths-changed",
    "output",
    "branch",
];

export type Category = "flow" | "agents" | "scripts" | "git";

// Per node type: its category, its output ports and what `{{nodes.<id>.<field>}}` may read after
// it ran, the lists written as space-separated words.
const SPECS = {
    start: ["flow", "next"],
    end: ["flow", ""],
    if: ["flow", "true false", "result value"],
    loop: ["flow", "repeat exhausted", "iteration max"],
    fork: ["flow", "1 2 3", "taskIds"],
    join: ["flow", "done failed", "succeeded failed"],
    "gate.human": ["flow", "approve reject", "comment"],
    workflow: ["flow", "done failed", "runId status summary"],
    agent: ["agents", "done failed", "summary verdict costUsd status"],
    dispatch: ["agents", "done failed", "taskId status summary"],
    "ask-user": ["agents", "answered", "answer"],
    check: ["scripts", "pass fail", "exitCode output"],
    "notify.webhook": ["scripts", "done failed", "status"],
    "git.commit": ["git", "done nothing failed", "sha"],
    "git.push": ["git", "done failed"],
    "git.sync-base": ["git", "done conflict failed", "conflicts"],
    "github.draft-pr": ["git", "created failed", "url number"],
    "github.pr-update": ["git", "done failed"],
    "github.pr-comment": ["git", "done failed"],
    "github.issue-comment": ["git", "done failed", "issue"],
    "github.wait-ci": ["git", "green red timeout failed", "status"],
} satisfies Record<string, Spec>;
type Spec = [category: Category, ports: string, outputs?: string];

const words = (list = "") => (list ? list.split(" ") : []);
const specOf = (type: NodeType): Spec => SPECS[type];

export type NodeType = keyof typeof SPECS;
export const NODE_TYPES = Object.keys(SPECS) as NodeType[];
export const NODE_CATALOG = Object.fromEntries(
    NODE_TYPES.map((type) => {
        const [category, ports] = specOf(type);
        return [type, { category, ports: words(ports) }];
    }),
) as Record<NodeType, { category: Category; ports: string[] }>;
export const NODE_OUTPUTS: Partial<Record<NodeType, string[]>> = Object.fromEntries(
    NODE_TYPES.map((type) => [type, words(specOf(type)[2])]),
);

interface Base {
    id: string;
    name?: string;
}

export interface StartNode extends Base {
    type: "start";
}
export interface EndNode extends Base {
    type: "end";
    status: "success" | "failed";
}
export interface LoopNode extends Base {
    type: "loop";
    max: number;
}
export interface AgentNode extends Base {
    type: "agent";
    prompt: string;
    skill?: string;
    // None: the project's agent.
    agent?: AgentName;
    model?: string;
    // MCP integrations of the workflow's repository.
    integrations?: string[];
    allowedTools?: string[];
    bashAllowlist?: string[];
    verdicts?: string[];
    session?: { continue: string };
    // Fork branches only.
    review?: boolean;
    budgetUsd?: number;
}
export interface CheckNode extends Base {
    type: "check";
    command: string;
    retryOn?: number[];
}
export interface GateNode extends Base {
    type: "gate.human";
    message: string;
    timeoutMs?: number;
}
export interface AskNode extends Base {
    type: "ask-user";
    question: string;
    options?: string[];
    timeoutMs?: number;
}
export interface DispatchNode extends Base {
    type: "dispatch";
    prompt: string;
    agent?: AgentName;
    model?: string;
    budgetUsd?: number;
}
export interface ForkNode extends Base {
    type: "fork";
    branches: number;
}
export interface JoinNode extends Base {
    type: "join";
    wait: "all" | "any";
}
export interface SubWorkflowNode extends Base {
    type: "workflow";
    // A workflow id of the same repository.
    workflow: string;
    prompt?: string;
    agent?: AgentName;
    budgetUsd?: number;
}
export interface IfNode extends Base {
    type: "if";
    condition: Condition;
}
export interface CommitNode extends Base {
    type: "git.commit";
    message: string;
}
export interface PushNode extends Base {
    type: "git.push";
}
export interface SyncNode extends Base {
    type: "git.sync-base";
}
export interface PrNode extends Base {
    type: "github.draft-pr";
    title?: string;
    // None: the project's setting.
    draft?: boolean;
}
export interface PrUpdateNode extends Base {
    type: "github.pr-update";
    ready?: boolean;
    addLabels?: string[];
    reviewers?: string[];
}
export interface PrCommentNode extends Base {
    type: "github.pr-comment";
    body: string;
}
export interface IssueCommentNode extends Base {
    type: "github.issue-comment";
    issue?: number;
    body: string;
}
export interface WaitCiNode extends Base {
    type: "github.wait-ci";
    timeoutMs: number;
    pollMs: number;
}
export interface WebhookNode extends Base {
    type: "notify.webhook";
    // `${NAME}` references take the project's secrets.
    url: string;
    body?: string;
}

export type GraphNode =
    | StartNode
    | EndNode
    | LoopNode
    | AgentNode
    | CheckNode
    | GateNode
    | AskNode
    | DispatchNode
    | ForkNode
    | JoinNode
    | SubWorkflowNode
    | IfNode
    | CommitNode
    | PushNode
    | SyncNode
    | PrNode
    | PrUpdateNode
    | PrCommentNode
    | IssueCommentNode
    | WaitCiNode
    | WebhookNode;

export type NodeOf<T extends NodeType> = Extract<GraphNode, { type: T }>;

// `from` is `<node>.<port>`; node ids and ports have no dots.
export interface Edge {
    from: string;
    to: string;
}

export interface Point {
    x: number;
    y: number;
}

export interface Definition {
    nodes: GraphNode[];
    edges: Edge[];
    // Where the editor drew the nodes; the engine never reads it.
    layout?: Record<string, Point>;
}

export const edgeKey = (node: string, port: string) => `${node}.${port}`;

export function splitFrom(from: string): { node: string; port: string } {
    const [node = "", ...port] = from.split(".");
    return { node, port: port.join(".") };
}

export const nodeById = (def: Pick<Definition, "nodes">, id: string) =>
    def.nodes.find((candidate) => candidate.id === id);

export const edgeFrom = (def: Pick<Definition, "edges">, node: string, port: string) => {
    const key = edgeKey(node, port);
    return def.edges.find((edge) => edge.from === key);
};

// The nodes with an edge into `id`, once per edge.
const sourcesOf = (def: Pick<Definition, "edges">, id: string) =>
    def.edges.filter((edge) => edge.to === id).map((edge) => splitFrom(edge.from).node);

export const labelOf = (node: Pick<GraphNode, "id" | "name">) => node.name?.trim() || node.id;

// Leaving by one of these with nothing wired ends the run as failed; any other port ends it done.
const FAILING = new Set("failed fail exhausted reject red timeout conflict".split(" "));
export const isFailurePort = (port: string) => FAILING.has(port);

export function portsOf(node: GraphNode): string[] {
    const fixed = NODE_CATALOG[node.type].ports;
    switch (node.type) {
        case "agent":
            return node.verdicts?.length ? [...new Set(node.verdicts).add("failed")] : fixed;
        case "fork": {
            const count = node.branches;
            return Array.from({ length: count }, (_, at) => String(at + 1));
        }
        case "gate.human":
        case "ask-user":
            return node.timeoutMs ? [...fixed, "timeout"] : fixed;
        default:
            return fixed;
    }
}

// Nodes the walk passes through without doing work of their own.
const PASSIVE = new Set<NodeType>(["start", "end", "loop", "join"]);
export const executable = (node: GraphNode) => !PASSIVE.has(node.type);

export interface Issue {
    code: string;
    params: Record<string, string | number>;
}

const problem = (code: string, params: Issue["params"] = {}): Issue => ({ code, params });

const TEXT_FIELDS: Partial<Record<NodeType, string[]>> = {
    agent: ["prompt"],
    dispatch: ["prompt"],
    workflow: ["prompt"],
    check: ["command"],
    "gate.human": ["message"],
    "ask-user": ["question"],
    "git.commit": ["message"],
    "github.draft-pr": ["title"],
    "github.pr-comment": ["body"],
    "github.issue-comment": ["body"],
    "notify.webhook": ["url", "body"],
};

// The fields a run renders, so the ones that may hold placeholders.
function templateText(node: GraphNode): string {
    const fields = node as unknown as Record<string, unknown>;
    return (TEXT_FIELDS[node.type] ?? []).map((key) => String(fields[key] ?? "")).join("\n");
}

export function forkBranches(def: Definition, forkId: string): string[] {
    const fork = nodeById(def, forkId);
    if (fork?.type !== "fork") return [];
    return portsOf(fork).flatMap((port) => {
        const edge = edgeFrom(def, forkId, port);
        return edge ? [edge.to] : [];
    });
}

// The fork right before an agent node, when it is one of its branches.
export const forkOf = (def: Definition, agentId: string): string | undefined =>
    sourcesOf(def, agentId).find((id) => nodeById(def, id)?.type === "fork");

export interface ForkShape {
    branches: { port: string; agent: AgentNode }[];
    join: string;
    wait: "all" | "any";
}

// Strict on purpose: fork, one agent per port, one join, so the canvas shows exactly what runs.
export function forkShape(def: Definition, forkId: string): ForkShape | Issue {
    const fork = nodeById(def, forkId);
    if (fork?.type !== "fork") return problem("forkMissing", { node: forkId });
    const branches: ForkShape["branches"] = [];
    let meeting: string | undefined;
    for (const port of portsOf(fork)) {
        const edge = edgeFrom(def, forkId, port);
        if (!edge) return problem("forkBranchUnwired", { node: forkId, port });
        const agent = nodeById(def, edge.to);
        if (agent?.type !== "agent") return problem("forkBranchNotAgent", { node: forkId, port });
        const node = agent.id;
        if (agent.session || agent.verdicts?.length) return problem("forkBranchPlain", { node });
        if (sourcesOf(def, node).some((source) => source !== forkId))
            return problem("forkBranchShared", { node });
        if (!edgeFrom(def, node, "done")) return problem("forkBranchDone", { node });
        for (const exit of ["done", "failed"]) {
            const to = edgeFrom(def, node, exit)?.to;
            if (to === undefined) continue;
            if (nodeById(def, to)?.type !== "join")
                return problem("forkBranchToJoin", { node, port: exit });
            meeting ??= to;
            if (to !== meeting) return problem("forkOneJoin", { node: forkId });
        }
        if (branches.some((branch) => branch.agent.id === node))
            return problem("forkSameAgent", { node: forkId, agent: node });
        branches.push({ port, agent });
    }
    const join = meeting ? nodeById(def, meeting) : undefined;
    if (join?.type !== "join") return problem("forkNeedsJoin", { node: forkId });
    const members = new Set(branches.map((branch) => branch.agent.id));
    if (sourcesOf(def, join.id).some((source) => !members.has(source)))
        return problem("joinForeign", { node: join.id, fork: forkId });
    return { branches, join: join.id, wait: join.wait };
}

const filled = (value: unknown) => typeof value === "string" && value.trim() !== "";

const REQUIRED_TEXT: Partial<Record<NodeType, string>> = {
    check: "command",
    dispatch: "prompt",
    "gate.human": "message",
    "ask-user": "question",
    "git.commit": "message",
    "github.pr-comment": "body",
    "github.issue-comment": "body",
    "notify.webhook": "url",
};

// What a field must hold for the run to work; the API also checks types and lengths.
function missingField(node: GraphNode): string | null {
    switch (node.type) {
        case "agent":
            return filled(node.prompt) || node.skill ? null : "prompt";
        case "workflow":
            return node.workflow ? null : "workflow";
        case "github.pr-update":
            return node.ready || node.addLabels?.length || node.reviewers?.length ? null : "ready";
        case "if": {
            const condition = node.condition;
            if (condition.kind === "paths-changed") return filled(condition.glob) ? null : "glob";
            return condition.kind === "output" && !condition.ref ? "ref" : null;
        }
    }
    const field = REQUIRED_TEXT[node.type];
    return field && !filled((node as unknown as Record<string, unknown>)[field]) ? field : null;
}

const MENTION = /(?<![\w.@/])@([A-Za-z\d][A-Za-z\d-]{0,38})\b/g;

// GitHub logins an agent prompt asks for a review that no PR update node requests: an agent
// only writes about them, nothing requests the review.
export function promptReviewers(def: Definition, node: GraphNode): string[] {
    if (node.type !== "agent" || !/review/i.test(node.prompt)) return [];
    const requested = new Set<string>();
    for (const other of def.nodes)
        if (other.type === "github.pr-update")
            for (const login of other.reviewers ?? []) requested.add(login.toLowerCase());
    const named = new Set(Array.from(node.prompt.matchAll(MENTION), (m) => m[1] ?? ""));
    return [...named].filter((login) => !requested.has(login.toLowerCase()));
}

// How many edges away from the roots each node is, breadth first in the order of the edges.
function distances(def: Definition, roots: string[]): Map<string, number> {
    const targets = new Map<string, string[]>();
    for (const edge of def.edges) {
        const { node } = splitFrom(edge.from);
        targets.set(node, [...(targets.get(node) ?? []), edge.to]);
    }
    const distance = new Map(roots.map((id) => [id, 0]));
    const queue = [...distance.keys()];
    for (const id of queue) {
        const next = (distance.get(id) ?? 0) + 1;
        for (const to of targets.get(id) ?? [])
            if (!distance.has(to)) {
                distance.set(to, next);
                queue.push(to);
            }
    }
    return distance;
}

function idIssues(ids: string[]): Issue[] {
    const seen = new Set<string>();
    return ids.flatMap((node) => {
        const found = !NODE_ID.test(node)
            ? [problem("invalidNodeId", { node })]
            : seen.has(node)
              ? [problem("duplicateNode", { node })]
              : [];
        seen.add(node);
        return found;
    });
}

function agentIssues(def: Definition, agent: AgentNode): Issue[] {
    const node = agent.id;
    const found: Issue[] = [];
    if ((agent.review || agent.budgetUsd) && !forkOf(def, node))
        found.push(problem("forkOnly", { node }));
    if (agent.verdicts && new Set(agent.verdicts).size < agent.verdicts.length)
        found.push(problem("verdictRepeated", { node }));
    const target = agent.session?.continue;
    if (target === node) found.push(problem("sessionSelf", { node }));
    else if (target !== undefined && nodeById(def, target)?.type !== "agent")
        found.push(problem("sessionTarget", { node, target }));
    return found;
}

function fieldIssues(def: Definition, node: GraphNode, known: Set<string>): Issue[] {
    const found: Issue[] = [];
    const field = missingField(node);
    if (field) found.push(problem("required", { node: node.id, field }));
    if (node.type === "if" && node.condition.kind === "output" && node.condition.ref) {
        const ref = node.condition.ref.split(".")[0] ?? "";
        if (!known.has(ref)) found.push(problem("unknownRef", { node: node.id, ref }));
    }
    return node.type === "agent" ? [...found, ...agentIssues(def, node)] : found;
}

function edgeIssues(def: Definition): Issue[] {
    const wired = new Set<string>();
    return def.edges.flatMap(({ from, to }) => {
        const { node, port } = splitFrom(from);
        const source = nodeById(def, node);
        if (!source || !portsOf(source).includes(port)) return [problem("edgeFrom", { from })];
        const found = wired.has(from) ? [problem("portWiredTwice", { port: from })] : [];
        wired.add(from);
        const target = nodeById(def, to);
        if (!target) found.push(problem("edgeTo", { from, to }));
        else if (target.type === "start") found.push(problem("edgeIntoStart", { from }));
        return found;
    });
}

function forkIssues(def: Definition): Issue[] {
    const found: Issue[] = [];
    const claimed = new Set<string>();
    for (const node of def.nodes) {
        if (node.type !== "fork") continue;
        const shape = forkShape(def, node.id);
        if ("code" in shape) found.push(shape);
        else claimed.add(shape.join);
    }
    // A broken fork leaves its join unclaimed; its own issue already says why.
    if (found.length) return found;
    return def.nodes
        .filter((node) => node.type === "join" && !claimed.has(node.id))
        .map((node) => problem("joinWithoutFork", { node: node.id }));
}

// Only a loop's repeat port is bounded, so every cycle must go round through one: a depth-first
// walk without those edges reports the first node it reaches again while still inside it.
function cycleIssues(def: Definition): Issue[] {
    const next = new Map<string, string[]>();
    for (const { from, to } of def.edges) {
        const { node, port } = splitFrom(from);
        if (port === "repeat" && nodeById(def, node)?.type === "loop") continue;
        next.set(node, [...(next.get(node) ?? []), to]);
    }
    const state = new Map<string, "inside" | "left">();
    for (const { id: root } of def.nodes) {
        if (state.has(root)) continue;
        state.set(root, "inside");
        const path = [{ id: root, at: 0 }];
        while (path.length) {
            const top = path[path.length - 1] as { id: string; at: number };
            const to = next.get(top.id)?.[top.at++];
            if (to === undefined) {
                state.set(top.id, "left");
                path.pop();
            } else if (state.get(to) === "inside") return [problem("cycle", { node: to })];
            else if (!state.has(to)) {
                state.set(to, "inside");
                path.push({ id: to, at: 0 });
            }
        }
    }
    return [];
}

function reachIssues(def: Definition): Issue[] {
    const start = def.nodes.find((node) => node.type === "start");
    if (!start) return [];
    const reached = distances(def, [start.id]);
    const found = def.nodes
        .filter((node) => !reached.has(node.id))
        .map((node) => problem("unreachable", { node: node.id }));
    if (!def.nodes.some((node) => reached.has(node.id) && executable(node)))
        found.push(problem("nothingToRun"));
    return found;
}

const NODE_PLACEHOLDER = /\{\{\s*nodes\.([\w-]+)\.\w+\s*\}\}/g;

const refIssues = (node: GraphNode, known: Set<string>): Issue[] =>
    Array.from(templateText(node).matchAll(NODE_PLACEHOLDER), (m) => m[1] ?? "")
        .filter((ref) => !known.has(ref))
        .map((ref) => problem("unknownRef", { node: node.id, ref }));

// Problems that keep a graph from running, in the order the editor lists them.
export function graphIssues(def: Definition): Issue[] {
    const count = def.nodes.length;
    const ids = def.nodes.map((node) => node.id);
    const known = new Set(ids);
    const starts = def.nodes.filter((node) => node.type === "start").length;
    return [
        ...(count < 1 || count > NODES_MAX ? [problem("nodeCount", { max: NODES_MAX })] : []),
        ...idIssues(ids),
        ...(starts === 1 ? [] : [problem("startCount", { count: starts })]),
        ...def.nodes.flatMap((node) => fieldIssues(def, node, known)),
        ...edgeIssues(def),
        ...forkIssues(def),
        ...cycleIssues(def),
        ...reachIssues(def),
        ...def.nodes.flatMap((node) => refIssues(node, known)),
    ];
}

export interface Transition {
    from: string;
    port: string;
    to: string | null;
}

export type Advance =
    | { kind: "node"; node: GraphNode; transitions: Transition[] }
    | { kind: "end"; status: "done" | "failed"; transitions: Transition[] };

// Follows a port to the next node that does work, counting loop visits on the way: a loop
// repeats while its count is within max, then leaves by exhausted. An unwired port ends the run.
export function advance(
    def: Definition,
    from: string,
    port: string,
    loops: Record<string, number>,
): Advance {
    const transitions: Transition[] = [];
    const finish = (status: "done" | "failed"): Advance => ({ kind: "end", status, transitions });
    let at = from;
    let exit = port;
    for (let hops = 0; hops < WALK_MAX * 4; hops++) {
        const edge = edgeFrom(def, at, exit);
        transitions.push({ from: at, port: exit, to: edge ? edge.to : null });
        if (!edge) return finish(isFailurePort(exit) ? "failed" : "done");
        const next = nodeById(def, edge.to);
        if (!next || next.type === "start") return finish("failed");
        if (next.type === "end") return finish(next.status === "failed" ? "failed" : "done");
        if (next.type !== "loop") return { kind: "node", node: next, transitions };
        const visits = (loops[next.id] ?? 0) + 1;
        loops[next.id] = visits;
        at = next.id;
        exit = visits <= next.max ? "repeat" : "exhausted";
    }
    return finish("failed");
}

export function enter(def: Definition, loops: Record<string, number>): Advance {
    const entry = def.nodes.find((node) => node.type === "start");
    if (!entry) return { kind: "end", transitions: [], status: "failed" };
    return advance(def, entry.id, "next", loops);
}

export type Outputs = Record<string, Record<string, string | number>>;

const PLACEHOLDER = /\{\{\s*(?:task|nodes\.([\w-]+)\.(\w+))\s*\}\}/g;

// One pass, so a value that itself holds a placeholder stays as it is. A loop's outputs come
// from its counter; a node that has not run on this path renders empty.
export function render(
    text: string,
    task: string,
    outputs: Outputs,
    loops: Record<string, number> = {},
    def?: Definition,
): string {
    return text.replace(PLACEHOLDER, (_, id?: string, field?: string) => {
        if (id === undefined || field === undefined) return task;
        const node = def && nodeById(def, id);
        if (node?.type === "loop" && field === "max") return `${node.max}`;
        if (node?.type === "loop" && field === "iteration")
            return `${Math.min(loops[id] ?? 0, node.max)}`;
        const value = outputs[id]?.[field];
        return value === undefined ? "" : `${value}`;
    });
}

export const mentionsTask = (text: string) => /\{\{\s*task\s*\}\}/.test(text);

// `*` within a path segment, `**` across segments, `?` one character.
export function globMatch(glob: string, path: string): boolean {
    const body = glob.replace(/\*\*\/?|[*?]|[.+^${}()|[\]\\]/g, (token) => {
        if (token.startsWith("**")) return ".*";
        if (token === "*") return "[^/]*";
        if (token === "?") return "[^/]";
        return `\\${token}`;
    });
    return new RegExp(`^${body}$`).test(path);
}

// Blank text is not a number, although Number("") is 0.
const numeric = (value: string | number) =>
    typeof value === "number" ? value : value.trim() ? Number(value) : Number.NaN;

const ORDER: Record<(typeof ORDERING)[number], (a: number, b: number) => boolean> = {
    ">": (a, b) => a > b,
    ">=": (a, b) => a >= b,
    "<": (a, b) => a < b,
    "<=": (a, b) => a <= b,
};

// Numbers compare as numbers when both sides are numeric, as text otherwise; an ordering of
// anything that is not a number is false.
export function compareValues(
    actual: string | number | undefined,
    op: OutputOp | NumericOp,
    expected: string | number,
): boolean {
    const left = actual ?? "";
    if (op === "contains") return `${left}`.includes(`${expected}`);
    const a = numeric(left);
    const b = numeric(expected);
    const both = !Number.isNaN(a) && !Number.isNaN(b);
    if (op === "equals" || op === "==" || op === "not-equals") {
        const same = both ? a === b : `${left}` === `${expected}`;
        return op === "not-equals" ? !same : same;
    }
    return both && ORDER[op](a, b);
}

export const VERDICT_MARKER = "OLIMP:VERDICT";
// CEZ: is still read so imported workflow files keep their verdicts.
const TRAILING_VERDICT = /\s*(?:OLIMP|CEZ):VERDICT[ \t:=]+([\w-]+)\s*$/;

export function parseVerdict(text: string, verdicts: string[]): string | null {
    const name = TRAILING_VERDICT.exec(text)?.[1];
    return name && verdicts.includes(name) ? name : null;
}

export const stripVerdict = (text: string) => text.replace(TRAILING_VERDICT, "");

export const verdictRequest = (verdicts: string[]) => {
    const markers = verdicts.map((verdict) => `\`${VERDICT_MARKER} ${verdict}\``).join(", ");
    return (
        `Close your final message with a line that holds only one of these markers: ${markers}. ` +
        "The workflow picks its next step from it."
    );
};

// Columns by distance from the start, rows within a column; placed nodes keep their place.
export const COLUMN = 340;
export const ROW = 150;

export function layoutOf(def: Definition): Record<string, Point> {
    const starts = def.nodes.filter((node) => node.type === "start").map((node) => node.id);
    const column = distances(def, starts);
    const beyond = Math.max(0, ...column.values()) + 1;
    const used = new Map<number, number>();
    const layout: Record<string, Point> = {};
    for (const { id } of def.nodes) {
        const kept = def.layout?.[id];
        if (kept) {
            layout[id] = kept;
            continue;
        }
        const x = column.get(id) ?? beyond;
        const y = used.get(x) ?? 0;
        used.set(x, y + 1);
        layout[id] = { x: x * COLUMN, y: y * ROW };
    }
    return layout;
}

const asRecord = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;

// Hands out ids that no node has yet: the base, else the base with -2, -3, ...
function idMaker(taken: Iterable<string>): (base: string) => string {
    const used = new Set(taken);
    return (base) => {
        const clean = base.replace(/[^\w-]/g, "-").replace(/^[^A-Za-z\d]+/, "") || "node";
        let id = clean;
        let suffix = 1;
        while (used.has(id)) id = `${clean}-${++suffix}`;
        used.add(id);
        return id;
    };
}

export interface ImportedWorkflow {
    name: string;
    description: string;
    definition: unknown;
}

// A workflow file (a `version: 2` graph, or an older list of `steps` or `skills`), already parsed
// from YAML or JSON. The result still goes through the API's validation.
export function importWorkflow(doc: unknown): ImportedWorkflow {
    const file = asRecord(doc);
    if (!file) throw new Error("not an object");
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const head = { name: text(file.name), description: text(file.description) };
    const graph = asRecord(file.definition) ?? file;
    if (Array.isArray(graph.nodes)) return { ...head, definition: importGraph(graph) };
    let steps: Record<string, unknown>[] | null = null;
    if (Array.isArray(file.steps)) steps = file.steps.map((entry) => asRecord(entry) ?? {});
    else if (Array.isArray(file.skills))
        steps = file.skills.map((skill) => ({ id: String(skill), skill: String(skill) }));
    if (!steps) throw new Error("no nodes, steps or skills");
    return { ...head, definition: fromSteps(steps) };
}

function importGraph(graph: Record<string, unknown>): unknown {
    const nodes = (graph.nodes as unknown[]).map((entry) => {
        const { runner, secrets: _secrets, ...node } = asRecord(entry) ?? {};
        return runner && !node.agent ? { ...node, agent: runner } : node;
    });
    // An edge that names only a node leaves by that node's first port.
    const firstPort = (id: string) => {
        const node = nodes.find((candidate) => candidate.id === id) as GraphNode | undefined;
        if (!node || !NODE_TYPES.includes(node.type)) return "";
        const sized =
            node.type === "fork" ? { ...node, branches: Number(node.branches) || 3 } : node;
        return portsOf(sized)[0] ?? "";
    };
    const edges = (Array.isArray(graph.edges) ? graph.edges : []).map((entry) => {
        const edge = asRecord(entry) ?? {};
        const from = String(edge.from ?? "");
        const to = String(edge.to ?? "");
        return { from: from.includes(".") ? from : edgeKey(from, firstPort(from)), to };
    });
    const layout = asRecord(graph.layout);
    return { nodes, edges, ...(layout && { layout }) };
}

// A list of steps, one after another: a check that may retry gets a loop node between its fail
// port and the step it goes back to.
function fromSteps(steps: Record<string, unknown>[]): Definition {
    const ids = steps.map((step, i) => String(step.id ?? `step-${i + 1}`));
    const claim = idMaker(ids);
    const start = claim("start");
    const nodes: GraphNode[] = [{ id: start, type: "start" }];
    const edges: Edge[] = [];
    let tail = edgeKey(start, "next");
    steps.forEach((step, i) => {
        const id = ids[i] as string;
        const name = typeof step.name === "string" ? { name: step.name } : {};
        const isCheck = typeof step.command === "string";
        if (isCheck) {
            nodes.push({ id, type: "check", command: step.command as string, ...name });
            const onFail = asRecord(step.onFail);
            if (typeof onFail?.retry === "string") {
                const loop = claim(`${id}-retry`);
                nodes.push({ id: loop, type: "loop", max: Number(onFail.max) || 2 });
                edges.push(
                    { from: edgeKey(id, "fail"), to: loop },
                    { from: edgeKey(loop, "repeat"), to: onFail.retry },
                );
            }
        } else {
            const text = (key: string) => {
                const value = step[key];
                return typeof value === "string" ? value : undefined;
            };
            const skill = text("skill");
            const model = text("model");
            const runner = text("runner");
            nodes.push({
                id,
                type: "agent",
                prompt: text("prompt") ?? "{{task}}",
                ...name,
                ...(skill !== undefined && { skill }),
                ...(model !== undefined && { model }),
                ...(runner !== undefined && { agent: runner as AgentName }),
            });
        }
        edges.push({ from: tail, to: id });
        tail = edgeKey(id, isCheck ? "pass" : "done");
    });
    const last = claim("end");
    return {
        nodes: [...nodes, { id: last, type: "end", status: "success" }],
        edges: [...edges, { from: tail, to: last }],
    };
}

// OLIMP's format before the graph editor: `{ start, nodes: { id: agent | condition | pr } }`,
// each agent leading to `next`, a condition to `yes`/`no`.
export function fromLegacy(old: {
    start: string;
    nodes: Record<string, Record<string, unknown>>;
}): Definition {
    const entry = idMaker(Object.keys(old.nodes))("start");
    const used = new Set(Object.keys(old.nodes));
    const nodes: GraphNode[] = [{ id: entry, type: "start" }];
    const edges: Edge[] = [{ from: edgeKey(entry, "next"), to: old.start }];
    const lastAgent = new Map<string, string>();
    for (const [id, n] of Object.entries(old.nodes)) {
        if (n.type === "agent") {
            // The title was the first line of the prompt; it is the only one when there is no body.
            const name = String(n.title ?? id);
            nodes.push({
                id,
                type: "agent",
                name,
                prompt: String(n.body ?? "") || name,
                ...(n.agent ? { agent: n.agent as AgentName } : {}),
                ...(n.skill ? { skill: String(n.skill) } : {}),
                ...(Array.isArray(n.integrations) && n.integrations.length
                    ? { integrations: n.integrations.map(String) }
                    : {}),
            });
            const next = n.next ? old.nodes[String(n.next)] : undefined;
            if (next?.type === "condition" && (next.check === "done" || next.check === "failed")) {
                const ok = next.check === "done" ? next.yes : next.no;
                const bad = next.check === "done" ? next.no : next.yes;
                if (ok) edges.push({ from: edgeKey(id, "done"), to: String(ok) });
                if (bad) edges.push({ from: edgeKey(id, "failed"), to: String(bad) });
                used.delete(String(n.next));
            } else if (n.next) {
                edges.push({ from: edgeKey(id, "done"), to: String(n.next) });
                lastAgent.set(String(n.next), id);
            }
        } else if (n.type === "pr") {
            nodes.push({
                id,
                type: "github.draft-pr",
                ...(n.title ? { title: String(n.title) } : {}),
            });
        }
    }
    for (const [id, n] of Object.entries(old.nodes)) {
        if (n.type !== "condition" || !used.has(id)) continue;
        const condition: Condition =
            n.check === "includes"
                ? {
                      kind: "output",
                      ref: `${lastAgent.get(id) ?? old.start}.summary`,
                      op: "contains",
                      value: String(n.text ?? ""),
                  }
                : { kind: "diff-files", op: ">", value: 0 };
        nodes.push({ id, type: "if", condition });
        if (n.yes) edges.push({ from: edgeKey(id, "true"), to: String(n.yes) });
        if (n.no) edges.push({ from: edgeKey(id, "false"), to: String(n.no) });
    }
    return { nodes, edges };
}

export const isLegacy = (value: unknown): value is Parameters<typeof fromLegacy>[0] => {
    const raw = asRecord(value);
    return Boolean(raw && typeof raw.start === "string" && asRecord(raw.nodes));
};

export interface Template {
    id: string;
    definition: Definition;
}

const START: StartNode = { id: "start", type: "start" };

const agentStep = (id: string, name: string, prompt: string, more: Partial<AgentNode> = {}) =>
    ({ id, type: "agent", name, prompt, ...more }) satisfies AgentNode;

const outcome = (id: string, name: string, status: EndNode["status"]): EndNode => ({
    id,
    type: "end",
    name,
    status,
});

const rounds = (id: string, name: string, max: number): LoopNode => ({
    id,
    type: "loop",
    name,
    max,
});

const graph = (nodes: GraphNode[], ...wires: [from: string, to: string][]): Definition => ({
    nodes,
    edges: wires.map(([from, to]) => ({ from, to })),
});

const reviewer = (id: string, name: string, lookFor: string) =>
    agentStep(
        id,
        name,
        `Read the diff of this run's branch, written for: {{task}}.\n\nLook only for ${lookFor}. ` +
            "Name the file and line of every real defect; if there is none, say so in one sentence.",
        { review: true },
    );

const resume = { session: { continue: "build" } };
const BUILD = agentStep("build", "Make the change", "{{task}}");
const TESTS: CheckNode = { id: "verify", type: "check", name: "Tests", command: "npm test" };
const HALT = outcome("halt", "Halted", "failed");

// The built-in graphs; their names and descriptions are in the panel's catalogs.
export const TEMPLATES: Template[] = [
    {
        id: "quick-task",
        definition: graph(
            [
                START,
                agentStep("work", "Work on the request", "{{task}}"),
                { id: "open-pr", type: "github.draft-pr", name: "Open a pull request" },
                outcome("finish", "Done", "success"),
            ],
            ["start.next", "work"],
            ["work.done", "open-pr"],
            ["open-pr.created", "finish"],
        ),
    },
    {
        id: "implement-and-verify",
        definition: graph(
            [
                START,
                BUILD,
                TESTS,
                rounds("attempts", "Attempts", 3),
                agentStep(
                    "repair",
                    "Repair",
                    "Attempt {{nodes.attempts.iteration}} of {{nodes.attempts.max}}: the tests " +
                        "still fail.\n\n{{nodes.verify.output}}\n\nFind the cause in the code " +
                        "and fix it; touch a test only when the test itself is wrong.",
                    resume,
                ),
                // The run's worktree is removed at the end, so an uncommitted change is lost.
                { id: "save", type: "git.commit", name: "Commit", message: "olimp: {{task}}" },
                outcome("finish", "Done", "success"),
                HALT,
            ],
            ["start.next", "build"],
            ["build.done", "verify"],
            ["verify.pass", "save"],
            ["verify.fail", "attempts"],
            ["attempts.repeat", "repair"],
            ["attempts.exhausted", "halt"],
            ["repair.done", "verify"],
            ["save.done", "finish"],
            ["save.nothing", "finish"],
            ["save.failed", "halt"],
        ),
    },
    {
        id: "implement-review-pr",
        definition: graph(
            [
                START,
                BUILD,
                TESTS,
                rounds("test-rounds", "Test attempts", 2),
                agentStep(
                    "repair",
                    "Repair",
                    "The tests fail:\n\n{{nodes.verify.output}}\n\nFix the cause.",
                    resume,
                ),
                agentStep(
                    "critique",
                    "AI review",
                    "Read the diff of this run's branch, written for: {{task}}. Answer accept " +
                        "when it is correct, safe and tested; answer revise with the concrete " +
                        "problems otherwise.",
                    { verdicts: ["accept", "revise"] },
                ),
                rounds("review-rounds", "Review rounds", 2),
                agentStep(
                    "rework",
                    "Rework",
                    "Review notes:\n\n{{nodes.critique.summary}}\n\nWork them in.",
                    resume,
                ),
                {
                    id: "approval",
                    type: "gate.human",
                    name: "Your approval",
                    message:
                        "AI review: {{nodes.critique.verdict}}. Open a pull request for “{{task}}”?",
                },
                { id: "pr", type: "github.draft-pr", name: "Draft pull request" },
                outcome("opened", "Pull request open", "success"),
                HALT,
            ],
            ["start.next", "build"],
            ["build.done", "verify"],
            ["verify.pass", "critique"],
            ["verify.fail", "test-rounds"],
            ["test-rounds.repeat", "repair"],
            ["test-rounds.exhausted", "halt"],
            ["repair.done", "verify"],
            ["critique.accept", "approval"],
            ["critique.revise", "review-rounds"],
            ["review-rounds.repeat", "rework"],
            ["review-rounds.exhausted", "approval"],
            ["rework.done", "verify"],
            ["approval.approve", "pr"],
            ["approval.reject", "halt"],
            ["pr.created", "opened"],
        ),
    },
    {
        id: "review-council",
        definition: graph(
            [
                START,
                BUILD,
                { id: "panel", type: "fork", name: "Reviewers", branches: 3 },
                reviewer("logic", "Logic", "wrong results, missed edge cases and regressions"),
                reviewer("safety", "Safety", "injection, leaked secrets, unchecked input, access"),
                reviewer("coverage", "Coverage", "changed behaviour that no test proves"),
                { id: "findings", type: "join", name: "Findings", wait: "all" },
                agentStep(
                    "judge",
                    "Judge",
                    "Three reviewers read the change made for: {{task}}.\n\n" +
                        "### Logic ({{nodes.logic.status}})\n{{nodes.logic.summary}}\n\n" +
                        "### Safety ({{nodes.safety.status}})\n{{nodes.safety.summary}}\n\n" +
                        "### Coverage ({{nodes.coverage.status}})\n{{nodes.coverage.summary}}\n\n" +
                        "Merge their findings, drop repeats and anything that is not a real " +
                        "defect, then choose: ship, or rework with the exact list of changes.",
                    { verdicts: ["ship", "rework"] },
                ),
                rounds("rounds", "Rework rounds", 2),
                agentStep(
                    "rework",
                    "Rework",
                    "Round {{nodes.rounds.iteration}} of {{nodes.rounds.max}}. The judge wants " +
                        "these changes:\n\n{{nodes.judge.summary}}\n\nMake them.",
                    resume,
                ),
                {
                    id: "approval",
                    type: "gate.human",
                    name: "Your call",
                    message:
                        "After {{nodes.rounds.max}} rounds the judge still wants changes:\n\n" +
                        "{{nodes.judge.summary}}\n\nOpen the pull request anyway?",
                },
                { id: "pr", type: "github.draft-pr", name: "Draft pull request" },
                outcome("opened", "Pull request open", "success"),
                HALT,
            ],
            ["start.next", "build"],
            ["build.done", "panel"],
            ["panel.1", "logic"],
            ["panel.2", "safety"],
            ["panel.3", "coverage"],
            ["logic.done", "findings"],
            ["safety.done", "findings"],
            ["coverage.done", "findings"],
            ["findings.done", "judge"],
            ["findings.failed", "judge"],
            ["judge.ship", "pr"],
            ["judge.rework", "rounds"],
            ["rounds.repeat", "rework"],
            ["rounds.exhausted", "approval"],
            ["rework.done", "panel"],
            ["approval.approve", "pr"],
            ["approval.reject", "halt"],
            ["pr.created", "opened"],
        ),
    },
    {
        id: "fix-ci",
        definition: graph(
            [
                START,
                BUILD,
                { id: "pr", type: "github.draft-pr", name: "Pull request" },
                {
                    id: "checks",
                    type: "github.wait-ci",
                    name: "CI",
                    timeoutMs: 60 * 60_000,
                    pollMs: 60_000,
                },
                rounds("attempts", "CI attempts", 3),
                agentStep(
                    "mend",
                    "Repair CI",
                    "CI failed on this run's pull request. Find the failing checks with " +
                        "`gh pr checks`, read the logs of the failed jobs and fix what broke " +
                        "them. The request was: {{task}}",
                ),
                { id: "push", type: "git.push", name: "Push" },
                outcome("passed", "CI passed", "success"),
                HALT,
            ],
            ["start.next", "build"],
            ["build.done", "pr"],
            ["pr.created", "checks"],
            ["checks.green", "passed"],
            ["checks.red", "attempts"],
            ["checks.timeout", "halt"],
            ["attempts.repeat", "mend"],
            ["attempts.exhausted", "halt"],
            ["mend.done", "push"],
            ["push.done", "checks"],
        ),
    },
];
