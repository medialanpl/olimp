import type { Config } from "./config.ts";
import { expand, references, type ServerSpec } from "./integrations.ts";
import { acpSession, piSession, type Session } from "./sessions.ts";

export const AGENTS = ["claude", "codex", "copilot", "cursor", "junie", "opencode", "pi"] as const;
export type AgentName = (typeof AGENTS)[number];

export const isAgent = (value: unknown): value is AgentName => AGENTS.includes(value as AgentName);

// Variables of the model providers OpenCode and pi talk to.
const PROVIDERS = [
    "ANTHROPIC_",
    "AZURE_OPENAI_",
    "DEEPSEEK_",
    "FIREWORKS_",
    "GEMINI_",
    "GOOGLE_GENERATIVE_AI_",
    "GROQ_",
    "MISTRAL_",
    "OPENAI_",
    "OPENROUTER_",
    "PERPLEXITY_",
    "TOGETHER_",
    "XAI_",
];

export interface AgentSpec {
    label: string;
    // The binary looked up on PATH; OLIMP_<AGENT> overrides it.
    bin: string;
    install: string;
    // The agent's configuration folder under HOME, and the variable that moves it (a second
    // login); null when the CLI keeps its login elsewhere, so it has one login per HOME.
    configDir: string;
    configEnv: string | null;
    // How OLIMP tells it is logged in: a file in that folder, or a command's output (stdout and
    // stderr); null when it cannot tell.
    login: { file: string } | { probe: string[]; ok: RegExp } | null;
    // How `pnpm agent-login` starts it: claude in a HOME without a login starts with one.
    loginArgs: string[];
    // The variable that carries a long-lived token pasted in the panel instead of a terminal login,
    // and how such a token starts, so a wrong one (OLIMP's own) is refused before a run.
    tokenEnv?: string;
    tokenPrefix?: string;
    // Variables carrying the agent's own login and configuration.
    envPrefixes: string[];
    // Whether a step can hand it MCP servers (integrations, a dispatched task's tool).
    mcp: boolean;
}

// How each agent runs and is probed, on Linux.
export const AGENT_SPECS: Record<AgentName, AgentSpec> = {
    claude: {
        label: "Claude Code",
        bin: "claude",
        install: "npm i -g @anthropic-ai/claude-code",
        configDir: ".claude",
        configEnv: "CLAUDE_CONFIG_DIR",
        login: { file: ".credentials.json" },
        loginArgs: [],
        // From `claude setup-token`, which needs a subscription.
        tokenEnv: "CLAUDE_CODE_OAUTH_TOKEN",
        tokenPrefix: "sk-ant-",
        envPrefixes: ["ANTHROPIC_", "CLAUDE_"],
        mcp: true,
    },
    codex: {
        label: "Codex",
        bin: "codex",
        install: "npm i -g @openai/codex",
        configDir: ".codex",
        configEnv: "CODEX_HOME",
        login: { file: "auth.json" },
        loginArgs: ["login"],
        envPrefixes: ["OPENAI_", "CODEX_"],
        mcp: true,
    },
    junie: {
        label: "Junie",
        bin: "junie",
        install: "https://www.jetbrains.com/junie/",
        configDir: ".junie",
        configEnv: null,
        login: { file: "secure_credentials.json" },
        loginArgs: [],
        envPrefixes: ["JUNIE_"],
        mcp: true,
    },
    opencode: {
        label: "OpenCode",
        bin: "opencode",
        install: "npm i -g opencode-ai",
        configDir: ".local/share/opencode",
        configEnv: null,
        login: {
            probe: ["auth", "list"],
            ok: /\b[1-9]\d* (credentials?|environment variables?)\b/,
        },
        loginArgs: ["auth", "login"],
        envPrefixes: PROVIDERS,
        mcp: true,
    },
    cursor: {
        label: "Cursor",
        bin: "cursor-agent",
        install: "curl https://cursor.com/install -fsS | bash",
        configDir: ".cursor",
        configEnv: null,
        login: {
            probe: ["status", "--format", "json"],
            ok: /"isAuthenticated"\s*:\s*true|"status"\s*:\s*"authenticated"/,
        },
        loginArgs: ["login"],
        envPrefixes: ["CURSOR_"],
        mcp: false,
    },
    pi: {
        label: "pi",
        bin: "pi",
        install: "npm i -g @mariozechner/pi-coding-agent",
        configDir: ".pi",
        configEnv: null,
        login: { probe: ["--list-models"], ok: /^provider\s+model\b/m },
        loginArgs: [],
        envPrefixes: ["PI_", ...PROVIDERS],
        mcp: false,
    },
    copilot: {
        label: "GitHub Copilot CLI",
        bin: "copilot",
        install: "npm i -g @github/copilot",
        configDir: ".copilot",
        configEnv: null,
        login: null,
        loginArgs: ["login"],
        envPrefixes: ["COPILOT_"],
        mcp: true,
    },
};

// The login file of the agents that keep one in their folder, relative to HOME.
export const LOGIN_FILES = {
    claude: ".claude/.credentials.json",
    codex: ".codex/auth.json",
} as const;

// A login beside the one in HOME; "default" is that one.
export const LOGIN_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const DEFAULT_LOGIN = "default";

// The step's MCP servers by integration name, with `${NAME}` references not yet expanded.
export type Servers = Record<string, ServerSpec>;

export const isModel = (value: unknown): value is string =>
    typeof value === "string" && /^[\w.:/[\]-]{1,64}$/.test(value);

type PerAgent = Partial<Record<AgentName, string>>;

// What a project chose; what it leaves out (null, or an agent missing from a map) comes from the
// installation's defaults, and a model from neither is the agent's own default.
export interface RepoAgents {
    agent: AgentName | null;
    models: PerAgent;
    // The login each agent runs on, by name; the one in HOME when missing.
    logins: PerAgent;
}

export interface AgentDefaults {
    agent: AgentName;
    models: PerAgent;
}

export const noAgents = (): RepoAgents => ({ agent: null, models: {}, logins: {} });

// A map of agent to model or login name, or null when it is not one; an empty value is left out.
export function perAgent(value: unknown, valid: (v: string) => boolean): PerAgent | null {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) return null;
    const map: PerAgent = {};
    for (const [agent, v] of Object.entries(value)) {
        if (!isAgent(agent) || (v !== null && v !== "" && typeof v !== "string")) return null;
        if (!v) continue;
        if (!valid(v)) return null;
        map[agent] = v;
    }
    return map;
}

export function repoAgentsOf(value: unknown): RepoAgents | null {
    if (typeof value !== "object" || value === null) return null;
    const body = value as Record<string, unknown>;
    const agent = body.agent ?? null;
    const models = perAgent(body.models, isModel);
    const logins = perAgent(body.logins, (v) => LOGIN_NAME.test(v));
    if ((agent !== null && !isAgent(agent)) || !models || !logins) return null;
    return {
        agent,
        models,
        logins: Object.fromEntries(Object.entries(logins).filter(([, v]) => v !== DEFAULT_LOGIN)),
    };
}

// What one call adds to the agent's defaults: a model, and folders outside the worktree it may read.
export interface CallOptions {
    model: string | null;
    dirs: string[];
    // A session of an earlier step to continue; only Claude takes one, the others start fresh.
    resume?: string | null;
    // A workflow step's own tool list in place of Claude's defaults.
    tools?: string[] | null;
}

export const resumes = (agent: AgentName) => agent === "claude";

export interface AgentCall {
    args: string[];
    // Added to the agent's allowed environment for this call only.
    env: Record<string, string>;
    // The protocol on stdin of an agent that is not given its prompt in the arguments.
    session?: Session;
    // The prompt on stdin, when it is longer than one argument may be.
    input?: string;
}

// Linux takes at most 128 KiB in one argument; spawn would only say E2BIG.
export const ARG_MAX = 128 * 1024 - 1;
const tooLong = (prompt: string) => Buffer.byteLength(prompt) > ARG_MAX;

// How to call one coding agent non-interactively; worktree, commit, push and PR stay in the runner.
// A step gets exactly the MCP servers it chose, none from the user's own agent configuration, and
// the shell commands its repository allows.
export interface AgentRunner {
    bin: string | null;
    call(
        prompt: string,
        dir: string,
        servers: Servers,
        env: NodeJS.ProcessEnv,
        commands: string[],
        options?: CallOptions,
    ): AgentCall;
}

// Claude expands `${NAME}` in --mcp-config itself, so the configuration carries only references.
function claudeConfig(servers: Servers): string {
    const mcpServers = Object.fromEntries(
        Object.entries(servers).map(([name, s]) => [
            name,
            s.kind === "stdio"
                ? { type: "stdio", command: s.command, args: s.args, env: s.env }
                : { type: "http", url: s.url, headers: s.headers },
        ]),
    );
    return JSON.stringify({ mcpServers });
}

type Toml = string | Toml[] | { [key: string]: Toml };

// One-line TOML; a JSON string is also a valid TOML basic string.
const toml = (value: Toml): string =>
    typeof value === "string"
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? `[${value.map(toml).join(", ")}]`
          : `{${Object.entries(value)
                .map(([k, v]) => ` ${JSON.stringify(k)} = ${toml(v)}`)
                .join(",")} }`;

// Codex does not expand references, and a value in its arguments would show in the process list:
// a value with a reference goes into the codex process environment, and the config names the
// variable (env_vars for a stdio server, env_http_headers for an http one). The whole
// mcp_servers table is one -c override, which replaces the table from ~/.codex/config.toml.
function codexConfig(
    servers: Servers,
    env: NodeJS.ProcessEnv,
): { table: string; env: Record<string, string> } {
    const extra: Record<string, string> = {};
    const pass = (name: string, value: string) => {
        if (name in extra && extra[name] !== value)
            throw new Error(
                `two integrations of this step set ${name} to different values, which codex cannot pass to both`,
            );
        extra[name] = value;
    };
    const tables = Object.entries(servers).map(([name, s], i): [string, Toml] => {
        if (s.kind === "stdio") {
            const literal: Record<string, string> = {};
            const forwarded: string[] = [];
            for (const [key, value] of Object.entries(s.env)) {
                if (!references(value).length) literal[key] = value;
                else {
                    pass(key, expand(value, env));
                    forwarded.push(key);
                }
            }
            return [name, { command: s.command, args: s.args, env: literal, env_vars: forwarded }];
        }
        const literal: Record<string, string> = {};
        const fromEnv: Record<string, string> = {};
        Object.entries(s.headers).forEach(([header, value], j) => {
            if (!references(value).length) literal[header] = value;
            else {
                const variable = `OLIMP_MCP_${i}_${j}`;
                pass(variable, expand(value, env));
                fromEnv[header] = variable;
            }
        });
        return [name, { url: s.url, http_headers: literal, env_http_headers: fromEnv }];
    });
    return { table: toml(Object.fromEntries(tables)), env: extra };
}

// OpenCode reads extra configuration as JSON from its environment; `${NAME}` references are
// expanded there, so values stay out of the process list.
function opencodeConfig(servers: Servers, env: NodeJS.ProcessEnv): string {
    const mcp = Object.fromEntries(
        Object.entries(servers).map(([name, s]) => [
            name,
            s.kind === "stdio"
                ? {
                      type: "local",
                      command: [s.command, ...s.args],
                      environment: expandAll(s.env, env),
                      enabled: true,
                  }
                : { type: "remote", url: s.url, headers: expandAll(s.headers, env), enabled: true },
        ]),
    );
    return JSON.stringify({ mcp });
}

const expandAll = (values: Record<string, string>, env: NodeJS.ProcessEnv) =>
    Object.fromEntries(Object.entries(values).map(([k, v]) => [k, expand(v, env)]));

const pairs = (values: Record<string, string>, env: NodeJS.ProcessEnv) =>
    Object.entries(expandAll(values, env)).map(([name, value]) => ({ name, value }));

// ACP's session/new takes the servers themselves, with references expanded, over stdin.
const acpServers = (servers: Servers, env: NodeJS.ProcessEnv) =>
    Object.entries(servers).map(([name, s]) =>
        s.kind === "stdio"
            ? { name, command: s.command, args: s.args, env: pairs(s.env, env) }
            : { type: "http", name, url: s.url, headers: pairs(s.headers, env) },
    );

const modelArg = (flag: string, options?: CallOptions) =>
    options?.model ? [flag, options.model] : [];

export function agentRunner(cfg: Config, name: AgentName): AgentRunner {
    const noMcp = (servers: Servers) => {
        if (Object.keys(servers).length)
            throw new Error(
                `${AGENT_SPECS[name].label} cannot be given MCP servers: run integrations or a ` +
                    "dispatched task on another agent",
            );
    };
    switch (name) {
        case "claude":
            return {
                bin: cfg.claude,
                call: (prompt, _dir, servers, _env, _commands, options) => {
                    const allowed = [
                        ...(options?.tools ?? []),
                        ...Object.keys(servers).map((n) => `mcp__${n}`),
                        "Bash",
                    ];
                    const piped = tooLong(prompt);
                    return {
                        args: [
                            "-p",
                            ...(piped ? [] : [prompt]),
                            // In print mode stream-json needs --verbose.
                            "--output-format",
                            "stream-json",
                            "--verbose",
                            "--permission-mode",
                            "acceptEdits",
                            "--strict-mcp-config",
                            "--mcp-config",
                            claudeConfig(servers),
                            // acceptEdits would deny MCP tools and every shell command in print mode.
                            "--allowedTools",
                            allowed.join(","),
                            ...(options?.tools ? ["--tools", options.tools.join(",")] : []),
                            ...(options?.resume ? ["--resume", options.resume] : []),
                            ...(options?.model ? ["--model", options.model] : []),
                            ...(options?.dirs ?? []).flatMap((dir) => ["--add-dir", dir]),
                        ],
                        env: {},
                        ...(piped && { input: prompt }),
                    };
                },
            };
        case "codex":
            // --full-auto is the workspace-write sandbox without network, where any command may
            // run, so the repository's commands only reach the prompt. `--` keeps a prompt
            // starting with "-" positional.
            return {
                bin: cfg.codex,
                // The sandbox reads the whole disk, so attached files need no extra folder.
                call: (prompt, dir, servers, env, _commands, options) => {
                    const config = codexConfig(servers, env);
                    const piped = tooLong(prompt);
                    return {
                        args: [
                            "exec",
                            "--json",
                            "--full-auto",
                            "-C",
                            dir,
                            "-c",
                            `mcp_servers=${config.table}`,
                            ...(options?.model ? ["-m", options.model] : []),
                            "--",
                            // `-` reads the prompt from stdin.
                            piped ? "-" : prompt,
                        ],
                        env: config.env,
                        ...(piped && { input: prompt }),
                    };
                },
            };
        // The four below run with every tool allowed: the repository's commands
        // only reach the prompt, and nothing sandboxes them.
        case "cursor":
            return {
                bin: cfg.cursor,
                call: (prompt, _dir, servers, _env, _commands, options) => {
                    noMcp(servers);
                    return {
                        args: [
                            "-p",
                            "--force",
                            "--trust",
                            "--output-format",
                            "stream-json",
                            ...modelArg("--model", options),
                            prompt,
                        ],
                        env: {},
                    };
                },
            };
        case "opencode":
            return {
                bin: cfg.opencode,
                call: (prompt, _dir, servers, env, _commands, options) => ({
                    args: ["run", "--format", "json", ...modelArg("--model", options), prompt],
                    env: { OPENCODE_CONFIG_CONTENT: opencodeConfig(servers, env) },
                }),
            };
        case "junie":
            return {
                bin: cfg.junie,
                call: (prompt, dir, servers, env, _commands, options) => ({
                    args: ["--acp=true", "-p", dir],
                    env: {},
                    session: acpSession({
                        cwd: dir,
                        prompt,
                        mcpServers: acpServers(servers, env),
                        // Junie asks for it even with a cached login.
                        authenticate: true,
                        options: [
                            { configId: "brave_mode", value: "on" },
                            ...(options?.model
                                ? [{ configId: "model", value: options.model }]
                                : []),
                        ],
                    }),
                }),
            };
        case "copilot":
            return {
                bin: cfg.copilot,
                call: (prompt, dir, servers, env, _commands, options) => ({
                    args: [
                        "--acp",
                        "--allow-all-tools",
                        "--no-auto-update",
                        ...modelArg("--model", options),
                        ...(options?.dirs ?? []).flatMap((d) => ["--add-dir", d]),
                    ],
                    env: {},
                    session: acpSession({
                        cwd: dir,
                        prompt,
                        mcpServers: acpServers(servers, env),
                        authenticate: false,
                        options: [],
                    }),
                }),
            };
        case "pi":
            return {
                bin: cfg.pi,
                call: (prompt, _dir, servers, _env, _commands, options) => {
                    noMcp(servers);
                    return {
                        args: [
                            "--mode",
                            "rpc",
                            ...modelArg("--model", options),
                            "--tools",
                            "read,bash,edit,write,grep,find",
                        ],
                        env: {},
                        session: piSession(prompt),
                    };
                },
            };
    }
}
