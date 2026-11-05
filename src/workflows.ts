import { type AgentName, isAgent } from "./agents.ts";
import type { MessageKey, Params } from "./i18n.ts";
import { parseNames } from "./integrations.ts";
import {
    CHECK_COMMAND_MAX,
    COMMAND_MAX,
    CONDITION_TEXT_MAX,
    MODEL_MAX,
    REF_MAX,
    TASK_BODY_MAX,
    TITLE_MAX,
} from "./limits.ts";
import {
    type Condition,
    type Definition,
    FORK_MAX,
    type GraphNode,
    graphIssues,
    LOOP_MAX,
    NODE_ID,
    NODE_TYPES,
    NUMERIC_OPS,
    type NumericOp,
    OPTIONS_MAX,
    OUTPUT_OPS,
    type OutputOp,
    POLL_MAX_MS,
    POLL_MIN_MS,
    type Point,
    VERDICT,
    WAIT_MAX_MS,
    WAIT_MIN_MS,
} from "./workflow-graph.ts";

export type { Definition, GraphNode, NodeType } from "./workflow-graph.ts";

const URL_MAX = 2000;
const LIST_MAX = 20;
const BUDGET_MAX = 1000;

export class DefinitionError extends Error {
    readonly code: MessageKey;
    readonly params: Params;
    constructor(code: MessageKey, params: Params = {}) {
        super(code);
        this.code = code;
        this.params = params;
    }
}

type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// Reads the fields of one node; an absent optional field stays out of the result.
function reader(id: string, raw: Raw) {
    const fail = (name: string): never => {
        throw new DefinitionError("workflow.invalidField", { node: id, field: name });
    };
    const present = (name: string) => raw[name] !== undefined && raw[name] !== null;
    return {
        fail,
        text(name: string, max: number, { required = false, empty = false } = {}) {
            const value = raw[name];
            if (!present(name)) return required ? fail(name) : undefined;
            if (typeof value !== "string" || value.length > max) return fail(name);
            const trimmed = value.trim();
            if (!trimmed && !empty) return required ? fail(name) : undefined;
            return trimmed;
        },
        int(name: string, min: number, max: number, fallback?: number) {
            const value = raw[name];
            if (!present(name)) return fallback;
            if (!Number.isInteger(value) || (value as number) < min || (value as number) > max)
                return fail(name);
            return value as number;
        },
        number(name: string, max: number) {
            const value = raw[name];
            if (!present(name)) return undefined;
            if (typeof value !== "number" || !(value > 0) || value > max) return fail(name);
            return value;
        },
        flag(name: string) {
            const value = raw[name];
            if (!present(name)) return undefined;
            if (typeof value !== "boolean") return fail(name);
            return value;
        },
        list(name: string, max: number, each: (value: string) => boolean = () => true) {
            const value = raw[name];
            if (!present(name)) return undefined;
            if (
                !Array.isArray(value) ||
                value.length > LIST_MAX ||
                !value.every((v) => typeof v === "string" && v.trim() && v.length <= max && each(v))
            )
                return fail(name);
            const list = [...new Set(value.map((v: string) => v.trim()))];
            return list.length ? list : undefined;
        },
        agent(name: string): AgentName | undefined {
            const value = raw[name];
            if (!present(name)) return undefined;
            return isAgent(value) ? value : fail(name);
        },
        oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
            const value = raw[name];
            if (!present(name)) return fallback;
            return values.includes(value as T) ? (value as T) : fail(name);
        },
    };
}

// Drops the keys whose value is undefined, so stored definitions carry only what was set.
const compact = <T extends object>(value: T): T =>
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

// `<node>.<output>`, one dot.
const OUTPUT_REF = /^[A-Za-z\d][\w-]*\.\w+$/;

function parseCondition(id: string, raw: unknown): Condition {
    const invalid = (): never => {
        throw new DefinitionError("workflow.invalidField", { node: id, field: "condition" });
    };
    if (!isObject(raw)) return invalid();
    const { kind, op, value } = raw;
    if (kind === "diff-lines" || kind === "diff-files") {
        const ok = NUMERIC_OPS.includes(op as NumericOp) && typeof value === "number" && value >= 0;
        return ok ? { kind, op: op as NumericOp, value: value as number } : invalid();
    }
    if (kind === "paths-changed") {
        const glob = raw.glob;
        return typeof glob === "string" && glob.length <= REF_MAX
            ? { kind, glob: glob.trim() }
            : invalid();
    }
    if (kind === "output") {
        const fits =
            typeof value === "number"
                ? Number.isFinite(value)
                : typeof value === "string" && value.length <= CONDITION_TEXT_MAX;
        const ref = raw.ref;
        if (typeof ref !== "string" || !OUTPUT_REF.test(ref)) return invalid();
        if (!OUTPUT_OPS.includes(op as OutputOp) || !fits) return invalid();
        return { kind, ref, op: op as OutputOp, value: value as string | number };
    }
    if (kind === "branch") {
        const named = typeof value === "string" ? value.trim() : "";
        if ((op !== "equals" && op !== "matches") || !named) return invalid();
        return (value as string).length > REF_MAX ? invalid() : { kind, op, value: named };
    }
    return invalid();
}

const wait = (r: ReturnType<typeof reader>) => r.int("timeoutMs", WAIT_MIN_MS, WAIT_MAX_MS);

function parseNode(raw: unknown): GraphNode {
    if (!isObject(raw) || typeof raw.id !== "string" || !NODE_ID.test(raw.id))
        throw new DefinitionError("workflow.invalidNodeId", {
            node: isObject(raw) && typeof raw.id === "string" ? raw.id : "",
        });
    const id = raw.id;
    const r = reader(id, raw);
    const base = { id, name: r.text("name", TITLE_MAX) };
    switch (raw.type) {
        case "start":
            return compact({ ...base, type: "start" });
        case "end":
            return compact({
                ...base,
                type: "end",
                status: r.oneOf("status", ["success", "failed"] as const, "success"),
            });
        case "loop":
            return compact({ ...base, type: "loop", max: r.int("max", 1, LOOP_MAX, 3) as number });
        case "agent": {
            const integrations = parseNames(raw.integrations);
            if (!integrations) return r.fail("integrations");
            const verdicts = r.list(
                "verdicts",
                30,
                (v) => VERDICT.test(v) && v !== "done" && v !== "failed",
            );
            const session = raw.session;
            if (session !== undefined && session !== null) {
                if (!isObject(session) || typeof session.continue !== "string")
                    return r.fail("session");
            }
            return compact({
                ...base,
                type: "agent",
                prompt: r.text("prompt", TASK_BODY_MAX, { empty: true }) ?? "",
                skill: r.text("skill", REF_MAX),
                agent: r.agent("agent"),
                model: r.text("model", MODEL_MAX),
                integrations: integrations.length ? integrations : undefined,
                allowedTools: r.list("allowedTools", REF_MAX),
                bashAllowlist: r.list("bashAllowlist", COMMAND_MAX),
                verdicts,
                session: isObject(session) ? { continue: String(session.continue) } : undefined,
                review: r.flag("review") || undefined,
                budgetUsd: r.number("budgetUsd", BUDGET_MAX),
            });
        }
        case "check": {
            const retryOn = raw.retryOn;
            if (
                retryOn !== undefined &&
                retryOn !== null &&
                (!Array.isArray(retryOn) ||
                    retryOn.length > LIST_MAX ||
                    !retryOn.every((c) => Number.isInteger(c) && c > 0 && c < 256))
            )
                return r.fail("retryOn");
            return compact({
                ...base,
                type: "check",
                command: r.text("command", CHECK_COMMAND_MAX, { required: true }) as string,
                retryOn:
                    Array.isArray(retryOn) && retryOn.length ? [...new Set(retryOn)] : undefined,
            });
        }
        case "gate.human":
            return compact({
                ...base,
                type: "gate.human",
                message: r.text("message", TASK_BODY_MAX, { required: true }) as string,
                timeoutMs: wait(r),
            });
        case "ask-user":
            return compact({
                ...base,
                type: "ask-user",
                question: r.text("question", TASK_BODY_MAX, { required: true }) as string,
                options: (() => {
                    const options = r.list("options", TITLE_MAX);
                    return options && options.length > OPTIONS_MAX ? r.fail("options") : options;
                })(),
                timeoutMs: wait(r),
            });
        case "dispatch":
            return compact({
                ...base,
                type: "dispatch",
                prompt: r.text("prompt", TASK_BODY_MAX, { required: true }) as string,
                agent: r.agent("agent"),
                model: r.text("model", MODEL_MAX),
                budgetUsd: r.number("budgetUsd", BUDGET_MAX),
            });
        case "fork":
            return compact({
                ...base,
                type: "fork",
                branches: r.int("branches", 2, FORK_MAX, 3) as number,
            });
        case "join":
            return compact({
                ...base,
                type: "join",
                wait: r.oneOf("wait", ["all", "any"] as const, "all"),
            });
        case "workflow":
            return compact({
                ...base,
                type: "workflow",
                workflow: r.text("workflow", REF_MAX, { required: true }) as string,
                prompt: r.text("prompt", TASK_BODY_MAX),
                agent: r.agent("agent"),
                budgetUsd: r.number("budgetUsd", BUDGET_MAX),
            });
        case "if":
            return compact({ ...base, type: "if", condition: parseCondition(id, raw.condition) });
        case "git.commit":
            return compact({
                ...base,
                type: "git.commit",
                message: r.text("message", TITLE_MAX * 5, { required: true }) as string,
            });
        case "git.push":
            return compact({ ...base, type: "git.push" });
        case "git.sync-base":
            return compact({ ...base, type: "git.sync-base" });
        case "github.draft-pr":
            return compact({
                ...base,
                type: "github.draft-pr",
                title: r.text("title", TITLE_MAX),
                draft: r.flag("draft"),
            });
        case "github.pr-update":
            return compact({
                ...base,
                type: "github.pr-update",
                ready: r.flag("ready") || undefined,
                addLabels: r.list("addLabels", 50),
                reviewers: r.list("reviewers", 100),
            });
        case "github.pr-comment":
            return compact({
                ...base,
                type: "github.pr-comment",
                body: r.text("body", TASK_BODY_MAX, { required: true }) as string,
            });
        case "github.issue-comment":
            return compact({
                ...base,
                type: "github.issue-comment",
                issue: r.int("issue", 1, Number.MAX_SAFE_INTEGER),
                body: r.text("body", TASK_BODY_MAX, { required: true }) as string,
            });
        case "github.wait-ci":
            return compact({
                ...base,
                type: "github.wait-ci",
                timeoutMs: r.int("timeoutMs", WAIT_MIN_MS, WAIT_MAX_MS, 60 * 60_000) as number,
                pollMs: r.int("pollMs", POLL_MIN_MS, POLL_MAX_MS, 60_000) as number,
            });
        case "notify.webhook": {
            const url = r.text("url", URL_MAX, { required: true }) as string;
            // A secret reference may stand for the whole address; a literal one must be HTTPS.
            if (!url.startsWith("${") && !/^https:\/\/[^\s/]+/.test(url)) return r.fail("url");
            return compact({
                ...base,
                type: "notify.webhook",
                url,
                body: r.text("body", TASK_BODY_MAX),
            });
        }
        default:
            throw new DefinitionError("workflow.unknownNodeType", {
                node: id,
                type: typeof raw.type === "string" ? raw.type : "",
            });
    }
}

function parseLayout(value: unknown, ids: Set<string>): Record<string, Point> | undefined {
    if (!isObject(value)) return undefined;
    const layout: Record<string, Point> = {};
    for (const [id, p] of Object.entries(value))
        if (ids.has(id) && isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y))
            layout[id] = { x: Math.round(p.x as number), y: Math.round(p.y as number) };
    return Object.keys(layout).length ? layout : undefined;
}

// Returns a normalised copy: only known fields, defaults filled in, so stored definitions are uniform.
export function parseDefinition(value: unknown): Definition {
    if (!isObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges))
        throw new DefinitionError("workflow.invalidDefinition");
    const nodes = value.nodes.map(parseNode);
    const edges = value.edges.map((e) => {
        if (!isObject(e) || typeof e.from !== "string" || typeof e.to !== "string")
            throw new DefinitionError("workflow.invalidEdge");
        return { from: e.from, to: e.to };
    });
    const layout = parseLayout(value.layout, new Set(nodes.map((n) => n.id)));
    const definition: Definition = { nodes, edges, ...(layout && { layout }) };
    const [first] = graphIssues(definition);
    if (first) throw new DefinitionError(`workflow.${first.code}` as MessageKey, first.params);
    return definition;
}

export const isNodeType = (value: unknown): value is GraphNode["type"] =>
    NODE_TYPES.includes(value as GraphNode["type"]);
