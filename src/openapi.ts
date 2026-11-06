import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { currentVersion } from "./machine.ts";
import { registerAgentTools } from "./mcp/agents.ts";
import { registerAutomationTools } from "./mcp/automations.ts";
import { registerGithubTools } from "./mcp/github.ts";
import { registerIntegrationTools } from "./mcp/integrations.ts";
import { registerMemoryTools } from "./mcp/memory.ts";
import { registerProjectSettingsTools } from "./mcp/project-settings.ts";
import { registerProjectTools } from "./mcp/projects.ts";
import type { Call } from "./mcp/shared.ts";
import { registerSkillTools } from "./mcp/skills.ts";
import { registerSystemTools } from "./mcp/system.ts";
import { registerTaskTools } from "./mcp/tasks.ts";
import { registerUserTools } from "./mcp/users.ts";
import { registerWorkflowTools } from "./mcp/workflows.ts";

type Json = Record<string, unknown>;
type Shape = Record<string, z.ZodType>;
type Sent = { method: string; path: string; body?: object; kind?: "file" | "events" };
type Operation = Json & { summary: string; description: string; parameters: Json[] };

const MARKER = /__(\w+?)__/g;

const DESCRIPTION = `Everything OLIMP's panel does, over HTTP: projects, tasks and their changes, workflows,
automations, repository memory, skills, integrations, accounts and settings. In the terminal,
\`olimp docs\` lists the same operations.

## Quick start

\`\`\`sh
OLIMP=http://127.0.0.1:4850
curl $OLIMP/api/repos
curl -X POST $OLIMP/api/tasks \\
  -H 'content-type: application/json' \\
  -d '{"repo": "my-project", "title": "Fix a typo"}'
\`\`\`

## Authentication

Without accounts the API trusts the machine it runs on: it listens on loopback only and needs no
token. Once accounts exist, every request but \`GET /health\` needs
\`Authorization: Bearer olimp_…\`; Settings → Accounts makes tokens. *Test Request* on this page
uses your panel session, so it acts as you.

## Requests

Writes send JSON with \`content-type: application/json\`, even with an empty body \`{}\`. The API refuses
other content types, foreign origins and unknown hosts. \`Accept-Language\` (\`en\` or \`pl\`) picks the
language of error messages.

## Errors

An error is \`{"error": "<message>", "code": "<key>"}\`: the message for people, the code the stable
part to rely on, e.g. \`task.notFound\`.

| Status | When |
|---|---|
| 400 | A field is missing or invalid; the code names it, e.g. \`field.invalidText\` |
| 401 | With accounts: no valid token or session |
| 403 | Not allowed: an admin's call, an unknown host or a foreign origin |
| 404 | Nothing with that id |
| 409 | The current state refuses it: busy, in use, taken or changed in the meantime |
| 413 | The body or the file is too large |
| 415 | A write without \`content-type: application/json\` |

## Live events

\`GET /api/events\` is a Server-Sent Events stream: every change of a task or a workflow run and the
agents' events as they happen.

## MCP

Each operation is also the MCP tool named in it, on \`olimp mcp\`. This reference is made from those
tools, so the two never differ. The panel's own endpoints are left out: the sign-in
(\`/api/auth/\`), your password, second factor and sessions (\`/api/me/\`), the terminals and the
Preview.`;

const jsonSchema = (type: z.ZodType): Json => {
    const { $schema: _, ...rest } = z.toJSONSchema(type, { io: "input", unrepresentable: "any" });
    return rest;
};
const optional = (type: z.ZodType) => type.safeParse(undefined).success;
const summary = (tool: string) =>
    tool
        .replace(/^olimp_/, "")
        .replaceAll("_", " ")
        .replace(/\bgithub\b/g, "GitHub")
        .replace(/^./, (first) => first.toUpperCase());

// Each tool's handler runs with a marker in place of every argument (`__id__`) and a call that only
// records what it would send, so the paths, queries and bodies are the MCP server's own.
async function record() {
    const tools: { tag: string; name: string; description: string; shape: Shape; sent: Sent }[] =
        [];
    let sent: Sent[] = [];
    const reply = async (one: Sent): Promise<CallToolResult> => {
        sent.push(one);
        return { content: [] };
    };
    const call: Call = (method, path, body) => reply({ method, path, body });
    const found: { name: string; config: Json; handler: (args: Json) => unknown }[] = [];
    const server = {
        registerTool: (name: string, config: Json, handler: (args: Json) => unknown) =>
            found.push({ name, config, handler }),
    } as unknown as McpServer;
    const groups: [string, () => void][] = [
        ["Projects", () => registerProjectTools(server, call)],
        ["Project settings", () => registerProjectSettingsTools(server, call)],
        ["GitHub", () => registerGithubTools(server, call)],
        [
            "Tasks",
            () =>
                registerTaskTools(server, call, (path) =>
                    reply({ method: "GET", path, kind: "file" }),
                ),
        ],
        ["Workflows", () => registerWorkflowTools(server, call)],
        ["Automations", () => registerAutomationTools(server, call)],
        ["Memory", () => registerMemoryTools(server, call)],
        ["Skills", () => registerSkillTools(server, call)],
        ["Integrations", () => registerIntegrationTools(server, call)],
        ["Agents", () => registerAgentTools(server, call)],
        ["Users", () => registerUserTools(server, call)],
        [
            "System",
            () =>
                registerSystemTools(server, call, () =>
                    reply({ method: "GET", path: "/api/events", kind: "events" }),
                ),
        ],
    ];
    for (const [tag, register] of groups) {
        found.length = 0;
        register();
        for (const { name, config, handler } of found) {
            const shape = (config.inputSchema ?? {}) as Shape;
            sent = [];
            await handler(Object.fromEntries(Object.keys(shape).map((key) => [key, `__${key}__`])));
            if (sent.length !== 1) throw new Error(`${name} sends ${sent.length} requests`);
            const description = String(config.description ?? "");
            tools.push({ tag, name, description, shape, sent: sent[0] });
        }
    }
    return tools;
}

function bodySchema(body: object, shape: Shape, schema: typeof jsonSchema): Json {
    const properties: Json = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(body)) {
        const arg = typeof value === "string" ? /^__(\w+)__$/.exec(value)?.[1] : undefined;
        const type = arg ? shape[arg] : undefined;
        properties[key] = type ? schema(type) : { const: value };
        if (!type || !optional(type)) required.push(key);
    }
    return { type: "object", properties, ...(required.length ? { required } : {}) };
}

// Two tools on one method and path (a repository added or created, a file list or one file) are
// one operation: their parameters merged, their bodies as alternatives.
function merge(ops: Operation[]): Operation {
    if (ops.length === 1) return ops[0];
    const parameters = new Map<string, Json>();
    for (const op of ops)
        for (const param of op.parameters) {
            const key = `${param.in} ${param.name}`;
            const everywhere = ops.every((other) =>
                other.parameters.some((p) => `${p.in} ${p.name}` === key),
            );
            parameters.set(key, { ...param, required: param.required && everywhere });
        }
    const bodies = ops.map((op) => op.requestBody as Json | undefined);
    const schemas = bodies.map((body, i) => ({
        title: ops[i].summary,
        ...(((body?.content as Json)?.["application/json"] as Json)?.schema as Json),
    }));
    return {
        ...ops[0],
        summary: ops.map((op) => op.summary).join(" · "),
        description: ops.map((op) => `#### ${op.summary}\n\n${op.description}`).join("\n\n"),
        parameters: [...parameters.values()],
        ...(bodies[0]
            ? {
                  requestBody: {
                      required: true,
                      content: { "application/json": { schema: { oneOf: schemas } } },
                  },
              }
            : {}),
    };
}

let built: Promise<Json> | null = null;

export function openApi(): Promise<Json> {
    built ??= build();
    return built;
}

async function build(): Promise<Json> {
    const tools = await record();
    const where = new Map(tools.map((tool) => [tool.name, tool.sent]));
    // Tools name each other; here the operation they call says more.
    const refer = (text: string) =>
        text.replace(/\bolimp_\w+/g, (tool) => {
            const other = where.get(tool);
            if (!other) return tool;
            return `\`${other.method} ${new URL(other.path, "http://olimp").pathname.replace(MARKER, "{$1}")}\``;
        });
    const schema = (type: z.ZodType): Json => JSON.parse(refer(JSON.stringify(jsonSchema(type))));
    const grouped = new Map<string, Operation[]>();
    for (const { tag, name, description, shape, sent } of tools) {
        const url = new URL(sent.path, "http://olimp");
        const path = url.pathname.replace(MARKER, "{$1}");
        const parameters: Json[] = [...path.matchAll(/\{(\w+)\}/g)].map(([, key]) => ({
            name: key,
            in: "path",
            required: true,
            schema: schema(shape[key]),
        }));
        for (const [key, value] of url.searchParams) {
            const arg = /^__(\w+)__$/.exec(value)?.[1] ?? (key in shape ? key : null);
            parameters.push({
                name: key,
                in: "query",
                required: arg ? !optional(shape[arg]) : false,
                schema: arg ? schema(shape[arg]) : { type: "string", enum: [value] },
            });
        }
        const method = sent.method.toLowerCase();
        const ok =
            sent.kind === "file"
                ? { "*/*": { schema: { type: "string", format: "binary" } } }
                : sent.kind === "events"
                  ? { "text/event-stream": { schema: { type: "string" } } }
                  : { "application/json": {} };
        const op: Operation = {
            tags: [tag],
            operationId: name,
            summary: summary(name),
            description: `${refer(description)}\n\nMCP tool: \`${name}\``,
            parameters,
            ...(method === "get"
                ? {}
                : {
                      requestBody: {
                          required: true,
                          content: {
                              "application/json": {
                                  schema: bodySchema(sent.body ?? {}, shape, schema),
                              },
                          },
                      },
                  }),
            responses: {
                "2XX": { description: "Success", content: ok },
                default: {
                    description: "Error",
                    content: {
                        "application/json": { schema: { $ref: "#/components/schemas/Error" } },
                    },
                },
            },
        };
        const key = `${method} ${path}`;
        grouped.set(key, [...(grouped.get(key) ?? []), op]);
    }
    const paths: Record<string, Json> = {};
    for (const [key, ops] of grouped) {
        const [method, path] = key.split(" ");
        paths[path] = { ...paths[path], [method]: merge(ops) };
    }
    paths["/health"] = {
        get: {
            tags: ["System"],
            operationId: "health",
            summary: "Health",
            description: "Liveness: the only path that never needs a token.",
            security: [],
            responses: {
                200: { description: "OLIMP is up", content: { "application/json": {} } },
            },
        },
    };
    return {
        openapi: "3.1.0",
        info: { title: "OLIMP API", version: currentVersion(), description: DESCRIPTION },
        tags: [...new Set(tools.map((tool) => tool.tag))].map((name) => ({ name })),
        security: [{}, { token: [] }],
        paths,
        components: {
            securitySchemes: {
                token: {
                    type: "http",
                    scheme: "bearer",
                    description: "An account's API token, olimp_…; not needed without accounts",
                },
            },
            schemas: {
                Error: {
                    type: "object",
                    required: ["error", "code"],
                    properties: {
                        error: { type: "string", description: "In the request's language" },
                        code: { type: "string", description: "Stable key, e.g. task.notFound" },
                    },
                },
            },
        },
    };
}
