import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { INTEGRATION_ENTRIES_MAX, INTEGRATION_VALUE_MAX } from "../limits.ts";
import { type Call, integrationName, repo, repoPath } from "./shared.ts";

const value = z.string().max(INTEGRATION_VALUE_MAX);
const secretsNote =
    `Values may refer to environment variables of the OLIMP process as \${NAME}; secrets must be ` +
    "given that way, never literally (an Authorization header without a reference is refused)";
const serverFields = {
    kind: z.enum(["stdio", "http"]).describe("stdio: a local command; http: a remote server"),
    command: value.optional().describe("stdio: the command to start"),
    args: z.array(value).max(INTEGRATION_ENTRIES_MAX).optional().describe("stdio: arguments"),
    env: z
        .record(z.string().regex(/^[A-Za-z_]\w*$/), value)
        .optional()
        .describe(`stdio: environment variables of the server. ${secretsNote}`),
    url: value.optional().describe("http: the server URL"),
    headers: z
        .record(z.string(), value)
        .optional()
        .describe(`http: request headers. ${secretsNote}`),
};

export function registerIntegrationTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_list_integrations",
        {
            description:
                "List the MCP integrations of a repository: name, kind, configuration " +
                `(secrets appear only as \${NAME} references) and \`missing\`: references that ` +
                "neither a project secret nor the OLIMP process fills.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", repoPath(repo, "integrations")),
    );
    server.registerTool(
        "olimp_add_integration",
        {
            description:
                "Add an MCP server to a registered repository. A task, automation or workflow " +
                "agent step of that repository gets it only when it names it in integrations.",
            inputSchema: {
                repo,
                name: integrationName.describe("Unique in the repository"),
                ...serverFields,
            },
        },
        ({ repo, ...body }) => call("POST", repoPath(repo, "integrations"), body),
    );
    server.registerTool(
        "olimp_update_integration",
        {
            description:
                "Change an integration: the given fields replace the stored ones; a new kind " +
                "needs all of its fields. The name stays.",
            inputSchema: {
                repo,
                name: integrationName,
                ...serverFields,
                kind: serverFields.kind.optional(),
            },
        },
        ({ repo, name, ...body }) => call("PATCH", repoPath(repo, `integrations/${name}`), body),
    );
    server.registerTool(
        "olimp_delete_integration",
        {
            description:
                "Delete an integration. Tasks, automations and workflows that name it keep the " +
                "name, and their steps then fail.",
            inputSchema: { repo, name: integrationName },
        },
        ({ repo, name }) => call("DELETE", repoPath(repo, `integrations/${name}`)),
    );
}
