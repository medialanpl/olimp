import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { AGENTS, type AgentName } from "./agents.ts";
import type { Config } from "./config.ts";
import { run } from "./proc.ts";
import { agentEnv } from "./sandbox.ts";

export interface ModelOption {
    agent: AgentName;
    // What the agent's model flag (or Junie's model option) takes.
    value: string;
    label: string;
    description: string;
}

const DISCOVERY_TIMEOUT_MS = 20_000;
const CACHE_MS = 60 * 60 * 1000;
const REQUEST_ID = "olimp-list-models";

// The Claude CLI answers `list_models` on its stream-json control channel without a
// turn, so it costs nothing; --safe-mode keeps the user's hooks, MCP servers and plugins out.
const DISCOVERY_ARGS = [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--safe-mode",
    "--no-session-persistence",
];

export function discoverClaudeModels(
    bin: string,
    env: Record<string, string>,
): Promise<ModelOption[]> {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, DISCOVERY_ARGS, {
            cwd: tmpdir(),
            env,
            stdio: ["pipe", "pipe", "ignore"],
        });
        const timer = setTimeout(
            () => finish(new Error("model discovery timed out")),
            DISCOVERY_TIMEOUT_MS,
        );
        const finish = (error: Error | null, models?: ModelOption[]) => {
            clearTimeout(timer);
            child.stdin.end();
            child.kill();
            if (error) reject(error);
            else resolve(models ?? []);
        };
        child.on("error", (error) => finish(error));
        child.on("exit", () => finish(new Error("the CLI ended without a model list")));
        child.stdin.on("error", () => {});
        createInterface({ input: child.stdout }).on("line", (line) => {
            let message: { type?: string; response?: Record<string, unknown> };
            try {
                message = JSON.parse(line);
            } catch {
                return;
            }
            const response = message.response;
            if (message.type !== "control_response" || response?.request_id !== REQUEST_ID) return;
            const listed = (response.response as { models?: unknown } | undefined)?.models;
            if (response.subtype !== "success" || !Array.isArray(listed))
                return finish(new Error("the CLI does not list its models"));
            finish(
                null,
                listed
                    .filter(
                        (m): m is { value: string; displayName?: string; description?: string } =>
                            typeof m?.value === "string" && m.value !== "default",
                    )
                    .slice(0, 50)
                    .map((m) => ({
                        agent: "claude",
                        value: m.value,
                        label: m.displayName || m.value,
                        description: m.description ?? "",
                    })),
            );
        });
        child.stdin.write(
            `${JSON.stringify({ type: "control_request", request_id: REQUEST_ID, request: { subtype: "list_models" } })}\n`,
        );
    });
}

// `codex app-server` lists the models the login offers over JSON-RPC (`model/list`,
// a page at a time) without a turn.
export function discoverCodexModels(
    bin: string,
    env: Record<string, string>,
): Promise<ModelOption[]> {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, ["app-server"], {
            cwd: tmpdir(),
            env,
            stdio: ["pipe", "pipe", "ignore"],
        });
        const models: ModelOption[] = [];
        let page = 0;
        const timer = setTimeout(
            () => finish(new Error("model discovery timed out")),
            DISCOVERY_TIMEOUT_MS,
        );
        const finish = (error: Error | null) => {
            clearTimeout(timer);
            child.stdin.end();
            child.kill();
            if (error) reject(error);
            else resolve(models);
        };
        const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
        const list = (cursor: string | null) =>
            send({
                id: ++page + 1,
                method: "model/list",
                params: { cursor, includeHidden: false },
            });
        child.on("error", (error) => finish(error));
        child.on("exit", () => finish(new Error("the CLI ended without a model list")));
        child.stdin.on("error", () => {});
        createInterface({ input: child.stdout }).on("line", (line) => {
            let message: { id?: unknown; result?: Record<string, unknown>; error?: unknown };
            try {
                message = JSON.parse(line);
            } catch {
                return;
            }
            if (message.error) return finish(new Error("the CLI does not list its models"));
            if (message.id === 1) {
                send({ method: "initialized", params: {} });
                return list(null);
            }
            if (typeof message.id !== "number" || !message.result) return;
            const data = Array.isArray(message.result.data) ? message.result.data : [];
            for (const m of data as {
                model?: unknown;
                displayName?: string;
                description?: string;
                hidden?: boolean;
            }[])
                if (typeof m.model === "string" && !m.hidden && models.length < 100)
                    models.push({
                        agent: "codex",
                        value: m.model,
                        label: m.displayName || m.model,
                        description: m.description ?? "",
                    });
            const next = message.result.nextCursor;
            if (typeof next === "string" && next && page < MAX_PAGES) list(next);
            else finish(null);
        });
        send({
            id: 1,
            method: "initialize",
            params: {
                clientInfo: { name: "olimp", title: "OLIMP", version: "1" },
                capabilities: {},
            },
        });
    });
}

const MAX_PAGES = 10;

// CLIs that print their models one per line, and how to read a line.
const LISTED: Partial<Record<AgentName, (line: string) => Omit<ModelOption, "agent"> | null>> = {
    // provider/model
    opencode: (line) => {
        const [provider, ...rest] = line.split("/");
        return /^[\w.-]+\/\S+$/.test(line)
            ? { value: line, label: rest.join("/"), description: `via ${provider}` }
            : null;
    },
    // "composer-2.5 - Composer 2.5"; no model at all is auto.
    cursor: (line) => {
        const found = /^([\w.:-]+)\s+-\s+(.+)$/.exec(line);
        return found?.[1] && found[1] !== "auto"
            ? { value: found[1], label: found[2] ?? found[1], description: "" }
            : null;
    },
};

async function listed(
    bin: string,
    agent: AgentName,
    env: Record<string, string>,
): Promise<ModelOption[]> {
    const read = LISTED[agent];
    if (!read) return [];
    const res = await run(bin, ["models"], { cwd: tmpdir(), timeoutMs: DISCOVERY_TIMEOUT_MS, env });
    if (res.code !== 0) throw new Error(`${agent} models exited with code ${res.code}`);
    return res.stdout
        .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
        .split("\n")
        .map((line) => read(line.trim()))
        .filter((m): m is Omit<ModelOption, "agent"> => m !== null)
        .slice(0, 100)
        .map((m) => ({ agent, ...m }));
}

const DISCOVER: Partial<
    Record<AgentName, (bin: string, env: Record<string, string>) => Promise<ModelOption[]>>
> = {
    claude: discoverClaudeModels,
    codex: discoverCodexModels,
    opencode: (bin, env) => listed(bin, "opencode", env),
    cursor: (bin, env) => listed(bin, "cursor", env),
};

const cache = new Map<string, { at: number; models: ModelOption[] }>();

// Only what the installed CLIs list for the caller's login: no list of OLIMP's own,
// so an agent that is not installed or cannot answer offers none (its CLI's default still runs).
// An answer is kept an hour per agent and HOME; a failure is not, so the next call asks again.
export async function listModels(cfg: Config, home: string): Promise<ModelOption[]> {
    const lists = await Promise.all(
        AGENTS.map(async (agent) => {
            const bin = cfg[agent];
            const discover = DISCOVER[agent];
            if (!bin || !discover) return [];
            const key = `${agent}:${bin}:${home}`;
            const hit = cache.get(key);
            if (hit && Date.now() - hit.at < CACHE_MS) return hit.models;
            try {
                const models = await discover(
                    bin,
                    agentEnv(agent, {}, cfg.agentEnv, process.env, home),
                );
                cache.set(key, { at: Date.now(), models });
                return models;
            } catch (error) {
                console.warn(`${agent} models: ${error instanceof Error ? error.message : error}`);
                return [];
            }
        }),
    );
    return lists.flat();
}
