import assert from "node:assert/strict";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { createApi } from "../src/api.ts";
import { ensureSandbox } from "../src/clones.ts";
import { loadConfig } from "../src/config.ts";
import { must } from "../src/proc.ts";
import { noSettings, projectEnv, settingsFrom } from "../src/project.ts";
import { notifyJob } from "../src/webhooks.ts";
import { openStore } from "./fixtures.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "olimp-project-")));
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const json = { "content-type": "application/json" };

async function setup() {
    const home = mkdtempSync(join(root, "home-"));
    const folder = join(home, "site");
    await must("git", ["init", "-q", "-b", "main", folder]);
    await must("git", ["-C", folder, "commit", "-q", "--allow-empty", "-m", "init"]);
    const store = await openStore(home);
    await store.addRepo("site", "main", folder, null);
    const cfg = loadConfig({ OLIMP_HOME: home, HOME: join(home, "agent-home") });
    const server = createApi(store, cfg);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const call = (method: string, path: string, body?: object) =>
        new Promise<{ status: number; json: Record<string, unknown> & unknown[] }>(
            (resolve, reject) => {
                const req = request(
                    {
                        host: "127.0.0.1",
                        port,
                        method,
                        path,
                        headers: { host: `127.0.0.1:${port}`, ...(method === "GET" ? {} : json) },
                    },
                    (res) => {
                        let data = "";
                        res.on("data", (chunk) => {
                            data += chunk;
                        });
                        res.on("end", () =>
                            resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) }),
                        );
                    },
                );
                req.on("error", reject);
                req.end(body ? JSON.stringify(body) : undefined);
            },
        );
    return { home, folder, store, cfg, call };
}

test("a fresh installation gets a sandbox project once, and a removed one stays gone", async () => {
    const home = mkdtempSync(join(root, "fresh-"));
    const cfg = loadConfig({ OLIMP_HOME: home, HOME: join(home, "agent-home") });
    const store = await openStore(home);
    const repo = await ensureSandbox(store, cfg);
    assert.deepEqual([repo?.id, repo?.github, repo?.defaultBranch], ["sandbox", null, "main"]);
    const dir = join(cfg.projectsDir, "sandbox");
    assert.equal(await must("git", ["-C", dir, "log", "--format=%s"]), "Sandbox to try OLIMP");
    // Without a knowledge base, as every new project, it has no memory upkeep.
    assert.deepEqual(await store.automations(), []);
    assert.equal(await ensureSandbox(store, cfg), null);
    await store.deleteRepo("sandbox");
    assert.equal(await ensureSandbox(store, cfg), null);
    assert.deepEqual(await store.repos(), []);
});

test("pull request review needs a project on GitHub", async () => {
    const { call } = await setup();
    const refused = await call("PATCH", "/api/repos/site/settings", { prReview: true });
    assert.equal(refused.status, 400);
    assert.equal(refused.json.code, "github.localProject");
});

test("a project names other projects as its knowledge areas", async () => {
    const { call, store } = await setup();
    await store.addRepo("kb", "main", null, null);
    const saved = await call("PATCH", "/api/repos/site/settings", { areas: ["kb", "kb"] });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual((saved.json.settings as { areas: string[] }).areas, ["kb"]);
    for (const [areas, code] of [
        [["site"], "project.unknownArea"],
        [["nope"], "project.unknownArea"],
        [["Not An Id"], "project.invalidAreas"],
        ["kb", "project.invalidAreas"],
        [["a", "b", "c", "d", "e", "f"], "project.invalidAreas"],
    ] as const) {
        const refused = await call("PATCH", "/api/repos/site/settings", { areas });
        assert.deepEqual([refused.status, refused.json.code], [400, code], JSON.stringify(areas));
    }
    assert.deepEqual((await store.repo("site"))?.settings.areas, ["kb"]);
});

test("a project's own settings change field by field, and the composer's default follows", async () => {
    const { call } = await setup();
    const fresh = await call("GET", "/api/repos/site");
    assert.deepEqual(fresh.json.settings, noSettings());
    // The last finished worktrees stay, so a finished task still has its terminal.
    assert.equal(fresh.json.settings.keepWorktrees, 10);
    const saved = await call("PATCH", "/api/repos/site/settings", {
        instructions: "  Answer in Polish.  ",
        workspace: "checkout",
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.settings, {
        ...noSettings(),
        instructions: "Answer in Polish.",
        workspace: "checkout",
    });
    const kept = await call("PATCH", "/api/repos/site/settings", { keepWorktrees: 3 });
    assert.equal((kept.json.settings as { workspace: string }).workspace, "checkout");
    for (const [body, code] of [
        [{ workspace: "elsewhere" }, "project.invalidWorkspace"],
        [{ keepWorktrees: -1 }, "project.invalidKeep"],
        [{ keepWorktrees: 1.5 }, "project.invalidKeep"],
        [{ instructions: 7 }, "instructions.invalid"],
    ] as const) {
        const refused = await call("PATCH", "/api/repos/site/settings", body);
        assert.deepEqual([refused.status, refused.json.code], [400, code]);
    }
    // Without `worktree` the task takes the project's checkout; dispatch still needs a worktree.
    const task = await call("POST", "/api/tasks", { repo: "site", title: "Here", body: "" });
    assert.equal(task.status, 201, JSON.stringify(task.json));
    assert.equal(task.json.workspace, "checkout");
    const own = await call("POST", "/api/tasks", {
        repo: "site",
        title: "Own",
        body: "",
        worktree: true,
    });
    assert.equal(own.json.workspace, "worktree");
    const missing = await call("PATCH", "/api/repos/nope/settings", { keepWorktrees: 1 });
    assert.equal(missing.status, 404);
    const broken = await call("PATCH", "/api/repos/site/settings", {
        worktreeScripts: { afterCreate: [{ name: "Install", command: "if then fi" }] },
    });
    assert.deepEqual([broken.status, broken.json.code], [400, "worktree.invalidScript"]);
    assert.match(broken.json.error as string, /^Script Install is not valid Bash: /);
    for (const worktreeScripts of [
        { afterCreate: [{ command: "  " }] },
        { beforeRemove: [{ command: "true", timeoutSeconds: 0 }] },
        { afterCreate: "pnpm install" },
    ]) {
        const refused = await call("PATCH", "/api/repos/site/settings", { worktreeScripts });
        assert.equal(refused.json.code, "worktree.invalidScripts", JSON.stringify(worktreeScripts));
    }
    const flags = await call("PATCH", "/api/repos/site/settings", { teamSkills: "no" });
    assert.equal(flags.json.code, "field.invalidBoolean");
});

test("the default skill is stored canonical, and team skills can be left out of the list", async () => {
    const { folder, call } = await setup();
    mkdirSync(join(folder, ".claude/skills/tidy"), { recursive: true });
    writeFileSync(
        join(folder, ".claude/skills/tidy/SKILL.md"),
        "---\nname: tidy\ndescription: Tidy up\n---\nDo it.\n",
    );
    const saved = await call("PATCH", "/api/repos/site/settings", {
        defaultSkill: "./tidy",
        teamSkills: false,
        draftPr: true,
        worktreeScripts: {
            afterCreate: [
                {
                    name: " Install ",
                    command: "pnpm install --frozen-lockfile && cp .env.example .env",
                },
            ],
            beforeRemove: [{ command: "docker compose down", timeoutSeconds: 60 }],
        },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    const settings = saved.json.settings as Record<string, unknown>;
    assert.deepEqual(
        [settings.defaultSkill, settings.teamSkills, settings.draftPr, settings.worktreeScripts],
        [
            "./tidy",
            false,
            true,
            {
                afterCreate: [
                    {
                        name: "Install",
                        command: "pnpm install --frozen-lockfile && cp .env.example .env",
                        timeoutSeconds: null,
                    },
                ],
                beforeRemove: [{ name: "", command: "docker compose down", timeoutSeconds: 60 }],
            },
        ],
    );
    const unknown = await call("PATCH", "/api/repos/site/settings", { defaultSkill: "./nope" });
    assert.equal(unknown.status, 400);
    const cleared = await call("PATCH", "/api/repos/site/settings", { defaultSkill: null });
    assert.equal((cleared.json.settings as { defaultSkill: null }).defaultSkill, null);
    const skills = await call("GET", "/api/skills?repo=site");
    assert.deepEqual(
        (skills.json as { id: string }[]).map((s) => s.id),
        ["./tidy"],
    );
});

test("integrations show the references nothing fills, and secrets the integrations using them", async () => {
    const { call } = await setup();
    const added = await call("POST", "/api/repos/site/integrations", {
        name: "sentry",
        kind: "http",
        url: "https://mcp.sentry.dev/mcp",
        headers: { Authorization: `Bearer \${E2E_PROJECT_TOKEN}`, "X-Org": `\${HOME}` },
    });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    const before = await call("GET", "/api/repos/site/integrations");
    assert.deepEqual((before.json as { missing: string[] }[])[0]?.missing, ["E2E_PROJECT_TOKEN"]);
    await call("PUT", "/api/repos/site/secrets/E2E_PROJECT_TOKEN", { value: "t0ken" });
    const after = await call("GET", "/api/repos/site/integrations");
    assert.deepEqual((after.json as { missing: string[] }[])[0]?.missing, []);
    const secrets = await call("GET", "/api/repos/site/secrets");
    assert.deepEqual((secrets.json as { usedBy: string[] }[])[0]?.usedBy, ["sentry"]);
});

test("secrets are listed by name only, sealed in the database, and fill the project's env", async () => {
    const { store, cfg, call } = await setup();
    const saved = await call("PUT", "/api/repos/site/secrets/SENTRY_TOKEN", { value: "s3cr3t" });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(
        (saved.json as { name: string }[]).map((s) => s.name),
        ["SENTRY_TOKEN"],
    );
    assert.equal(JSON.stringify(saved.json).includes("s3cr3t"), false);
    const stored = await store.secrets("site");
    assert.ok(stored.SENTRY_TOKEN?.value.startsWith("v1."));
    assert.equal(JSON.stringify(stored).includes("s3cr3t"), false);
    assert.equal((await projectEnv(store, cfg, "site", {})).SENTRY_TOKEN, "s3cr3t");
    assert.equal(
        JSON.stringify((await call("GET", "/api/repos/site")).json).includes("v1."),
        false,
    );
    for (const name of ["PATH", "OLIMP_HOME", "ANTHROPIC_API_KEY", "1TOKEN"]) {
        const refused = await call("PUT", `/api/repos/site/secrets/${name}`, { value: "x" });
        assert.deepEqual([refused.status, refused.json.code], [400, "secret.invalidName"], name);
    }
    const empty = await call("PUT", "/api/repos/site/secrets/OTHER", { value: "" });
    assert.equal(empty.json.code, "secret.invalidValue");
    const deleted = await call("DELETE", "/api/repos/site/secrets/SENTRY_TOKEN");
    assert.deepEqual(deleted.json, []);
    const again = await call("DELETE", "/api/repos/site/secrets/SENTRY_TOKEN");
    assert.deepEqual([again.status, again.json.code], [404, "secret.notFound"]);
});

test("webhooks keep their address sealed and post a job's end in their format", async () => {
    const { store, cfg, call } = await setup();
    const plain = await call("POST", "/api/repos/site/webhooks", {
        name: "Team",
        url: "http://hooks.example/x",
    });
    assert.deepEqual([plain.status, plain.json.code], [400, "webhook.invalidUrl"]);
    const url = "https://hooks.slack.com/services/T0/B0/token";
    const added = await call("POST", "/api/repos/site/webhooks", {
        name: "Team",
        url,
        format: "slack",
    });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.equal(added.json.host, "hooks.slack.com");
    assert.deepEqual(added.json.events, ["done", "failed"]);
    assert.equal(JSON.stringify(added.json).includes("token"), false);
    assert.equal(JSON.stringify(await store.webhooks("site")).includes("token"), false);
    const id = added.json.id as string;
    const off = await call("POST", "/api/repos/site/webhooks", {
        name: "Off",
        url: "https://example.com/hook",
        enabled: false,
    });
    assert.equal(off.status, 201);

    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fetch = mock.method(globalThis, "fetch", async (to: string, init: RequestInit) => {
        sent.push({ url: to, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 200 });
    });
    try {
        const tested = await call("POST", `/api/repos/site/webhooks/${id}/test`);
        assert.equal((tested.json.last as { ok: boolean }).ok, true);
        assert.equal(sent[0]?.url, url);
        assert.match(String(sent[0]?.body.text), /OLIMP test message for project site/);

        const task = await store.createTask({ repo: "site", title: "Ship it", body: "" });
        await notifyJob(store, cfg, "task", task.id);
        assert.equal(sent.length, 1, "a queued task is not reported");
        await store.update(task.id, { status: "done", prUrl: "https://github.com/a/b/pull/1" });
        await notifyJob(store, cfg, "task", task.id);
        assert.equal(sent.length, 2, "only the enabled webhook");
        assert.match(String(sent[1]?.body.text), /^✅ site: “Ship it” finished\. http/);
        assert.match(String(sent[1]?.body.text), /\/tasks\/[0-9a-f]{12}\nhttps:\/\/github/);

        await call("PATCH", `/api/repos/site/webhooks/${id}`, { automations: false });
        const scheduled = await store.createTask({
            repo: "site",
            title: "Nightly",
            body: "",
            automation: "aaaaaaaaaaaa",
        });
        await store.update(scheduled.id, { status: "done" });
        await notifyJob(store, cfg, "task", scheduled.id);
        assert.equal(sent.length, 2, "an automation's job is left out");
        await call("PATCH", `/api/repos/site/webhooks/${id}`, { events: ["failed"] });
        await notifyJob(store, cfg, "task", task.id);
        assert.equal(sent.length, 2, "done is no longer one of its events");
    } finally {
        fetch.mock.restore();
    }
    const listed = await call("GET", "/api/repos/site/webhooks");
    assert.deepEqual(
        (listed.json as { name: string }[]).map((h) => h.name),
        ["Team", "Off"],
    );
    const bad = await call("PATCH", `/api/repos/site/webhooks/${id}`, { events: [] });
    assert.equal(bad.json.code, "webhook.invalidEvents");
    assert.equal((await call("DELETE", `/api/repos/site/webhooks/${id}`)).status, 200);
    const gone = await call("POST", `/api/repos/site/webhooks/${id}/test`);
    assert.deepEqual([gone.status, gone.json.code], [404, "webhook.notFound"]);
});

test("an ntfy webhook posts to its server's root with the topic and its sealed token", async () => {
    const { store, cfg, call } = await setup();
    const noTopic = await call("POST", "/api/repos/site/webhooks", {
        name: "Phone",
        url: "https://ntfy.sh/",
        format: "ntfy",
    });
    assert.deepEqual([noTopic.status, noTopic.json.code], [400, "webhook.invalidTopic"]);
    const spaced = await call("POST", "/api/repos/site/webhooks", {
        name: "Phone",
        url: "https://ntfy.example/ntfy/olimp-x7",
        format: "ntfy",
        token: "tk 1",
    });
    assert.deepEqual([spaced.status, spaced.json.code], [400, "webhook.invalidToken"]);
    const added = await call("POST", "/api/repos/site/webhooks", {
        name: "Phone",
        url: "https://ntfy.example/ntfy/olimp-x7",
        format: "ntfy",
        token: "tk_secret",
        events: ["failed", "waiting"],
    });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual([added.json.host, added.json.hasToken], ["ntfy.example", true]);
    assert.equal(JSON.stringify(added.json).includes("tk_secret"), false);
    const stored = JSON.stringify(await store.webhooks("site"));
    assert.equal(stored.includes("tk_secret") || stored.includes("olimp-x7"), false);
    const id = added.json.id as string;

    const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
        [];
    const fetch = mock.method(globalThis, "fetch", async (to: string, init: RequestInit) => {
        sent.push({
            url: to,
            headers: init.headers as Record<string, string>,
            body: JSON.parse(String(init.body)),
        });
        return new Response(null, { status: 200 });
    });
    try {
        const task = await store.createTask({ repo: "site", title: "Ship it", body: "" });
        await store.update(task.id, { status: "failed", error: "tests failed" });
        await notifyJob(store, cfg, "task", task.id);
        assert.equal(sent[0]?.url, "https://ntfy.example/ntfy/");
        assert.equal(sent[0]?.headers.authorization, "Bearer tk_secret");
        const { message, click, ...rest } = sent[0]?.body ?? {};
        assert.deepEqual(rest, { topic: "olimp-x7", title: "OLIMP", tags: ["x"], priority: 4 });
        assert.match(String(message), /^❌ site: “Ship it” failed\. http.*\ntests failed$/);
        assert.match(String(click), new RegExp(`/tasks/${task.id}$`));

        const kept = await call("PATCH", `/api/repos/site/webhooks/${id}`, { name: "Mine" });
        assert.equal(kept.json.hasToken, true);
        const dropped = await call("PATCH", `/api/repos/site/webhooks/${id}`, { token: "" });
        assert.equal(dropped.json.hasToken, false);
        await call("POST", `/api/repos/site/webhooks/${id}/test`);
        assert.equal(sent[1]?.headers.authorization, undefined);
        assert.deepEqual(sent[1]?.body.tags, ["wave"]);
    } finally {
        fetch.mock.restore();
    }
    // A token belongs to ntfy alone: another format drops it.
    await call("PATCH", `/api/repos/site/webhooks/${id}`, { token: "tk_again" });
    const json = await call("PATCH", `/api/repos/site/webhooks/${id}`, { format: "json" });
    assert.equal(json.json.hasToken, false);
    const back = await call("PATCH", `/api/repos/site/webhooks/${id}`, {
        format: "ntfy",
        url: "https://ntfy.example/a/",
    });
    assert.equal(back.json.code, "webhook.invalidTopic");
});

test("agent config files are read and written in the project's folder and the caller's HOME", async () => {
    const { home, folder, call } = await setup();
    const listed = await call("GET", "/api/repos/site/agent-config");
    const settings = (
        listed.json.files as { id: string; path: string; scope: string; exists: boolean }[]
    ).find((f) => f.id === "claude.project.settings");
    assert.deepEqual(
        [settings?.path, settings?.scope, settings?.exists],
        [".claude/settings.json", "project", false],
    );
    const broken = await call("PUT", "/api/repos/site/agent-config/claude.project.settings", {
        content: "{ nope",
    });
    assert.deepEqual([broken.status, broken.json.code], [400, "agentConfig.invalidJson"]);
    const written = await call("PUT", "/api/repos/site/agent-config/claude.project.settings", {
        content: '{ "model": "opus" }\n',
    });
    assert.equal(written.status, 200, JSON.stringify(written.json));
    assert.equal(
        readFileSync(join(folder, ".claude/settings.json"), "utf8"),
        '{ "model": "opus" }\n',
    );
    const read = await call("GET", "/api/repos/site/agent-config/claude.project.settings");
    assert.deepEqual([read.json.exists, read.json.content], [true, '{ "model": "opus" }\n']);
    // TOML is written as given; the user scope is the caller's HOME.
    const toml = await call("PUT", "/api/repos/site/agent-config/codex.user.config", {
        content: 'model = "gpt-5"\n',
    });
    assert.equal(toml.status, 200);
    assert.equal(
        readFileSync(join(home, "agent-home/.codex/config.toml"), "utf8"),
        'model = "gpt-5"\n',
    );
    // pi's settings, not its keys.
    const pi = (listed.json.files as { id: string; agents: string[] }[])
        .filter((f) => f.agents.includes("pi"))
        .map((f) => f.id);
    assert.deepEqual(pi, [
        "project.agents",
        "pi.user.settings",
        "pi.project.settings",
        "pi.user.memory",
    ]);
    const unknown = await call("GET", "/api/repos/site/agent-config/claude.nope");
    assert.deepEqual([unknown.status, unknown.json.code], [404, "agentConfig.notFound"]);
    // A link out of the project is never followed.
    const outside = join(home, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(folder, ".cursor"));
    const escaped = await call("PUT", "/api/repos/site/agent-config/cursor.project.mcp", {
        content: "{}",
    });
    assert.deepEqual([escaped.status, escaped.json.code], [400, "agentConfig.outsideProject"]);
    writeFileSync(join(outside, "secret.md"), "outside\n");
    symlinkSync(join(outside, "secret.md"), join(folder, "AGENTS.md"));
    const linked = await call("GET", "/api/repos/site/agent-config/project.agents");
    assert.equal(linked.json.code, "agentConfig.outsideProject");
    const blocked = (await call("GET", "/api/repos/site/agent-config")).json.files as {
        id: string;
        blocked: boolean;
    }[];
    assert.deepEqual(
        blocked.filter((f) => f.blocked).map((f) => f.id),
        ["project.agents", "cursor.project.settings", "cursor.project.mcp"],
    );
    const states = new Map(
        (blocked as unknown as { id: string; git: string | null }[]).map((f) => [f.id, f.git]),
    );
    assert.equal(states.get("claude.project.settings"), "untracked");
    assert.equal(states.get("claude.user.settings"), null);
    await must("git", ["-C", folder, "add", ".claude/settings.json"]);
    await must("git", ["-C", folder, "commit", "-q", "-m", "settings"]);
    const committed = (await call("GET", "/api/repos/site/agent-config")).json.files as {
        id: string;
        git: string | null;
    }[];
    assert.equal(committed.find((f) => f.id === "claude.project.settings")?.git, "committed");
    writeFileSync(join(folder, ".claude/settings.json"), "{}\n");
    const changed = (await call("GET", "/api/repos/site/agent-config")).json.files as {
        id: string;
        git: string | null;
        docs: string;
    }[];
    const file = changed.find((f) => f.id === "claude.project.settings");
    assert.deepEqual(
        [file?.git, file?.docs],
        ["modified", "https://code.claude.com/docs/en/settings"],
    );
});

test("the local layer is listed as git-ignored, and Claude's MCP servers only by name", async () => {
    const { home, folder, call } = await setup();
    writeFileSync(join(folder, ".gitignore"), "CLAUDE.local.md\n");
    const written = await call("PUT", "/api/repos/site/agent-config/claude.local.memory", {
        content: "Mine only.\n",
    });
    assert.equal(written.status, 200, JSON.stringify(written.json));
    mkdirSync(join(home, "agent-home"), { recursive: true });
    writeFileSync(
        join(home, "agent-home/.claude.json"),
        JSON.stringify({
            mcpServers: { jarvis: { env: { TOKEN: "secret" } } },
            projects: {
                [folder]: { mcpServers: { corivo: {} } },
                "/other": { mcpServers: { x: {} } },
            },
        }),
    );
    const listed = (await call("GET", "/api/repos/site/agent-config")).json;
    const local = (
        listed.files as { id: string; scope: string; seeded: boolean; git: string }[]
    ).find((f) => f.id === "claude.local.memory");
    assert.deepEqual([local?.scope, local?.seeded, local?.git], ["local", true, "ignored"]);
    assert.deepEqual(listed.mcpServers, { user: ["jarvis"], local: ["corivo"] });
    assert.doesNotMatch(JSON.stringify(listed), /secret/);
});

test("a project's worktrees on disk are listed with their job and removed when idle", async () => {
    const { home, folder, store, call } = await setup();
    const task = await store.createTask({ repo: "site", title: "Kept", body: "" });
    const tree = join(home, "worktrees", task.id);
    await must("git", ["-C", folder, "worktree", "add", "-q", "-b", `olimp/${task.id}`, tree]);
    // A worktree outside OLIMP's folder is the user's own.
    await must("git", ["-C", folder, "worktree", "add", "-q", "-b", "mine", join(home, "mine")]);
    const listed = await call("GET", "/api/repos/site/worktrees");
    assert.deepEqual(
        (listed.json as { id: string; branch: string; active: boolean; job: object }[]).map((w) => [
            w.id,
            w.branch,
            w.active,
            w.job,
        ]),
        [[task.id, `olimp/${task.id}`, false, { kind: "task", title: "Kept", status: "queued" }]],
    );
    assert.equal(typeof (listed.json as { bytes: number }[])[0]?.bytes, "number");
    // Reclaim keeps as many as the project keeps: one here, none after.
    const other = await store.createTask({ repo: "site", title: "Older", body: "" });
    await must("git", [
        "-C",
        folder,
        "worktree",
        "add",
        "-q",
        "-b",
        `olimp/${other.id}`,
        join(home, "worktrees", other.id),
    ]);
    await call("PATCH", "/api/repos/site/settings", { keepWorktrees: 1 });
    const reclaimed = await call("POST", "/api/repos/site/worktrees/reclaim");
    assert.equal((reclaimed.json as unknown[]).length, 1);
    await call("PATCH", "/api/repos/site/settings", { keepWorktrees: 0 });
    assert.equal(
        ((await call("POST", "/api/repos/site/worktrees/reclaim")).json as unknown[]).length,
        1,
    );
    assert.deepEqual((await call("GET", "/api/repos/site/worktrees")).json, []);
    await must("git", ["-C", folder, "worktree", "add", "-q", tree, `olimp/${task.id}`]);
    assert.equal((await call("DELETE", `/api/repos/site/worktrees/${task.id}`)).status, 200);
    assert.deepEqual((await call("GET", "/api/repos/site/worktrees")).json, []);
    const missing = await call("DELETE", `/api/repos/site/worktrees/${task.id}`);
    assert.deepEqual([missing.status, missing.json.code], [404, "worktree.notFound"]);
});

test("settings saved with plain setup commands read back as setup scripts", () => {
    const settings = settingsFrom('{"setupCommands":["pnpm install"],"draftPr":true}');
    assert.deepEqual(settings.worktreeScripts, {
        afterCreate: [{ name: "", command: "pnpm install", timeoutSeconds: null }],
        beforeRemove: [],
    });
    assert.equal(settings.draftPr, true);
    assert.equal("setupCommands" in settings, false);
});
