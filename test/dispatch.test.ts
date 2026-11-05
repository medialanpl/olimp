import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApi } from "../src/api.ts";
import { registerRepo } from "../src/clones.ts";
import { loadConfig } from "../src/config.ts";
import { issueToken, queueMerge, revokeToken } from "../src/dispatch.ts";
import { createDispatchServer } from "../src/dispatch-mcp.ts";
import { must, run } from "../src/proc.ts";
import { startWorker } from "../src/runner.ts";
import type { Store, Task } from "../src/store.ts";
import { bareRepo, fakeGh, openStore, script } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-dispatch-"));
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const { bare } = await bareRepo(root, "origin", { "README.md": "demo\n" });
const gh = fakeGh(root, { "acme/demo": bare });

// One fake claude for every step: the dispatched task adds two subtasks through its own MCP
// server's address and token; both subtasks append to README (a conflict); the merge step
// resolves it.
const agent = `case "$*" in
  *"Dispatch mode"*)
    prev=""; for a in "$@"; do [ "$prev" = "--mcp-config" ] && config="$a"; prev="$a"; done
    node -e '
      const env = JSON.parse(process.argv[1]).mcpServers["olimp-dispatch"].env;
      const add = (title) => fetch(env.DISPATCH_URL + "/api/dispatch/subtasks", {
        method: "POST",
        headers: { "x-olimp-dispatch": env.DISPATCH_TOKEN, "content-type": "application/json" },
        body: JSON.stringify({ title, body: "Add " + title }),
      }).then((res) => { if (!res.ok) process.exit(5); });
      add("Left").then(() => add("Right"));
    ' "$config" || exit 5
    echo base > BASE.md; echo "split in two" ;;
  *"Merge the work"*)
    grep -q "<<<<<<<" README.md || exit 6
    printf 'demo\\nleft\\nright\\n' > README.md; echo "merged" ;;
  *"subtask of the dispatched task"*)
    case "$*" in
      *Left*) echo left >> README.md; echo L > LEFT.md ;;
      *) echo right >> README.md; echo R > RIGHT.md ;;
    esac
    [ -f BASE.md ] || exit 7
    echo "part done" ;;
  *) exit 8 ;;
esac`;

let n = 0;
async function setup() {
    const home = join(root, `home-${n++}`);
    const base = {
        ...loadConfig({ OLIMP_HOME: home }),
        gh,
        claude: script(root, `claude-${n}`, agent),
    };
    const store = await openStore(home);
    await registerRepo(store, base, "demo", null, "acme/demo");
    // The agent's MCP server reaches this API, so the config knows its port.
    const server = createApi(store, base);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const cfg = { ...base, port: (server.address() as AddressInfo).port };
    return { cfg, store };
}

const call = (
    port: number,
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: object,
): Promise<{ status: number; json: Record<string, unknown> }> =>
    new Promise((resolve, reject) => {
        const req = request(
            {
                host: "127.0.0.1",
                port,
                method,
                path,
                headers: {
                    host: `127.0.0.1:${port}`,
                    ...(body ? { "content-type": "application/json" } : {}),
                    ...headers,
                },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () =>
                    resolve({ status: res.statusCode ?? 0, json: JSON.parse(data || "null") }),
                );
            },
        );
        req.on("error", reject);
        req.end(body ? JSON.stringify(body) : undefined);
    });

async function settle(store: Store, ids: () => Promise<string[]>) {
    for (let i = 0; i < 600; i++) {
        const tasks = await Promise.all((await ids()).map((id) => store.task(id)));
        if (
            tasks.length &&
            tasks.every((t) => t && t.status !== "queued" && t.status !== "running")
        )
            return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

test("a dispatched task's subtasks run on its branch after it, and one step merges them", async () => {
    const { cfg, store } = await setup();
    const parent = await store.createTask({
        repo: "demo",
        title: "Split",
        body: "Do two parts",
        dispatch: { maxSubtasks: 2, inFlight: 2 },
    });
    const stop = startWorker(store, { ...cfg, maxParallel: 3 }, 20);
    let merge: Task | undefined;
    try {
        await settle(store, async () => {
            const done = await store.task(parent.id);
            const subtasks = await store.subtasks(parent.id);
            return [
                parent.id,
                ...subtasks.map((t) => t.id),
                ...(done?.dispatchMerge ? [done.dispatchMerge] : ["x"]),
            ];
        });
        const done = (await store.task(parent.id)) as Task;
        assert.equal(done.status, "done", done.error ?? "");
        merge = done.dispatchMerge ? await store.task(done.dispatchMerge) : undefined;
        await settle(store, async () => (merge ? [merge.id] : []));
        merge = merge && (await store.task(merge.id));
    } finally {
        stop();
    }
    const subtasks = await store.subtasks(parent.id);
    assert.deepEqual(
        subtasks.map((t) => [t.title, t.status, t.prUrl]),
        [
            ["Left", "done", null],
            ["Right", "done", null],
        ],
        subtasks.map((t) => t.error).join("; "),
    );
    assert.ok(merge, "a merge step was queued");
    assert.equal(merge.status, "done", merge.error ?? "");
    assert.equal(merge.thread, parent.id);
    assert.equal(merge.parent, parent.id);
    assert.match(merge.body, /Left \(.*done, branch olimp\//);
    const branch = `olimp/${parent.id}`;
    const show = (file: string) => run("git", ["-C", bare, "show", `${branch}:${file}`]);
    assert.equal((await show("README.md")).stdout, "demo\nleft\nright\n");
    for (const file of ["BASE.md", "LEFT.md", "RIGHT.md"])
        assert.equal((await show(file)).code, 0, file);
    const log = await must("git", ["-C", bare, "log", "--format=%s", branch]);
    assert.match(log, /olimp: merge subtask Right \(conflicts\)/);
    assert.match(log, /olimp: merge subtask Left/);
});

test("only the running dispatched task's token adds its subtasks, up to its limit", async () => {
    const { cfg, store } = await setup();
    const parent = await store.createTask({
        repo: "demo",
        title: "Split",
        body: "",
        model: "opus",
        dispatch: { maxSubtasks: 1, inFlight: 1, agent: "codex", model: "gpt-5-codex" },
    });
    const token = issueToken(parent.id);
    const port = cfg.port;
    const add = (headers: Record<string, string>) =>
        call(port, "POST", "/api/dispatch/subtasks", headers, { title: "Part", body: "Do it" });
    assert.equal((await add({ "x-olimp-dispatch": token })).json.code, "dispatch.notRunning");
    await store.startJob("task", parent.id, `olimp/${parent.id}`);
    assert.equal((await add({ "x-olimp-dispatch": "forged" })).status, 401);
    const created = await add({ "x-olimp-dispatch": token });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal((await add({ "x-olimp-dispatch": token })).json.code, "dispatch.limit");
    const listed = await call(port, "GET", "/api/dispatch/subtasks", { "x-olimp-dispatch": token });
    assert.deepEqual(listed.json, [{ id: created.json.id, title: "Part", status: "queued" }]);
    const subtask = await store.task(created.json.id as string);
    assert.equal(subtask?.parent, parent.id);
    assert.deepEqual([subtask?.agent, subtask?.model], ["codex", "gpt-5-codex"]);
    assert.equal(subtask?.thread, null);
    // It waits in the queue while its dispatched task works.
    assert.equal((await store.nextJob())?.kind, undefined);
    await store.update(parent.id, { status: "done" });
    const next = await store.nextJob();
    assert.equal(next?.kind === "task" && next.task.id, subtask?.id);
    revokeToken(parent.id);
    assert.equal((await add({ "x-olimp-dispatch": token })).status, 401);
    const viaApi = await call(port, "GET", `/api/tasks/${parent.id}/subtasks`);
    assert.equal((viaApi.json as unknown as Task[]).length, 1);
});

test("dispatch options are checked, and the merge step is queued once", async () => {
    const { cfg, store } = await setup();
    const port = cfg.port;
    const post = (body: object) =>
        call(port, "POST", "/api/tasks", {}, { repo: "demo", title: "x", ...body });
    const plain = await post({ dispatch: true });
    assert.deepEqual(plain.json.dispatch, {
        maxSubtasks: 50,
        inFlight: 4,
        agent: null,
        model: null,
        budgetUsd: null,
    });
    assert.equal((await post({ dispatch: { budgetUsd: -1 } })).json.code, "task.invalidDispatch");
    assert.equal((await post({ dispatch: { inFlight: 5 } })).json.code, "task.invalidDispatch");
    assert.equal(
        (await post({ dispatch: true, variants: 2 })).json.code,
        "task.dispatchWithVariants",
    );
    const parent = plain.json as unknown as Task;
    await store.update(parent.id, { status: "done" });
    const one = await store.createTask({ repo: "demo", title: "A", body: "", parent: parent.id });
    const two = await store.createTask({ repo: "demo", title: "B", body: "", parent: parent.id });
    await store.update(one.id, { status: "done" });
    assert.equal(await queueMerge(store, parent.id), null, "B still queued");
    await store.update(two.id, { status: "failed", error: "boom" });
    const [first, second] = await Promise.all([
        queueMerge(store, parent.id),
        queueMerge(store, parent.id),
    ]);
    assert.equal([first, second].filter(Boolean).length, 1);
    const merge = (first ?? second) as Task;
    assert.equal((await store.task(parent.id))?.dispatchMerge, merge.id);
    assert.match(merge.body, /B \(.*failed\): boom/);
});

test("the agent's dispatch MCP server adds and lists subtasks with its token", async () => {
    const { cfg, store } = await setup();
    const parent = await store.createTask({
        repo: "demo",
        title: "Split",
        body: "",
        dispatch: { maxSubtasks: 3, inFlight: 1 },
    });
    await store.startJob("task", parent.id, `olimp/${parent.id}`);
    const token = issueToken(parent.id);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createDispatchServer(`http://127.0.0.1:${cfg.port}`, token).connect(serverSide);
    const client = new Client({ name: "agent", version: "0.0.0" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["dispatch_subtask", "list_subtasks"]);
    const added = await client.callTool({
        name: "dispatch_subtask",
        arguments: { title: "Part", body: "Do it" },
    });
    assert.equal(added.isError, false);
    const listed = await client.callTool({ name: "list_subtasks", arguments: {} });
    assert.match(JSON.stringify(listed.content), /Part/);
    revokeToken(parent.id);
    const refused = await client.callTool({ name: "list_subtasks", arguments: {} });
    assert.equal(refused.isError, true);
    await client.close();
});
