import assert from "node:assert/strict";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { githubLogin } from "../src/clones.ts";
import { loadConfig } from "../src/config.ts";
import { issueStepToken, revokeStepToken } from "../src/memory.ts";
import { must } from "../src/proc.ts";
import { loadSettings } from "../src/settings.ts";
import { type Automation, Store, type Workflow } from "../src/store.ts";
import { bareRepo, commitFiles, fakeGh, openStore, ref, script } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-api-"));
const skill = (description: string) => `---\nname: x\ndescription: ${description}\n---\nDo it.\n`;
const skills = await bareRepo(root, "skills", {
    "skills/tidy/SKILL.md": skill("Tidy up"),
    "skills/review/SKILL.md": "---\ndescription: >\n  Review the\n  change\n---\n",
    "skills/notes.md": "not a skill\n",
});
const more = await bareRepo(root, "more", {
    "skills/tidy/SKILL.md": skill("Other tidy"),
    "skills/docs/SKILL.md": skill("Write docs"),
});
const gone = await bareRepo(root, "gone", {
    "skills/old/SKILL.md": skill("Old"),
    "plugins/x/skills/old/SKILL.md": skill("Deeper old"),
    "plugins/x/skills/deep/SKILL.md": skill("Deep"),
});
const fresh = await bareRepo(root, "fresh", { "skills/old/SKILL.md": skill("Old") });
const gh = fakeGh(root, {
    "acme/skills": skills.bare,
    "acme/more": more.bare,
    "acme/gone": gone.bare,
    "acme/fresh": fresh.bare,
});
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const json = { "content-type": "application/json" };

// Databases from before numbered migrations only exist in SQLite.
const sqlite = (home: string) => Store.open({ home, databaseUrl: null });

function client(port: number) {
    return (
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
                    headers: { host: `127.0.0.1:${port}`, ...headers },
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
}

// Every test gets its own database and API server, so it passes alone and in any order; the bare
// repositories above are shared because no test writes to them.
async function setup(sources: string[] = [], env: Record<string, string> = {}) {
    const home = mkdtempSync(join(root, "home-"));
    const store = await openStore(home);
    await store.addRepo("demo", "main", null, "acme/demo");
    const server = createApi(store, {
        ...loadConfig({ OLIMP_HOME: home, HOME: join(home, "agent-home"), ...env }),
        gh,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const call = client(port);
    const list = async (path: string) => (await call("GET", path)).json as unknown as object[];
    const ids = async (path: string) =>
        (await list(path)).map((item) => (item as { id: string }).id);
    for (const repo of sources)
        assert.equal((await call("POST", "/api/skill-sources", json, { repo })).status, 201);
    return { home, store, port, call, list, ids };
}

test("a GitHub repository is cloned into a folder of its own, also from its address", async () => {
    const { call, home } = await setup();
    const projects = join(home, "projects");
    const cloned = await call("POST", "/api/repos", json, {
        repo: "https://github.com/acme/skills.git",
        folder: "sk",
    });
    assert.equal(cloned.status, 201, JSON.stringify(cloned.json));
    assert.deepEqual([cloned.json.id, cloned.json.github], ["sk", "acme/skills"]);
    assert.equal(cloned.json.path, join(projects, "sk"));
    assert.ok(existsSync(join(projects, "sk", ".git")));
    // Registered again it is fetched in its folder; a folder that exists is never reused.
    const again = await call("POST", "/api/repos", json, { repo: "acme/skills" });
    assert.deepEqual([again.json.id, again.json.path], ["sk", join(projects, "sk")]);
    const taken = await call("POST", "/api/repos", json, { repo: "acme/more", folder: "sk" });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.code, "repo.folderExists");
    const named = await call("POST", "/api/repos", json, { repo: "git@github.com:acme/more" });
    assert.deepEqual([named.json.id, named.json.path], ["more", join(projects, "more")]);
    for (const body of [
        { repo: "acme/gone", folder: ".." },
        { repo: "acme/gone", folder: "a/b" },
        { repo: "https://gitlab.com/acme/gone" },
    ])
        assert.equal(
            (await call("POST", "/api/repos", json, body)).status,
            400,
            JSON.stringify(body),
        );
});

test("the folder picker lists visible subfolders inside its root and nothing outside", async () => {
    const browse = mkdtempSync(join(root, "browse-"));
    const outside = mkdtempSync(join(root, "outside-"));
    mkdirSync(join(browse, "b", ".git"), { recursive: true });
    mkdirSync(join(browse, "a", "deeper"), { recursive: true });
    mkdirSync(join(browse, ".hidden"));
    writeFileSync(join(browse, "file.txt"), "");
    symlinkSync(outside, join(browse, "out"));
    const { call } = await setup([], { OLIMP_BROWSE_ROOT: browse });
    const real = realpathSync(browse);
    const top = await call("GET", "/api/folders");
    assert.equal(top.status, 200, JSON.stringify(top.json));
    assert.equal(top.json.path, real);
    assert.equal(top.json.parent, null);
    assert.deepEqual(top.json.folders, [
        { name: "a", path: join(real, "a"), git: false },
        { name: "b", path: join(real, "b"), git: true },
    ]);
    const a = await call("GET", `/api/folders?path=${encodeURIComponent(join(real, "a"))}`);
    assert.equal(a.json.parent, real);
    assert.deepEqual(
        (a.json.folders as { name: string }[]).map((folder) => folder.name),
        ["deeper"],
    );
    for (const path of [outside, join(browse, "out"), join(browse, ".."), "a", join(browse, "x")]) {
        const refused = await call("GET", `/api/folders?path=${encodeURIComponent(path)}`);
        assert.equal(refused.json.code, "folder.outsideRoot", path);
    }
});

test("the folder picker creates a new folder inside its root, once and with a plain name", async () => {
    const browse = mkdtempSync(join(root, "create-"));
    const outside = mkdtempSync(join(root, "outside-"));
    const { call } = await setup([], { OLIMP_BROWSE_ROOT: browse });
    const real = realpathSync(browse);
    const created = await call("POST", "/api/folders", json, { path: browse, folder: "kb" });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.path, join(real, "kb"));
    assert.equal(created.json.parent, real);
    assert.deepEqual(created.json.folders, []);
    const again = await call("POST", "/api/folders", json, { path: browse, folder: "kb" });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, "repo.folderExists");
    for (const folder of ["..", "a/b", "", 7])
        assert.equal(
            (await call("POST", "/api/folders", json, { path: browse, folder })).json.code,
            "repo.invalidFolder",
            String(folder),
        );
    const refused = await call("POST", "/api/folders", json, { path: outside, folder: "x" });
    assert.equal(refused.json.code, "folder.outsideRoot");
    assert.equal(existsSync(join(outside, "x")), false);
});

test("any local folder is a project, on GitHub when its origin is, named after the folder", async () => {
    const browse = mkdtempSync(join(root, "local-"));
    const github = "https://github.com/acme/more.git";
    const checkout = async (name: string, origin: string | null) => {
        const dir = join(browse, name);
        await must("git", ["clone", "-q", more.bare, dir]);
        if (origin) await must("git", ["-C", dir, "remote", "set-url", "origin", origin]);
        // Fetching the GitHub address reaches the local bare repository.
        await must("git", ["-C", dir, "config", `url.${more.bare}.insteadOf`, github]);
        return dir;
    };
    const mine = await checkout("mine", github);
    const { call, store } = await setup([], { OLIMP_BROWSE_ROOT: browse });
    const added = await call("POST", "/api/repos", json, { path: mine });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.deepEqual(
        [added.json.id, added.json.github, added.json.git],
        ["mine", "acme/more", true],
    );
    assert.equal((await store.repo("mine"))?.path, realpathSync(mine));
    mkdirSync(join(browse, "Plain Folder"));
    writeFileSync(join(browse, "Plain Folder", "notes.txt"), "kept as it is\n");
    const plain = await call("POST", "/api/repos", json, { path: join(browse, "Plain Folder") });
    assert.deepEqual(
        [plain.json.id, plain.json.github, plain.json.git, plain.json.defaultBranch],
        ["plain-folder", null, false, ""],
    );
    const local = await call("POST", "/api/repos", json, { path: await checkout("local", null) });
    assert.deepEqual([local.json.id, local.json.github, local.json.git], ["local", null, true]);
    const twice = await call("POST", "/api/repos", json, { path: join(browse, "Plain Folder") });
    assert.equal(twice.json.id, "plain-folder");
    for (const [path, code] of [
        [await checkout("copy", github), "repo.otherFolder"],
        [root, "folder.outsideRoot"],
    ]) {
        const refused = await call("POST", "/api/repos", json, { path });
        assert.equal(refused.json.code, code, path);
    }
});

test("an empty folder becomes a git project; one with files does when an admin asks", async () => {
    const browse = mkdtempSync(join(root, "init-"));
    const { call } = await setup([], { OLIMP_BROWSE_ROOT: browse });
    const files = (dir: string) => must("git", ["-C", dir, "ls-files"]);
    const empty = join(browse, "empty");
    mkdirSync(empty);
    const added = await call("POST", "/api/repos", json, { path: empty });
    assert.deepEqual([added.json.git, added.json.defaultBranch], [true, "main"]);
    assert.equal((await files(empty)).trim(), ".gitignore");

    const site = join(browse, "site");
    mkdirSync(join(site, "node_modules"), { recursive: true });
    writeFileSync(join(site, "index.html"), "<h1>Hi</h1>\n");
    writeFileSync(join(site, ".env"), "SECRET=1\n");
    writeFileSync(join(site, "node_modules", "dep.js"), "\n");
    const folder = await call("POST", "/api/repos", json, { path: site });
    assert.equal(folder.json.git, false);
    const made = await call("POST", `/api/repos/${folder.json.id}/git`, json, {});
    assert.deepEqual([made.json.git, made.json.defaultBranch], [true, "main"]);
    assert.deepEqual((await files(site)).trim().split("\n"), [".gitignore", "index.html"]);
    const again = await call("POST", `/api/repos/${folder.json.id}/git`, json, {});
    assert.deepEqual([again.status, again.json.code], [409, "repo.alreadyGit"]);

    // A repository without a commit gets its first one, so a task's worktree has a start.
    const unborn = join(browse, "unborn");
    mkdirSync(unborn);
    await must("git", ["-C", unborn, "init", "-q", "-b", "trunk"]);
    writeFileSync(join(unborn, "a.txt"), "a\n");
    const fresh = await call("POST", "/api/repos", json, { path: unborn });
    assert.deepEqual([fresh.json.git, fresh.json.defaultBranch], [true, "trunk"]);
    assert.equal(
        (await must("git", ["-C", unborn, "log", "--format=%s"])).trim(),
        "Initial commit",
    );
});

test("the GitHub owners are the gh account and its organizations", async () => {
    const { call } = await setup();
    assert.deepEqual((await call("GET", "/api/github/owners")).json, [
        {
            login: "octo",
            name: "Octo Cat",
            description: null,
            kind: "user",
            avatarUrl: "https://avatars.githubusercontent.com/u/1",
        },
        { login: "acme", name: null, description: "Acme Inc", kind: "org", avatarUrl: null },
    ]);
    assert.deepEqual((await call("GET", "/api/github/status")).json, {
        loggedIn: true,
        login: "octo",
    });
    const signedOut = script(root, "gh-signed-out", "echo 'run gh auth login' >&2; exit 4");
    assert.equal(await githubLogin({ ...loadConfig({ OLIMP_HOME: root }), gh: signedOut }), null);
});

test("tasks can be created and read back", async () => {
    const { call } = await setup();
    const created = await call("POST", "/api/tasks", json, { repo: "demo", title: "Do it" });
    assert.equal(created.status, 201);
    assert.equal(created.json.status, "queued");
    const read = await call("GET", `/api/tasks/${created.json.id}`);
    assert.equal(read.json.title, "Do it");
});

test("a task is archived and restored, and pinned for the installation without accounts", async () => {
    const { call, store } = await setup();
    const a = (await call("POST", "/api/tasks", json, { repo: "demo", title: "A" })).json
        .id as string;
    const b = (await call("POST", "/api/tasks", json, { repo: "demo", title: "B" })).json.id;
    const queued = await call("PUT", `/api/tasks/${a}/archive`, json);
    assert.equal(queued.status, 409);
    assert.equal(queued.json.code, "task.notFinished");
    await store.update(a, { status: "done" });
    const archived = await call("PUT", `/api/tasks/${a}/archive`, json);
    assert.equal(archived.status, 200);
    assert.ok(archived.json.archivedAt);
    assert.equal((await call("DELETE", `/api/tasks/${a}/archive`, json)).json.archivedAt, null);
    assert.deepEqual((await call("PUT", `/api/tasks/${b}/pin`, json)).json, [b]);
    // Pins of one millisecond are ordered by task id, so the second comes a moment later.
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual((await call("PUT", `/api/tasks/${a}/pin`, json)).json, [b, a]);
    // Pinning twice keeps one pin in its place.
    assert.deepEqual((await call("PUT", `/api/tasks/${b}/pin`, json)).json, [b, a]);
    assert.deepEqual((await call("DELETE", `/api/tasks/${b}/pin`, json)).json, [a]);
    assert.deepEqual((await call("GET", "/api/pins")).json, [a]);
    const missing = await call("PUT", "/api/tasks/ffffffffffff/pin", json);
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, "task.notFound");
    assert.deepEqual((await call("PUT", `/api/tasks/${a}/read`, json)).json, {
        tasks: [a],
        runs: [],
    });
    assert.deepEqual((await call("DELETE", `/api/tasks/${a}/read`, json)).json.tasks, []);
    const run = await call("PUT", "/api/workflow-runs/ffffffffffff/read", json);
    assert.equal(run.json.code, "run.notFound");
    assert.deepEqual((await call("GET", "/api/reads")).json, { tasks: [], runs: [] });
});

test("settings are saved, applied at once, survive a restart and reset to the environment", async () => {
    const { home, call, store } = await setup([], { OLIMP_MAX_PARALLEL: "2" });
    const before = (await call("GET", "/api/settings")).json;
    assert.deepEqual(before.saved, []);
    assert.equal((before.values as { maxParallel: number }).maxParallel, 2);
    const folder = mkdtempSync(join(root, "projects-"));
    const saved = await call("PUT", "/api/settings", json, {
        maxParallel: 4,
        taskTimeoutMin: 90,
        projectsDir: folder,
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.values, {
        maxParallel: 4,
        taskTimeoutMin: 90,
        projectsDir: folder,
        browseRoot: (before.values as { browseRoot: string }).browseRoot,
    });
    assert.deepEqual(saved.json.saved, ["maxParallel", "taskTimeoutMin", "projectsDir"]);
    const cfg = loadConfig({ OLIMP_HOME: home });
    await loadSettings(store, cfg);
    assert.equal(cfg.taskTimeoutMs, 90 * 60_000);
    assert.equal(cfg.projectsDir, folder);
    const reset = await call("PUT", "/api/settings", json, { maxParallel: null });
    assert.equal((reset.json.values as { maxParallel: number }).maxParallel, 2);
    assert.deepEqual(reset.json.saved, ["taskTimeoutMin", "projectsDir"]);
    for (const [body, code] of [
        [{ maxParallel: 0 }, "settings.invalidNumber"],
        [{ taskTimeoutMin: 1.5 }, "settings.invalidNumber"],
        [{ projectsDir: "relative/path" }, "settings.invalidFolder"],
        [{ browseRoot: join(root, "missing") }, "settings.invalidFolder"],
    ] as const) {
        const refused = await call("PUT", "/api/settings", json, body);
        assert.equal(refused.status, 400, JSON.stringify(body));
        assert.equal(refused.json.code, code);
    }
});

test("the machine, the agents and the version are reported", async () => {
    const { call } = await setup([], {
        OLIMP_PI: script(root, "pi-cli", 'echo "pi 1.2.3"'),
        OLIMP_JUNIE: script(root, "junie-shim", "echo 'Junie was not found' >&2; exit 127"),
        OLIMP_COPILOT: script(root, "copilot-other", "echo 'Usage: copilot <file>'"),
    });
    const machine = (await call("GET", "/api/machine")).json;
    assert.ok((machine.cores as number) > 0);
    assert.ok((machine.cpu as number) >= 0 && (machine.cpu as number) <= 100);
    const memory = machine.memory as { used: number; total: number };
    assert.ok(memory.used > 0 && memory.used <= memory.total);
    assert.equal((machine.olimp as { running: number }).running, 0);
    const agents = (await call("GET", "/api/agents")).json as unknown as {
        agent: string;
        configEnv: string | null;
        bin: string | null;
        version: string | null;
    }[];
    const of = (name: string) => agents.find((a) => a.agent === name);
    assert.deepEqual([of("pi")?.bin?.endsWith("pi-cli"), of("pi")?.version], [true, "pi 1.2.3"]);
    // A launcher that only says the CLI is missing does not count as installed, nor does another
    // tool called `copilot`.
    assert.deepEqual([of("junie")?.bin, of("junie")?.version], [null, null]);
    assert.equal(of("copilot")?.bin, null);
    assert.deepEqual(
        agents.map((a) => a.agent),
        ["claude", "codex", "copilot", "cursor", "junie", "opencode", "pi"],
    );
    // Only these two keep their login in a folder a variable moves, so only they get second ones.
    assert.deepEqual(
        agents.filter((a) => a.configEnv).map((a) => a.agent),
        ["claude", "codex"],
    );
    const version = (await call("GET", "/api/version")).json;
    assert.match(version.version as string, /^\d+\.\d+\.\d+/);
    const spec = (await call("GET", "/api/openapi.json")).json;
    assert.equal((spec.info as { version: string }).version, version.version);
});

test("tasks run with claude unless codex is chosen", async () => {
    const { call } = await setup();
    const task = { repo: "demo", title: "Do it" };
    const plain = await call("POST", "/api/tasks", json, task);
    assert.equal(plain.json.agent, "claude");
    const codex = await call("POST", "/api/tasks", json, { ...task, agent: "codex" });
    assert.equal(codex.status, 201);
    assert.equal((await call("GET", `/api/tasks/${codex.json.id}`)).json.agent, "codex");
    for (const agent of ["gpt", "", null, 1])
        assert.equal((await call("POST", "/api/tasks", json, { ...task, agent })).status, 400);
});

test("a database from before the agent column gets it with claude for old tasks", async () => {
    const old = mkdtempSync(join(tmpdir(), "olimp-old-"));
    try {
        const db = new DatabaseSync(join(old, "olimp.db"));
        db.exec(`CREATE TABLE repos (id TEXT PRIMARY KEY, default_branch TEXT NOT NULL,
                added_at TEXT NOT NULL);
            CREATE TABLE tasks (id TEXT PRIMARY KEY, repo TEXT NOT NULL, title TEXT NOT NULL,
                body TEXT NOT NULL, status TEXT NOT NULL, branch TEXT, pr_url TEXT, error TEXT,
                log TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            INSERT INTO repos VALUES ('acme/demo', 'main', 'then');
            INSERT INTO tasks (id, repo, title, body, status, created_at, updated_at)
                VALUES ('0123456789ab', 'acme/demo', 'Old', '', 'done', 'then', 'then');`);
        db.close();
        const migrated = await sqlite(old);
        assert.deepEqual(
            await migrated.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        );
        const before = await migrated.task("0123456789ab");
        assert.equal(before?.agent, "claude");
        assert.equal(before?.skill, null);
        assert.equal(before?.automation, null);
        const task = await migrated.createTask({
            repo: "demo",
            title: "New",
            body: "",
            agent: "codex",
        });
        assert.equal(task.agent, "codex");
        assert.equal((await (await sqlite(old)).task(task.id))?.agent, "codex");
    } finally {
        rmSync(old, { recursive: true, force: true });
    }
});

test("bad input is rejected", async () => {
    const { call } = await setup();
    assert.equal(
        (await call("POST", "/api/tasks", json, { repo: "none", title: "x" })).status,
        400,
    );
    assert.equal(
        (await call("POST", "/api/tasks", json, { repo: "demo", title: " " })).status,
        400,
    );
    assert.equal((await call("GET", "/api/tasks/zzz")).status, 404);
});

test("errors carry a stable code and a message in the request's locale", async () => {
    const { call } = await setup();
    const body = { repo: "none", title: "x" };
    const en = await call("POST", "/api/tasks", json, body);
    assert.deepEqual(en.json, {
        error: "Project none is not registered.",
        code: "repo.notRegistered",
    });
    const pl = await call(
        "POST",
        "/api/tasks",
        { ...json, "accept-language": "pl-PL,pl;q=0.9" },
        body,
    );
    assert.equal(pl.status, 400);
    assert.deepEqual(pl.json, {
        error: "Projekt none nie jest zarejestrowany.",
        code: "repo.notRegistered",
    });
    const missing = await call("GET", "/api/tasks/zzz", { "accept-language": "pl" });
    assert.deepEqual(missing.json, { error: "Nie znaleziono.", code: "request.notFound" });
});

test("requests from web pages and foreign hosts are refused", async () => {
    const { call, port } = await setup();
    const body = { repo: "demo", title: "Evil" };
    const foreign = await call(
        "POST",
        "/api/tasks",
        { ...json, origin: "https://evil.example" },
        body,
    );
    assert.equal(foreign.status, 403);
    const rebound = await call(
        "POST",
        "/api/tasks",
        { ...json, host: `evil.example:${port}` },
        body,
    );
    assert.equal(rebound.status, 403);
    assert.equal(
        (await call("POST", "/api/tasks", { "content-type": "text/plain" }, body)).status,
        415,
    );
    const same = await call(
        "POST",
        "/api/tasks",
        { ...json, origin: `http://127.0.0.1:${port}` },
        body,
    );
    assert.equal(same.status, 201);
});

test("skill sources are registered and their skills listed with name, description and source", async () => {
    const { call, list } = await setup();
    assert.deepEqual(await list("/api/skills"), []);
    const added = await call("POST", "/api/skill-sources", json, { repo: "acme/skills" });
    assert.equal(added.status, 201);
    assert.equal(added.json.id, "acme/skills");
    assert.equal(added.json.defaultBranch, "main");
    assert.equal((await call("POST", "/api/skill-sources", json, { repo: "nope" })).status, 400);
    const url = "https://github.com/acme/skills.git";
    const pinned = await call("POST", "/api/skill-sources", json, { repo: url, branch: "main" });
    assert.equal(pinned.json.id, "acme/skills");
    const missing = await call("POST", "/api/skill-sources", json, { repo: url, branch: "nope" });
    assert.equal(missing.json.code, "skill.unknownBranch");
    assert.deepEqual(await list("/api/skills"), [
        {
            id: "acme/skills:review",
            name: "review",
            description: "Review the change",
            source: "acme/skills",
        },
        { id: "acme/skills:tidy", name: "tidy", description: "Tidy up", source: "acme/skills" },
    ]);
    await call("POST", "/api/skill-sources", json, { repo: "acme/more" });
    assert.deepEqual(
        (await list("/api/skill-sources")).map((s) => (s as { id: string }).id),
        ["acme/more", "acme/skills"],
    );
    assert.equal((await list("/api/skills")).length, 4);
});

test("skills are listed as last fetched until the sources are refreshed", async () => {
    const { call, ids, store } = await setup(["acme/fresh"]);
    await commitFiles(fresh.seed, { "skills/new/SKILL.md": skill("New") }, "new");
    await must("git", ["-C", fresh.seed, "push", "-q", fresh.bare, "main"]);
    assert.deepEqual(await ids("/api/skills"), ["acme/fresh:old"]);
    const refreshed = await call("POST", "/api/skill-sources/refresh", json);
    assert.equal(refreshed.status, 200);
    assert.deepEqual(await ids("/api/skills"), ["acme/fresh:new", "acme/fresh:old"]);
    await store.addSkillSource("acme/missing", "main");
    const failed = await call("POST", "/api/skill-sources/refresh", json);
    assert.deepEqual([failed.status, failed.json.code], [502, "skill.refreshFailed"]);
    assert.match(String(failed.json.error), /acme\/missing/);
    assert.deepEqual(await ids("/api/skills"), ["acme/fresh:new", "acme/fresh:old"]);
});

test("a task's skill is resolved to owner/repo:name or refused with a code", async () => {
    const { call } = await setup(["acme/skills", "acme/more"]);
    const task = { repo: "demo", title: "Tidy" };
    const short = await call("POST", "/api/tasks", json, { ...task, skill: "review" });
    assert.equal(short.status, 201);
    assert.equal(short.json.skill, "acme/skills:review");
    assert.equal(
        (await call("GET", `/api/tasks/${short.json.id}`)).json.skill,
        "acme/skills:review",
    );
    const full = await call("POST", "/api/tasks", json, { ...task, skill: "acme/more:tidy" });
    assert.equal(full.json.skill, "acme/more:tidy");
    assert.equal((await call("POST", "/api/tasks", json, task)).json.skill, null);
    const ambiguous = await call("POST", "/api/tasks", json, { ...task, skill: "tidy" });
    assert.equal(ambiguous.status, 400);
    assert.equal(ambiguous.json.code, "skill.ambiguous");
    for (const skill of ["nope", "acme/more:review", "../tidy", "acme/none:tidy"]) {
        const unknown = await call("POST", "/api/tasks", json, { ...task, skill });
        assert.equal(unknown.status, 400, skill);
        assert.equal(unknown.json.code, "skill.unknown", skill);
    }
    const pl = await call(
        "POST",
        "/api/tasks",
        { ...json, "accept-language": "pl" },
        { ...task, skill: "nope" },
    );
    assert.equal(
        pl.json.error,
        "Nieznany skill nope: nie ma go ani żadne zarejestrowane źródło skilli, ani projekt, ani HOME agenta.",
    );
});

const nightly = {
    name: "Nightly",
    cron: "0 3 * * 1-5",
    repo: "demo",
    title: "Tidy up",
    skill: "review",
};

test("automations are created, listed, changed, run now and deleted", async () => {
    const { call, list, port } = await setup(["acme/skills"]);
    const created = await call("POST", "/api/automations", json, nightly);
    assert.equal(created.status, 201);
    const id = created.json.id as string;
    assert.match(id, /^[0-9a-f]{12}$/);
    assert.deepEqual(
        { ...created.json, id: undefined, createdAt: undefined, nextRunAt: undefined },
        {
            ...nightly,
            id: undefined,
            workflow: null,
            body: "",
            agent: "claude",
            skill: "acme/skills:review",
            integrations: [],
            enabled: true,
            lastRunAt: null,
            author: null,
            createdAt: undefined,
            builtin: null,
            nextRunAt: undefined,
        },
    );
    // The next weekday at 03:00 in the server's time zone.
    const next = new Date(created.json.nextRunAt as string);
    assert.ok(next.getTime() > Date.now() && next.getTime() <= Date.now() + 4 * 86_400_000);
    assert.deepEqual([next.getHours(), next.getMinutes()], [3, 0]);
    assert.ok(next.getDay() >= 1 && next.getDay() <= 5);
    assert.equal((await list("/api/automations")).length, 1);
    const one = await call("GET", `/api/automations/${id}`);
    assert.equal(one.status, 200);
    assert.deepEqual(one.json, created.json);

    const off = await call("PATCH", `/api/automations/${id}`, json, { enabled: false });
    assert.equal(off.status, 200);
    assert.equal(off.json.enabled, false);
    assert.equal(off.json.nextRunAt, null);
    assert.equal(off.json.skill, "acme/skills:review");
    const changed = await call("PATCH", `/api/automations/${id}`, json, {
        cron: "*/5  * * * *",
        agent: "codex",
        skill: null,
    });
    assert.equal(changed.json.cron, "*/5 * * * *");
    assert.equal(changed.json.agent, "codex");
    assert.equal(changed.json.skill, null);
    assert.equal(changed.json.title, "Tidy up");

    const ran = await call("POST", `/api/automations/${id}/run`, json, {});
    assert.equal(ran.status, 201);
    assert.equal(ran.json.automation, id);
    assert.equal(ran.json.agent, "codex");
    assert.equal((await call("GET", `/api/tasks/${ran.json.id}`)).json.automation, id);
    const [stored] = (await list("/api/automations")) as { lastRunAt: string | null }[];
    assert.ok(stored?.lastRunAt);

    const deleted = await call("DELETE", `/api/automations/${id}`, json);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.id, id);
    assert.equal((await list("/api/automations")).length, 0);
    for (const [method, path] of [
        ["GET", `/api/automations/${id}`],
        ["DELETE", `/api/automations/${id}`],
        ["PATCH", `/api/automations/${id}`],
        ["POST", `/api/automations/${id}/run`],
    ] as const) {
        const body = method === "GET" || method === "DELETE" ? undefined : {};
        const res = await call(method, path, json, body);
        assert.equal(res.status, 404, `${method} ${JSON.stringify(res.json)}`);
    }
    // The MCP server sends DELETE with a JSON body through fetch.
    const viaFetch = await fetch(`http://127.0.0.1:${port}/api/automations/${id}`, {
        method: "DELETE",
        headers: json,
        body: "{}",
    });
    assert.equal(viaFetch.status, 404);
    assert.equal(((await viaFetch.json()) as { code: string }).code, "request.notFound");
});

test("bad automations are refused with a code", async () => {
    const { call, list } = await setup(["acme/skills", "acme/more"]);
    const cases: [object, string][] = [
        [{ cron: "0 3 * *" }, "automation.invalidCron"],
        [{ cron: "0 25 * * *" }, "automation.invalidCron"],
        [{ repo: "none" }, "repo.notRegistered"],
        [{ skill: "nope" }, "skill.unknown"],
        [{ skill: "tidy" }, "skill.ambiguous"],
        [{ agent: "gpt" }, "task.invalidAgent"],
        [{ enabled: "yes" }, "field.invalidBoolean"],
        [{ name: "" }, "field.invalidText"],
        [{ title: undefined }, "field.invalidText"],
    ];
    for (const [patch, code] of cases) {
        const res = await call("POST", "/api/automations", json, { ...nightly, ...patch });
        assert.equal(res.status, 400, code);
        assert.equal(res.json.code, code);
    }
    const pl = await call(
        "POST",
        "/api/automations",
        { ...json, "accept-language": "pl" },
        { ...nightly, cron: "x" },
    );
    assert.match(pl.json.error as string, /^cron: x nie jest wyrażeniem cron/);
    const id = (await call("POST", "/api/automations", json, nightly)).json.id;
    const bad = await call("PATCH", `/api/automations/${id}`, json, { cron: "* * * * * *" });
    assert.equal(bad.json.code, "automation.invalidCron");
    assert.equal((await call("GET", "/api/automations")).status, 200);
    assert.equal((await list("/api/automations")).length, 1);
    await call("DELETE", `/api/automations/${id}`, json);
});

test("removing a project only unregisters it, and waits for its jobs and automations", async () => {
    const { call, ids, store, home } = await setup();
    const folder = join(home, "kit");
    mkdirSync(folder);
    await store.addRepo("kit", "main", folder, null);
    assert.equal((await call("GET", "/api/repos/kit")).json.folder, folder);
    // Turning the knowledge base on gives the project its memory upkeep.
    await call("PATCH", "/api/repos/kit/settings", json, { memory: true });
    const task = await store.createTask({ repo: "kit", title: "Busy", body: "" });
    const busy = await call("DELETE", "/api/repos/kit", json);
    assert.deepEqual([busy.status, busy.json.code], [409, "repo.busy"]);
    await store.update(task.id, { status: "done" });
    const automation = await store.createAutomation({
        name: "Nightly",
        cron: "0 3 * * *",
        workflow: null,
        repo: "kit",
        title: "Tidy",
        body: "",
        agent: "claude",
        skill: null,
        integrations: [],
        enabled: true,
    });
    const used = await call("DELETE", "/api/repos/kit", json);
    assert.deepEqual([used.status, used.json.code], [409, "repo.inUse"]);
    await store.deleteAutomation(automation.id);
    const removed = await call("DELETE", "/api/repos/kit", json);
    assert.equal(removed.status, 200);
    assert.deepEqual(await ids("/api/repos"), ["demo"]);
    assert.equal((await call("GET", "/api/repos/kit")).status, 404);
    assert.ok(existsSync(folder));
    assert.equal((await store.task(task.id))?.repo, "kit");
    await store.addRepo("kit", "main", folder, null);
    assert.equal((await call("GET", "/api/repos/kit")).status, 200);
    const upkeep = (await store.automations()).filter((a) => a.repo === "kit" && a.builtin);
    assert.equal(upkeep.length, 2);
});

test("the built-in memory upkeep can be turned off and changed, not deleted, renamed or moved", async () => {
    const { call, store } = await setup();
    await call("PATCH", "/api/repos/demo/settings", json, { memory: true });
    const list = (await call("GET", "/api/automations")).json as unknown as Automation[];
    const weave = list.find((a) => a.builtin === "weave") as Automation;
    assert.equal(weave.name, "Memory weaving");
    const path = `/api/automations/${weave.id}`;
    const changed = await call("PATCH", path, json, {
        enabled: false,
        cron: "0 5 * * *",
        name: weave.name,
        repo: "demo",
        workflow: null,
        body: "Weave.",
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.json));
    assert.deepEqual([changed.json.enabled, changed.json.cron], [false, "0 5 * * *"]);
    for (const patch of [{ name: "Mine" }, { title: "Mine" }, { repo: "kit" }]) {
        const refused = await call("PATCH", path, json, patch);
        assert.deepEqual([refused.status, refused.json.code], [409, "automation.builtin"]);
    }
    const deleted = await call("DELETE", path, json);
    assert.deepEqual([deleted.status, deleted.json.code], [409, "automation.builtin"]);
    assert.equal((await store.automation(weave.id))?.body, "Weave.");
});

test("a task may work in the project's checkout, on a new branch it names or OLIMP's", async () => {
    const { call, store, home } = await setup();
    const folder = join(home, "kit");
    mkdirSync(folder);
    await must("git", ["-C", folder, "init", "-q", "-b", "main"]);
    await store.addRepo("kit", "main", folder, null);
    const task = { repo: "kit", title: "C" };
    const plain = await call("POST", "/api/tasks", json, task);
    assert.deepEqual([plain.json.workspace, plain.json.branchName], ["worktree", null]);
    const here = await call("POST", "/api/tasks", json, { ...task, worktree: false });
    assert.deepEqual([here.json.workspace, here.json.branchName], ["checkout", null]);
    const auto = await call("POST", "/api/tasks", json, {
        ...task,
        worktree: false,
        newBranch: true,
    });
    assert.deepEqual([auto.json.workspace, auto.json.branchName], ["branch", null]);
    const named = { ...task, worktree: false, newBranch: true, branch: "feat/x" };
    assert.equal((await call("POST", "/api/tasks", json, named)).json.branchName, "feat/x");
    for (const branch of ["main", "bad..name", "-x"]) {
        const refused = await call("POST", "/api/tasks", json, { ...named, branch });
        assert.equal(refused.json.code, "task.invalidBranch", branch);
    }
    for (const extra of [{ variants: 2 }, { dispatch: true }]) {
        const refused = await call("POST", "/api/tasks", json, {
            ...task,
            worktree: false,
            ...extra,
        });
        assert.equal(refused.json.code, "task.checkoutAlone");
    }
});

test("a project's own skills come first in its list, can be read and given to a task", async () => {
    const { call, ids, store, home } = await setup(["acme/skills"]);
    const folder = join(home, "kit");
    mkdirSync(join(folder, ".claude", "skills", "check"), { recursive: true });
    writeFileSync(join(folder, ".claude", "skills", "check", "SKILL.md"), "Run the checks.\n");
    await store.addRepo("kit", "main", folder, null);
    assert.deepEqual(await ids("/api/skills?repo=kit"), [
        "./check",
        "acme/skills:review",
        "acme/skills:tidy",
    ]);
    assert.equal((await call("GET", "/api/skills?repo=nope")).status, 404);
    const read = await call("GET", "/api/skill?ref=.%2Fcheck&repo=kit");
    assert.equal(read.json.content, "Run the checks.\n");
    const global = await call("GET", "/api/skill?ref=acme%2Fskills%3Atidy");
    assert.match(global.json.content as string, /Tidy up/);
    assert.equal((await call("GET", "/api/skill?ref=.%2Fnope&repo=kit")).status, 404);
    const task = await call("POST", "/api/tasks", json, {
        repo: "kit",
        title: "C",
        skill: "./check",
    });
    assert.equal(task.json.skill, "./check");
    const automation = await call("POST", "/api/automations", json, {
        name: "Check",
        cron: "0 4 * * *",
        repo: "kit",
        title: "C",
        skill: "./check",
    });
    assert.equal(automation.json.skill, "./check");
    const missing = await call("POST", "/api/tasks", json, {
        repo: "kit",
        title: "C",
        skill: "./x",
    });
    assert.equal(missing.json.code, "skill.unknown");
});

test("skills nested deeper in a source are found, the shallowest of a name wins", async () => {
    const { call, list } = await setup(["acme/gone"]);
    assert.deepEqual(
        (await list("/api/skills")).map((s) => {
            const { id, description } = s as { id: string; description: string };
            return [id, description];
        }),
        [
            ["acme/gone:deep", "Deep"],
            ["acme/gone:old", "Old"],
        ],
    );
    const text = await call("GET", "/api/skill?ref=acme%2Fgone%3Adeep");
    assert.match(String(text.json.content), /Deep/);
});

test("an account's own skills are created, edited and deleted in its agents' HOME, claude.ai ones listed", async () => {
    const { call, ids, list, home } = await setup();
    const skills = join(home, "agent-home", ".claude", "skills");
    mkdirSync(join(skills, "synced", "org", "pdf"), { recursive: true });
    writeFileSync(
        join(skills, "synced", "org", "pdf", "SKILL.md"),
        '---\ndescription: "PDF \\"files\\""\n---\n',
    );
    const content = skill("Mine");
    const made = await call("POST", "/api/own-skills", json, { name: "mine", content });
    assert.deepEqual([made.status, made.json.id], [201, "~/mine"]);
    const again = await call("POST", "/api/own-skills", json, { name: "mine", content });
    assert.equal(again.json.code, "skill.exists");
    const bare = await call("POST", "/api/own-skills", json, { name: "x", content: "no front" });
    assert.equal(bare.json.code, "skill.noDescription");
    const synced = await call("POST", "/api/own-skills", json, { name: "synced", content });
    assert.equal(synced.json.code, "skill.invalidName");
    assert.deepEqual(await ids("/api/skills"), ["~/mine", "claude.ai/pdf"]);
    const listed = (await list("/api/skills")) as { id: string; description: string }[];
    assert.equal(listed.find((s) => s.id === "claude.ai/pdf")?.description, 'PDF "files"');

    const edited = await call("PUT", "/api/own-skills/mine", json, { content: skill("Edited") });
    assert.equal(edited.json.description, "Edited");
    const read = await call("GET", "/api/skill?ref=~%2Fmine");
    assert.match(String(read.json.content), /Edited/);
    const task = await call("POST", "/api/tasks", json, { repo: "demo", title: "T", skill: "pdf" });
    assert.equal(task.json.skill, "claude.ai/pdf");

    symlinkSync(join(skills, "synced", "org", "pdf"), join(skills, "linked"));
    const linked = await call("PUT", "/api/own-skills/linked", json, { content });
    assert.equal(linked.json.code, "skill.notEditable");
    assert.equal((await call("DELETE", "/api/own-skills/mine", json)).status, 200);
    assert.equal((await call("PUT", "/api/own-skills/mine", json, { content })).status, 404);
    assert.deepEqual(await ids("/api/skills"), ["~/linked", "claude.ai/pdf"]);
});

test("skills.sh search passes well-formed hits and reports when it is down", async () => {
    let up = true;
    const queries: string[] = [];
    const fake = createServer((req, res) => {
        queries.push(new URL(req.url ?? "", "http://x").searchParams.get("q") ?? "");
        res.writeHead(up ? 200 : 503, { "content-type": "application/json" });
        res.end(
            JSON.stringify({
                skills: [
                    { source: "acme/skills", skillId: "tidy", installs: 42 },
                    { source: "bad source", skillId: "x" },
                    { source: "acme/skills", skillId: "../up" },
                ],
            }),
        );
    });
    servers.push(fake);
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const { call } = await setup([], {
        OLIMP_SKILLS_SEARCH_URL: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    });
    const found = await call("GET", "/api/skill-search?q=tidy%20up");
    assert.deepEqual(found.json, [
        { id: "acme/skills:tidy", source: "acme/skills", name: "tidy", installs: 42 },
    ]);
    assert.deepEqual(queries, ["tidy up"]);
    assert.equal((await call("GET", "/api/skill-search?q=t")).json.code, "skill.invalidQuery");
    up = false;
    const down = await call("GET", "/api/skill-search?q=tidy");
    assert.deepEqual([down.status, down.json.code], [502, "skill.searchFailed"]);
});

test("a removed skill source leaves the lists and its clone, its tasks and automations keep the skill", async () => {
    const { call, list, ids, home } = await setup(["acme/skills", "acme/more"]);
    await call("POST", "/api/skill-sources", json, { repo: "acme/gone" });
    const clone = join(home, "skills", "acme__gone");
    assert.ok(existsSync(clone));
    const task = await call("POST", "/api/tasks", json, {
        repo: "demo",
        title: "Old",
        skill: "old",
    });
    const automation = await call("POST", "/api/automations", json, { ...nightly, skill: "old" });
    assert.equal(automation.json.skill, "acme/gone:old");

    const removed = await call("DELETE", "/api/skill-sources/acme/gone", json);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.id, "acme/gone");
    assert.equal(existsSync(clone), false);
    assert.deepEqual(await ids("/api/skill-sources"), ["acme/more", "acme/skills"]);
    assert.deepEqual(await ids("/api/skills"), [
        "acme/more:docs",
        "acme/more:tidy",
        "acme/skills:review",
        "acme/skills:tidy",
    ]);
    assert.equal((await call("GET", `/api/tasks/${task.json.id}`)).json.skill, "acme/gone:old");
    const automations = (await list("/api/automations")) as { id: string; skill: string }[];
    assert.equal(automations.find((a) => a.id === automation.json.id)?.skill, "acme/gone:old");

    const again = await call("DELETE", "/api/skill-sources/acme/gone", {
        ...json,
        "accept-language": "pl",
    });
    assert.equal(again.status, 404);
    assert.deepEqual(again.json, {
        error: "Źródło skilli acme/gone nie jest zarejestrowane.",
        code: "skill.sourceNotRegistered",
    });
    await call("DELETE", `/api/automations/${automation.json.id}`, json);
});

const flow = {
    name: "Review and ship",
    description: "Review, then open a pull request when anything changed",
    repo: "demo",
    definition: {
        nodes: [
            { id: "start", type: "start" },
            { id: "review", type: "agent", name: "Review", prompt: "{{task}}", skill: "review" },
            { id: "check", type: "if", condition: { kind: "diff-files", op: ">", value: 0 } },
            { id: "pr", type: "github.draft-pr" },
        ],
        edges: [
            { from: "start.next", to: "review" },
            { from: "review.done", to: "check" },
            { from: "check.true", to: "pr" },
        ],
        layout: { review: { x: 340.4, y: 0 }, gone: { x: 1, y: 1 } },
    },
};

type Nodes = Record<string, unknown>[];

test("workflows are created, read, changed, run now and deleted; runs are listed and read", async () => {
    const { call, list, ids } = await setup(["acme/skills"]);
    const created = await call("POST", "/api/workflows", json, flow);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const id = created.json.id as string;
    assert.match(id, /^[0-9a-f]{12}$/);
    assert.equal(created.json.description, flow.description);
    const definition = created.json.definition as { nodes: Nodes; layout: unknown };
    const review = definition.nodes.find((n) => n.id === "review");
    assert.equal(review?.skill, "acme/skills:review");
    // No agent: the project's when it runs.
    assert.equal(review?.agent, undefined);
    assert.deepEqual(definition.layout, { review: { x: 340, y: 0 } });
    assert.deepEqual(await ids("/api/workflows"), [id]);
    assert.equal((await call("GET", `/api/workflows/${id}`)).json.name, "Review and ship");

    const renamed = await call("PATCH", `/api/workflows/${id}`, json, { name: "Ship" });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.json.name, "Ship");
    assert.equal(renamed.json.description, flow.description);
    assert.deepEqual(renamed.json.definition, created.json.definition);

    const ran = await call("POST", `/api/workflows/${id}/run`, json, {});
    assert.equal(ran.status, 201);
    assert.equal(ran.json.status, "queued");
    assert.equal(ran.json.workflow, id);
    assert.equal(ran.json.automation, null);
    // A run keeps the definition it was queued with.
    const changed = {
        nodes: [
            { id: "start", type: "start" },
            { id: "fix", type: "agent", prompt: "Fix it" },
        ],
        edges: [{ from: "start.next", to: "fix" }],
    };
    await call("PATCH", `/api/workflows/${id}`, json, { definition: changed });
    const one = await call("GET", `/api/workflow-runs/${ran.json.id}`);
    assert.equal(one.status, 200);
    assert.deepEqual(one.json.steps, []);
    const kept = one.json.definition as { nodes: Nodes };
    assert.ok(kept.nodes.some((n) => n.id === "review"));
    const [summary] = (await list("/api/workflow-runs")) as Record<string, unknown>[];
    assert.equal(summary?.id, ran.json.id);
    assert.equal(summary?.name, "Ship");
    assert.equal("steps" in (summary ?? {}), false);
    assert.equal("state" in (summary ?? {}), false);

    // Only a waiting run takes an answer.
    const early = await call("POST", `/api/workflow-runs/${ran.json.id}/answer`, json, {
        answer: "approve",
    });
    assert.equal(early.status, 409);
    assert.equal(early.json.code, "run.notAsking");

    const deleted = await call("DELETE", `/api/workflows/${id}`, json);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await ids("/api/workflows"), []);
    assert.equal((await call("GET", `/api/workflow-runs/${ran.json.id}`)).json.workflow, id);
    for (const [method, path] of [
        ["GET", `/api/workflows/${id}`],
        ["PATCH", `/api/workflows/${id}`],
        ["POST", `/api/workflows/${id}/run`],
        ["GET", "/api/workflow-runs/ffffffffffff"],
    ] as const)
        assert.equal(
            (await call(method, path, json, method === "GET" ? undefined : {})).status,
            404,
        );
});

test("bad workflow definitions are refused with a code, in both languages", async () => {
    const { call, ids } = await setup(["acme/skills", "acme/more"]);
    const { nodes, edges } = flow.definition;
    const swap = (id: string, node: object) => nodes.map((n) => (n.id === id ? node : n));
    const cases: [unknown, string][] = [
        [{ nodes, edges: [...edges, { from: "pr.created", to: "nope" }] }, "workflow.edgeTo"],
        [{ nodes, edges: [...edges, { from: "check.maybe", to: "pr" }] }, "workflow.edgeFrom"],
        [{ nodes, edges: [...edges, { from: "check.false", to: "review" }] }, "workflow.cycle"],
        [
            { nodes, edges: [...edges, { from: "check.true", to: "review" }] },
            "workflow.portWiredTwice",
        ],
        [
            { nodes: [...nodes, { id: "lost", type: "github.draft-pr" }], edges },
            "workflow.unreachable",
        ],
        [{ nodes: swap("pr", { id: "pr", type: "merge" }), edges }, "workflow.unknownNodeType"],
        [{ nodes: nodes.slice(1), edges: edges.slice(1) }, "workflow.startCount"],
        [
            { nodes: swap("review", { id: "review", type: "agent", prompt: " " }), edges },
            "workflow.required",
        ],
        [
            {
                nodes: swap("check", { id: "check", type: "if", condition: { kind: "diff" } }),
                edges,
            },
            "workflow.invalidField",
        ],
        [
            {
                nodes: swap("pr", { id: "pr", type: "notify.webhook", url: "http://example.com" }),
                edges,
            },
            "workflow.invalidField",
        ],
        [
            { nodes: swap("pr", { id: "pr", type: "workflow", workflow: "ffffffffffff" }), edges },
            "workflow.unknownSubWorkflow",
        ],
        [{ nodes: swap("review", { ...nodes[1], skill: "tidy" }), edges }, "skill.ambiguous"],
        ["graph", "workflow.invalidDefinition"],
        [{ nodes, edges: ["start.next"] }, "workflow.invalidEdge"],
    ];
    for (const [definition, code] of cases) {
        const res = await call("POST", "/api/workflows", json, { ...flow, definition });
        assert.equal(res.status, 400, code);
        assert.equal(res.json.code, code, JSON.stringify(definition));
    }
    assert.equal(
        (await call("POST", "/api/workflows", json, { ...flow, repo: "none" })).json.code,
        "repo.notRegistered",
    );
    const pl = await call(
        "POST",
        "/api/workflows",
        { ...json, "accept-language": "pl" },
        { ...flow, definition: { nodes, edges: [...edges, { from: "pr.created", to: "nope" }] } },
    );
    assert.deepEqual(pl.json, {
        error: "Połączenie z pr.created prowadzi do nope, którego nie ma w tym workflow.",
        code: "workflow.edgeTo",
    });
    assert.deepEqual(await ids("/api/workflows"), []);
});

test("an automation runs either a workflow or a task template and switches between them", async () => {
    const { call } = await setup(["acme/skills"]);
    const workflow = (await call("POST", "/api/workflows", json, flow)).json.id as string;
    const created = await call("POST", "/api/automations", json, {
        name: "Nightly flow",
        cron: "0 3 * * *",
        workflow,
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const id = created.json.id as string;
    assert.equal(created.json.workflow, workflow);
    for (const key of ["repo", "title", "body", "agent", "skill"])
        assert.equal(created.json[key], null);

    const ran = await call("POST", `/api/automations/${id}/run`, json, {});
    assert.equal(ran.status, 201);
    assert.equal(ran.json.workflow, workflow);
    assert.equal(ran.json.automation, id);
    assert.equal((await call("GET", `/api/workflow-runs/${ran.json.id}`)).json.automation, id);

    const both = await call("PATCH", `/api/automations/${id}`, json, { title: "Tidy" });
    assert.equal(both.status, 400);
    assert.equal(both.json.code, "automation.taskAndWorkflow");
    const inUse = await call("DELETE", `/api/workflows/${workflow}`, {
        ...json,
        "accept-language": "pl",
    });
    assert.equal(inUse.status, 409);
    assert.equal(inUse.json.code, "workflow.inUse");
    assert.match(inUse.json.error as string, new RegExp(`automatyzacje ${id}`));

    const task = await call("PATCH", `/api/automations/${id}`, json, {
        workflow: null,
        repo: "demo",
        title: "Tidy",
    });
    assert.equal(task.status, 200, JSON.stringify(task.json));
    assert.equal(task.json.workflow, null);
    assert.equal(task.json.agent, "claude");
    assert.equal((await call("POST", `/api/automations/${id}/run`, json, {})).json.title, "Tidy");
    const back = await call("PATCH", `/api/automations/${id}`, json, { workflow });
    assert.equal(back.json.workflow, workflow);
    assert.equal(back.json.title, null);

    const refused: [object, string][] = [
        [{ workflow, repo: "demo", title: "x" }, "automation.taskAndWorkflow"],
        [{ workflow: "ffffffffffff" }, "workflow.notFound"],
        [{ repo: "demo" }, "field.invalidText"],
    ];
    for (const [patch, code] of refused) {
        const res = await call("POST", "/api/automations", json, {
            name: "x",
            cron: "0 3 * * *",
            ...patch,
        });
        assert.equal(res.status, 400, code);
        assert.equal(res.json.code, code);
    }
    await call("DELETE", `/api/automations/${id}`, json);
    assert.equal((await call("DELETE", `/api/workflows/${workflow}`, json)).status, 200);
});

test("a database from before workflows keeps its automations, which can then point at a workflow", async () => {
    const old = mkdtempSync(join(tmpdir(), "olimp-old-"));
    try {
        const db = new DatabaseSync(join(old, "olimp.db"));
        db.exec(`CREATE TABLE repos (id TEXT PRIMARY KEY, default_branch TEXT NOT NULL,
                added_at TEXT NOT NULL);
            CREATE TABLE automations (id TEXT PRIMARY KEY, name TEXT NOT NULL, cron TEXT NOT NULL,
                repo TEXT NOT NULL REFERENCES repos (id), title TEXT NOT NULL, body TEXT NOT NULL,
                agent TEXT NOT NULL, skill TEXT, enabled INTEGER NOT NULL, last_run_at TEXT,
                last_slot TEXT, created_at TEXT NOT NULL);
            INSERT INTO repos VALUES ('acme/demo', 'main', 'then');
            INSERT INTO automations VALUES ('aaaaaaaaaaaa', 'Nightly', '0 3 * * *', 'acme/demo',
                'Tidy', 'Body', 'codex', 'acme/skills:tidy', 0, 'last', '2026-11-02T02:00:00.000Z',
                'then');`);
        db.close();
        const migrated = await sqlite(old);
        assert.deepEqual(
            await migrated.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        );
        assert.deepEqual(await migrated.automation("aaaaaaaaaaaa"), {
            id: "aaaaaaaaaaaa",
            name: "Nightly",
            cron: "0 3 * * *",
            enabled: false,
            workflow: null,
            repo: "demo",
            title: "Tidy",
            body: "Body",
            agent: "codex",
            skill: "acme/skills:tidy",
            integrations: [],
            lastRunAt: "last",
            author: null,
            createdAt: "then",
            builtin: null,
        });
        const workflow = await migrated.createWorkflow({
            name: "Flow",
            repo: "demo",
            definition: {
                nodes: [
                    { id: "start", type: "start" },
                    { id: "pr", type: "github.draft-pr" },
                ],
                edges: [{ from: "start.next", to: "pr" }],
            },
        });
        const input = { name: "Flow", cron: "0 4 * * *", enabled: true, workflow: workflow.id };
        const blank = {
            repo: null,
            title: null,
            body: null,
            agent: null,
            skill: null,
            integrations: null,
        };
        const flowAutomation = await migrated.createAutomation({ ...input, ...blank });
        const run = await migrated.runAutomation(flowAutomation.id);
        assert.equal(run && "workflow" in run ? run.workflow : null, workflow.id);
        assert.equal((await (await sqlite(old)).automations()).length, 2);
    } finally {
        rmSync(old, { recursive: true, force: true });
    }
});

test("notes are added to a registered repository, listed newest first by repository and deleted", async () => {
    const { call, store } = await setup();
    await store.addRepo("notes", "main");
    const add = (repo: string, text: string) => call("POST", "/api/notes", json, { repo, text });
    const first = await add("notes", "  Tests need Node 26  ");
    assert.equal(first.status, 201);
    assert.equal(first.json.text, "Tests need Node 26");
    assert.equal(first.json.repo, "notes");
    assert.deepEqual([first.json.task, first.json.run, first.json.node], [null, null, null]);
    const second = await add("notes", "The docs are in docs/");
    await add("demo", "Elsewhere");

    const listed = await call("GET", "/api/notes?repo=notes");
    assert.equal(listed.status, 200);
    assert.deepEqual(
        (listed.json as unknown as { id: string }[]).map((n) => n.id),
        [second.json.id, first.json.id],
    );
    const all = (await call("GET", "/api/notes")).json as unknown as { repo: string }[];
    assert.ok(all.some((n) => n.repo === "demo"));
    assert.equal((await call("GET", "/api/notes?repo=Acme")).json.code, "repo.invalidId");

    const removed = await call("DELETE", `/api/notes/${first.json.id}`, json);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.id, first.json.id);
    const left = (await call("GET", "/api/notes?repo=notes")).json as unknown as unknown[];
    assert.equal(left.length, 1);
});

const github = {
    name: "github",
    kind: "stdio",
    command: "github-mcp",
    args: ["stdio"],
    env: { GITHUB_TOKEN: ref("E2E_GITHUB_TOKEN"), LOG: "warn" },
};
const sentry = {
    name: "sentry",
    kind: "http",
    url: "https://mcp.sentry.example/mcp",
    headers: { Authorization: `Bearer ${ref("E2E_SENTRY_TOKEN")}`, Accept: "application/json" },
};

test("integrations of a repository are added, listed, changed and deleted", async () => {
    const { call, list } = await setup();
    const path = "/api/repos/demo/integrations";
    assert.deepEqual(await list(path), []);
    const added = await call("POST", path, json, github);
    assert.equal(added.status, 201);
    assert.equal(added.json.repo, "demo");
    assert.deepEqual(added.json.env, github.env);
    assert.equal((await call("POST", path, json, sentry)).status, 201);
    assert.deepEqual(
        (await list(path)).map((i) => (i as { name: string }).name),
        ["github", "sentry"],
    );

    const changed = await call("PATCH", `${path}/github`, json, { args: ["stdio", "--read-only"] });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.json.args, ["stdio", "--read-only"]);
    assert.equal(changed.json.command, "github-mcp");
    assert.deepEqual(changed.json.env, github.env);
    const http = await call("PATCH", `${path}/github`, json, {
        kind: "http",
        url: "https://api.github.example/mcp/",
    });
    assert.equal(http.status, 200);
    assert.deepEqual(
        [http.json.kind, http.json.headers, http.json.command],
        ["http", {}, undefined],
    );

    const removed = await call("DELETE", `${path}/github`, json);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.name, "github");
    assert.deepEqual(
        (await list(path)).map((i) => (i as { name: string }).name),
        ["sentry"],
    );
    assert.equal((await call("DELETE", `${path}/github`, json)).json.code, "integration.notFound");
});

test("bad integrations are refused with a code, and secrets only pass as references", async () => {
    const { call } = await setup();
    const path = "/api/repos/demo/integrations";
    const refused = async (body: object, code: string, status = 400) => {
        const res = await call("POST", path, json, body);
        assert.equal(res.status, status, JSON.stringify(body));
        assert.equal(res.json.code, code, JSON.stringify(body));
        return res;
    };
    const literal = await refused(
        { ...sentry, headers: { authorization: "Bearer sk-live-123" } },
        "integration.literalAuthorization",
    );
    assert.equal(
        literal.json.error,
        "Header authorization must take its secret from an environment variable of the OLIMP " +
            `process, e.g. Bearer ${ref("API_TOKEN")}: OLIMP never stores secrets.`,
    );
    await refused(
        { ...sentry, headers: { "Proxy-Authorization": "secret" } },
        "integration.literalAuthorization",
    );
    for (const value of [ref("1BAD"), ref("TOKEN:-x"), "${TOKEN", ref("")])
        await refused({ ...github, env: { T: value } }, "integration.invalidReference");
    const token = ref("TOKEN");
    await refused({ ...github, command: `run ${token}` }, "integration.referenceNotAllowed");
    await refused({ ...github, args: [`--token=${token}`] }, "integration.referenceNotAllowed");
    await refused(
        { ...sentry, url: `https://x.example/?t=${token}` },
        "integration.referenceNotAllowed",
    );
    await refused({ ...sentry, url: "file:///etc/passwd" }, "integration.invalidField");
    await refused({ ...github, env: { "BAD-NAME": "x" } }, "integration.invalidField");
    await refused({ ...github, url: "https://x.example" }, "integration.invalidField");
    await refused({ ...github, command: undefined }, "integration.invalidField");
    await refused({ ...github, kind: "sse" }, "integration.invalidKind");
    for (const name of ["", "a b", "x".repeat(51), "../x", 5])
        await refused({ ...github, name }, "integration.invalidName");
    assert.equal((await call("POST", path, json, github)).status, 201);
    await refused(github, "integration.exists", 409);
    await refused({ ...github, args: ["x".repeat(2001)] }, "integration.invalidField");

    const rename = await call("PATCH", `${path}/github`, json, { name: "gh" });
    assert.equal(rename.json.code, "integration.fixedName");
    const none = await call("GET", "/api/repos/none/integrations");
    assert.equal(none.status, 404);
    assert.equal(none.json.code, "repo.notRegistered");
    const pl = await call(
        "POST",
        path,
        { ...json, "accept-language": "pl" },
        { ...sentry, headers: { Authorization: "Bearer x" } },
    );
    assert.equal(
        pl.json.error,
        "Nagłówek Authorization musi brać sekret ze zmiennej środowiskowej procesu OLIMP, np. " +
            `Bearer ${ref("API_TOKEN")}: OLIMP nigdy nie zapisuje sekretów.`,
    );
});

test("tasks, automations and workflow agent steps choose integrations of their repository", async () => {
    const { call, store } = await setup();
    await store.addRepo("other", "main");
    await call("POST", "/api/repos/demo/integrations", json, github);
    const task = { repo: "demo", title: "Use it" };
    const chosen = await call("POST", "/api/tasks", json, {
        ...task,
        integrations: ["github", "github"],
    });
    assert.equal(chosen.status, 201);
    assert.deepEqual(chosen.json.integrations, ["github"]);
    assert.equal(chosen.json.issue, null);
    assert.deepEqual((await call("POST", "/api/tasks", json, task)).json.integrations, []);
    const unknown = await call("POST", "/api/tasks", json, { ...task, integrations: ["jira"] });
    assert.deepEqual(unknown.json, {
        error: "Integration jira is not defined in project demo.",
        code: "integration.unknown",
    });
    const elsewhere = { repo: "other", title: "x", integrations: ["github"] };
    assert.equal(
        (await call("POST", "/api/tasks", json, elsewhere)).json.code,
        "integration.unknown",
    );
    for (const integrations of ["github", [5], ["a b"], Array(21).fill("github")])
        assert.equal(
            (await call("POST", "/api/tasks", json, { ...task, integrations })).json.code,
            "integration.invalidList",
        );

    const automation = await call("POST", "/api/automations", json, {
        name: "Nightly",
        cron: "0 3 * * *",
        ...task,
        integrations: ["github"],
    });
    assert.equal(automation.status, 201);
    assert.deepEqual(automation.json.integrations, ["github"]);
    const auto = `/api/automations/${automation.json.id}`;
    assert.deepEqual((await call("PATCH", auto, json, { enabled: false })).json.integrations, [
        "github",
    ]);
    const moved = await call("PATCH", auto, json, { repo: "other" });
    assert.equal(moved.json.code, "integration.unknown");
    const movedClean = await call("PATCH", auto, json, { repo: "other", integrations: [] });
    assert.equal(movedClean.status, 200);
    const queued = await call("POST", `${auto}/run`, json);
    assert.deepEqual(queued.json.integrations, []);

    const definition = (integrations: string[]) => ({
        nodes: [
            { id: "start", type: "start" },
            { id: "use", type: "agent", name: "Use", prompt: "Use it", integrations },
        ],
        edges: [{ from: "start.next", to: "use" }],
    });
    const flow = await call("POST", "/api/workflows", json, {
        name: "Flow",
        repo: "demo",
        definition: definition(["github"]),
    });
    assert.equal(flow.status, 201);
    const node = (
        flow.json.definition as { nodes: { id: string; integrations: string[] }[] }
    ).nodes.find((n) => n.id === "use");
    assert.deepEqual(node?.integrations, ["github"]);
    const bad = await call("POST", "/api/workflows", json, {
        name: "Flow",
        repo: "demo",
        definition: definition(["jira"]),
    });
    assert.equal(bad.json.code, "integration.unknown");
    const path = `/api/workflows/${flow.json.id}`;
    assert.equal(
        (await call("PATCH", path, json, { repo: "other" })).json.code,
        "integration.unknown",
    );
    assert.equal((await call("PATCH", path, json, { name: "Renamed" })).status, 200);
    const invalid = await call("POST", "/api/workflows", json, {
        name: "Flow",
        repo: "demo",
        definition: definition("github" as unknown as string[]),
    });
    assert.equal(invalid.json.code, "workflow.invalidField");
});

test("one repository is read with its settings, an unregistered one is 404", async () => {
    const { call } = await setup();
    await call("PUT", "/api/repos/demo/issues", json, {});
    await call("PUT", "/api/repos/demo/commands", json, { commands: ["pnpm lint"] });
    const read = await call("GET", "/api/repos/demo");
    assert.equal(read.status, 200);
    assert.equal(read.json.id, "demo");
    assert.equal(read.json.defaultBranch, "main");
    assert.equal(read.json.issueLabel, "olimp");
    assert.deepEqual(read.json.commands, ["pnpm lint"]);
    const none = await call("GET", "/api/repos/none", { "accept-language": "pl" });
    assert.equal(none.status, 404);
    assert.deepEqual(none.json, {
        error: "Projekt none nie jest zarejestrowany.",
        code: "repo.notRegistered",
    });
    assert.equal((await call("DELETE", "/api/repos/none", json)).status, 404);
});

test("GitHub issues are switched on with a label, changed and switched off", async () => {
    const { call } = await setup();
    const path = "/api/repos/demo/issues";
    const repoOf = async () =>
        ((await call("GET", "/api/repos")).json as unknown as { issueLabel: string | null }[])[0];
    assert.equal((await repoOf())?.issueLabel, null);
    const on = await call("PUT", path, json, {});
    assert.equal(on.status, 200);
    assert.equal(on.json.issueLabel, "olimp");
    assert.equal(
        (await call("PUT", path, json, { label: " ready for bot " })).json.issueLabel,
        "ready for bot",
    );
    assert.equal((await repoOf())?.issueLabel, "ready for bot");
    for (const label of ["", " ", "a,b", "x".repeat(51), 5])
        assert.equal((await call("PUT", path, json, { label })).json.code, "issues.invalidLabel");
    const off = await call("DELETE", path, json);
    assert.equal(off.json.issueLabel, null);
    const none = await call("PUT", "/api/repos/none/issues", json, {});
    assert.equal(none.status, 404);
});

test("a repository's commands are set, changed, refused when they chain or redirect, and cleared", async () => {
    const { call } = await setup();
    const path = "/api/repos/demo/commands";
    const repoOf = async () =>
        ((await call("GET", "/api/repos")).json as unknown as { commands: string[] }[])[0];
    assert.deepEqual((await repoOf())?.commands, []);
    const set = await call("PUT", path, json, {
        commands: [" pnpm   typecheck ", "pnpm lint", "pnpm lint", 'pnpm run test -- --grep "a b"'],
    });
    assert.equal(set.status, 200);
    assert.deepEqual(set.json.commands, [
        "pnpm typecheck",
        "pnpm lint",
        'pnpm run test -- --grep "a b"',
    ]);
    await call("PUT", path, json, { commands: ["pnpm typecheck"] });
    assert.deepEqual((await repoOf())?.commands, ["pnpm typecheck"]);
    const bad = [
        undefined,
        [],
        "pnpm lint",
        [5],
        [" "],
        ["x".repeat(201)],
        Array.from({ length: 21 }, (_, i) => `cmd${i}`),
        ...[
            "pnpm lint; rm -rf /",
            "pnpm lint && curl x",
            "pnpm lint | sh",
            "echo `id`",
            "echo $(id)",
            "echo $HOME",
            "pnpm lint > out",
            "cat < /etc/passwd",
            "pnpm lint &",
            "Bash(x)",
            "a,b",
            "pnpm *",
            "a\\\nb",
            "pnpm lint\nrm -rf /",
            "pnpm\tlint",
        ].map((c) => [c]),
    ];
    for (const commands of bad) {
        const refused = await call("PUT", path, json, { commands });
        assert.equal(refused.status, 400, JSON.stringify(commands));
        assert.equal(refused.json.code, "commands.invalid");
    }
    const pl = await call("PUT", path, { ...json, "accept-language": "pl" }, { commands: [] });
    assert.match(
        pl.json.error as string,
        /oczekiwano listy od 1 do 20 poleceń, każde do 200 znaków/,
    );
    assert.deepEqual((await repoOf())?.commands, ["pnpm typecheck"]);
    const cleared = await call("DELETE", path, json);
    assert.deepEqual(cleared.json.commands, []);
    assert.deepEqual((await repoOf())?.commands, []);
    assert.equal(
        (await call("PUT", "/api/repos/none/commands", json, { commands: ["x"] })).status,
        404,
    );
});

test("a database from stage 4 gets integrations and issues, its workflows keep working", async () => {
    const old = mkdtempSync(join(tmpdir(), "olimp-old-"));
    try {
        const db = new DatabaseSync(join(old, "olimp.db"));
        db.exec(`CREATE TABLE repos (id TEXT PRIMARY KEY, default_branch TEXT NOT NULL,
                added_at TEXT NOT NULL);
            CREATE TABLE tasks (id TEXT PRIMARY KEY, repo TEXT NOT NULL, title TEXT NOT NULL,
                body TEXT NOT NULL, agent TEXT NOT NULL DEFAULT 'claude', skill TEXT,
                automation TEXT, status TEXT NOT NULL, branch TEXT, pr_url TEXT, error TEXT,
                log TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE automations (id TEXT PRIMARY KEY, name TEXT NOT NULL, cron TEXT NOT NULL,
                workflow TEXT, repo TEXT, title TEXT, body TEXT, agent TEXT, skill TEXT,
                enabled INTEGER NOT NULL, last_run_at TEXT, last_slot TEXT,
                created_at TEXT NOT NULL);
            CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo TEXT NOT NULL,
                definition TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            INSERT INTO repos VALUES ('acme/demo', 'main', 'then');
            INSERT INTO tasks (id, repo, title, body, status, created_at, updated_at)
                VALUES ('0123456789ab', 'acme/demo', 'Old', '', 'done', 'then', 'then');
            INSERT INTO automations (id, name, cron, repo, title, body, agent, enabled, created_at)
                VALUES ('aaaaaaaaaaaa', 'Nightly', '0 3 * * *', 'acme/demo', 'Tidy', '',
                'claude', 1, 'then');
            INSERT INTO workflows VALUES ('bbbbbbbbbbbb', 'Flow', 'acme/demo',
                '{"start":"a","nodes":{"a":{"type":"agent","title":"A","body":"","agent":"claude","skill":null,"next":null}}}',
                'then', 'then');`);
        db.close();
        const migrated = await sqlite(old);
        assert.deepEqual(
            await migrated.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        );
        assert.equal((await migrated.repo("demo"))?.issueLabel, null);
        const task = await migrated.task("0123456789ab");
        assert.deepEqual(task?.integrations, []);
        assert.equal(task?.issue, null);
        // What finished before reads counts as read.
        assert.deepEqual((await migrated.reads("")).tasks, ["0123456789ab"]);
        assert.deepEqual((await migrated.automation("aaaaaaaaaaaa"))?.integrations, []);
        // A definition from before the graph editor reads as a graph.
        const workflow = (await migrated.workflow("bbbbbbbbbbbb")) as Workflow;
        assert.equal(workflow.description, "");
        assert.deepEqual(workflow.definition, {
            nodes: [
                { id: "start", type: "start" },
                { id: "a", type: "agent", name: "A", prompt: "A", agent: "claude" },
            ],
            edges: [{ from: "start.next", to: "a" }],
        });
        const run = await migrated.createRun(workflow);
        assert.deepEqual((await migrated.run(run.id))?.definition, workflow.definition);

        await migrated.setIssueLabel("demo", "olimp");
        const issue = { repo: "demo", title: "Issue", body: "", issue: 4 };
        assert.ok(await migrated.createIssueTask(issue));
        const restarted = await sqlite(old);
        assert.equal(await restarted.createIssueTask(issue), undefined);
        assert.equal((await restarted.repo("demo"))?.issueLabel, "olimp");
    } finally {
        rmSync(old, { recursive: true, force: true });
    }
});

const tablesOf = (home: string) => {
    const db = new DatabaseSync(join(home, "olimp.db"));
    const schema = db
        .prepare(
            "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
    db.close();
    return schema;
};

test("a new SQLite database gets every migration once, a restart changes nothing", async () => {
    const home = mkdtempSync(join(tmpdir(), "olimp-new-"));
    try {
        const store = await sqlite(home);
        assert.deepEqual(
            await store.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        );
        const schema = tablesOf(home);
        assert.ok(schema.some((t) => t.name === "schema_migrations"));
        assert.ok(schema.some((t) => t.name === "tasks_issue"));
        await store.addRepo("demo", "main", null, "acme/demo");
        await store.addNotes("demo", ["kept"], { task: null, run: null, node: null });
        const again = await sqlite(home);
        assert.deepEqual(
            await again.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        );
        assert.deepEqual(tablesOf(home), schema);
        assert.deepEqual(
            (await again.notes("demo")).map((n) => n.text),
            ["kept"],
        );
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

// Notes of one step share a timestamp; their order came from SQLite's rowid and must survive the
// move to an explicit column, also when the ids sort the other way.
test("a database from stage 5 keeps its data and the order of its notes", async () => {
    const old = mkdtempSync(join(tmpdir(), "olimp-old-"));
    try {
        const db = new DatabaseSync(join(old, "olimp.db"));
        db.exec(`CREATE TABLE repos (id TEXT PRIMARY KEY, default_branch TEXT NOT NULL,
                added_at TEXT NOT NULL, issue_label TEXT);
            CREATE TABLE notes (id TEXT PRIMARY KEY, repo TEXT NOT NULL REFERENCES repos (id),
                text TEXT NOT NULL, task TEXT, run TEXT, node TEXT, created_at TEXT NOT NULL);
            CREATE INDEX notes_repo ON notes (repo, created_at);
            INSERT INTO repos VALUES ('acme/demo', 'main', 'then', 'olimp');
            INSERT INTO notes VALUES ('ffffffffffff', 'acme/demo', 'first', 'aaaaaaaaaaaa', NULL,
                NULL, '2026-10-01T00:00:00.000Z');
            INSERT INTO notes VALUES ('000000000000', 'acme/demo', 'second', 'aaaaaaaaaaaa', NULL,
                NULL, '2026-10-01T00:00:00.000Z');
            INSERT INTO notes VALUES ('777777777777', 'acme/demo', 'older', NULL, 'bbbbbbbbbbbb',
                'edit', '2026-09-01T00:00:00.000Z');`);
        db.close();
        const migrated = await sqlite(old);
        assert.deepEqual(
            await migrated.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
        );
        assert.equal((await migrated.repo("demo"))?.issueLabel, "olimp");
        assert.deepEqual((await migrated.repo("demo"))?.commands, []);
        const listed = async (store: Store) =>
            (await store.notes("demo")).map((n) => [n.text, n.task, n.run, n.node]);
        const expected = [
            ["second", "aaaaaaaaaaaa", null, null],
            ["first", "aaaaaaaaaaaa", null, null],
            ["older", null, "bbbbbbbbbbbb", "edit"],
        ];
        assert.deepEqual(await listed(migrated), expected);
        assert.deepEqual(await migrated.memoryPages("demo"), []);
        assert.equal((await migrated.unwovenNotes("demo")).total, 3);
        const page = { slug: "notes", title: "Notes", description: "Old notes.", kind: "page" };
        const none = { task: null, run: null, node: null };
        assert.ok(await migrated.createMemoryPage("demo", { ...page, kind: "page" }, none));
        const cited = { heading: "Older", body: "Woven.", sources: ["777777777777"] };
        assert.ok(await migrated.addMemorySection("demo", "notes", cited, none));
        assert.deepEqual(
            (await migrated.unwovenNotes("demo")).notes.map((n) => n.text),
            ["second", "first"],
        );
        const [newest] = await migrated.addNotes("demo", ["a", "b"], {
            task: null,
            run: null,
            node: null,
        });
        assert.equal(newest?.text, "a");
        assert.deepEqual((await listed(await sqlite(old))).slice(0, 2), [
            ["b", null, null, null],
            ["a", null, null, null],
        ]);
    } finally {
        rmSync(old, { recursive: true, force: true });
    }
});

test("memory pages and sections are created, read and changed with their version", async () => {
    const { call, store } = await setup();
    const memory = "/api/repos/demo/memory";
    const [note] = await store.addNotes("demo", ["Use pnpm"], {
        task: null,
        run: null,
        node: null,
    });
    const empty = await call("GET", memory);
    assert.deepEqual(empty.json, { repo: "demo", hubs: [], pages: [], unwoven: 1 });

    const hub = await call("POST", `${memory}/pages`, json, {
        slug: "start",
        title: "Start",
        description: "Where   to begin.\n",
        kind: "hub",
    });
    assert.equal(hub.status, 201);
    assert.equal(hub.json.description, "Where to begin.");
    assert.equal(hub.json.version, 1);
    const page = await call("POST", `${memory}/pages`, json, {
        slug: "build",
        title: "Build",
        description: "How to build.",
    });
    assert.equal(page.json.kind, "page");
    const section = await call("POST", `${memory}/pages/build/sections`, json, {
        heading: "Tools / setup",
        body: "Run pnpm build.\r\n",
        sources: [note?.id],
    });
    assert.equal(section.status, 201);
    assert.deepEqual(
        [section.json.body, section.json.sources, section.json.version, section.json.task],
        ["Run pnpm build.", [note?.id], 1, null],
    );
    await call("POST", `${memory}/pages/start/sections`, json, {
        heading: "Areas",
        body: "- [[build]]",
    });

    const map = (await call("GET", memory)).json as unknown as {
        hubs: { slug: string; sections: number }[];
        pages: { slug: string; sections: number }[];
        unwoven: number;
    };
    assert.deepEqual(
        [map.hubs.map((p) => [p.slug, p.sections]), map.pages.map((p) => [p.slug, p.sections])],
        [[["start", 1]], [["build", 1]]],
    );
    assert.equal(map.unwoven, 0);
    assert.deepEqual((await call("GET", `${memory}/unwoven`)).json, { total: 0, notes: [] });

    const path = `${memory}/pages/build/sections/${encodeURIComponent("Tools / setup")}`;
    const changed = await call("PATCH", path, json, { version: 1, body: "Run make." });
    assert.equal(changed.status, 200);
    assert.deepEqual([changed.json.body, changed.json.version], ["Run make.", 2]);
    assert.deepEqual(changed.json.sources, [note?.id]);
    const stale = await call("PATCH", path, json, { version: 1, body: "Lost." });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, "memory.sectionConflict");
    const renamed = await call("PATCH", `${memory}/pages/build`, json, {
        version: 1,
        title: "Building",
    });
    assert.deepEqual([renamed.json.title, renamed.json.version], ["Building", 2]);
    const late = await call("PATCH", `${memory}/pages/build`, json, { version: 1, kind: "hub" });
    assert.equal(late.status, 409);
    assert.equal(late.json.code, "memory.pageConflict");

    const read = await call("GET", `${memory}/pages/build`);
    assert.equal(read.json.title, "Building");
    assert.deepEqual(
        (read.json.sections as { heading: string; body: string }[]).map((s) => [s.heading, s.body]),
        [["Tools / setup", "Run make."]],
    );
    assert.equal((await call("GET", `${memory}/unwoven`)).json.total, 0);
});

test("bad memory input is refused with a code, in both languages", async () => {
    const { call, store } = await setup();
    await store.addRepo("other", "main");
    const memory = "/api/repos/demo/memory";
    const pl = { ...json, "accept-language": "pl" };
    const page = { slug: "build", title: "Build", description: "How to build." };
    assert.equal((await call("POST", `${memory}/pages`, json, page)).status, 201);
    const refused = async (method: string, path: string, body: object, code: string) => {
        const r = await call(method, path, json, method === "GET" ? undefined : body);
        assert.equal(r.json.code, code, `${method} ${path} ${JSON.stringify(body)}`);
        return r.status;
    };
    for (const slug of ["Build", "a--b", "-a", "x".repeat(65), 5])
        assert.equal(
            await refused("POST", `${memory}/pages`, { ...page, slug }, "memory.invalidSlug"),
            400,
        );
    assert.equal(await refused("POST", `${memory}/pages`, page, "memory.pageExists"), 409);
    await refused(
        "POST",
        `${memory}/pages`,
        { ...page, slug: "x", kind: "map" },
        "memory.invalidKind",
    );
    await refused(
        "POST",
        `${memory}/pages`,
        { ...page, slug: "x", description: "" },
        "field.invalidText",
    );
    const sections = `${memory}/pages/build/sections`;
    await refused("POST", sections, { heading: "A", body: "x\n## B\ny" }, "memory.headingInBody");
    assert.equal(
        (await call("POST", sections, json, { heading: "A", body: "```\n## not a heading\n```" }))
            .status,
        201,
    );
    await refused("POST", sections, { heading: "A", body: "again" }, "memory.sectionExists");
    await refused(
        "POST",
        sections,
        { heading: "B", body: "x", sources: "x" },
        "memory.invalidSources",
    );
    const [elsewhere] = await store.addNotes("other", ["Other"], {
        task: null,
        run: null,
        node: null,
    });
    await refused(
        "POST",
        sections,
        { heading: "B", body: "x", sources: [elsewhere?.id] },
        "memory.unknownNote",
    );
    await refused(
        "POST",
        sections,
        { heading: "B", body: "x".repeat(10_001) },
        "field.invalidText",
    );
    await refused("PATCH", `${sections}/A`, { body: "y" }, "memory.invalidVersion");
    await refused("PATCH", `${sections}/A`, { version: 0, body: "y" }, "memory.invalidVersion");
    assert.equal(
        await refused("PATCH", `${sections}/Z`, { version: 1 }, "memory.sectionNotFound"),
        404,
    );
    assert.equal(await refused("GET", `${memory}/pages/nope`, {}, "memory.pageNotFound"), 404);
    assert.equal(await refused("GET", "/api/repos/none/memory", {}, "repo.notRegistered"), 404);
    const missing = await call("GET", `${memory}/pages/nope`, pl);
    assert.deepEqual(missing.json, {
        error: "Projekt demo nie ma strony pamięci nope.",
        code: "memory.pageNotFound",
    });
    const stale = await call("PATCH", `${sections}/A`, pl, { version: 5, body: "y" });
    assert.deepEqual(stale.json, {
        error: "Sekcja A strony build zmieniła się po wersji 5: odczytaj ją ponownie i nanieś zmianę na nową wersję.",
        code: "memory.sectionConflict",
    });
});

test("a memory search ranks the project's hits, answers the best 20 and checks the query", async () => {
    const { call, store } = await setup();
    await store.addRepo("other", "main");
    const none = { task: null, run: null, node: null };
    const page = (slug: string, title: string) => ({
        slug,
        title,
        description: `About ${title}.`,
        kind: "page" as const,
    });
    const section = (heading: string, body: string) => ({ heading, body, sources: [] });
    await store.createMemoryPage("demo", page("ops", "Operations"), none);
    for (let i = 1; i <= 25; i++)
        await store.addMemorySection(
            "demo",
            "ops",
            section(`Step ${i}`, `Deploy step ${i}.`),
            none,
        );
    await store.createMemoryPage("demo", page("deploy", "Deploy"), none);
    await store.addMemorySection("demo", "deploy", section("Keys", "The deploy key."), none);
    await store.addMemorySection("demo", "deploy", section("Deploy key", "In the vault."), none);
    await store.createMemoryPage("other", page("deploy", "Deploy elsewhere"), none);
    const search = (repo: string, q: string) =>
        call("GET", `/api/repos/${repo}/memory/search?${new URLSearchParams({ q })}`);

    const found = await search("demo", "deploy");
    assert.equal(found.status, 200);
    const { total, hits } = found.json as unknown as {
        total: number;
        hits: { slug: string; title: string; heading: string | null; snippet: string }[];
    };
    assert.equal(total, 28);
    assert.equal(hits.length, 20);
    assert.deepEqual(
        hits.slice(0, 4).map((h) => [h.slug, h.heading, h.snippet]),
        [
            ["deploy", null, "About Deploy."],
            ["deploy", "Deploy key", "In the vault."],
            ["deploy", "Keys", "The deploy key."],
            ["ops", "Step 1", "Deploy step 1."],
        ],
    );
    assert.ok(hits.every((h) => h.title !== "Deploy elsewhere"));
    const phrase = (await search("demo", "deploy key")).json.hits as { heading: string }[];
    assert.deepEqual(
        phrase.map((h) => h.heading),
        ["Deploy key", "Keys"],
    );
    assert.equal((await search("other", "deploy")).json.total, 1);
    assert.equal((await search("demo", "elsewhere")).json.total, 0);

    for (const q of ["x", "  x  ", "x".repeat(201)]) {
        const bad = await search("demo", q);
        assert.equal(bad.status, 400);
        assert.equal(bad.json.code, "memory.invalidQuery");
    }
    assert.equal(
        (await call("GET", "/api/repos/demo/memory/search")).json.code,
        "memory.invalidQuery",
    );
    assert.equal((await search("none", "deploy")).json.code, "repo.notRegistered");
});

test("a step's token reaches only its project's and areas' memory and notes, written as the step", async () => {
    const { call, store } = await setup();
    await store.addRepo("kb", "main");
    await store.addRepo("other", "main");
    const source = { task: "0123456789ab", run: null, node: null, author: null };
    const token = issueStepToken({ repos: ["demo", "kb"], source });
    const step = { ...json, "x-olimp-step": token };
    const page = await call("POST", "/api/repos/kb/memory/pages", step, {
        slug: "deploy",
        title: "Deploy",
        description: "How it ships.",
    });
    assert.deepEqual([page.status, page.json.task], [201, source.task]);
    for (const text of ["Use pnpm", "Use tabs"]) {
        const note = await call("POST", "/api/notes", step, { repo: "demo", text });
        assert.deepEqual([note.status, note.json.task], [201, source.task]);
    }
    const first = async (query: string) =>
        (
            (await call("GET", `/api/repos/demo/memory/unwoven${query}`, step)).json.notes as {
                text: string;
            }[]
        )[0]?.text;
    assert.deepEqual([await first(""), await first("?oldest=true")], ["Use tabs", "Use pnpm"]);
    const hits = await call("GET", "/api/repos/kb/memory/search?q=ships", step);
    assert.equal(hits.json.total, 1);
    const refused: [string, string, object?][] = [
        ["GET", "/api/repos/other/memory"],
        ["POST", "/api/notes", { repo: "other", text: "x" }],
        ["GET", "/api/notes"],
        ["DELETE", "/api/notes/ffffffffffff"],
        ["POST", "/api/repos/demo/memory/sources", { url: "http://127.0.0.1/x" }],
        ["GET", "/api/repos/demo/memory/graph"],
        ["GET", "/api/tasks"],
    ];
    for (const [method, path, body] of refused) {
        const res = await call(method, path, step, body);
        assert.deepEqual([res.status, res.json.code], [403, "memory.stepForbidden"], path);
    }
    revokeStepToken(token);
    const late = await call("GET", "/api/repos/demo/memory", step);
    assert.deepEqual([late.status, late.json.code], [401, "memory.invalidStepToken"]);
});

test("bad notes are refused with a code, in both languages", async () => {
    const { call } = await setup();
    const pl = { ...json, "accept-language": "pl" };
    const none = await call("POST", "/api/notes", json, { repo: "none", text: "x" });
    assert.equal(none.status, 400);
    assert.equal(none.json.code, "repo.notRegistered");
    for (const text of ["", " ", "x".repeat(2001), 5]) {
        const bad = await call("POST", "/api/notes", json, { repo: "demo", text });
        assert.equal(bad.status, 400);
        assert.equal(bad.json.code, "field.invalidText");
    }
    const ok = await call("POST", "/api/notes", json, {
        repo: "demo",
        text: "x".repeat(2000),
    });
    assert.equal(ok.status, 201);
    const missing = await call("DELETE", "/api/notes/ffffffffffff", json);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.json, {
        error: "Note ffffffffffff does not exist.",
        code: "note.notFound",
    });
    const missingPl = await call("DELETE", "/api/notes/ffffffffffff", pl);
    assert.deepEqual(missingPl.json, {
        error: "Notatka ffffffffffff nie istnieje.",
        code: "note.notFound",
    });
});
