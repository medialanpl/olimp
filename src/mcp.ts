import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.ts";
import { DEFAULT_LOCALE } from "./i18n.ts";
import { registerAgentTools } from "./mcp/agents.ts";
import { registerAutomationTools } from "./mcp/automations.ts";
import { registerGithubTools } from "./mcp/github.ts";
import { registerIntegrationTools } from "./mcp/integrations.ts";
import { registerMemoryTools } from "./mcp/memory.ts";
import { registerProjectSettingsTools } from "./mcp/project-settings.ts";
import { registerProjectTools } from "./mcp/projects.ts";
import { registerSkillTools } from "./mcp/skills.ts";
import { registerSystemTools } from "./mcp/system.ts";
import { registerTaskTools } from "./mcp/tasks.ts";
import { registerUserTools } from "./mcp/users.ts";
import { registerWorkflowTools } from "./mcp/workflows.ts";

// The MCP server is a thin client of the API, so the API process stays the only owner of the database.
export function createMcpServer(env: NodeJS.ProcessEnv = process.env): McpServer {
    const base = env.OLIMP_URL ?? `http://127.0.0.1:${loadConfig(env).port}`;
    const locale = env.OLIMP_LOCALE ?? DEFAULT_LOCALE;
    // Once OLIMP has accounts, every call acts as the account of this token.
    const token = env.OLIMP_TOKEN?.trim();
    // An agent step's own server: only the memory tools, with the token OLIMP issued for the step.
    const step = env.OLIMP_STEP_TOKEN?.trim();

    // Every write is a JSON body: the API refuses other content types on non-GET requests.
    async function call(method: string, path: string, body?: object): Promise<CallToolResult> {
        const write = method !== "GET";
        try {
            const res = await fetch(`${base}${path}`, {
                method,
                headers: {
                    "accept-language": locale,
                    ...(step
                        ? { "x-olimp-step": step }
                        : token
                          ? { authorization: `Bearer ${token}` }
                          : {}),
                    ...(write ? { "content-type": "application/json" } : {}),
                },
                body: write ? JSON.stringify(body ?? {}) : undefined,
            });
            return { content: [{ type: "text", text: await res.text() }], isError: !res.ok };
        } catch (error) {
            return {
                content: [{ type: "text", text: `OLIMP API at ${base}: ${error}` }],
                isError: true,
            };
        }
    }

    // A file from the API: an image comes as one, anything else as base64 text.
    async function file(path: string): Promise<CallToolResult> {
        try {
            const res = await fetch(`${base}${path}`, {
                headers: {
                    "accept-language": locale,
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
            });
            if (!res.ok)
                return { content: [{ type: "text", text: await res.text() }], isError: true };
            const type = res.headers.get("content-type") ?? "application/octet-stream";
            const data = Buffer.from(await res.arrayBuffer()).toString("base64");
            return {
                content: type.startsWith("image/")
                    ? [{ type: "image", data, mimeType: type }]
                    : [{ type: "text", text: JSON.stringify({ mediaType: type, data }) }],
            };
        } catch (error) {
            return {
                content: [{ type: "text", text: `OLIMP API at ${base}: ${error}` }],
                isError: true,
            };
        }
    }

    // Reads the event stream until the time or the number of events runs out.
    async function watch(seconds: number, max: number): Promise<CallToolResult> {
        const events: unknown[] = [];
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), seconds * 1000);
        try {
            const res = await fetch(`${base}/api/events`, {
                headers: {
                    "accept-language": locale,
                    accept: "text/event-stream",
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                },
                signal: stop.signal,
            });
            if (!res.ok || !res.body)
                return { content: [{ type: "text", text: await res.text() }], isError: true };
            const decoder = new TextDecoder();
            let buffer = "";
            for await (const chunk of res.body) {
                buffer += decoder.decode(chunk, { stream: true });
                const frames = buffer.split("\n\n");
                buffer = frames.pop() ?? "";
                for (const frame of frames) {
                    const data = frame
                        .split("\n")
                        .filter((line) => line.startsWith("data:"))
                        .map((line) => line.slice(5).trim())
                        .join("\n");
                    if (data) events.push(JSON.parse(data));
                }
                if (events.length >= max) break;
            }
        } catch (error) {
            if (!stop.signal.aborted)
                return {
                    content: [{ type: "text", text: `OLIMP API at ${base}: ${error}` }],
                    isError: true,
                };
        } finally {
            clearTimeout(timer);
            stop.abort();
        }
        return { content: [{ type: "text", text: JSON.stringify(events.slice(0, max)) }] };
    }

    const server = new McpServer({ name: "olimp", version: "0.0.1" });
    if (step) {
        registerMemoryTools(server, call, true);
        return server;
    }
    registerProjectTools(server, call);
    registerGithubTools(server, call);
    registerSystemTools(server, call, watch);
    registerAgentTools(server, call);
    registerUserTools(server, call);
    registerTaskTools(server, call, file);
    registerIntegrationTools(server, call);
    registerProjectSettingsTools(server, call);
    registerSkillTools(server, call);
    registerAutomationTools(server, call);
    registerWorkflowTools(server, call);
    registerMemoryTools(server, call);
    return server;
}

if (import.meta.main) await createMcpServer().connect(new StdioServerTransport());
