import type { Stdin } from "./proc.ts";

// The protocol an agent speaks on stdin and stdout for one prompt; the trace of the same lines is
// read by TraceReader.
export interface Session {
    start(stdin: Stdin): void;
    line(text: string): void;
}

type Json = Record<string, unknown>;

// A permission request is answered with the broadest allow the agent offers.
const ALLOW_KINDS = ["allow_always", "allow_once"];

const parse = (text: string): Json | null => {
    try {
        const value = text.trim() ? JSON.parse(text) : null;
        return value && typeof value === "object" && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
};

// One prompt over ACP (JSON-RPC 2.0, a message per line): initialize, authenticate when the agent
// wants it, session/new, the session's options, session/prompt; its answer ends the session, and
// so does any error. The agent's permission requests are allowed.
export function acpSession(opts: {
    cwd: string;
    prompt: string;
    mcpServers: object[];
    authenticate: boolean;
    options: { configId: string; value: string }[];
}): Session {
    let stdin: Stdin | null = null;
    let next = 1;
    const pending = new Map<number, (result: Json) => void>();
    const send = (message: Json) => stdin?.write(JSON.stringify({ jsonrpc: "2.0", ...message }));
    const request = (method: string, params: object, then: (result: Json) => void) => {
        const id = next++;
        pending.set(id, then);
        send({ id, method, params });
    };
    const prompt = (sessionId: unknown, i = 0): void => {
        const option = opts.options[i];
        if (option)
            request("session/set_config_option", { sessionId, ...option }, () =>
                prompt(sessionId, i + 1),
            );
        else
            request(
                "session/prompt",
                { sessionId, prompt: [{ type: "text", text: opts.prompt }] },
                () => stdin?.finish(),
            );
    };
    const open = () =>
        request("session/new", { cwd: opts.cwd, mcpServers: opts.mcpServers }, (result) =>
            prompt(result.sessionId),
        );
    return {
        start(given) {
            stdin = given;
            request(
                "initialize",
                {
                    protocolVersion: 1,
                    clientCapabilities: {
                        fs: { readTextFile: false, writeTextFile: false },
                        terminal: false,
                    },
                },
                (result) => {
                    const methods = Array.isArray(result.authMethods) ? result.authMethods : [];
                    const method = (methods[0] as Json | undefined)?.id;
                    if (opts.authenticate && method !== undefined)
                        request("authenticate", { methodId: method }, open);
                    else open();
                },
            );
        },
        line(text) {
            const message = parse(text);
            if (!message) return;
            const id = message.id;
            if (typeof message.method === "string" && id !== undefined) {
                if (message.method !== "session/request_permission")
                    return send({ id, error: { code: -32601, message: "method not found" } });
                const params = (message.params ?? {}) as Json;
                const options = (Array.isArray(params.options) ? params.options : []) as Json[];
                const allow =
                    ALLOW_KINDS.map((kind) => options.find((o) => o.kind === kind)).find(Boolean) ??
                    options[0];
                return send({
                    id,
                    result: allow
                        ? { outcome: { outcome: "selected", optionId: allow.optionId } }
                        : { outcome: { outcome: "cancelled" } },
                });
            }
            if (typeof id !== "number" || !pending.has(id)) return;
            const then = pending.get(id);
            pending.delete(id);
            if (message.error) stdin?.finish();
            else then?.((message.result ?? {}) as Json);
        },
    };
}

// One prompt over pi's RPC mode: the prompt command, then events until the agent settles.
export function piSession(prompt: string): Session {
    let stdin: Stdin | null = null;
    return {
        start(given) {
            stdin = given;
            stdin.write(JSON.stringify({ type: "prompt", message: prompt }));
        },
        line(text) {
            const message = parse(text);
            if (
                message?.type === "agent_end" ||
                message?.type === "agent_settled" ||
                (message?.type === "response" && message.success === false)
            )
                stdin?.finish();
        },
    };
}
