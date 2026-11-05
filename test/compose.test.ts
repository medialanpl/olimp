import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { agentRunner } from "../src/agents.ts";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { UPLOAD_MAX } from "../src/limits.ts";
import { discoverClaudeModels, discoverCodexModels, listModels } from "../src/models.ts";
import { must } from "../src/proc.ts";
import { attachmentsDir, safeName, uniqueNames } from "../src/uploads.ts";
import { bareRepo, commitFiles, openStore, ref, script } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-compose-"));
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

// A local git project with a second branch and a task branch, and a gh that logs `pr close`.
async function setup() {
    const home = mkdtempSync(join(root, "home-"));
    const project = join(home, "project");
    await must("git", ["init", "-q", "-b", "main", project]);
    await commitFiles(project, { "README.md": "# Demo\n" }, "init");
    await must("git", ["-C", project, "branch", "release"]);
    await must("git", ["-C", project, "branch", "olimp/0123456789ab"]);
    const closed = join(home, "gh-pr-close.log");
    const gh = script(home, "gh", `[ "$1 $2" = "pr close" ] && echo "$3 $4" >> "${closed}"`);
    const store = await openStore(home);
    await store.addRepo("demo", "main", project, "acme/demo");
    await store.addRepo("plain", "", mkdtempSync(join(home, "plain-")), null);
    const cfg = { ...loadConfig({ OLIMP_HOME: home }), gh, webDir: join(root, "no-panel") };
    const server = createApi(store, cfg);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const raw = (
        method: string,
        path: string,
        body?: object,
    ): Promise<{ status: number; headers: IncomingHttpHeaders; data: Buffer }> =>
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
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (chunk) => chunks.push(chunk));
                    res.on("end", () =>
                        resolve({
                            status: res.statusCode ?? 0,
                            headers: res.headers,
                            data: Buffer.concat(chunks),
                        }),
                    );
                },
            );
            req.on("error", reject);
            req.end(body ? JSON.stringify(body) : undefined);
        });
    // biome-ignore lint/suspicious/noExplicitAny: test replies are read field by field
    const call = async (method: string, path: string, body?: object): Promise<any> => {
        const res = await raw(method, path, body);
        return { status: res.status, json: JSON.parse(res.data.toString() || "null") };
    };
    const upload = async (name: string, data: Buffer) =>
        (await call("POST", "/api/uploads", { name, data: data.toString("base64") })).json
            .id as string;
    return { home, cfg, store, call, raw, upload, closed };
}

test("a task keeps its model, and a retry or continuation keeps it too", async () => {
    const { call } = await setup();
    const created = await call("POST", "/api/tasks", { repo: "demo", title: "Fix", model: "opus" });
    assert.equal(created.status, 201);
    assert.equal(created.json.model, "opus");
    const plain = await call("POST", "/api/tasks", { repo: "demo", title: "Fix" });
    assert.equal(plain.json.model, null);
    const bad = await call("POST", "/api/tasks", { repo: "demo", title: "x", model: "a b" });
    assert.equal(bad.json.code, "task.invalidModel");
    const next = await call("POST", `/api/tasks/${created.json.id}/continue`, { body: "More" });
    assert.equal(next.json.model, "opus");
    const other = await call("POST", `/api/tasks/${created.json.id}/continue`, {
        body: "Again",
        model: "haiku",
    });
    assert.equal(other.json.model, "haiku");
});

test("files attached to a task are kept beside it and served, images inline only", async () => {
    const { cfg, store, call, raw, upload } = await setup();
    const image = await upload("screen shot.png", PNG);
    const page = await upload("../evil.svg", Buffer.from("<svg onload=alert(1)>"));
    const twin = await upload("screen shot.png", Buffer.from("other"));
    const task = await call("POST", "/api/tasks", {
        repo: "demo",
        title: "Look",
        attachments: [image, page, twin],
    });
    assert.equal(task.status, 201, JSON.stringify(task.json));
    assert.deepEqual(task.json.attachments, ["screen shot.png", "evil.svg", "screen shot-2.png"]);
    assert.ok(existsSync(join(attachmentsDir(cfg, task.json.id), "screen shot-2.png")));
    const png = await raw("GET", `/api/tasks/${task.json.id}/attachments/screen%20shot.png`);
    assert.equal(png.status, 200);
    assert.equal(png.headers["content-type"], "image/png");
    assert.match(String(png.headers["content-disposition"]), /^inline;/);
    assert.deepEqual(png.data, PNG);
    const svg = await raw("GET", `/api/tasks/${task.json.id}/attachments/evil.svg`);
    assert.equal(svg.headers["content-type"], "application/octet-stream");
    assert.match(String(svg.headers["content-disposition"]), /^attachment;/);
    assert.equal(svg.headers["x-content-type-options"], "nosniff");
    const missing = await call("GET", `/api/tasks/${task.json.id}/attachments/nope.png`);
    assert.equal(missing.json.code, "task.attachmentNotFound");
    // An upload is used once.
    const again = await call("POST", "/api/tasks", {
        repo: "demo",
        title: "Again",
        attachments: [image],
    });
    assert.equal(again.json.code, "task.uploadExpired");
    await store.update(task.json.id, { status: "failed" });
    const retried = await call("POST", `/api/tasks/${task.json.id}/retry`, {});
    assert.equal(retried.status, 201, JSON.stringify(retried.json));
    assert.deepEqual(
        readFileSync(join(attachmentsDir(cfg, retried.json.id), "screen shot.png")),
        PNG,
    );
    const empty = await call("POST", "/api/uploads", { name: "a.txt", data: "" });
    assert.equal(empty.json.code, "upload.tooLarge");
    // A body too large to read names the file limit too.
    const huge = await call("POST", "/api/uploads", { name: "a.txt", data: "A".repeat(8 << 20) });
    assert.deepEqual([huge.status, huge.json.code], [413, "upload.tooLarge"]);
    const garbage = await call("POST", "/api/uploads", { name: "a.txt", data: "%%%" });
    assert.equal(garbage.json.code, "upload.invalid");
});

test("a continuation may carry files without a written request", async () => {
    const { cfg, call, upload } = await setup();
    const task = await call("POST", "/api/tasks", { repo: "demo", title: "Fix" });
    const file = await upload("log.txt", Buffer.from("boom"));
    const next = await call("POST", `/api/tasks/${task.json.id}/continue`, {
        body: "",
        attachments: [file],
    });
    assert.equal(next.status, 201, JSON.stringify(next.json));
    assert.deepEqual(next.json.attachments, ["log.txt"]);
    assert.equal(readFileSync(join(attachmentsDir(cfg, next.json.id), "log.txt"), "utf8"), "boom");
    const none = await call("POST", `/api/tasks/${task.json.id}/continue`, { body: "" });
    assert.equal(none.json.code, "field.invalidText");
});

test("variants of one prompt lean different ways, and picking one archives the rest", async () => {
    const { store, call, upload, closed } = await setup();
    const file = await upload("spec.md", Buffer.from("# Spec"));
    const created = await call("POST", "/api/tasks", {
        repo: "demo",
        title: "Fix",
        body: "Fix it",
        variants: 3,
        attachments: [file],
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const [a, b, c] = created.json.tasks;
    assert.deepEqual(
        created.json.tasks.map((t: { variant: string }) => t.variant),
        ["A", "B", "C"],
    );
    assert.equal(a.body, "Fix it");
    assert.match(b.body, /change as little as you can/);
    assert.match(c.body, /fix the underlying design/);
    assert.deepEqual(c.attachments, ["spec.md"]);
    const group = created.json.group;
    assert.equal((await call("GET", `/api/task-groups/${group}`)).json.tasks.length, 3);
    const early = await call("POST", `/api/task-groups/${group}/pick`, { task: a.id });
    assert.equal(early.json.code, "task.variantsRunning");
    await store.update(a.id, { status: "done", prUrl: "https://github.com/acme/demo/pull/1" });
    await store.update(b.id, { status: "done", prUrl: "https://github.com/acme/demo/pull/2" });
    await store.update(c.id, { status: "failed" });
    const picked = await call("POST", `/api/task-groups/${group}/pick`, { task: a.id });
    assert.equal(picked.status, 200, JSON.stringify(picked.json));
    const archived = Object.fromEntries(
        picked.json.tasks.map((t: { variant: string; archivedAt: string | null }) => [
            t.variant,
            !!t.archivedAt,
        ]),
    );
    assert.deepEqual(archived, { A: false, B: true, C: true });
    assert.equal(
        readFileSync(closed, "utf8"),
        "https://github.com/acme/demo/pull/2 --delete-branch\n",
    );
    const stranger = await call("POST", `/api/task-groups/${group}/pick`, { task: "aaaaaaaaaaaa" });
    assert.equal(stranger.json.code, "task.notInGroup");
    const plain = await call("POST", "/api/tasks", { repo: "plain", title: "x", variants: 2 });
    assert.equal(plain.json.code, "task.variantsNeedGit");
    const many = await call("POST", "/api/tasks", { repo: "demo", title: "x", variants: 4 });
    assert.equal(many.json.code, "task.invalidVariants");
});

test("a project's branches leave out task branches, its base can change, new ones start from it", async () => {
    const { call, home } = await setup();
    const branches = await call("GET", "/api/repos/demo/branches");
    assert.deepEqual(branches.json, { base: "main", branches: ["main", "release"] });
    const unknown = await call("PUT", "/api/repos/demo/branch", { branch: "nope" });
    assert.equal(unknown.json.code, "repo.unknownBranch");
    const changed = await call("PUT", "/api/repos/demo/branch", { branch: "release" });
    assert.equal(changed.json.defaultBranch, "release");
    assert.equal((await call("GET", "/api/repos/plain/branches")).json.code, "repo.noGit");
    const created = await call("POST", "/api/repos/demo/branches", { name: "feat/x" });
    assert.equal(created.status, 201);
    assert.deepEqual(created.json.branches, ["feat/x", "main", "release"]);
    const project = join(home, "project");
    assert.equal(
        await must("git", ["-C", project, "rev-parse", "feat/x"]),
        await must("git", ["-C", project, "rev-parse", "release"]),
    );
    for (const name of ["olimp/x", "-x", "a..b", "@{-1}"])
        assert.equal(
            (await call("POST", "/api/repos/demo/branches", { name })).json.code,
            "repo.invalidBranch",
        );
    assert.equal(
        (await call("POST", "/api/repos/demo/branches", { name: "main" })).json.code,
        "repo.branchExists",
    );
});

test("fetching a GitHub project shows origin's newer branch on its Git page, not a diverged one", async () => {
    const { call, home, store } = await setup();
    const { bare, seed } = await bareRepo(home, "site", { "README.md": "# Site\n" });
    const site = join(home, "site");
    await must("git", ["clone", "-q", bare, site]);
    await store.addRepo("site", "main", site, "acme/site");
    await commitFiles(seed, { "page.ts": "export {};\n" }, "Merged on GitHub");
    await must("git", ["-C", seed, "push", "-q", bare, "main"]);
    const top = async () => (await call("GET", "/api/repos/site/commits")).json.commits[0].title;
    assert.equal(await top(), "init");
    assert.equal((await call("POST", "/api/repos/site/fetch", {})).status, 200);
    assert.equal(await top(), "Merged on GitHub");
    assert.equal(
        (await call("GET", "/api/repos/site/files?path=page.ts")).json.content,
        "export {};\n",
    );
    // The folder's checkout is left as it was.
    assert.equal(existsSync(join(site, "page.ts")), false);
    await commitFiles(site, { "local.ts": "export {};\n" }, "Only in the folder");
    assert.equal(await top(), "Only in the folder");
    assert.equal((await call("POST", "/api/repos/demo/fetch", {})).json.code, "repo.fetchFailed");
    assert.equal(
        (await call("POST", "/api/repos/plain/fetch", {})).json.code,
        "github.localProject",
    );
});

test("prompt templates are saved as a whole, null brings the built-in ones back", async () => {
    const { call } = await setup();
    assert.equal((await call("GET", "/api/prompt-templates")).json, null);
    const templates = [{ id: "tests", label: "Add tests", text: "Add tests for the change." }];
    assert.deepEqual((await call("PUT", "/api/prompt-templates", { templates })).json, templates);
    assert.deepEqual((await call("GET", "/api/prompt-templates")).json, templates);
    const bad = await call("PUT", "/api/prompt-templates", {
        templates: [{ id: "x y", label: "a", text: "b" }],
    });
    assert.equal(bad.json.code, "templates.invalid");
    await call("PUT", "/api/prompt-templates", { templates: null });
    assert.equal((await call("GET", "/api/prompt-templates")).json, null);
});

test("the global instructions are saved trimmed, and empty clears them", async () => {
    const { call } = await setup();
    assert.deepEqual((await call("GET", "/api/instructions")).json, { instructions: "" });
    const saved = await call("PUT", "/api/instructions", { instructions: "  Be brief.\n" });
    assert.deepEqual(saved.json, { instructions: "Be brief." });
    assert.deepEqual((await call("GET", "/api/instructions")).json, { instructions: "Be brief." });
    const long = await call("PUT", "/api/instructions", { instructions: "x".repeat(20_001) });
    assert.equal(long.status, 200);
    const bad = await call("PUT", "/api/instructions", { instructions: "x".repeat(100_001) });
    assert.equal(bad.json.code, "instructions.invalid");
    await call("PUT", "/api/instructions", { instructions: " " });
    assert.deepEqual((await call("GET", "/api/instructions")).json, { instructions: "" });
});

test("a task without an agent takes its project's, then the installation's default", async () => {
    const { call } = await setup();
    assert.deepEqual((await call("GET", "/api/agent-defaults")).json, {
        agent: "claude",
        models: {},
    });
    const defaults = { agent: "codex", models: { claude: "opus", codex: "" } };
    const saved = await call("PUT", "/api/agent-defaults", defaults);
    assert.deepEqual(saved.json, { agent: "codex", models: { claude: "opus" } });
    const bad = await call("PUT", "/api/agent-defaults", { agent: "gpt" });
    assert.equal(bad.json.code, "agents.invalid");
    const task = async (body: object = {}) =>
        (await call("POST", "/api/tasks", { repo: "demo", title: "T", body: "", ...body })).json;
    assert.equal((await task()).agent, "codex");
    assert.equal((await task({ agent: "claude" })).agent, "claude");
    const chosen = await call("PUT", "/api/repos/demo/agents", {
        agent: "claude",
        models: { codex: "gpt-5-codex" },
        logins: { claude: "work", codex: "default" },
    });
    assert.deepEqual(chosen.json.agents, {
        agent: "claude",
        models: { codex: "gpt-5-codex" },
        logins: { claude: "work" },
    });
    assert.equal((await task()).agent, "claude");
    for (const body of [{ agent: "gpt" }, { logins: { claude: "../x" } }, { models: { x: "a" } }]) {
        const refused = await call("PUT", "/api/repos/demo/agents", body);
        assert.equal(refused.json.code, "agents.invalid", JSON.stringify(body));
    }
});

test("the model and the attachments' folder reach each agent's command line", () => {
    const cfg = loadConfig({ OLIMP_HOME: root });
    const claude = agentRunner(cfg, "claude").call("Do it", "/tree", {}, {}, [], {
        model: "opus",
        dirs: ["/home/x/attachments/t1"],
    });
    assert.deepEqual(claude.args.slice(-4), [
        "--model",
        "opus",
        "--add-dir",
        "/home/x/attachments/t1",
    ]);
    const codex = agentRunner(cfg, "codex").call("Do it", "/tree", {}, {}, [], {
        model: "gpt-5-codex",
        dirs: [],
    });
    assert.deepEqual(codex.args.slice(-4), ["-m", "gpt-5-codex", "--", "Do it"]);
    assert.ok(!agentRunner(cfg, "claude").call("x", "/t", {}, {}, []).args.includes("--model"));
});

test("without accounts a second login may point at any config folder, which removal keeps", async () => {
    const { call } = await setup();
    const folder = join(root, `claude-work-${Date.now()}`);
    const added = await call("POST", "/api/agents/claude/logins", { folder });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual(
        [added.json.name, added.json.dir, added.json.linked],
        [folder.split("/").at(-1), folder, true],
    );
    assert.ok(existsSync(folder));
    const own = await call("POST", "/api/agents/claude/logins", { name: "spare" });
    assert.equal(own.json.linked, false);
    for (const [body, code] of [
        [{ folder: "relative/x" }, "login.invalidFolder"],
        [{ folder: "/x", name: "Bad Name" }, "login.invalidName"],
    ] as const) {
        const refused = await call("POST", "/api/agents/claude/logins", body);
        assert.equal(refused.json.code, code, JSON.stringify(body));
    }
    const single = await call("POST", "/api/agents/cursor/logins", { name: "work" });
    assert.equal(single.json.code, "login.single");
    await call("DELETE", `/api/agents/claude/logins/${added.json.name}`, {});
    assert.ok(existsSync(folder));
});

test("OpenCode gets the step's MCP servers in its environment; Cursor and pi refuse them", () => {
    const cfg = loadConfig({ OLIMP_HOME: root });
    const servers = {
        gh: {
            kind: "stdio" as const,
            command: "npx",
            args: ["gh-mcp"],
            env: { GITHUB_TOKEN: ref("GH_SECRET") },
        },
    };
    const opencode = agentRunner(cfg, "opencode").call(
        "Do it",
        "/tree",
        servers,
        {
            GH_SECRET: "s3cret",
        },
        [],
    );
    assert.deepEqual(JSON.parse(opencode.env.OPENCODE_CONFIG_CONTENT ?? ""), {
        mcp: {
            gh: {
                type: "local",
                command: ["npx", "gh-mcp"],
                environment: { GITHUB_TOKEN: "s3cret" },
                enabled: true,
            },
        },
    });
    assert.ok(!opencode.args.join(" ").includes("s3cret"));
    for (const agent of ["cursor", "pi"] as const)
        assert.throws(
            () => agentRunner(cfg, agent).call("Do it", "/tree", servers, {}, []),
            /cannot be given MCP servers/,
        );
});

test("attached file names stay on the disk as they are, without folders", () => {
    assert.equal(safeName("../../etc/passwd"), "passwd");
    assert.equal(safeName("C:\\Users\\a\\zrzut ekranu.png"), "zrzut ekranu.png");
    assert.equal(safeName(".env"), "env");
    assert.equal(safeName("a\u0000b<c>.txt"), "a_b_c_.txt");
    assert.deepEqual(uniqueNames(["a.png", "A.png", "a.png", "b"]), [
        "a.png",
        "A-2.png",
        "a-3.png",
        "b",
    ]);
});

test("Claude's models come from its CLI's list_models answer, without its default entry", async () => {
    const dir = mkdtempSync(join(root, "models-"));
    const answer = JSON.stringify({
        type: "control_response",
        response: {
            subtype: "success",
            request_id: "olimp-list-models",
            response: {
                models: [
                    { value: "default", displayName: "Default" },
                    { value: "opus", displayName: "Opus 5.5", description: "For complex work" },
                    { value: "haiku" },
                ],
            },
        },
    });
    const cli = script(
        dir,
        "claude",
        `read -r line; echo '{"type":"system"}'; echo '${answer}'; sleep 5`,
    );
    assert.deepEqual(await discoverClaudeModels(cli, { PATH: process.env.PATH ?? "" }), [
        { agent: "claude", value: "opus", label: "Opus 5.5", description: "For complex work" },
        { agent: "claude", value: "haiku", label: "haiku", description: "" },
    ]);
    const old = script(dir, "old-claude", "read -r line; exit 1");
    await assert.rejects(discoverClaudeModels(old, { PATH: process.env.PATH ?? "" }));
});

test("Codex's models come from its app-server, page by page; an agent not installed lists none", async () => {
    const dir = mkdtempSync(join(root, "codex-models-"));
    const pages = [
        {
            data: [
                { model: "gpt-5.5-codex", displayName: "GPT-5.5 Codex" },
                { model: "x", hidden: true },
            ],
            nextCursor: "p2",
        },
        { data: [{ model: "gpt-5.5-mini", description: "Fast" }], nextCursor: null },
    ];
    const cli = script(
        dir,
        "codex",
        `[ "$1" = app-server ] || exit 9
read -r line; echo '{"id":1,"result":{}}'
read -r line
read -r line; echo '{"id":2,"result":${JSON.stringify(pages[0])}}'
read -r line; echo '{"id":3,"result":${JSON.stringify(pages[1])}}'
sleep 5`,
    );
    assert.deepEqual(await discoverCodexModels(cli, { PATH: process.env.PATH ?? "" }), [
        { agent: "codex", value: "gpt-5.5-codex", label: "GPT-5.5 Codex", description: "" },
        { agent: "codex", value: "gpt-5.5-mini", label: "gpt-5.5-mini", description: "Fast" },
    ]);
    const cfg = { ...loadConfig({ OLIMP_HOME: root }), claude: "", codex: cli, cursor: null };
    const models = await listModels(cfg, dir);
    assert.deepEqual([...new Set(models.map((m) => m.agent))], ["codex"]);
});

test("a source from a file or a link becomes a note and a task that weaves it, citing the note", async () => {
    const { cfg, call, upload } = await setup();
    const served = createServer((req, res) => {
        const [type, body] =
            req.url === "/docs/guide"
                ? ["text/html; charset=utf-8", "<h1>Guide</h1>"]
                : req.url === "/logo"
                  ? ["image/png", "png"]
                  : req.url === "/huge"
                    ? ["text/plain", "A".repeat(UPLOAD_MAX + 1)]
                    : ["text/plain", ""];
        res.writeHead(req.url === "/gone" ? 404 : 200, { "content-type": type });
        res.end(body);
    });
    servers.push(served);
    await new Promise<void>((resolve) => served.listen(0, "127.0.0.1", resolve));
    const site = `http://127.0.0.1:${(served.address() as AddressInfo).port}`;

    const id = await upload("notes.md", Buffer.from("# Notes\nUse pnpm."));
    const off = await call("POST", "/api/repos/demo/memory/sources", { upload: id });
    assert.deepEqual([off.status, off.json.code], [409, "memory.off"]);
    await call("PATCH", "/api/repos/demo/settings", { memory: true });
    const filed = await call("POST", "/api/repos/demo/memory/sources", { upload: id });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    assert.match(filed.json.note.text, /^Source: notes\.md \(/);
    assert.equal(filed.json.task.title, "Ingest notes.md");
    assert.match(filed.json.task.body, new RegExp(`note ${filed.json.note.id} records it`));
    assert.deepEqual(filed.json.task.attachments, ["notes.md"]);
    assert.equal(
        readFileSync(join(attachmentsDir(cfg, filed.json.task.id), "notes.md"), "utf8"),
        "# Notes\nUse pnpm.",
    );

    const linked = await call("POST", "/api/repos/demo/memory/sources", {
        url: `${site}/docs/guide`,
    });
    assert.equal(linked.status, 201, JSON.stringify(linked.json));
    assert.match(linked.json.note.text, new RegExp(`^Source: ${site}/docs/guide \\(text/html`));
    assert.deepEqual(linked.json.task.attachments, ["guide.html"]);
    const file = join(attachmentsDir(cfg, linked.json.task.id), "guide.html");
    assert.equal(readFileSync(file, "utf8"), "<h1>Guide</h1>");

    const refused: [object, number, string][] = [
        [{}, 400, "memory.sourceMissing"],
        [{ url: `${site}/docs/guide`, upload: id }, 400, "memory.sourceMissing"],
        [{ url: "ftp://example.com/x" }, 400, "memory.invalidSourceUrl"],
        [{ upload: "0".repeat(24) }, 400, "task.uploadExpired"],
        [{ url: `${site}/logo` }, 400, "memory.sourceType"],
        [{ url: `${site}/huge` }, 413, "memory.sourceTooLarge"],
        [{ url: `${site}/gone` }, 502, "memory.sourceFetch"],
    ];
    for (const [body, status, code] of refused) {
        const res = await call("POST", "/api/repos/demo/memory/sources", body);
        assert.deepEqual([res.status, res.json.code], [status, code], JSON.stringify(body));
    }
});
