import { parse, stringify } from "yaml";
import {
    COLUMN,
    edgeFrom,
    edgeKey,
    FORK_MAX,
    forkBranches,
    importWorkflow,
    isFailurePort,
    layoutOf,
    nodeById,
    portsOf,
    ROW,
    splitFrom,
} from "../../../src/workflow-graph.ts";
import type { Definition, GraphNode, NodeType, Point } from "./types";

export {
    CONDITION_KINDS,
    edgeFrom,
    edgeKey,
    executable,
    FORK_MAX,
    forkOf,
    graphIssues,
    isFailurePort,
    LOOP_MAX,
    labelOf,
    layoutOf,
    NODE_CATALOG,
    NODE_OUTPUTS,
    NODE_TYPES,
    NODES_MAX,
    NUMERIC_OPS,
    nodeById,
    OPTIONS_MAX,
    OUTPUT_OPS,
    portsOf,
    promptReviewers,
    splitFrom,
    TEMPLATES,
    WAIT_MAX_MS,
    WAIT_MIN_MS,
} from "../../../src/workflow-graph.ts";

export interface Draft {
    name: string;
    description: string;
    repo: string;
    definition: Definition;
}

// Message keys cannot hold the dots and dashes of node types: gate.human is gateHuman.
export const nodeKey = (type: NodeType) =>
    type.replace(/[.-](\w)/g, (_, c: string) => c.toUpperCase()) as NodeKey;
export type NodeKey =
    | "start"
    | "end"
    | "loop"
    | "agent"
    | "check"
    | "gateHuman"
    | "askUser"
    | "dispatch"
    | "fork"
    | "join"
    | "workflow"
    | "if"
    | "gitCommit"
    | "gitPush"
    | "gitSyncBase"
    | "githubDraftPr"
    | "githubPrUpdate"
    | "githubPrComment"
    | "githubIssueComment"
    | "githubWaitCi"
    | "notifyWebhook";

const DEFAULTS: { [T in NodeType]: Omit<Extract<GraphNode, { type: T }>, "id" | "type"> } = {
    start: {},
    end: { status: "success" },
    loop: { max: 3 },
    agent: { prompt: "{{task}}" },
    check: { command: "npm test" },
    "gate.human": { message: "Continue with {{task}}?" },
    "ask-user": { question: "What should I do next?" },
    dispatch: { prompt: "{{task}}" },
    fork: { branches: 2 },
    join: { wait: "all" },
    workflow: { workflow: "" },
    if: { condition: { kind: "diff-lines", op: ">", value: 200 } },
    "git.commit": { message: "{{task}}" },
    "git.push": {},
    "git.sync-base": {},
    "github.draft-pr": {},
    "github.pr-update": { ready: true },
    "github.pr-comment": { body: "OLIMP: {{task}}" },
    "github.issue-comment": { body: "OLIMP: {{task}}" },
    "github.wait-ci": { timeoutMs: 60 * 60_000, pollMs: 60_000 },
    "notify.webhook": { url: "", body: "OLIMP: {{task}}" },
};

const ID_BASE: Partial<Record<NodeType, string>> = {
    "gate.human": "gate",
    "ask-user": "ask",
    "git.commit": "commit",
    "git.push": "push",
    "git.sync-base": "sync",
    "github.draft-pr": "pr",
    "github.pr-update": "pr-update",
    "github.pr-comment": "pr-comment",
    "github.issue-comment": "issue-comment",
    "github.wait-ci": "wait-ci",
    "notify.webhook": "webhook",
};

export function freshId(def: Pick<Definition, "nodes">, base: string): string {
    const ids = new Set(def.nodes.map((n) => n.id));
    if (!ids.has(base)) return base;
    let n = 2;
    while (ids.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

export function newNode(
    def: Pick<Definition, "nodes">,
    type: NodeType,
    extra: Partial<GraphNode> = {},
): GraphNode {
    const base = extra.id ?? ID_BASE[type] ?? type;
    return { ...DEFAULTS[type], ...extra, type, id: freshId(def, base) } as GraphNode;
}

export const blankDefinition = (): Definition => ({
    nodes: [
        { id: "start", type: "start" },
        { id: "agent", type: "agent", name: "Do the task", prompt: "{{task}}" },
    ],
    edges: [{ from: "start.next", to: "agent" }],
});

// The first drag keeps the automatic layout, so the other nodes do not jump.
export function withLayout(def: Definition): Definition {
    if (def.nodes.every((n) => def.layout?.[n.id])) return def;
    return { ...def, layout: layoutOf(def) };
}

export const tidy = (def: Definition): Definition => {
    const { layout: _, ...rest } = def;
    return { ...rest, layout: layoutOf(rest) };
};

export function moveNode(def: Definition, id: string, at: Point): Definition {
    const placed = withLayout(def);
    return { ...placed, layout: { ...placed.layout, [id]: at } };
}

function placeAfter(def: Definition, from: string | null): Point {
    const layout = layoutOf(def);
    const origin = from ? layout[from] : undefined;
    const taken = Object.values(layout);
    if (origin) {
        let y = origin.y;
        while (
            taken.some((p) => Math.abs(p.x - (origin.x + COLUMN)) < 40 && Math.abs(p.y - y) < 80)
        )
            y += ROW;
        return { x: origin.x + COLUMN, y };
    }
    return { x: Math.max(0, ...taken.map((p) => p.x)) + COLUMN, y: 0 };
}

export function connect(
    def: Definition,
    node: string,
    port: string,
    to: string | null,
): Definition {
    const from = edgeKey(node, port);
    const rest = def.edges.filter((e) => e.from !== from);
    return { ...def, edges: to ? [...rest, { from, to }] : rest };
}

export function addNode(
    def: Definition,
    type: NodeType,
    extra: Partial<GraphNode> = {},
    from: { node: string; port: string } | null = null,
): { definition: Definition; id: string } {
    if (type === "fork") return addFork(def, from);
    const placed = withLayout(def);
    const node = newNode(placed, type, extra);
    let next: Definition = {
        ...placed,
        nodes: [...placed.nodes, node],
        layout: { ...placed.layout, [node.id]: placeAfter(placed, from?.node ?? null) },
    };
    if (from) next = connect(next, from.node, from.port, node.id);
    return { definition: next, id: node.id };
}

// A fork comes with its branches and join, or the draft would not be valid.
function addFork(
    def: Definition,
    from: { node: string; port: string } | null,
): { definition: Definition; id: string } {
    let next = withLayout(def);
    const at = placeAfter(next, from?.node ?? null);
    const fork = newNode(next, "fork");
    next = { ...next, nodes: [...next.nodes, fork], layout: { ...next.layout, [fork.id]: at } };
    const join = newNode(next, "join");
    next = {
        ...next,
        nodes: [...next.nodes, join],
        layout: { ...next.layout, [join.id]: { x: at.x + COLUMN * 2, y: at.y } },
    };
    next = resizeFork(next, fork.id, 2);
    if (from) next = connect(next, from.node, from.port, fork.id);
    return { definition: next, id: fork.id };
}

export function resizeFork(def: Definition, forkId: string, count: number): Definition {
    const fork = nodeById(def, forkId);
    if (fork?.type !== "fork") return def;
    const n = Math.min(FORK_MAX, Math.max(2, count));
    const branches = forkBranches(def, forkId);
    const firstBranch = branches[0];
    const join =
        (firstBranch ? edgeFrom(def, firstBranch, "done")?.to : undefined) ??
        def.nodes.find((x) => x.type === "join" && !def.edges.some((e) => e.to === x.id))?.id;
    let next: Definition = withLayout({
        ...def,
        nodes: def.nodes.map((x) => (x.id === forkId ? { ...x, branches: n } : x)),
    });
    for (const id of branches.slice(n)) next = removeNode(next, id);
    next = { ...next, edges: next.edges.filter((e) => !isStaleBranch(e.from, forkId, n)) };
    const at = next.layout?.[forkId] ?? { x: 0, y: 0 };
    for (let i = branches.length; i < n; i++) {
        const branch = newNode(next, "agent", { id: "branch", name: `Branch ${i + 1}` });
        next = {
            ...next,
            nodes: [...next.nodes, branch],
            layout: {
                ...next.layout,
                [branch.id]: { x: at.x + COLUMN, y: at.y + (i - (n - 1) / 2) * ROW },
            },
        };
        next = connect(next, forkId, String(i + 1), branch.id);
        if (join) next = connect(next, branch.id, "done", join);
    }
    return next;
}

const isStaleBranch = (from: string, forkId: string, n: number) => {
    const { node, port } = splitFrom(from);
    return node === forkId && Number(port) > n;
};

export function removeNode(def: Definition, id: string): Definition {
    const { [id]: _, ...layout } = def.layout ?? {};
    return {
        ...def,
        nodes: def.nodes.filter((n) => n.id !== id),
        edges: def.edges.filter((e) => splitFrom(e.from).node !== id && e.to !== id),
        ...(def.layout && { layout }),
    };
}

const swapRefs = (text: string, from: string, to: string) =>
    text.replace(
        new RegExp(`(\\{\\{\\s*nodes\\.)${from.replace(/[-]/g, "\\-")}(\\.)`, "g"),
        `$1${to}$2`,
    );

// Every reference follows the new id: connections, layout, sessions, conditions and templates.
export function renameNode(def: Definition, from: string, to: string): Definition {
    const swap = (id: string) => (id === from ? to : id);
    const nodes = def.nodes.map((n): GraphNode => {
        const renamed = { ...n, id: swap(n.id) } as GraphNode;
        if (renamed.type === "agent" && renamed.session)
            renamed.session = { continue: swap(renamed.session.continue) };
        if (renamed.type === "if" && renamed.condition.kind === "output") {
            const [node = "", field = ""] = renamed.condition.ref.split(".");
            renamed.condition = { ...renamed.condition, ref: `${swap(node)}.${field}` };
        }
        const fields = renamed as unknown as Record<string, unknown>;
        for (const key of ["prompt", "command", "message", "question", "body", "title", "url"]) {
            const value = fields[key];
            if (typeof value === "string") fields[key] = swapRefs(value, from, to);
        }
        return renamed;
    });
    const layout = Object.fromEntries(
        Object.entries(def.layout ?? {}).map(([id, p]) => [swap(id), p]),
    );
    return {
        ...def,
        nodes,
        edges: def.edges.map((e) => {
            const { node, port } = splitFrom(e.from);
            return { from: edgeKey(swap(node), port), to: swap(e.to) };
        }),
        ...(def.layout && { layout }),
    };
}

export interface Simulation {
    at: string | null;
    taken: Set<string>;
    visited: Set<string>;
    end: "done" | "failed" | null;
}

// The start, loops and joins go on by themselves, a fork runs all its branches; at every other
// node the user picks the port it leaves by.
export function simulate(def: Definition, choices: string[]): Simulation {
    const sim: Simulation = { at: null, taken: new Set(), visited: new Set(), end: null };
    const entry = def.nodes.find((node) => node.type === "start");
    if (!entry) return sim;
    const visits: Record<string, number> = {};
    const picks = choices.values();
    let here = entry.id;
    let leave = "next";
    for (let left = 300; left > 0; left--) {
        sim.visited.add(here);
        const edge = edgeFrom(def, here, leave);
        if (!edge) return { ...sim, end: isFailurePort(leave) ? "failed" : "done" };
        sim.taken.add(edge.from);
        const node = nodeById(def, edge.to);
        if (!node) return sim;
        here = node.id;
        sim.visited.add(here);
        if (node.type === "end")
            return { ...sim, end: node.status === "failed" ? "failed" : "done" };
        if (node.type === "loop") {
            const count = (visits[here] ?? 0) + 1;
            visits[here] = count;
            leave = count <= node.max ? "repeat" : "exhausted";
            continue;
        }
        if (node.type === "fork") {
            const join = markBranches(def, node, sim);
            if (!join) return sim;
            here = join;
            sim.visited.add(here);
        }
        const pick = picks.next().value;
        if (!pick) return { ...sim, at: here };
        leave = pick;
    }
    return sim;
}

// Marks each branch of a fork and its edge back; the join they lead to, if one is wired.
function markBranches(def: Definition, fork: GraphNode, sim: Simulation): string | undefined {
    let join: string | undefined;
    for (const port of portsOf(fork)) {
        const out = edgeFrom(def, fork.id, port);
        if (!out) continue;
        sim.taken.add(out.from);
        sim.visited.add(out.to);
        const back = edgeFrom(def, out.to, "done");
        if (!back) continue;
        sim.taken.add(back.from);
        join = back.to;
    }
    return join;
}

// The file format: YAML with version 2.
export function toYaml(draft: Pick<Draft, "name" | "description" | "definition">): string {
    const { nodes, edges, layout } = draft.definition;
    return stringify({
        version: 2,
        name: draft.name,
        ...(draft.description && { description: draft.description }),
        nodes,
        edges,
        ...(layout && { layout }),
    });
}

// YAML or JSON; the API validates the result on save.
export function fromText(text: string): {
    name: string;
    description: string;
    definition: Definition;
} {
    const imported = importWorkflow(parse(text));
    return { ...imported, definition: imported.definition as Definition };
}

export function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/[^\w.-]+/g, "-") || "workflow"}.yaml`;
    link.click();
    URL.revokeObjectURL(url);
}
