import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp.ts";
import { ref } from "./fixtures.ts";

interface Seen {
    method: string;
    url: string;
    contentType: string | undefined;
    locale: string | undefined;
    authorization: string | undefined;
    step: string | undefined;
    body: string;
}

const seen: Seen[] = [];
const READS = '{"tasks":["0123456789ab"],"runs":[]}';

const replies: Record<string, { status: number; body: string }> = {
    "POST /api/repos": { status: 201, body: '{"repo":"acme/demo"}' },
    "GET /api/repos": { status: 200, body: '[{"id":"acme/demo","defaultBranch":"main"}]' },
    "GET /api/repos/demo": { status: 200, body: '{"id":"acme/demo","commands":[]}' },
    "GET /api/folders": { status: 200, body: '{"path":"/srv","folders":[]}' },
    "POST /api/folders": { status: 201, body: '{"path":"/srv/new","folders":[]}' },
    "GET /api/repos/demo/github/prs": { status: 200, body: "[]" },
    "GET /api/repos/demo/github/issues/3": { status: 200, body: '{"number":3}' },
    "POST /api/repos/demo/github/prs/7/merge": { status: 200, body: '{"number":7}' },
    "GET /api/folders?path=%2Fhome%2Fx&hidden=1": { status: 200, body: '{"folders":[]}' },
    "GET /api/folders?path=%2Fsrv%2Fcode": {
        status: 200,
        body: '{"path":"/srv/code","folders":[]}',
    },
    "GET /api/github/owners": { status: 200, body: '[{"login":"acme","kind":"org"}]' },
    "GET /api/github/status": { status: 200, body: '{"loggedIn":true,"login":"octo"}' },
    "POST /api/tasks": { status: 201, body: '{"id":"0123456789ab","status":"queued"}' },
    "GET /api/tasks": { status: 200, body: '[{"id":"0123456789ab"}]' },
    "GET /api/tasks/0123456789ab": { status: 200, body: '{"id":"0123456789ab"}' },
    "GET /api/tasks/ffffffffffff": { status: 404, body: '{"error":"not found"}' },
    "PUT /api/tasks/0123456789ab/archive": { status: 200, body: '{"archivedAt":"2026-10-29"}' },
    "DELETE /api/tasks/0123456789ab/archive": { status: 200, body: '{"archivedAt":null}' },
    "PUT /api/tasks/0123456789ab/pin": { status: 200, body: '["0123456789ab"]' },
    "DELETE /api/tasks/0123456789ab/pin": { status: 200, body: "[]" },
    "GET /api/pins": { status: 200, body: '["0123456789ab"]' },
    "PUT /api/tasks/0123456789ab/read": { status: 200, body: READS },
    "DELETE /api/tasks/0123456789ab/read": { status: 200, body: READS },
    "PUT /api/workflow-runs/cccccccccccc/read": { status: 200, body: READS },
    "DELETE /api/workflow-runs/cccccccccccc/read": { status: 200, body: READS },
    "GET /api/reads": { status: 200, body: READS },
    "POST /api/skill-sources": { status: 201, body: '{"id":"acme/skills"}' },
    "GET /api/skill-sources": { status: 200, body: '[{"id":"acme/skills"}]' },
    "POST /api/skill-sources/refresh": { status: 200, body: '[{"id":"acme/skills"}]' },
    "DELETE /api/skill-sources/acme/skills": { status: 200, body: '{"id":"acme/skills"}' },
    "DELETE /api/repos/demo": { status: 200, body: '{"id":"demo"}' },
    "POST /api/repos/demo/git": { status: 200, body: '{"id":"demo","git":true}' },
    "POST /api/repos/demo/fetch": { status: 200, body: '{"id":"demo","git":true}' },
    "GET /api/skills": { status: 200, body: '[{"id":"acme/skills:tidy"}]' },
    "POST /api/own-skills": { status: 201, body: '{"id":"~/mine"}' },
    "PUT /api/own-skills/mine": { status: 200, body: '{"id":"~/mine"}' },
    "DELETE /api/own-skills/mine": { status: 200, body: '{"id":"~/mine"}' },
    "GET /api/skill-search?q=tidy": { status: 200, body: '[{"id":"acme/skills:tidy"}]' },
    "GET /api/skills?repo=demo": { status: 200, body: '[{"id":"./check"}]' },
    "GET /api/skill?ref=.%2Fcheck&repo=demo": { status: 200, body: '{"ref":"./check"}' },
    "GET /api/automations": { status: 200, body: '[{"id":"aaaaaaaaaaaa"}]' },
    "POST /api/automations": { status: 201, body: '{"id":"aaaaaaaaaaaa"}' },
    "GET /api/automations/aaaaaaaaaaaa": { status: 200, body: '{"id":"aaaaaaaaaaaa"}' },
    "PATCH /api/automations/aaaaaaaaaaaa": { status: 200, body: '{"id":"aaaaaaaaaaaa"}' },
    "DELETE /api/automations/aaaaaaaaaaaa": { status: 200, body: '{"id":"aaaaaaaaaaaa"}' },
    "POST /api/automations/aaaaaaaaaaaa/run": { status: 201, body: '{"id":"0123456789ab"}' },
    "GET /api/workflows": { status: 200, body: '[{"id":"bbbbbbbbbbbb"}]' },
    "POST /api/workflows": { status: 201, body: '{"id":"bbbbbbbbbbbb"}' },
    "GET /api/workflows/bbbbbbbbbbbb": { status: 200, body: '{"id":"bbbbbbbbbbbb"}' },
    "PATCH /api/workflows/bbbbbbbbbbbb": { status: 200, body: '{"id":"bbbbbbbbbbbb"}' },
    "DELETE /api/workflows/bbbbbbbbbbbb": { status: 200, body: '{"id":"bbbbbbbbbbbb"}' },
    "POST /api/workflows/bbbbbbbbbbbb/run": { status: 201, body: '{"id":"cccccccccccc"}' },
    "GET /api/workflow-runs": { status: 200, body: '[{"id":"cccccccccccc"}]' },
    "GET /api/workflow-runs/cccccccccccc": { status: 200, body: '{"id":"cccccccccccc"}' },
    "GET /api/notes": { status: 200, body: '[{"id":"dddddddddddd"}]' },
    "GET /api/notes?repo=demo": { status: 200, body: '[{"id":"dddddddddddd"}]' },
    "POST /api/notes": { status: 201, body: '{"id":"dddddddddddd"}' },
    "DELETE /api/notes/dddddddddddd": { status: 200, body: '{"id":"dddddddddddd"}' },
    "GET /api/repos/demo/integrations": { status: 200, body: '[{"name":"github"}]' },
    "POST /api/repos/demo/integrations": { status: 201, body: '{"name":"github"}' },
    "PATCH /api/repos/demo/integrations/github": { status: 200, body: '{"name":"github"}' },
    "DELETE /api/repos/demo/integrations/github": { status: 200, body: '{"name":"github"}' },
    "PUT /api/repos/demo/issues": { status: 200, body: '{"issueLabel":"olimp"}' },
    "GET /api/repos/demo/memory": { status: 200, body: '{"hubs":[],"pages":[]}' },
    "GET /api/repos/demo/memory/graph": { status: 200, body: '{"nodes":[],"edges":[]}' },
    "GET /api/repos/demo/memory/unwoven": { status: 200, body: '{"total":0}' },
    "GET /api/repos/demo/memory/unwoven?oldest=true": { status: 200, body: '{"total":0}' },
    "GET /api/repos/demo/memory/search?q=deploy+key": {
        status: 200,
        body: '{"total":0,"hits":[]}',
    },
    "POST /api/repos/demo/memory/pages": { status: 201, body: '{"slug":"build"}' },
    "POST /api/repos/demo/memory/sources": { status: 201, body: '{"note":{},"task":{}}' },
    "GET /api/repos/demo/memory/pages/build": { status: 200, body: '{"slug":"build"}' },
    "PATCH /api/repos/demo/memory/pages/build": { status: 200, body: '{"version":2}' },
    "POST /api/repos/demo/memory/pages/build/sections": {
        status: 201,
        body: '{"heading":"Tools / setup"}',
    },
    "PATCH /api/repos/demo/memory/pages/build/sections/Tools%20%2F%20setup": {
        status: 200,
        body: '{"version":2}',
    },
    "DELETE /api/repos/demo/issues": { status: 200, body: '{"issueLabel":null}' },
    "PUT /api/repos/demo/commands": { status: 200, body: '{"commands":["pnpm lint"]}' },
    "DELETE /api/repos/demo/commands": { status: 200, body: '{"commands":[]}' },
    "GET /api/me": { status: 200, body: '{"id":"eeeeeeeeeeee","name":"ada"}' },
    "GET /api/users": { status: 200, body: '[{"id":"eeeeeeeeeeee"}]' },
    "POST /api/users": { status: 201, body: '{"id":"eeeeeeeeeeee"}' },
    "DELETE /api/users/eeeeeeeeeeee": { status: 200, body: '{"id":"eeeeeeeeeeee"}' },
    "GET /api/users/eeeeeeeeeeee/tokens": { status: 200, body: '[{"id":"ffffffffffff"}]' },
    "POST /api/users/eeeeeeeeeeee/tokens": { status: 201, body: '{"id":"ffffffffffff"}' },
    "DELETE /api/tokens/ffffffffffff": { status: 200, body: '{"id":"ffffffffffff"}' },
    "PATCH /api/users/eeeeeeeeeeee": { status: 200, body: '{"id":"eeeeeeeeeeee"}' },
    "POST /api/users/eeeeeeeeeeee/link": { status: 200, body: '{"sent":"invite"}' },
    "DELETE /api/users/eeeeeeeeeeee/two-factor": { status: 200, body: '{"totp":false}' },
    "GET /api/mail": { status: 200, body: '{"saved":false}' },
    "PUT /api/mail": { status: 200, body: '{"saved":true}' },
    "DELETE /api/mail": { status: 200, body: '{"saved":false}' },
    "POST /api/mail/test": { status: 200, body: '{"to":"a@b.c"}' },
    "GET /api/machine": { status: 200, body: '{"cores":8}' },
    "GET /api/agents": { status: 200, body: "[]" },
    "POST /api/agents/codex/logins": { status: 201, body: '{"name":"work"}' },
    "DELETE /api/agents/codex/logins/work": { status: 200, body: "[]" },
    "PUT /api/agents/claude/logins/default/token": { status: 200, body: '{"name":"default"}' },
    "DELETE /api/agents/claude/logins/work/token": { status: 200, body: '{"name":"work"}' },
    "GET /api/agent-defaults": { status: 200, body: '{"agent":"claude","models":{}}' },
    "PUT /api/agent-defaults": { status: 200, body: '{"agent":"codex","models":{}}' },
    "PUT /api/repos/demo/agents": { status: 200, body: '{"id":"demo"}' },
    "GET /api/version": { status: 200, body: '{"version":"0.0.1"}' },
    "POST /api/version/check": { status: 200, body: '{"behind":0}' },
    "POST /api/version/update": { status: 202, body: '{"restarting":true}' },
    "GET /api/settings": { status: 200, body: '{"saved":[]}' },
    "PUT /api/settings": { status: 200, body: '{"saved":["maxParallel"]}' },
    "GET /api/tasks/0123456789ab/trace": { status: 200, body: '{"events":[]}' },
    "GET /api/tasks/0123456789ab/changes": { status: 200, body: '{"files":[]}' },
    "GET /api/tasks/0123456789ab/commits": { status: 200, body: '{"commits":[]}' },
    "GET /api/tasks/0123456789ab/subtasks": { status: 200, body: "[]" },
    "GET /api/models": { status: 200, body: "[]" },
    "POST /api/uploads": { status: 201, body: '{"id":"aaaaaaaaaaaaaaaaaaaaaaaa"}' },
    "GET /api/task-groups/cccccccccccc": { status: 200, body: '{"tasks":[]}' },
    "POST /api/task-groups/cccccccccccc/pick": { status: 200, body: '{"tasks":[]}' },
    "GET /api/repos/demo/branches": { status: 200, body: '{"branches":["main"]}' },
    "PUT /api/repos/demo/branch": { status: 200, body: '{"defaultBranch":"main"}' },
    "POST /api/repos/demo/branches": { status: 201, body: '{"branches":["main","x"]}' },
    "GET /api/repos/demo/changes": { status: 200, body: '{"files":[]}' },
    "GET /api/repos/demo/commits": { status: 200, body: '{"commits":[]}' },
    "GET /api/repos/demo/commits/abc1234?branch=release": {
        status: 200,
        body: '{"sha":"abc1234"}',
    },
    "GET /api/repos/demo/files?branch=release": { status: 200, body: '{"files":[]}' },
    "GET /api/repos/demo/files?path=src%2Fa%20b.ts": { status: 200, body: '{"path":"src/a b.ts"}' },
    "GET /api/prompt-templates": { status: 200, body: "null" },
    "PUT /api/prompt-templates": { status: 200, body: "null" },
    "GET /api/instructions": { status: 200, body: '{"instructions":""}' },
    "PUT /api/instructions": { status: 200, body: '{"instructions":""}' },
    "GET /api/tasks/0123456789ab/commits/abc1234": { status: 200, body: '{"sha":"abc1234"}' },
    "GET /api/tasks/0123456789ab/files": { status: 200, body: '{"files":[]}' },
    "GET /api/tasks/0123456789ab/files?path=src%2Fa%20b.ts": {
        status: 200,
        body: '{"path":"src/a b.ts"}',
    },
    "GET /api/tasks/0123456789ab/thread": { status: 200, body: "[]" },
    "GET /api/workflow-runs/cccccccccccc/changes": { status: 200, body: '{"files":[]}' },
    "POST /api/tasks/0123456789ab/cancel": { status: 200, body: '{"status":"cancelled"}' },
    "POST /api/tasks/0123456789ab/retry": { status: 201, body: '{"retryOf":"0123456789ab"}' },
    "POST /api/tasks/0123456789ab/continue": { status: 201, body: '{"thread":"0123456789ab"}' },
    "GET /api/workflow-runs/cccccccccccc/trace": { status: 200, body: '{"events":[]}' },
    "POST /api/workflow-runs/cccccccccccc/cancel": { status: 200, body: '{"status":"cancelled"}' },
    "POST /api/workflow-runs/cccccccccccc/answer": { status: 200, body: '{"status":"queued"}' },
    "POST /api/workflows/build": { status: 200, body: '{"name":"fix"}' },
    "POST /api/workflow-runs/cccccccccccc/retry": {
        status: 201,
        body: '{"retryOf":"cccccccccccc"}',
    },
    "GET /api/costs": { status: 200, body: '{"by":"day"}' },
    "GET /api/costs?by=author&days=7": { status: 200, body: '{"by":"author"}' },
};

// What the fake event stream sends, in two writes, before it ends.
const streamed = [
    { type: "task", task: { id: "0123456789ab", status: "running" } },
    { type: "agent", event: { seq: 1, task: "0123456789ab", type: "tool", summary: "Bash: ls" } },
];

let failNext = false;
const api = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
        body += chunk;
    });
    req.on("end", () => {
        const method = req.method ?? "";
        const url = req.url ?? "";
        seen.push({
            method,
            url,
            contentType: req.headers["content-type"],
            locale: req.headers["accept-language"],
            authorization: req.headers.authorization,
            step: req.headers["x-olimp-step"] as string | undefined,
            body,
        });
        if (url === "/api/events") {
            res.writeHead(200, { "content-type": "text/event-stream" });
            res.write(": hello\n\n");
            const [first, second] = streamed.map(
                (event, i) =>
                    `id: ${i + 1}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
            res.write(`${first}${second?.slice(0, 10)}`);
            setTimeout(() => res.end(second?.slice(10)), 20);
            return;
        }
        const reply = failNext
            ? { status: 500, body: '{"error":"boom"}' }
            : (replies[`${method} ${url}`] ?? { status: 404, body: "{}" });
        failNext = false;
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body);
    });
});
await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
const port = (api.address() as AddressInfo).port;

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
const server = createMcpServer({ OLIMP_URL: `http://127.0.0.1:${port}` });
await server.connect(serverSide);
const client = new Client({ name: "test", version: "0.0.0" });
await client.connect(clientSide);
after(async () => {
    await client.close();
    await server.close();
    api.close();
});

async function callTool(name: string, args: Record<string, unknown> = {}) {
    seen.length = 0;
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as { type: string; text: string }[];
    return { isError: result.isError === true, text: content[0]?.text, request: seen[0] };
}

test("olimp_add_repo posts the repository", async () => {
    const r = await callTool("olimp_add_repo", { repo: "acme/demo" });
    assert.equal(r.isError, false);
    assert.equal(r.text, '{"repo":"acme/demo"}');
    assert.equal(r.request?.method, "POST");
    assert.equal(r.request?.url, "/api/repos");
    assert.equal(r.request?.contentType, "application/json");
    assert.equal(r.request?.locale, "en");
    assert.deepEqual(JSON.parse(r.request?.body ?? ""), { repo: "acme/demo" });
});

test("OLIMP_LOCALE sets Accept-Language on API calls", async () => {
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    const polish = createMcpServer({ OLIMP_URL: `http://127.0.0.1:${port}`, OLIMP_LOCALE: "pl" });
    await polish.connect(serverEnd);
    const other = new Client({ name: "test-pl", version: "0.0.0" });
    await other.connect(clientEnd);
    try {
        seen.length = 0;
        await other.callTool({ name: "olimp_list_tasks", arguments: {} });
        assert.equal(seen[0]?.locale, "pl");
    } finally {
        await other.close();
        await polish.close();
    }
});

test("without OLIMP_TOKEN no Authorization header is sent, with it every call carries it", async () => {
    assert.equal((await callTool("olimp_list_tasks")).request?.authorization, undefined);
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    const withToken = createMcpServer({
        OLIMP_URL: `http://127.0.0.1:${port}`,
        OLIMP_TOKEN: " olimp_secret ",
    });
    await withToken.connect(serverEnd);
    const other = new Client({ name: "test-token", version: "0.0.0" });
    await other.connect(clientEnd);
    try {
        for (const [name, args] of [
            ["olimp_list_tasks", {}],
            ["olimp_whoami", {}],
            ["olimp_add_note", { repo: "demo", text: "N" }],
        ] as const) {
            seen.length = 0;
            await other.callTool({ name, arguments: args });
            assert.equal(seen[0]?.authorization, "Bearer olimp_secret", name);
        }
    } finally {
        await other.close();
        await withToken.close();
    }
});

test("an agent step's server has only the memory tools and signs every call with its token", async () => {
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    const stepServer = createMcpServer({
        OLIMP_URL: `http://127.0.0.1:${port}`,
        OLIMP_TOKEN: "olimp_secret",
        OLIMP_STEP_TOKEN: "step-token",
    });
    await stepServer.connect(serverEnd);
    const other = new Client({ name: "test-step", version: "0.0.0" });
    await other.connect(clientEnd);
    try {
        const { tools } = await other.listTools();
        assert.deepEqual(tools.map((tool) => tool.name).sort(), [
            "olimp_add_memory_section",
            "olimp_add_note",
            "olimp_create_memory_page",
            "olimp_get_memory_map",
            "olimp_get_memory_page",
            "olimp_list_notes",
            "olimp_list_unwoven_notes",
            "olimp_search_memory",
            "olimp_update_memory_page",
            "olimp_update_memory_section",
        ]);
        seen.length = 0;
        await other.callTool({ name: "olimp_add_note", arguments: { repo: "demo", text: "N" } });
        assert.deepEqual([seen[0]?.step, seen[0]?.authorization], ["step-token", undefined]);
    } finally {
        await other.close();
        await stepServer.close();
    }
});

test("account, token, machine and settings tools call their endpoints", async () => {
    const cases: [string, Record<string, unknown>, string, string, object | null][] = [
        ["olimp_whoami", {}, "GET", "/api/me", null],
        ["olimp_list_users", {}, "GET", "/api/users", null],
        [
            "olimp_create_user",
            { name: "bob", role: "member" },
            "POST",
            "/api/users",
            { name: "bob", role: "member" },
        ],
        ["olimp_delete_user", { id: "eeeeeeeeeeee" }, "DELETE", "/api/users/eeeeeeeeeeee", {}],
        [
            "olimp_list_tokens",
            { id: "eeeeeeeeeeee" },
            "GET",
            "/api/users/eeeeeeeeeeee/tokens",
            null,
        ],
        [
            "olimp_create_token",
            { id: "eeeeeeeeeeee" },
            "POST",
            "/api/users/eeeeeeeeeeee/tokens",
            {},
        ],
        ["olimp_revoke_token", { id: "ffffffffffff" }, "DELETE", "/api/tokens/ffffffffffff", {}],
        [
            "olimp_update_user",
            { id: "eeeeeeeeeeee", role: "admin" },
            "PATCH",
            "/api/users/eeeeeeeeeeee",
            { role: "admin" },
        ],
        [
            "olimp_send_account_link",
            { id: "eeeeeeeeeeee" },
            "POST",
            "/api/users/eeeeeeeeeeee/link",
            {},
        ],
        [
            "olimp_reset_two_factor",
            { id: "eeeeeeeeeeee" },
            "DELETE",
            "/api/users/eeeeeeeeeeee/two-factor",
            null,
        ],
        ["olimp_get_mail", {}, "GET", "/api/mail", null],
        [
            "olimp_update_mail",
            { host: "smtp.example.com", port: 465, secure: true, from: "olimp@example.com" },
            "PUT",
            "/api/mail",
            { host: "smtp.example.com", port: 465, secure: true, from: "olimp@example.com" },
        ],
        ["olimp_reset_mail", {}, "DELETE", "/api/mail", null],
        ["olimp_send_test_mail", {}, "POST", "/api/mail/test", {}],
        ["olimp_get_machine", {}, "GET", "/api/machine", null],
        ["olimp_list_agents", {}, "GET", "/api/agents", null],
        [
            "olimp_add_agent_login",
            { agent: "codex", name: "work" },
            "POST",
            "/api/agents/codex/logins",
            { name: "work" },
        ],
        [
            "olimp_remove_agent_login",
            { agent: "codex", name: "work" },
            "DELETE",
            "/api/agents/codex/logins/work",
            null,
        ],
        [
            "olimp_set_agent_token",
            { agent: "claude", token: "sk-ant-oat01-abcdefghijklmnop" },
            "PUT",
            "/api/agents/claude/logins/default/token",
            { token: "sk-ant-oat01-abcdefghijklmnop" },
        ],
        [
            "olimp_set_agent_token",
            { agent: "claude", name: "work" },
            "DELETE",
            "/api/agents/claude/logins/work/token",
            null,
        ],
        ["olimp_get_agent_defaults", {}, "GET", "/api/agent-defaults", null],
        [
            "olimp_set_agent_defaults",
            { agent: "codex", models: { claude: "opus" } },
            "PUT",
            "/api/agent-defaults",
            { agent: "codex", models: { claude: "opus" } },
        ],
        [
            "olimp_set_repo_agents",
            { repo: "demo", agent: null, logins: { claude: "work" } },
            "PUT",
            "/api/repos/demo/agents",
            { agent: null, logins: { claude: "work" } },
        ],
        ["olimp_get_version", {}, "GET", "/api/version", null],
        ["olimp_check_update", {}, "POST", "/api/version/check", {}],
        ["olimp_update", {}, "POST", "/api/version/update", {}],
        ["olimp_get_settings", {}, "GET", "/api/settings", null],
        [
            "olimp_update_settings",
            { maxParallel: 3, projectsDir: null },
            "PUT",
            "/api/settings",
            { maxParallel: 3, projectsDir: null },
        ],
        [
            "olimp_create_repo",
            { repo: "acme/demo", description: "New" },
            "POST",
            "/api/repos",
            { repo: "acme/demo", description: "New", create: true },
        ],
    ];
    for (const [name, args, method, url, body] of cases) {
        const r = await callTool(name, args);
        assert.equal(r.isError, false, name);
        assert.equal(r.request?.method, method, name);
        assert.equal(r.request?.url, url, name);
        if (body) assert.deepEqual(JSON.parse(r.request?.body ?? ""), body, name);
    }
    for (const [name, args] of [
        ["olimp_create_user", { name: "-bob" }],
        ["olimp_create_user", { name: "bob", role: "owner" }],
        ["olimp_create_repo", { repo: "acme/demo", visibility: "secret" }],
        ["olimp_revoke_token", { id: "nope" }],
    ] as const) {
        const r = await callTool(name, args);
        assert.equal(r.isError, true, `${name} ${JSON.stringify(args)}`);
        assert.equal(r.request, undefined);
    }
});

test("olimp_create_task posts the task", async () => {
    const task = { repo: "demo", title: "Do it", body: "Details", agent: "codex" };
    const r = await callTool("olimp_create_task", task);
    assert.equal(r.isError, false);
    assert.equal(r.text, '{"id":"0123456789ab","status":"queued"}');
    assert.equal(r.request?.method, "POST");
    assert.equal(r.request?.url, "/api/tasks");
    assert.equal(r.request?.contentType, "application/json");
    assert.deepEqual(JSON.parse(r.request?.body ?? ""), task);
});

test("every API capability has a tool", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
        "olimp_add_agent_login",
        "olimp_add_integration",
        "olimp_add_memory_section",
        "olimp_add_memory_source",
        "olimp_add_note",
        "olimp_add_repo",
        "olimp_add_skill_source",
        "olimp_add_webhook",
        "olimp_answer_workflow_run",
        "olimp_archive_task",
        "olimp_build_workflow",
        "olimp_cancel_task",
        "olimp_cancel_workflow_run",
        "olimp_check_update",
        "olimp_clear_commands",
        "olimp_continue_task",
        "olimp_create_automation",
        "olimp_create_branch",
        "olimp_create_folder",
        "olimp_create_memory_page",
        "olimp_create_own_skill",
        "olimp_create_repo",
        "olimp_create_task",
        "olimp_create_token",
        "olimp_create_user",
        "olimp_create_workflow",
        "olimp_delete_automation",
        "olimp_delete_integration",
        "olimp_delete_note",
        "olimp_delete_own_skill",
        "olimp_delete_secret",
        "olimp_delete_user",
        "olimp_delete_webhook",
        "olimp_delete_workflow",
        "olimp_disable_issues",
        "olimp_enable_issues",
        "olimp_fetch_repo",
        "olimp_get_agent_config",
        "olimp_get_agent_defaults",
        "olimp_get_automation",
        "olimp_get_costs",
        "olimp_get_github_item",
        "olimp_get_instructions",
        "olimp_get_machine",
        "olimp_get_mail",
        "olimp_get_memory_graph",
        "olimp_get_memory_map",
        "olimp_get_memory_page",
        "olimp_get_prompt_templates",
        "olimp_get_repo",
        "olimp_get_repo_changes",
        "olimp_get_repo_commit",
        "olimp_get_repo_file",
        "olimp_get_settings",
        "olimp_get_task",
        "olimp_get_task_attachment",
        "olimp_get_task_changes",
        "olimp_get_task_commit",
        "olimp_get_task_file",
        "olimp_get_task_thread",
        "olimp_get_task_trace",
        "olimp_get_variants",
        "olimp_get_version",
        "olimp_get_workflow",
        "olimp_get_workflow_run",
        "olimp_get_workflow_run_changes",
        "olimp_get_workflow_run_trace",
        "olimp_github_status",
        "olimp_init_git",
        "olimp_list_agent_config",
        "olimp_list_agents",
        "olimp_list_automations",
        "olimp_list_branches",
        "olimp_list_folders",
        "olimp_list_github_items",
        "olimp_list_github_owners",
        "olimp_list_integrations",
        "olimp_list_models",
        "olimp_list_notes",
        "olimp_list_pins",
        "olimp_list_reads",
        "olimp_list_repo_commits",
        "olimp_list_repo_files",
        "olimp_list_repos",
        "olimp_list_secrets",
        "olimp_list_skill_sources",
        "olimp_list_skills",
        "olimp_list_subtasks",
        "olimp_list_task_commits",
        "olimp_list_task_files",
        "olimp_list_tasks",
        "olimp_list_tokens",
        "olimp_list_unwoven_notes",
        "olimp_list_users",
        "olimp_list_webhooks",
        "olimp_list_workflow_runs",
        "olimp_list_workflows",
        "olimp_list_worktrees",
        "olimp_mark_run_read",
        "olimp_mark_run_unread",
        "olimp_mark_task_read",
        "olimp_mark_task_unread",
        "olimp_merge_pull_request",
        "olimp_pick_variant",
        "olimp_pin_task",
        "olimp_read_skill",
        "olimp_reclaim_worktrees",
        "olimp_refresh_skill_sources",
        "olimp_remove_agent_login",
        "olimp_remove_repo",
        "olimp_remove_skill_source",
        "olimp_remove_worktree",
        "olimp_reset_mail",
        "olimp_reset_two_factor",
        "olimp_retry_task",
        "olimp_retry_workflow_run",
        "olimp_revoke_token",
        "olimp_run_automation",
        "olimp_run_workflow",
        "olimp_search_memory",
        "olimp_search_skills",
        "olimp_send_account_link",
        "olimp_send_test_mail",
        "olimp_set_agent_config",
        "olimp_set_agent_defaults",
        "olimp_set_agent_token",
        "olimp_set_base_branch",
        "olimp_set_commands",
        "olimp_set_instructions",
        "olimp_set_prompt_templates",
        "olimp_set_repo_agents",
        "olimp_set_secret",
        "olimp_test_webhook",
        "olimp_unarchive_task",
        "olimp_unpin_task",
        "olimp_update",
        "olimp_update_automation",
        "olimp_update_integration",
        "olimp_update_mail",
        "olimp_update_memory_page",
        "olimp_update_memory_section",
        "olimp_update_own_skill",
        "olimp_update_repo_settings",
        "olimp_update_settings",
        "olimp_update_user",
        "olimp_update_webhook",
        "olimp_update_workflow",
        "olimp_upload_file",
        "olimp_watch_events",
        "olimp_whoami",
    ]);
});

test("olimp_watch_events returns the streamed events in order, with the token", async () => {
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    const withToken = createMcpServer({
        OLIMP_URL: `http://127.0.0.1:${port}`,
        OLIMP_TOKEN: "olimp_secret",
    });
    await withToken.connect(serverEnd);
    const other = new Client({ name: "test", version: "0.0.0" });
    await other.connect(clientEnd);
    try {
        seen.length = 0;
        const result = await other.callTool({
            name: "olimp_watch_events",
            arguments: { seconds: 5 },
        });
        const [content] = result.content as { text: string }[];
        assert.equal(result.isError, undefined);
        assert.deepEqual(JSON.parse(content?.text ?? ""), streamed);
        assert.equal(seen[0]?.url, "/api/events");
        assert.equal(seen[0]?.authorization, "Bearer olimp_secret");

        seen.length = 0;
        const capped = await other.callTool({ name: "olimp_watch_events", arguments: { max: 1 } });
        const [first] = capped.content as { text: string }[];
        assert.deepEqual(JSON.parse(first?.text ?? ""), streamed.slice(0, 1));
    } finally {
        await other.close();
        await withToken.close();
    }
});

test("olimp_create_task passes the skill", async () => {
    const task = { repo: "demo", title: "Do it", skill: "acme/skills:tidy" };
    const r = await callTool("olimp_create_task", task);
    assert.equal(r.isError, false);
    assert.deepEqual(JSON.parse(r.request?.body ?? ""), task);
});

const automation = { name: "Nightly", cron: "0 3 * * 1-5", repo: "demo", title: "Tidy" };

const flowDefinition = {
    nodes: [
        { id: "start", type: "start" },
        {
            id: "fix",
            type: "agent",
            name: "Fix",
            prompt: "{{task}}",
            agent: "codex",
            skill: "tidy",
        },
        { id: "check", type: "if", condition: { kind: "diff-files", op: ">", value: 0 } },
        { id: "pr", type: "github.draft-pr", title: "Fix" },
    ],
    edges: [
        { from: "start.next", to: "fix" },
        { from: "fix.done", to: "check" },
        { from: "check.true", to: "pr" },
    ],
};

const integrationFlow = {
    nodes: [
        { id: "start", type: "start" },
        { id: "use", type: "agent", prompt: "Use it", integrations: ["github"] },
    ],
    edges: [{ from: "start.next", to: "use" }],
};

const githubIntegration = {
    name: "github",
    kind: "stdio",
    command: "github-mcp",
    args: ["stdio"],
    env: { GITHUB_TOKEN: ref("GITHUB_TOKEN") },
};

const task = "0123456789ab";
const run = "cccccccccccc";

const toolCalls: [string, Record<string, unknown>, string, string, unknown][] = [
    ["olimp_get_task_trace", { id: task }, "GET", `/api/tasks/${task}/trace`, undefined],
    ["olimp_get_task_changes", { id: task }, "GET", `/api/tasks/${task}/changes`, undefined],
    ["olimp_get_task_thread", { id: task }, "GET", `/api/tasks/${task}/thread`, undefined],
    ["olimp_list_task_commits", { id: task }, "GET", `/api/tasks/${task}/commits`, undefined],
    ["olimp_list_subtasks", { id: task }, "GET", `/api/tasks/${task}/subtasks`, undefined],
    ["olimp_list_models", {}, "GET", "/api/models", undefined],
    [
        "olimp_upload_file",
        { name: "a.png", data: "aGk=", mediaType: "image/png" },
        "POST",
        "/api/uploads",
        { name: "a.png", data: "aGk=", mediaType: "image/png" },
    ],
    ["olimp_get_variants", { group: run }, "GET", `/api/task-groups/${run}`, undefined],
    ["olimp_pick_variant", { group: run, task }, "POST", `/api/task-groups/${run}/pick`, { task }],
    ["olimp_list_branches", { repo: "demo" }, "GET", "/api/repos/demo/branches", undefined],
    ["olimp_get_repo_changes", { repo: "demo" }, "GET", "/api/repos/demo/changes", undefined],
    ["olimp_list_repo_commits", { repo: "demo" }, "GET", "/api/repos/demo/commits", undefined],
    [
        "olimp_get_repo_commit",
        { repo: "demo", sha: "abc1234", branch: "release" },
        "GET",
        "/api/repos/demo/commits/abc1234?branch=release",
        undefined,
    ],
    [
        "olimp_list_repo_files",
        { repo: "demo", branch: "release" },
        "GET",
        "/api/repos/demo/files?branch=release",
        undefined,
    ],
    [
        "olimp_get_repo_file",
        { repo: "demo", path: "src/a b.ts" },
        "GET",
        "/api/repos/demo/files?path=src%2Fa%20b.ts",
        undefined,
    ],
    [
        "olimp_create_branch",
        { repo: "demo", name: "x" },
        "POST",
        "/api/repos/demo/branches",
        { name: "x" },
    ],
    [
        "olimp_set_base_branch",
        { repo: "demo", branch: "main" },
        "PUT",
        "/api/repos/demo/branch",
        { branch: "main" },
    ],
    ["olimp_get_prompt_templates", {}, "GET", "/api/prompt-templates", undefined],
    ["olimp_get_instructions", {}, "GET", "/api/instructions", undefined],
    [
        "olimp_set_instructions",
        { instructions: "Be brief." },
        "PUT",
        "/api/instructions",
        { instructions: "Be brief." },
    ],
    [
        "olimp_set_prompt_templates",
        { templates: null },
        "PUT",
        "/api/prompt-templates",
        { templates: null },
    ],
    [
        "olimp_get_task_commit",
        { id: task, sha: "abc1234" },
        "GET",
        `/api/tasks/${task}/commits/abc1234`,
        undefined,
    ],
    ["olimp_list_task_files", { id: task }, "GET", `/api/tasks/${task}/files`, undefined],
    [
        "olimp_get_task_file",
        { id: task, path: "src/a b.ts" },
        "GET",
        `/api/tasks/${task}/files?path=src%2Fa%20b.ts`,
        undefined,
    ],
    [
        "olimp_get_workflow_run_changes",
        { id: run },
        "GET",
        `/api/workflow-runs/${run}/changes`,
        undefined,
    ],
    ["olimp_cancel_task", { id: task }, "POST", `/api/tasks/${task}/cancel`, {}],
    ["olimp_archive_task", { id: task }, "PUT", `/api/tasks/${task}/archive`, {}],
    ["olimp_unarchive_task", { id: task }, "DELETE", `/api/tasks/${task}/archive`, {}],
    ["olimp_pin_task", { id: task }, "PUT", `/api/tasks/${task}/pin`, {}],
    ["olimp_unpin_task", { id: task }, "DELETE", `/api/tasks/${task}/pin`, {}],
    ["olimp_list_pins", {}, "GET", "/api/pins", undefined],
    ["olimp_mark_task_read", { id: task }, "PUT", `/api/tasks/${task}/read`, {}],
    ["olimp_mark_task_unread", { id: task }, "DELETE", `/api/tasks/${task}/read`, {}],
    ["olimp_mark_run_read", { id: run }, "PUT", `/api/workflow-runs/${run}/read`, {}],
    ["olimp_mark_run_unread", { id: run }, "DELETE", `/api/workflow-runs/${run}/read`, {}],
    ["olimp_list_reads", {}, "GET", "/api/reads", undefined],
    ["olimp_retry_task", { id: task }, "POST", `/api/tasks/${task}/retry`, {}],
    [
        "olimp_continue_task",
        { id: task, body: "Now the docs" },
        "POST",
        `/api/tasks/${task}/continue`,
        { body: "Now the docs" },
    ],
    [
        "olimp_get_workflow_run_trace",
        { id: run },
        "GET",
        `/api/workflow-runs/${run}/trace`,
        undefined,
    ],
    ["olimp_cancel_workflow_run", { id: run }, "POST", `/api/workflow-runs/${run}/cancel`, {}],
    [
        "olimp_answer_workflow_run",
        { id: run, answer: "approve", comment: "Looks good" },
        "POST",
        `/api/workflow-runs/${run}/answer`,
        { answer: "approve", comment: "Looks good" },
    ],
    ["olimp_retry_workflow_run", { id: run }, "POST", `/api/workflow-runs/${run}/retry`, {}],
    ["olimp_get_costs", {}, "GET", "/api/costs", undefined],
    ["olimp_get_costs", { by: "author", days: 7 }, "GET", "/api/costs?by=author&days=7", undefined],
    ["olimp_list_repos", {}, "GET", "/api/repos", undefined],
    [
        "olimp_add_repo",
        { path: "/srv/code/demo" },
        "POST",
        "/api/repos",
        { path: "/srv/code/demo" },
    ],
    [
        "olimp_add_repo",
        { repo: "https://github.com/acme/demo", folder: "demo-2" },
        "POST",
        "/api/repos",
        { repo: "https://github.com/acme/demo", folder: "demo-2" },
    ],
    [
        "olimp_create_repo",
        { repo: "acme/new", template: "acme/starter", folder: "new" },
        "POST",
        "/api/repos",
        { repo: "acme/new", template: "acme/starter", folder: "new", create: true },
    ],
    ["olimp_list_folders", {}, "GET", "/api/folders", undefined],
    [
        "olimp_create_folder",
        { path: "/srv", folder: "new" },
        "POST",
        "/api/folders",
        { path: "/srv", folder: "new" },
    ],
    [
        "olimp_list_folders",
        { path: "/srv/code" },
        "GET",
        "/api/folders?path=%2Fsrv%2Fcode",
        undefined,
    ],
    [
        "olimp_list_folders",
        { path: "/home/x", hidden: true },
        "GET",
        "/api/folders?path=%2Fhome%2Fx&hidden=1",
        undefined,
    ],
    ["olimp_list_github_owners", {}, "GET", "/api/github/owners", undefined],
    ["olimp_github_status", {}, "GET", "/api/github/status", undefined],
    [
        "olimp_list_github_items",
        { repo: "demo", kind: "prs" },
        "GET",
        "/api/repos/demo/github/prs",
        undefined,
    ],
    [
        "olimp_get_github_item",
        { repo: "demo", kind: "issues", number: 3 },
        "GET",
        "/api/repos/demo/github/issues/3",
        undefined,
    ],
    [
        "olimp_merge_pull_request",
        { repo: "demo", number: 7, method: "squash", sha: "a".repeat(40) },
        "POST",
        "/api/repos/demo/github/prs/7/merge",
        { method: "squash", sha: "a".repeat(40) },
    ],
    ["olimp_get_repo", { repo: "demo" }, "GET", "/api/repos/demo", undefined],
    [
        "olimp_add_skill_source",
        { repo: "acme/skills" },
        "POST",
        "/api/skill-sources",
        { repo: "acme/skills" },
    ],
    ["olimp_list_skill_sources", {}, "GET", "/api/skill-sources", undefined],
    ["olimp_refresh_skill_sources", {}, "POST", "/api/skill-sources/refresh", {}],
    ["olimp_search_skills", { query: "tidy" }, "GET", "/api/skill-search?q=tidy", undefined],
    [
        "olimp_create_own_skill",
        { name: "mine", content: "---" },
        "POST",
        "/api/own-skills",
        { name: "mine", content: "---" },
    ],
    [
        "olimp_update_own_skill",
        { name: "mine", content: "x" },
        "PUT",
        "/api/own-skills/mine",
        { content: "x" },
    ],
    ["olimp_delete_own_skill", { name: "mine" }, "DELETE", "/api/own-skills/mine", {}],
    [
        "olimp_remove_skill_source",
        { repo: "acme/skills" },
        "DELETE",
        "/api/skill-sources/acme/skills",
        {},
    ],
    [
        "olimp_create_task",
        { repo: "demo", title: "Here", worktree: false, newBranch: true, branch: "feat/x" },
        "POST",
        "/api/tasks",
        { repo: "demo", title: "Here", worktree: false, newBranch: true, branch: "feat/x" },
    ],
    ["olimp_remove_repo", { repo: "demo" }, "DELETE", "/api/repos/demo", {}],
    ["olimp_init_git", { repo: "demo" }, "POST", "/api/repos/demo/git", {}],
    ["olimp_fetch_repo", { repo: "demo" }, "POST", "/api/repos/demo/fetch", {}],
    ["olimp_list_skills", {}, "GET", "/api/skills", undefined],
    ["olimp_list_skills", { repo: "demo" }, "GET", "/api/skills?repo=demo", undefined],
    [
        "olimp_read_skill",
        { ref: "./check", repo: "demo" },
        "GET",
        "/api/skill?ref=.%2Fcheck&repo=demo",
        undefined,
    ],
    ["olimp_list_automations", {}, "GET", "/api/automations", undefined],
    [
        "olimp_get_automation",
        { id: "aaaaaaaaaaaa" },
        "GET",
        "/api/automations/aaaaaaaaaaaa",
        undefined,
    ],
    [
        "olimp_create_automation",
        { ...automation, skill: "tidy", enabled: false },
        "POST",
        "/api/automations",
        { ...automation, skill: "tidy", enabled: false },
    ],
    [
        "olimp_update_automation",
        { id: "aaaaaaaaaaaa", enabled: true, skill: null },
        "PATCH",
        "/api/automations/aaaaaaaaaaaa",
        { enabled: true, skill: null },
    ],
    [
        "olimp_delete_automation",
        { id: "aaaaaaaaaaaa" },
        "DELETE",
        "/api/automations/aaaaaaaaaaaa",
        {},
    ],
    [
        "olimp_run_automation",
        { id: "aaaaaaaaaaaa" },
        "POST",
        "/api/automations/aaaaaaaaaaaa/run",
        {},
    ],
    [
        "olimp_create_automation",
        { name: "Nightly flow", cron: "0 3 * * *", workflow: "bbbbbbbbbbbb" },
        "POST",
        "/api/automations",
        { name: "Nightly flow", cron: "0 3 * * *", workflow: "bbbbbbbbbbbb" },
    ],
    [
        "olimp_update_automation",
        { id: "aaaaaaaaaaaa", workflow: null, repo: "demo", title: "Tidy" },
        "PATCH",
        "/api/automations/aaaaaaaaaaaa",
        { workflow: null, repo: "demo", title: "Tidy" },
    ],
    ["olimp_list_workflows", {}, "GET", "/api/workflows", undefined],
    [
        "olimp_build_workflow",
        { repo: "demo", request: "Fix and test" },
        "POST",
        "/api/workflows/build",
        { repo: "demo", request: "Fix and test" },
    ],
    [
        "olimp_create_workflow",
        { name: "Flow", repo: "demo", definition: flowDefinition },
        "POST",
        "/api/workflows",
        { name: "Flow", repo: "demo", definition: flowDefinition },
    ],
    ["olimp_get_workflow", { id: "bbbbbbbbbbbb" }, "GET", "/api/workflows/bbbbbbbbbbbb", undefined],
    [
        "olimp_update_workflow",
        { id: "bbbbbbbbbbbb", name: "Renamed" },
        "PATCH",
        "/api/workflows/bbbbbbbbbbbb",
        { name: "Renamed" },
    ],
    ["olimp_delete_workflow", { id: "bbbbbbbbbbbb" }, "DELETE", "/api/workflows/bbbbbbbbbbbb", {}],
    ["olimp_run_workflow", { id: "bbbbbbbbbbbb" }, "POST", "/api/workflows/bbbbbbbbbbbb/run", {}],
    [
        "olimp_run_workflow",
        { id: "bbbbbbbbbbbb", input: "Fix the login" },
        "POST",
        "/api/workflows/bbbbbbbbbbbb/run",
        { input: "Fix the login" },
    ],
    ["olimp_list_workflow_runs", {}, "GET", "/api/workflow-runs", undefined],
    [
        "olimp_get_workflow_run",
        { id: "cccccccccccc" },
        "GET",
        "/api/workflow-runs/cccccccccccc",
        undefined,
    ],
    ["olimp_list_notes", {}, "GET", "/api/notes", undefined],
    ["olimp_list_notes", { repo: "demo" }, "GET", "/api/notes?repo=demo", undefined],
    [
        "olimp_add_note",
        { repo: "demo", text: "Tests need Node 26" },
        "POST",
        "/api/notes",
        { repo: "demo", text: "Tests need Node 26" },
    ],
    ["olimp_delete_note", { id: "dddddddddddd" }, "DELETE", "/api/notes/dddddddddddd", {}],
    [
        "olimp_create_task",
        { repo: "demo", title: "Use", integrations: ["github", "sentry"] },
        "POST",
        "/api/tasks",
        { repo: "demo", title: "Use", integrations: ["github", "sentry"] },
    ],
    [
        "olimp_create_workflow",
        { name: "Flow", repo: "demo", definition: integrationFlow },
        "POST",
        "/api/workflows",
        { name: "Flow", repo: "demo", definition: integrationFlow },
    ],
    [
        "olimp_update_automation",
        { id: "aaaaaaaaaaaa", integrations: [] },
        "PATCH",
        "/api/automations/aaaaaaaaaaaa",
        { integrations: [] },
    ],
    ["olimp_list_integrations", { repo: "demo" }, "GET", "/api/repos/demo/integrations", undefined],
    [
        "olimp_add_integration",
        { repo: "demo", ...githubIntegration },
        "POST",
        "/api/repos/demo/integrations",
        githubIntegration,
    ],
    [
        "olimp_update_integration",
        { repo: "demo", name: "github", args: ["stdio", "--read-only"] },
        "PATCH",
        "/api/repos/demo/integrations/github",
        { args: ["stdio", "--read-only"] },
    ],
    [
        "olimp_delete_integration",
        { repo: "demo", name: "github" },
        "DELETE",
        "/api/repos/demo/integrations/github",
        {},
    ],
    [
        "olimp_enable_issues",
        { repo: "demo", label: "olimp" },
        "PUT",
        "/api/repos/demo/issues",
        { label: "olimp" },
    ],
    ["olimp_disable_issues", { repo: "demo" }, "DELETE", "/api/repos/demo/issues", {}],
    [
        "olimp_set_commands",
        { repo: "demo", commands: ["pnpm typecheck", "pnpm lint"] },
        "PUT",
        "/api/repos/demo/commands",
        { commands: ["pnpm typecheck", "pnpm lint"] },
    ],
    ["olimp_clear_commands", { repo: "demo" }, "DELETE", "/api/repos/demo/commands", {}],
    ["olimp_get_memory_map", { repo: "demo" }, "GET", "/api/repos/demo/memory", undefined],
    [
        "olimp_list_unwoven_notes",
        { repo: "demo" },
        "GET",
        "/api/repos/demo/memory/unwoven",
        undefined,
    ],
    [
        "olimp_list_unwoven_notes",
        { repo: "demo", oldest: true },
        "GET",
        "/api/repos/demo/memory/unwoven?oldest=true",
        undefined,
    ],
    [
        "olimp_search_memory",
        { repo: "demo", query: "deploy key" },
        "GET",
        "/api/repos/demo/memory/search?q=deploy+key",
        undefined,
    ],
    [
        "olimp_create_memory_page",
        { repo: "demo", slug: "build", title: "Build", description: "How to build." },
        "POST",
        "/api/repos/demo/memory/pages",
        { slug: "build", title: "Build", description: "How to build." },
    ],
    ["olimp_get_memory_graph", { repo: "demo" }, "GET", "/api/repos/demo/memory/graph", undefined],
    [
        "olimp_add_memory_source",
        { repo: "demo", url: "https://example.com/guide" },
        "POST",
        "/api/repos/demo/memory/sources",
        { url: "https://example.com/guide" },
    ],
    [
        "olimp_get_memory_page",
        { repo: "demo", slug: "build" },
        "GET",
        "/api/repos/demo/memory/pages/build",
        undefined,
    ],
    [
        "olimp_update_memory_page",
        { repo: "demo", slug: "build", version: 1, kind: "hub" },
        "PATCH",
        "/api/repos/demo/memory/pages/build",
        { version: 1, kind: "hub" },
    ],
    [
        "olimp_add_memory_section",
        {
            repo: "demo",
            slug: "build",
            heading: "Tools / setup",
            body: "Run pnpm build.",
            sources: ["dddddddddddd"],
        },
        "POST",
        "/api/repos/demo/memory/pages/build/sections",
        { heading: "Tools / setup", body: "Run pnpm build.", sources: ["dddddddddddd"] },
    ],
    [
        "olimp_update_memory_section",
        {
            repo: "demo",
            slug: "build",
            heading: "Tools / setup",
            version: 1,
            body: "Run make.",
        },
        "PATCH",
        "/api/repos/demo/memory/pages/build/sections/Tools%20%2F%20setup",
        { version: 1, body: "Run make." },
    ],
];

for (const [tool, args, method, url, body] of toolCalls)
    test(`${tool} calls ${method} ${url}`, async () => {
        const r = await callTool(tool, args);
        assert.equal(r.isError, false, r.text);
        assert.equal(r.text, replies[`${method} ${url}`]?.body);
        assert.equal(r.request?.method, method);
        assert.equal(r.request?.url, url);
        if (body === undefined) assert.equal(r.request?.body, "");
        else {
            assert.equal(r.request?.contentType, "application/json");
            assert.deepEqual(JSON.parse(r.request?.body ?? ""), body);
        }
    });

test("tools refuse a bad id, repo or cron before calling the API", async () => {
    for (const [tool, args] of [
        ["olimp_run_automation", { id: "nope" }],
        ["olimp_get_automation", { id: "../tasks" }],
        ["olimp_delete_automation", { id: "../tasks" }],
        ["olimp_remove_skill_source", { repo: "acme/x/../../tasks" }],
        ["olimp_create_automation", { ...automation, cron: 5 }],
        ["olimp_update_automation", { id: "aaaaaaaaaaaa", enabled: "yes" }],
        ["olimp_run_workflow", { id: "../tasks" }],
        ["olimp_get_workflow_run", { id: "nope" }],
        ["olimp_delete_note", { id: "../tasks" }],
        ["olimp_add_note", { repo: "demo", text: "x".repeat(2001) }],
        ["olimp_list_notes", { repo: "acme/../tasks" }],
        ["olimp_add_integration", { repo: "demo", ...githubIntegration, name: "../x" }],
        ["olimp_add_integration", { repo: "demo", ...githubIntegration, kind: "sse" }],
        ["olimp_delete_integration", { repo: "demo", name: "x/../../tasks" }],
        ["olimp_update_integration", { repo: "acme/../x", name: "github" }],
        ["olimp_create_task", { repo: "demo", title: "x", integrations: "github" }],
        ["olimp_enable_issues", { repo: "demo", label: "x".repeat(51) }],
        ["olimp_set_commands", { repo: "demo", commands: [] }],
        ["olimp_set_commands", { repo: "demo", commands: ["x".repeat(201)] }],
        ["olimp_clear_commands", { repo: "acme/../tasks" }],
        ["olimp_get_repo", { repo: "acme/demo/../../tasks" }],
        ["olimp_cancel_task", { id: "../tasks" }],
        ["olimp_continue_task", { id: "0123456789ab", body: "" }],
        ["olimp_retry_workflow_run", { id: "nope" }],
        ["olimp_get_costs", { by: "week" }],
        ["olimp_get_costs", { days: 400 }],
        ["olimp_watch_events", { seconds: 61 }],
        ["olimp_get_memory_page", { repo: "demo", slug: "../../tasks" }],
        ["olimp_get_memory_page", { repo: "demo", slug: "Build" }],
        ["olimp_search_memory", { repo: "demo", query: "x" }],
        ["olimp_update_memory_page", { repo: "demo", slug: "build", version: 0 }],
        [
            "olimp_add_memory_section",
            { repo: "demo", slug: "build", heading: "A", body: "x", sources: ["../x"] },
        ],
        ["olimp_create_memory_page", { repo: "demo", slug: "b", title: "B", description: "" }],
        ["olimp_add_memory_source", { repo: "demo", url: "not a link" }],
        ["olimp_add_memory_source", { repo: "demo", upload: "../x" }],
        [
            "olimp_create_workflow",
            {
                name: "x",
                repo: "demo",
                definition: { nodes: [{ id: "a.b", type: "start" }], edges: [] },
            },
        ],
    ] as const) {
        const r = await callTool(tool, args);
        assert.equal(r.isError, true, tool);
        assert.equal(r.request, undefined, tool);
    }
});

test("olimp_create_task refuses an unknown agent before calling the API", async () => {
    const r = await callTool("olimp_create_task", { repo: "demo", title: "x", agent: "gpt" });
    assert.equal(r.isError, true);
    assert.equal(r.request, undefined);
});

test("olimp_list_tasks gets the task list", async () => {
    const r = await callTool("olimp_list_tasks");
    assert.equal(r.isError, false);
    assert.equal(r.text, '[{"id":"0123456789ab"}]');
    assert.equal(r.request?.method, "GET");
    assert.equal(r.request?.url, "/api/tasks");
    assert.equal(r.request?.body, "");
});

test("olimp_get_task gets one task", async () => {
    const r = await callTool("olimp_get_task", { id: "0123456789ab" });
    assert.equal(r.isError, false);
    assert.equal(r.text, '{"id":"0123456789ab"}');
    assert.equal(r.request?.method, "GET");
    assert.equal(r.request?.url, "/api/tasks/0123456789ab");
    assert.equal(r.request?.body, "");
});

test("API errors come back as tool errors with the API's body", async () => {
    const missing = await callTool("olimp_get_task", { id: "ffffffffffff" });
    assert.equal(missing.isError, true);
    assert.equal(missing.text, '{"error":"not found"}');

    failNext = true;
    const broken = await callTool("olimp_create_task", { repo: "demo", title: "Do it" });
    assert.equal(broken.isError, true);
    assert.equal(broken.text, '{"error":"boom"}');
});
