import type { AgentName } from "./agents.ts";
import type { AgentEventType, Store, Usage } from "./store.ts";

// An event's summary in characters, how many events one step keeps, and for how long.
// The detail keeps the whole of it; the cap is only a guard, far above what Claude's own tools return.
export const EVENT_SUMMARY_MAX = 500;
export const EVENT_DETAIL_MAX = 1_000_000;
export const STEP_EVENTS_MAX = 1000;
export const EVENT_RETENTION_DAYS = 30;

// What an agent's CLI says when the account, not the task, stopped the run.
const BILLING = /\bapi error:\s*402\b|\brequires more credits\b|\bcredit balance is too low\b/i;
const USAGE_LIMIT =
    /\b(?:usage|session|weekly|hourly|\d+[\s-]hours?)[\s-]?limit\b|\bquota\b.{0,20}\b(?:exceeded|reached)\b/i;
export const LOGIN_RACE = /another claude code process is refreshing/i;

// A failed run's reason when its account stopped it, with the CLI's own line, which tells when a
// limit resets.
export function accountFailure(output: string): string | null {
    for (const line of output.split("\n")) {
        const kind = BILLING.test(line)
            ? "is out of credits"
            : USAGE_LIMIT.test(line)
              ? "hit its usage limit"
              : null;
        if (kind) return `the agent's account ${kind}: ${line.trim().slice(0, 300)}`;
    }
    return null;
}

export interface TraceEvent {
    type: AgentEventType;
    summary: string;
    detail?: string | null;
}

export const USAGE_FIELDS = [
    "turns",
    "costUsd",
    "inputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "outputTokens",
    "durationMs",
] as const satisfies readonly (keyof Usage)[];

export const emptyUsage = (): Usage => ({
    turns: null,
    costUsd: null,
    inputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    durationMs: null,
});

export function clip(text: string, max = EVENT_SUMMARY_MAX): string {
    const line = text.replace(/\s+/g, " ").trim();
    return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// The input field that says most about a tool call; the whole input when none of them is there.
const INPUT_KEYS = ["command", "file_path", "path", "pattern", "url", "query", "description"];

export function inputSummary(input: unknown): string {
    if (input && typeof input === "object") {
        const record = input as Record<string, unknown>;
        for (const key of INPUT_KEYS)
            if (typeof record[key] === "string") return clip(record[key] as string);
    }
    return clip(input === undefined ? "" : JSON.stringify(input));
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);
// What Claude's Edit, MultiEdit or Write changes, as "-" and "+" lines.
export function editDetail(tool: string, input: unknown): string | null {
    if (!isObject(input)) return null;
    const lines = (prefix: string, text: unknown) =>
        typeof text === "string" && text ? text.split("\n").map((line) => prefix + line) : [];
    const edits =
        tool === "MultiEdit" && Array.isArray(input.edits) ? input.edits.filter(isObject) : [input];
    const out =
        tool === "Write"
            ? lines("+", input.content)
            : tool === "Edit" || tool === "MultiEdit"
              ? edits.flatMap((edit) => [
                    ...lines("-", edit.old_string),
                    ...lines("+", edit.new_string),
                ])
              : [];
    return out.length ? out.join("\n") : null;
}

const count = (value: unknown) => (typeof value === "number" && value >= 0 ? value : 0);

// Reads an agent's JSON lines as they come: events go to `onEvent`, the final answer and usage
// are kept. A line that is not JSON (a CLI error, an old fake agent) is kept as raw output.
export class TraceReader {
    readonly usage: Usage = emptyUsage();
    result: string | null = null;
    readonly raw: string[] = [];
    // What the agent reported as errors, apart from its answer, for telling why a run failed.
    readonly errors: string[] = [];
    // The agent reported a failure that its exit code may not show.
    failed = false;
    // Claude's session, which a later step can continue.
    sessionId: string | null = null;
    // ACP's answer comes in chunks: the text since the last tool call.
    private segment = "";
    private readonly agent: AgentName;
    private readonly onEvent: (event: TraceEvent) => void;

    constructor(agent: AgentName, onEvent: (event: TraceEvent) => void) {
        this.agent = agent;
        this.onEvent = onEvent;
    }

    line(text: string): void {
        let message: unknown;
        try {
            if (text.trim()) message = JSON.parse(text);
        } catch {}
        if (!isObject(message)) {
            this.raw.push(text);
            return;
        }
        if (this.agent === "claude") this.claude(message);
        else if (this.agent === "codex") this.codex(message);
        else if (this.agent === "cursor") this.cursor(message);
        else if (this.agent === "opencode") this.opencode(message);
        else if (this.agent === "pi") this.pi(message);
        else this.acp(message);
    }

    private fail(summary: string): void {
        this.failed = true;
        this.emit("error", summary || "the agent failed");
    }

    private add(
        fresh: unknown,
        read: unknown,
        write: unknown,
        output: unknown,
        costUsd?: unknown,
    ): void {
        this.usage.inputTokens =
            (this.usage.inputTokens ?? 0) + count(fresh) + count(read) + count(write);
        this.usage.cacheReadTokens = (this.usage.cacheReadTokens ?? 0) + count(read);
        this.usage.cacheWriteTokens = (this.usage.cacheWriteTokens ?? 0) + count(write);
        this.usage.outputTokens = (this.usage.outputTokens ?? 0) + count(output);
        if (typeof costUsd === "number") this.usage.costUsd = (this.usage.costUsd ?? 0) + costUsd;
    }

    // Cursor's stream-json: like Claude's, with tool calls as their own events and no usage today.
    private cursor(message: Json): void {
        if (message.type === "assistant" && isObject(message.message) && !message.model_call_id) {
            const content = message.message.content;
            for (const block of Array.isArray(content) ? content : [])
                if (isObject(block) && block.type === "text" && typeof block.text === "string")
                    this.emit("text", block.text);
        }
        if (message.type === "tool_call" && message.subtype === "started") {
            const call = isObject(message.tool_call) ? message.tool_call : {};
            const fn = isObject(call.function) ? call.function : null;
            const [key, value] = Object.entries(call)[0] ?? ["tool", {}];
            const name = fn ? String(fn.name) : key.replace(/ToolCall$/, "");
            const args = fn ? fn.arguments : isObject(value) ? value.args : undefined;
            this.emit("tool", `${name}: ${inputSummary(args)}`);
        }
        if (message.type !== "result") return;
        if (typeof message.result === "string") this.result = message.result;
        if (typeof message.duration_ms === "number") this.usage.durationMs = message.duration_ms;
        const usage = isObject(message.usage) ? message.usage : {};
        this.add(
            usage.input_tokens,
            usage.cache_read_input_tokens,
            usage.cache_creation_input_tokens,
            usage.output_tokens,
            message.total_cost_usd,
        );
        this.usage.turns = 1;
        if (message.is_error === true) this.fail(String(message.result ?? message.subtype ?? ""));
        else this.emit("result", String(message.subtype ?? "result"));
    }

    // `opencode run --format json`: finished parts of the session, a step-finish part per round
    // trip with its tokens and cost.
    private opencode(message: Json): void {
        const part = isObject(message.part) ? message.part : {};
        if (message.type === "text" && typeof part.text === "string") {
            this.emit("text", part.text);
            this.result = this.result ? `${this.result}\n${part.text}` : part.text;
        } else if (message.type === "tool_use") {
            const state = isObject(part.state) ? part.state : {};
            this.emit("tool", `${String(part.tool)}: ${inputSummary(state.input)}`);
        } else if (message.type === "step_finish") {
            const tokens = isObject(part.tokens) ? part.tokens : {};
            const cache = isObject(tokens.cache) ? tokens.cache : {};
            this.add(tokens.input, cache.read, cache.write, tokens.output);
            if (typeof part.cost === "number")
                this.usage.costUsd = (this.usage.costUsd ?? 0) + part.cost;
            this.usage.turns = (this.usage.turns ?? 0) + 1;
        } else if (message.type === "error") {
            const error = isObject(message.error) ? message.error : {};
            const data = isObject(error.data) ? error.data : {};
            this.fail(String(data.message ?? error.name ?? "error"));
        }
    }

    // pi's RPC mode: whole assistant messages with usage, and tool executions.
    private pi(message: Json): void {
        if (message.type === "tool_execution_start")
            this.emit("tool", `${String(message.toolName)}: ${inputSummary(message.args)}`);
        else if (message.type === "response" && message.success === false)
            this.fail(String(message.error ?? "pi refused the command"));
        else if (message.type === "message_end" && isObject(message.message)) {
            const done = message.message;
            if (done.role !== "assistant") return;
            const parts = Array.isArray(done.content) ? done.content : [];
            const text = parts
                .filter((p): p is Json => isObject(p) && p.type === "text")
                .map((p) => String(p.text ?? ""))
                .join("");
            if (text.trim()) {
                this.emit("text", text);
                this.result = text;
            }
            const usage = isObject(done.usage) ? done.usage : {};
            const cost = isObject(usage.cost) ? usage.cost.total : undefined;
            this.add(usage.input, usage.cacheRead, usage.cacheWrite, usage.output, cost);
            this.usage.turns = (this.usage.turns ?? 0) + 1;
            if (done.stopReason === "error") this.fail(String(done.errorMessage ?? "error"));
        }
    }

    private flush(): void {
        if (this.segment.trim()) {
            this.emit("text", this.segment);
            this.result = this.segment;
        }
        this.segment = "";
    }

    // ACP (Junie, Copilot): session/update notifications, and the prompt's answer with usage.
    private acp(message: Json): void {
        if (message.error !== undefined && message.id !== undefined) {
            const error = isObject(message.error) ? message.error : {};
            this.fail(String(error.message ?? "ACP error"));
            return;
        }
        if (isObject(message.result) && typeof message.result.stopReason === "string") {
            this.flush();
            const usage = isObject(message.result.usage) ? message.result.usage : {};
            this.add(
                usage.inputTokens,
                usage.cachedReadTokens,
                usage.cachedWriteTokens,
                usage.outputTokens,
            );
            this.usage.turns = 1;
            const reason = message.result.stopReason;
            if (reason === "refusal" || reason === "cancelled") this.fail(reason);
            else this.emit("result", reason);
            return;
        }
        if (message.method !== "session/update" || !isObject(message.params)) return;
        const update = isObject(message.params.update) ? message.params.update : {};
        const content = isObject(update.content) ? update.content : {};
        if (update.sessionUpdate === "agent_message_chunk" && typeof content.text === "string")
            this.segment += content.text;
        else if (update.sessionUpdate === "tool_call") {
            this.flush();
            this.emit(
                "tool",
                `${String(update.title ?? update.kind)}: ${inputSummary(update.rawInput)}`,
            );
        } else if (update.sessionUpdate === "usage_update" && isObject(update.cost)) {
            if (typeof update.cost.amount === "number") this.usage.costUsd = update.cost.amount;
        }
    }

    private emit(type: AgentEventType, summary: string, detail?: string | null): void {
        if (type === "error") this.errors.push(summary);
        const clipped = clip(summary);
        const whole = detail?.slice(0, EVENT_DETAIL_MAX);
        if (clipped)
            this.onEvent(
                whole ? { type, summary: clipped, detail: whole } : { type, summary: clipped },
            );
    }

    // Claude Code's stream-json: what it loaded, assistant messages with text and tool_use blocks,
    // the tools' results, and one result. Every detail is kept whole.
    private claude(message: Json): void {
        if (typeof message.session_id === "string") this.sessionId = message.session_id;
        if (message.type === "system" && message.subtype === "init") {
            const many = (key: string) => (Array.isArray(message[key]) ? message[key].length : 0);
            this.emit(
                "session",
                `Claude Code ${String(message.claude_code_version ?? "")} · ` +
                    `${String(message.model ?? "")} · ${many("tools")} tools · ` +
                    `${many("mcp_servers")} MCP · ${many("skills")} skills · ` +
                    `${many("slash_commands")} commands`,
                JSON.stringify(message, null, 2),
            );
        }
        if (message.type === "assistant" && isObject(message.message)) {
            const content = message.message.content;
            for (const block of Array.isArray(content) ? content : []) {
                if (!isObject(block)) continue;
                if (block.type === "text" && typeof block.text === "string")
                    this.emit("text", block.text, block.text);
                if (block.type === "tool_use")
                    this.emit(
                        "tool",
                        `${String(block.name)}: ${inputSummary(block.input)}`,
                        editDetail(String(block.name), block.input) ??
                            JSON.stringify(block.input, null, 2),
                    );
            }
        }
        if (message.type === "user" && isObject(message.message)) {
            const content = message.message.content;
            for (const block of Array.isArray(content) ? content : []) {
                if (!isObject(block) || block.type !== "tool_result") continue;
                const parts = Array.isArray(block.content) ? block.content : [block.content];
                const text = parts
                    .map((p) =>
                        typeof p === "string"
                            ? p
                            : isObject(p) && typeof p.text === "string"
                              ? p.text
                              : isObject(p)
                                ? `[${String(p.type)}]`
                                : "",
                    )
                    .join("\n");
                this.emit(
                    "output",
                    `${block.is_error === true ? "error: " : ""}${text}` || "(empty)",
                    text,
                );
            }
        }
        if (message.type !== "result") return;
        if (typeof message.result === "string") this.result = message.result;
        if (message.is_error === true && typeof message.result === "string")
            this.errors.push(message.result);
        const usage = isObject(message.usage) ? message.usage : {};
        Object.assign(this.usage, {
            turns: typeof message.num_turns === "number" ? message.num_turns : null,
            costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
            inputTokens:
                count(usage.input_tokens) +
                count(usage.cache_creation_input_tokens) +
                count(usage.cache_read_input_tokens),
            cacheReadTokens: count(usage.cache_read_input_tokens),
            cacheWriteTokens: count(usage.cache_creation_input_tokens),
            outputTokens: count(usage.output_tokens),
            durationMs: typeof message.duration_ms === "number" ? message.duration_ms : null,
        });
        const cost = this.usage.costUsd === null ? "" : `, $${this.usage.costUsd.toFixed(4)}`;
        // The whole result, with the tokens split into fresh input and cache writes and reads.
        this.emit(
            message.is_error === true ? "error" : "result",
            `${String(message.subtype ?? "result")}: ${this.usage.turns ?? "?"} turns${cost}`,
            JSON.stringify(message, null, 2),
        );
    }

    // `codex exec --json`: items as they complete, usage per turn, no cost.
    private codex(message: Json): void {
        if (message.type === "turn.completed") {
            const usage = isObject(message.usage) ? message.usage : {};
            this.usage.turns = (this.usage.turns ?? 0) + 1;
            // Codex's input already holds the cached part.
            this.usage.inputTokens = (this.usage.inputTokens ?? 0) + count(usage.input_tokens);
            this.usage.cacheReadTokens =
                (this.usage.cacheReadTokens ?? 0) + count(usage.cached_input_tokens);
            this.usage.outputTokens = (this.usage.outputTokens ?? 0) + count(usage.output_tokens);
            return;
        }
        if (message.type === "turn.failed" && isObject(message.error))
            this.emit("error", String(message.error.message ?? "turn failed"));
        else if (message.type === "error") this.emit("error", String(message.message ?? ""));
        else if (message.type === "item.completed" && isObject(message.item)) {
            const event = codexItem(message.item);
            if (message.item.type === "agent_message" && typeof message.item.text === "string")
                this.result = message.item.text;
            if (event) this.emit(event.type, event.summary);
        }
    }
}

function codexItem(item: Json): TraceEvent | null {
    switch (item.type) {
        case "agent_message":
            return { type: "text", summary: String(item.text ?? "") };
        case "command_execution":
            return { type: "tool", summary: `shell: ${String(item.command ?? "")}` };
        case "file_change": {
            const changes = Array.isArray(item.changes) ? item.changes : [];
            const paths = changes.map((c) => (isObject(c) ? `${c.kind} ${c.path}` : ""));
            return { type: "tool", summary: `edit: ${paths.join(", ")}` };
        }
        case "mcp_tool_call":
            return { type: "tool", summary: `${String(item.server)}.${String(item.tool)}` };
        case "web_search":
            return { type: "tool", summary: `web_search: ${String(item.query ?? "")}` };
        case "error":
            return { type: "error", summary: String(item.message ?? "") };
        default:
            return null;
    }
}

const HOUR = 3_600_000;

export const retentionStart = (now = Date.now()) =>
    new Date(now - EVENT_RETENTION_DAYS * 24 * HOUR).toISOString();

// Deletes agent events past retention now and then every hour.
export function startEventPurge(store: Store): () => void {
    const purge = async () => {
        try {
            const deleted = await store.purgeAgentEvents(retentionStart());
            if (deleted) console.log(`deleted ${deleted} agent event(s) older than retention`);
        } catch (error) {
            console.error(`event purge: ${error}`);
        }
    };
    void purge();
    const timer = setInterval(purge, HOUR);
    return () => clearInterval(timer);
}
