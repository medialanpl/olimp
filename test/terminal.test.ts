import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { EventBus } from "../src/bus.ts";
import { loadConfig } from "../src/config.ts";
import { must } from "../src/proc.ts";
import { makeTargets, packageScripts, projectCommands } from "../src/project-commands.ts";
import {
    closeAllTerminals,
    findUrls,
    foreground,
    groupsUnder,
    loadPty,
    parseProcesses,
    processTable,
    shells,
    tidyCommand,
} from "../src/terminals.ts";
import { openStore } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-terminal-"));
const servers: Server[] = [];
after(() => {
    closeAllTerminals();
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});
const pty = typeof (await loadPty()) !== "string";
const json = { "content-type": "application/json" };

test("the process table names a shell's first child and every group under it", () => {
    const rows = parseProcesses(
        [
            "  100     1   100 /usr/bin/node olimp",
            "  200   100   200 /bin/bash",
            "  210   200   210 /usr/bin/npm run dev",
            "  211   210   210 sh -c vite",
            "  220   200   220 sleep 100",
            "  300     1   300 /bin/bash",
            "garbage",
        ].join("\n"),
    );
    assert.equal(rows.length, 6);
    assert.equal(foreground(rows, 200), "npm run dev");
    assert.equal(foreground(rows, 220), null);
    assert.deepEqual(groupsUnder(rows, 200, 100)?.sort(), [200, 210, 220]);
    // Not OLIMP's child: the pid may belong to someone else by now.
    assert.equal(groupsUnder(rows, 300, 100), null);
    assert.equal(tidyCommand("/opt/homebrew/bin/node server.js"), "node server.js");
    assert.equal(tidyCommand(`run ${"x".repeat(60)}`).length, 40);
});

test("addresses in output are found once, without colours, with 0.0.0.0 as localhost", () => {
    assert.deepEqual(
        findUrls(
            "\x1b[32m  ➜  Local:\x1b[0m http://localhost:5173/\n" +
                "listening on http://0.0.0.0:3000 and http://localhost:5173/ again, " +
                "not https://example.com",
        ),
        ["http://localhost:5173", "http://localhost:3000"],
    );
});

test("a worktree's package scripts run with its package manager, beside Makefile targets", () => {
    const dir = mkdtempSync(join(root, "commands-"));
    const manifest = { scripts: { dev: "vite", test: "node --test" } };
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    writeFileSync(
        join(dir, "Makefile"),
        ".PHONY: up\nup:\n\tdocker compose up\nVAR := 1\n%.o: %.c\n",
    );
    const found = projectCommands(dir, false);
    assert.deepEqual(
        found.commands.map((c) => [c.command, c.source]),
        [
            ["pnpm run dev", "package.json"],
            ["pnpm run test", "package.json"],
            ["make up", "Makefile"],
        ],
    );
    assert.equal(found.install, "pnpm install");
    // The project's setup scripts install it already.
    assert.equal(projectCommands(dir, true).install, null);
    assert.deepEqual(packageScripts({ scripts: { a: 1 } }, "npm"), []);
    assert.deepEqual(makeTargets("build: deps\nbuild: more\n").length, 1);
});

test("only the host's own shells are offered, its default first", () => {
    const file = join(root, "shells");
    writeFileSync(file, "# comment\n/bin/sh\n/no/such/shell\n");
    const offered = shells(file);
    assert.ok(offered.includes("/bin/sh"));
    assert.ok(!offered.includes("/no/such/shell"));
});

function client(port: number) {
    return (
        method: string,
        path: string,
        body?: object,
    ): Promise<{ status: number; json: Record<string, unknown> }> =>
        new Promise((resolve, reject) => {
            // With a length, as a browser sends it: a route that ignores the body leaves nothing
            // of it on the connection.
            const payload = body ? JSON.stringify(body) : "";
            const length = { "content-length": String(Buffer.byteLength(payload)) };
            const req = request(
                {
                    host: "127.0.0.1",
                    port,
                    method,
                    path,
                    headers: { host: `127.0.0.1:${port}`, ...(body ? { ...json, ...length } : {}) },
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
            req.end(payload || undefined);
        });
}

async function until<T>(check: () => Promise<T | undefined>, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const found = await check();
        if (found !== undefined) return found;
        if (Date.now() > end) throw new Error("timed out");
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

async function setup(git = false) {
    const home = mkdtempSync(join(root, "home-"));
    const folder = join(home, "kit");
    mkdirSync(folder);
    if (git) await must("git", ["init", "-q", folder]);
    const store = await openStore(home);
    await store.addRepo("kit", "main", folder, null);
    const bus = new EventBus();
    const server = createApi(store, loadConfig({ OLIMP_HOME: home }), bus);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const call = client((server.address() as AddressInfo).port);
    return { store, folder, bus, call };
}

test("a task's terminal runs a shell in its folder, keeps its output and stops its tree", {
    skip: !pty,
}, async () => {
    const { store, folder, bus, call } = await setup();
    const task = await store.createTask({ repo: "kit", title: "Look", body: "" });
    const base = `/api/tasks/${task.id}/terminals`;
    const state = await call("GET", base);
    assert.equal(state.json.available, true);
    assert.equal(state.json.folder, folder);
    const changed: string[] = [];
    bus.subscribe((event) => {
        if (event.type === "terminal") changed.push(event.id);
    });
    const opened = await call("POST", base, { cols: 100, rows: 30 });
    assert.equal(opened.status, 201);
    const id = opened.json.id as string;
    assert.deepEqual([opened.json.ordinal, opened.json.label, opened.json.cwd], [1, null, folder]);
    await call("POST", `${base}/${id}/input`, { data: "echo olimp-$((40+2)) && pwd\r" });
    const out = await until(async () => {
        const read = await call("GET", `${base}/${id}/output?cursor=0`);
        return String(read.json.data).includes("olimp-42") ? read.json : undefined;
    });
    assert.ok(String(out.data).includes(folder));
    assert.ok(changed.includes(id));
    // Later reads start at the cursor.
    const later = await call("GET", `${base}/${id}/output?cursor=${out.cursor}`);
    assert.equal(String(later.json.data).includes("olimp-42"), false);

    await call("POST", `${base}/${id}/input`, { data: "sleep 37 & sleep 38\r" });
    const busy = await until(async () => {
        const sessions = (await call("GET", base)).json.sessions as Record<string, unknown>[];
        return sessions[0]?.label === "sleep 37" ? sessions[0] : undefined;
    });
    assert.equal(busy.busy, true);
    const sleeping = () =>
        (processTable(true) ?? []).filter((row) => /^sleep 3[78]$/.test(row.command));
    assert.equal(sleeping().length, 2);
    assert.deepEqual((await call("DELETE", `${base}/${id}`, {})).json, { stopped: true });
    // The background job has a group of its own and goes too.
    await until(async () => (sleeping().length ? undefined : true));
    assert.deepEqual((await call("GET", base)).json.sessions, []);
    assert.equal((await call("GET", `${base}/${id}/output`)).status, 404);
});

test("printed addresses are listed with whether something listens there", {
    skip: !pty,
}, async () => {
    const { store, call } = await setup();
    const listening = createServer();
    await new Promise<void>((resolve) => listening.listen(0, "127.0.0.1", resolve));
    const port = (listening.address() as AddressInfo).port;
    const task = await store.createTask({ repo: "kit", title: "Serve", body: "" });
    const base = `/api/tasks/${task.id}/terminals`;
    const id = (await call("POST", base, { input: `echo ready on http://0.0.0.0:${port}/\r` })).json
        .id as string;
    const urls = await until(async () => {
        const found = (await call("GET", `${base}/urls`)).json.urls as Record<string, unknown>[];
        return found.length ? found : undefined;
    });
    assert.deepEqual(
        urls.map((u) => [u.url, u.running]),
        [[`http://localhost:${port}`, true]],
    );
    listening.close();
    await call("DELETE", `${base}/${id}`, {});
});

test("archiving a task closes its terminals; a removed worktree has none to open", {
    skip: !pty,
}, async () => {
    const { store, call } = await setup();
    const task = await store.createTask({ repo: "kit", title: "Done", body: "" });
    const base = `/api/tasks/${task.id}/terminals`;
    await call("POST", base, {});
    await store.update(task.id, { status: "done" });
    assert.equal((await call("PUT", `/api/tasks/${task.id}/archive`, {})).status, 200);
    assert.deepEqual((await call("GET", base)).json.sessions, []);

    const git = await setup(true);
    const tree = await git.store.createTask({
        repo: "kit",
        title: "Tree",
        body: "",
        workspace: "worktree",
    });
    const gone = await git.call("POST", `/api/tasks/${tree.id}/terminals`, {});
    assert.deepEqual([gone.status, gone.json.code], [409, "terminal.noFolder"]);
    const other = await store.createTask({ repo: "kit", title: "Shell", body: "" });
    const shell = await call("POST", `/api/tasks/${other.id}/terminals`, { shell: "/bin/no" });
    assert.deepEqual([shell.status, shell.json.code], [400, "terminal.unknownShell"]);
});

test("a thread's Claude session can be taken over from its folder", async () => {
    const { store, folder, call } = await setup();
    const task = await store.createTask({ repo: "kit", title: "Ask", body: "" });
    assert.equal((await call("GET", `/api/tasks/${task.id}/terminals`)).json.takeOver, null);
    await store.update(task.id, { status: "done", sessionId: "9d07abcc-0efc" });
    const line = String((await call("GET", `/api/tasks/${task.id}/terminals`)).json.takeOver);
    assert.ok(line.startsWith(`cd ${folder} && `), line);
    assert.ok(line.endsWith("--resume 9d07abcc-0efc"), line);
});

test("a workflow run has terminals of its own, a project none", async () => {
    const { call } = await setup();
    assert.equal((await call("GET", "/api/repos/kit/terminals")).status, 404);
    assert.equal((await call("GET", "/api/tasks/000000000000/terminals")).status, 404);
    const run = await call("GET", "/api/workflow-runs/000000000000/terminals");
    assert.deepEqual([run.status, run.json.code], [404, "run.notFound"]);
});
