import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AGENTS } from "../agents.ts";
import { PATH_MAX } from "../limits.ts";
import { type Call, loginName, model, perAgent } from "./shared.ts";

export function registerAgentTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_list_agents",
        {
            description:
                `List the coding agents OLIMP can run (${AGENTS.join(", ")}): the binary found ` +
                "and its version (null when not installed), how to install it, whether it takes " +
                "MCP servers, and the caller's logins of each (without accounts: the " +
                "installation's): the default one in HOME and second ones, each with its " +
                "configuration folder and whether it is logged in (null: OLIMP cannot tell).",
        },
        () => call("GET", "/api/agents"),
    );
    server.registerTool(
        "olimp_add_agent_login",
        {
            description:
                "Add a second login of an agent for the caller (a work account beside a personal " +
                "one). Only claude and codex: the others keep their login outside their config " +
                "folder. Without accounts it may point at any config folder (made when missing; " +
                "removing the login leaves it), else OLIMP makes an empty one. Log in on the OLIMP " +
                "machine with `pnpm agent-login <agent> <name>` and OLIMP_TOKEN (without " +
                "accounts: CLAUDE_CONFIG_DIR or CODEX_HOME set to the folder); a project picks it " +
                "with olimp_set_repo_agents.",
            inputSchema: {
                agent: z.enum(AGENTS),
                name: loginName
                    .optional()
                    .describe("Login name, e.g. work; from the folder's by default"),
                folder: z
                    .string()
                    .max(PATH_MAX)
                    .optional()
                    .describe(
                        "Config folder, absolute or ~/…, e.g. ~/.claude-work (no accounts only)",
                    ),
            },
        },
        ({ agent, ...body }) => call("POST", `/api/agents/${agent}/logins`, body),
    );
    server.registerTool(
        "olimp_remove_agent_login",
        {
            description:
                "Remove a second login of an agent and its folder with the credentials in it. " +
                "Projects that chose it fail until they pick another.",
            inputSchema: { agent: z.enum(AGENTS), name: loginName },
        },
        ({ agent, name }) => call("DELETE", `/api/agents/${agent}/logins/${name}`),
    );
    server.registerTool(
        "olimp_set_agent_token",
        {
            description:
                "Log a login of the caller's agent in with a long-lived token instead of a terminal " +
                "on the OLIMP machine: for claude, what `claude setup-token` prints when run " +
                "anywhere the caller is logged in to Claude. OLIMP keeps it as a file only it can " +
                "read beside the login, never returns it, and hands it to the agent as " +
                "CLAUDE_CODE_OAUTH_TOKEN. Without token, removes it.",
            inputSchema: {
                agent: z.enum(AGENTS),
                name: loginName.default("default"),
                token: z.string().min(20).max(1000).optional(),
            },
        },
        ({ agent, name, token }) =>
            call(
                token ? "PUT" : "DELETE",
                `/api/agents/${agent}/logins/${name}/token`,
                token ? { token } : undefined,
            ),
    );
    server.registerTool(
        "olimp_get_agent_defaults",
        {
            description:
                "Show what a project runs when it has chosen nothing itself: the agent of new " +
                "tasks and the model per agent (a missing one is the CLI's own default).",
        },
        () => call("GET", "/api/agent-defaults"),
    );
    server.registerTool(
        "olimp_set_agent_defaults",
        {
            description:
                "Set the agent and the models per agent projects use when they have chosen none " +
                "(admin only). A project's own choice wins.",
            inputSchema: { agent: z.enum(AGENTS), models: perAgent(model).optional() },
        },
        (body) => call("PUT", "/api/agent-defaults", body),
    );
    server.registerTool(
        "olimp_list_models",
        {
            description:
                "List the models a task can ask for, only as the installed CLIs (Claude, Codex, " +
                "OpenCode, Cursor) offer them to the installation's (or your) login, with label " +
                "and description; an agent that is not installed or cannot answer lists none. A " +
                "task's model picks its agent too.",
            inputSchema: {},
        },
        () => call("GET", "/api/models"),
    );
}
