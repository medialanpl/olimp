import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TASK_BODY_MAX, TITLE_MAX } from "./limits.ts";

// The MCP server a dispatched task's agent gets: it adds subtasks of that one task, with the
// token OLIMP issued for it, and nothing else.
export function createDispatchServer(
    url = process.env.DISPATCH_URL ?? "",
    token = process.env.DISPATCH_TOKEN ?? "",
): McpServer {
    async function call(method: string, body?: object): Promise<CallToolResult> {
        try {
            const res = await fetch(`${url}/api/dispatch/subtasks`, {
                method,
                headers: {
                    "x-olimp-dispatch": token,
                    ...(body ? { "content-type": "application/json" } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });
            return { content: [{ type: "text", text: await res.text() }], isError: !res.ok };
        } catch (error) {
            return {
                content: [{ type: "text", text: `OLIMP at ${url}: ${error}` }],
                isError: true,
            };
        }
    }
    const server = new McpServer({ name: "olimp-dispatch", version: "0.0.1" });
    server.registerTool(
        "dispatch_subtask",
        {
            description:
                "Add one subtask of the task you are working on. It runs after you finish, in its " +
                "own worktree from your branch with your changes, by an agent that sees only its " +
                "title and body; a later step merges every subtask. Replies with the subtask.",
            inputSchema: {
                title: z.string().min(1).max(TITLE_MAX),
                body: z
                    .string()
                    .min(1)
                    .max(TASK_BODY_MAX)
                    .describe("Exactly what to change, where, and how to check it"),
            },
        },
        (args) => call("POST", args),
    );
    server.registerTool(
        "list_subtasks",
        {
            description: "List the subtasks added so far, with their status.",
            inputSchema: {},
        },
        () => call("GET"),
    );
    return server;
}

if (import.meta.main) await createDispatchServer().connect(new StdioServerTransport());
