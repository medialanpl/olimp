import assert from "node:assert/strict";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
} from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { type Config, loadConfig, publicHostProblem } from "../src/config.ts";
import type { agentsInfo } from "../src/machine.ts";
import { must, run } from "../src/proc.ts";
import { agentHome, hashToken, tightenHomes, userHome } from "../src/users.ts";
import { bareRepo, chain, fakeGh, ghFiles, openStore, script, step } from "./fixtures.ts";

type AgentInfo = Awaited<ReturnType<typeof agentsInfo>>[number];

const root = mkdtempSync(join(tmpdir(), "olimp-users-"));
const fresh = await bareRepo(root, "fresh", { "README.md": "# fresh\n" });
const gh = fakeGh(root, { "acme/fresh": fresh.bare, "acme/other": fresh.bare });
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const PUBLIC = "olimp.example.com";

interface Reply {
    status: number;
    json: Record<string, unknown>;
    headers: Record<string, unknown>;
}

function client(port: number) {
    return (
        method: string,
        path: string,
        options: { token?: string; body?: object; headers?: Record<string, string> } = {},
    ): Promise<Reply> =>
        new Promise((resolve, reject) => {
            const body = options.body ? JSON.stringify(options.body) : undefined;
            const req = request(
                {
                    host: "127.0.0.1",
                    port,
                    method,
                    path,
                    headers: {
                        host: `127.0.0.1:${port}`,
                        // Node sends a GET or DELETE body without chunking: it needs its length.
                        ...(body
                            ? {
                                  "content-type": "application/json",
                                  "content-length": String(Buffer.byteLength(body)),
                              }
                            : {}),
                        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
                        ...options.headers,
                    },
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    res.on("end", () =>
                        resolve({
                            status: res.statusCode ?? 0,
                            json: JSON.parse(data || "null"),
                            headers: res.headers,
                        }),
                    );
                },
            );
            req.on("error", reject);
            req.end(body);
        });
}

async function setup(publicHost: string | null = null) {
    const home = mkdtempSync(join(root, "home-"));
    const store = await openStore(home);
    await store.addRepo("demo", "main", null, "acme/demo");
    const cfg: Config = { ...loadConfig({ OLIMP_HOME: home }), gh, publicHost };
    const server = createApi(store, cfg);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    return { home, store, cfg, port, call: client(port) };
}

type Call = ReturnType<typeof client>;

// The first account through the API, without a token, and a member made by it.
async function accounts(call: Call) {
    const first = await call("POST", "/api/users", { body: { name: "ada" } });
    assert.equal(first.status, 201, JSON.stringify(first.json));
    const admin = first.json as { id: string; token: { id: string; token: string } };
    const made = await call("POST", "/api/users", {
        token: admin.token.token,
        body: { name: "bob", role: "member" },
    });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const member = made.json as { id: string; token: { id: string; token: string } };
    return {
        admin: { id: admin.id, token: admin.token.token, tokenId: admin.token.id },
        member: { id: member.id, token: member.token.token, tokenId: member.token.id },
    };
}

test("without accounts nothing needs a token and nothing has an author", async () => {
    const { call, store } = await setup();
    const task = await call("POST", "/api/tasks", { body: { repo: "demo", title: "Do" } });
    assert.equal(task.status, 201);
    assert.equal(task.json.author, null);
    assert.equal((await call("GET", "/api/tasks")).status, 200);
    const me = await call("GET", "/api/me", { headers: { "accept-language": "pl" } });
    assert.equal(me.status, 404);
    assert.equal(me.json.code, "account.none");
    assert.match(me.json.error as string, /Nie ma kont/);
    assert.deepEqual((await call("GET", "/api/users")).json, []);
    assert.equal(await store.hasUsers(), false);
});

test("the first account needs no token only while there are none, and is an admin", async () => {
    const { call, store, cfg } = await setup();
    const first = await call("POST", "/api/users", { body: { name: "ada", role: "member" } });
    assert.equal(first.status, 201);
    assert.equal(first.json.role, "admin");
    assert.equal(first.headers["cache-control"], "no-store");
    const token = (first.json.token as { token: string }).token;
    assert.match(token, /^olimp_[\w-]{43}$/);
    // Only the hash is stored.
    assert.equal((await store.userByToken(hashToken(token)))?.name, "ada");
    assert.equal(await store.userByToken(token), undefined);
    assert.ok(existsSync(userHome(cfg, first.json.id as string)));
    for (const locale of ["en", "pl"]) {
        const again = await call("POST", "/api/users", {
            body: { name: "eve" },
            headers: { "accept-language": locale },
        });
        assert.equal(again.status, 401);
        assert.equal(again.json.code, "auth.missingToken");
        assert.equal(again.headers["www-authenticate"], "Bearer");
    }
    assert.deepEqual(
        (await store.users()).map((u) => u.name),
        ["ada"],
    );
});

test("with accounts every request but /health needs a valid token, a revoked one fails", async () => {
    const { call } = await setup();
    const { admin } = await accounts(call);
    assert.equal((await call("GET", "/health")).status, 200);
    const missing = await call("GET", "/api/tasks");
    assert.equal(missing.status, 401);
    assert.equal(missing.json.code, "auth.missingToken");
    for (const token of ["olimp_wrong", `${admin.token}x`]) {
        const wrong = await call("GET", "/api/tasks", {
            token,
            headers: { "accept-language": "pl" },
        });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.json.code, "auth.invalidToken");
        assert.match(wrong.json.error as string, /unieważniony/);
    }
    assert.equal((await call("GET", "/api/tasks", { token: admin.token })).status, 200);
    const me = await call("GET", "/api/me", { token: admin.token });
    assert.equal(me.json.name, "ada");
    assert.deepEqual(
        (me.json.tokens as { id: string }[]).map((t) => t.id),
        [admin.tokenId],
    );
    const extra = await call("POST", `/api/users/${admin.id}/tokens`, {
        token: admin.token,
        body: {},
    });
    assert.equal(extra.status, 201);
    const second = extra.json.token as string;
    assert.equal((await call("GET", "/api/me", { token: second })).json.id, admin.id);
    const revoked = await call("DELETE", `/api/tokens/${extra.json.id}`, {
        token: admin.token,
        body: {},
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
    assert.equal(revoked.json.token, undefined);
    const after = await call("GET", "/api/me", { token: second });
    assert.equal(after.status, 401);
    assert.equal(after.json.code, "auth.invalidToken");
});

test("a member makes no accounts or tokens, revokes only their own, the last admin stays", async () => {
    const { call, cfg } = await setup();
    const { admin, member } = await accounts(call);
    const as = { token: member.token };
    for (const [method, path] of [
        ["GET", "/api/users"],
        ["POST", "/api/users"],
        ["POST", `/api/users/${member.id}/tokens`],
        ["DELETE", `/api/users/${member.id}`],
        ["GET", `/api/users/${admin.id}/tokens`],
        ["DELETE", `/api/tokens/${admin.tokenId}`],
    ] as const) {
        const refused = await call(method, path, { ...as, body: { name: "mal" } });
        assert.equal(refused.status, 403, `${method} ${path} ${JSON.stringify(refused.json)}`);
        assert.equal(refused.json.code, "auth.adminOnly");
    }
    assert.equal((await call("GET", `/api/users/${member.id}/tokens`, as)).status, 200);
    const users = await call("GET", "/api/users", { token: admin.token });
    assert.deepEqual(
        (users.json as unknown as { name: string; role: string }[]).map((u) => [u.name, u.role]),
        [
            ["ada", "admin"],
            ["bob", "member"],
        ],
    );
    const taken = await call("POST", "/api/users", { token: admin.token, body: { name: "bob" } });
    assert.equal(taken.status, 409);
    assert.equal(taken.json.code, "account.exists");
    for (const body of [{ name: "-x" }, { name: "ok", role: "owner" }]) {
        const bad = await call("POST", "/api/users", { token: admin.token, body });
        assert.equal(bad.status, 400);
    }
    const last = await call("DELETE", `/api/users/${admin.id}`, { token: admin.token, body: {} });
    assert.equal(last.status, 409);
    assert.equal(last.json.code, "account.lastAdmin");
    assert.equal(
        (await call("DELETE", `/api/tokens/${member.tokenId}`, { ...as, body: {} })).status,
        200,
    );
    assert.equal((await call("GET", "/api/me", as)).status, 401);
    assert.ok(existsSync(userHome(cfg, member.id)));
    const gone = await call("DELETE", `/api/users/${member.id}`, { token: admin.token, body: {} });
    assert.equal(gone.status, 200);
    assert.equal(existsSync(userHome(cfg, member.id)), false);
    const missing = await call("DELETE", `/api/users/${member.id}`, {
        token: admin.token,
        body: {},
    });
    assert.equal(missing.json.code, "account.notFound");
});

test("tasks, automations, workflows, runs, notes and memory record their author", async () => {
    const { call, store } = await setup();
    const { admin, member } = await accounts(call);
    const as = (token: string, body?: object) => ({ token, body: body ?? {} });
    const task = await call("POST", "/api/tasks", as(member.token, { repo: "demo", title: "T" }));
    assert.equal(task.json.author, member.id);
    const automation = await call(
        "POST",
        "/api/automations",
        as(member.token, { name: "Nightly", cron: "0 3 * * *", repo: "demo", title: "A" }),
    );
    assert.equal(automation.json.author, member.id);
    // Run by the admin, the automation's task is still queued as its author.
    const queued = await call(
        "POST",
        `/api/automations/${automation.json.id}/run`,
        as(admin.token),
    );
    assert.equal(queued.json.author, member.id);
    const changed = await call(
        "PATCH",
        `/api/automations/${automation.json.id}`,
        as(admin.token, { name: "Renamed" }),
    );
    assert.equal(changed.json.author, member.id);
    const definition = chain(step("a", "Edit"));
    const workflow = await call(
        "POST",
        "/api/workflows",
        as(member.token, { name: "Flow", repo: "demo", definition }),
    );
    assert.equal(workflow.json.author, member.id);
    const started = await call("POST", `/api/workflows/${workflow.json.id}/run`, as(admin.token));
    assert.equal(started.json.author, admin.id);
    const listed = await call("GET", "/api/workflow-runs", { token: admin.token });
    assert.equal((listed.json as unknown as { author: string }[])[0]?.author, admin.id);
    const note = await call("POST", "/api/notes", as(member.token, { repo: "demo", text: "N" }));
    assert.equal(note.json.author, member.id);
    const memory = "/api/repos/demo/memory";
    const page = await call(
        "POST",
        `${memory}/pages`,
        as(member.token, { slug: "build", title: "Build", description: "How to build." }),
    );
    assert.equal(page.json.author, member.id);
    const section = await call(
        "POST",
        `${memory}/pages/build/sections`,
        as(member.token, { heading: "Tools", body: "pnpm" }),
    );
    assert.equal(section.json.author, member.id);
    const edited = await call(
        "PATCH",
        `${memory}/pages/build/sections/Tools`,
        as(admin.token, { version: 1, body: "pnpm 12" }),
    );
    assert.equal(edited.json.author, admin.id);
    const issues = await call("PUT", "/api/repos/demo/issues", as(member.token, {}));
    assert.equal(issues.json.issueAuthor, member.id);
    assert.equal((await store.repo("demo"))?.issueAuthor, member.id);
    const off = await call("DELETE", "/api/repos/demo/issues", as(admin.token));
    assert.equal(off.json.issueAuthor, null);
});

test("OLIMP_PUBLIC_HOST is accepted only while accounts exist, and refused at start without", async () => {
    const { call } = await setup(PUBLIC);
    const viaProxy = { host: PUBLIC, origin: `https://${PUBLIC}` };
    const early = await call("GET", "/api/tasks", { headers: viaProxy });
    assert.equal(early.status, 403);
    assert.equal(early.json.code, "request.unknownHost");
    const firstViaProxy = await call("POST", "/api/users", {
        body: { name: "eve" },
        headers: viaProxy,
    });
    assert.equal(firstViaProxy.status, 403);
    const { admin } = await accounts(call);
    assert.equal((await call("GET", "/api/tasks", { headers: viaProxy })).status, 401);
    const ok = await call("GET", "/api/tasks", { token: admin.token, headers: viaProxy });
    assert.equal(ok.status, 200);
    const foreign = await call("GET", "/api/tasks", {
        token: admin.token,
        headers: { host: PUBLIC, origin: `http://${PUBLIC}` },
    });
    assert.equal(foreign.json.code, "request.foreignOrigin");
    const other = await call("GET", "/api/tasks", {
        token: admin.token,
        headers: { host: "evil.example.com" },
    });
    assert.equal(other.json.code, "request.unknownHost");
    assert.equal(publicHostProblem(null, false), null);
    assert.equal(publicHostProblem(PUBLIC, true), null);
    assert.match(publicHostProblem(PUBLIC, false) ?? "", /no accounts/);
    assert.match(publicHostProblem("https://x", true) ?? "", /host name/);
    assert.equal(loadConfig({ OLIMP_PUBLIC_HOST: " Olimp.Example.com " }).publicHost, PUBLIC);
});

test("a new repository is created with gh, private by default, and registered", async () => {
    const { call, store, cfg } = await setup();
    const created = await call("POST", "/api/repos", {
        body: { repo: "acme/fresh", create: true, description: "A new\nrepository" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.deepEqual([created.json.id, created.json.github], ["fresh", "acme/fresh"]);
    assert.deepEqual(readFileSync(ghFiles(root).createArgs, "utf8").trim().split("\n"), [
        "repo",
        "create",
        "acme/fresh",
        "--private",
        "--add-readme",
        "--description",
        "A new repository",
    ]);
    assert.equal((await store.repo("fresh"))?.defaultBranch, "main");
    assert.equal((await store.repo("fresh"))?.path, join(cfg.projectsDir, "fresh"));
    for (const body of [
        { repo: "acme/fresh", create: true, visibility: "secret" },
        { repo: "acme/fresh", create: "yes" },
        { repo: "acme", create: true },
        { repo: "acme/fresh", create: true, template: "not a repo" },
        { repo: "acme/fresh", create: true, folder: "." },
    ]) {
        const bad = await call("POST", "/api/repos", { body });
        assert.equal(bad.status, 400, JSON.stringify(body));
    }
    const pub = await call("POST", "/api/repos", {
        body: { repo: "acme/fresh", create: true, visibility: "public", folder: "fresh-public" },
    });
    assert.equal(pub.status, 201);
    assert.ok(readFileSync(ghFiles(root).createArgs, "utf8").includes("--public\n--add-readme"));
    const fromTemplate = await call("POST", "/api/repos", {
        body: {
            repo: "acme/fresh",
            create: true,
            template: "https://github.com/acme/starter",
            folder: "fresh-template",
        },
    });
    assert.equal(fromTemplate.status, 201, JSON.stringify(fromTemplate.json));
    assert.deepEqual(readFileSync(ghFiles(root).createArgs, "utf8").trim().split("\n"), [
        "repo",
        "create",
        "acme/fresh",
        "--private",
        "--template",
        "acme/starter",
    ]);
    // A folder that exists is refused before anything is made on GitHub.
    const taken = await call("POST", "/api/repos", { body: { repo: "acme/other", create: true } });
    assert.equal(taken.status, 201);
    const again = await call("POST", "/api/repos", { body: { repo: "acme/other", create: true } });
    assert.equal(again.json.code, "repo.folderExists");
    // Without GitHub: a local git repository with an empty first commit, nothing on GitHub.
    rmSync(ghFiles(root).createArgs, { force: true });
    const local = await call("POST", "/api/repos", {
        body: { name: "loose", create: true, github: false },
    });
    assert.equal(local.status, 201, JSON.stringify(local.json));
    assert.deepEqual(
        [local.json.id, local.json.github, local.json.git, local.json.defaultBranch],
        ["loose", null, true, "main"],
    );
    const log = await must("git", ["-C", join(cfg.projectsDir, "loose"), "log", "--format=%s"]);
    assert.equal(log.trim(), "Initial commit");
    assert.equal(existsSync(ghFiles(root).createArgs), false);
    const issues = await call("PUT", "/api/repos/loose/issues", { body: {} });
    assert.equal(issues.json.code, "repo.noGithub");
    const unnamed = await call("POST", "/api/repos", { body: { create: true, github: false } });
    assert.equal(unnamed.json.code, "repo.invalidFolder");
});

test("only an admin browses the machine's folders, registers one or sets the instructions", async () => {
    const { call } = await setup();
    const { member } = await accounts(call);
    for (const [method, path, body] of [
        ["GET", "/api/folders", undefined],
        ["POST", "/api/folders", { path: "/tmp", folder: "x" }],
        ["POST", "/api/repos", { path: "/tmp" }],
        ["PUT", "/api/instructions", { instructions: "Be brief." }],
        ["PUT", "/api/agent-defaults", { agent: "codex" }],
    ] as const) {
        const refused = await call(method, path, { token: member.token, body });
        assert.equal(refused.json.code, "auth.adminOnly", `${method} ${path}`);
    }
});

// agent-login runs as its own process, with only the environment given here.
async function agentLogin(
    cfg: Config,
    port: number,
    token: string | null,
    agent = "claude",
    ...login: string[]
) {
    const env: Record<string, string> = {
        PATH: process.env.PATH ?? "",
        OLIMP_HOME: cfg.home,
        OLIMP_URL: `http://127.0.0.1:${port}`,
        OLIMP_CLAUDE: script(
            root,
            "claude-login",
            'echo "HOME=$HOME ARGS=$* KEY=$ANTHROPIC_API_KEY"',
        ),
        OLIMP_CODEX: script(root, "codex-login", 'echo "HOME=$HOME ARGS=$*"'),
        ANTHROPIC_API_KEY: "the-installation-key",
        ...(token ? { OLIMP_TOKEN: token } : {}),
    };
    return run(
        process.execPath,
        [join(import.meta.dirname, "../src/agent-login.ts"), agent, ...login],
        { env },
    );
}

test("pnpm agent-login starts the agent CLI with the HOME of the token's account", async () => {
    const { call, cfg, port, store } = await setup();
    const none = await agentLogin(cfg, port, "olimp_x");
    assert.equal(none.code, 1);
    assert.match(none.stderr, /no accounts/);
    const { member } = await accounts(call);
    const home = userHome(cfg, member.id);
    rmSync(home, { recursive: true, force: true });
    const claude = await agentLogin(cfg, port, member.token);
    assert.equal(claude.code, 0, claude.stderr);
    assert.match(claude.stdout, new RegExp(`HOME=${home} ARGS= KEY=\\n`));
    assert.ok(existsSync(home));
    const codex = await agentLogin(cfg, port, member.token, "codex");
    assert.match(codex.stdout, new RegExp(`HOME=${home} ARGS=login`));
    const without = await agentLogin(cfg, port, null);
    assert.match(without.stderr, /OLIMP_TOKEN/);
    const wrong = await agentLogin(cfg, port, "olimp_wrong");
    assert.match(wrong.stderr, /unknown or revoked/);
    const usage = await agentLogin(cfg, port, member.token, "gpt");
    assert.match(usage.stderr, /usage: olimp agent-login <claude\|codex\|copilot/);
    assert.equal(await store.hasUsers(), true);
    const work = await agentLogin(cfg, port, member.token, "codex", "work");
    const folder = join(cfg.home, "users", member.id, "logins", "codex", "work");
    assert.match(work.stdout, new RegExp(`HOME=${home} ARGS=login`));
    assert.match(work.stdout, new RegExp(`CODEX_HOME=${folder}`));
    assert.ok(existsSync(folder));
});

test("an account logs claude in with a pasted token, a private file the API never returns", async () => {
    const { call, cfg, store } = await setup();
    const { member } = await accounts(call);
    const token = `sk-ant-oat01-${"x".repeat(40)}`;
    const path = `/api/agents/claude/logins/default/token`;
    const saved = await call("PUT", path, { token: member.token, body: { token: ` ${token}\n` } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual([saved.json.loggedIn, saved.json.token], [true, true]);
    const file = join(userHome(cfg, member.id), ".claude", "olimp-oauth-token");
    assert.equal(readFileSync(file, "utf8"), token);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const agents = await call("GET", "/api/agents", { token: member.token });
    assert.equal(JSON.stringify(agents.json).includes(token), false);
    assert.equal(JSON.stringify(saved.json).includes(token), false);
    const run = await agentHome(store, cfg, member.id, "claude");
    assert.equal(run.env.CLAUDE_CODE_OAUTH_TOKEN, token);
    for (const [where, body, status, code] of [
        [path, { token: "short" }, 400, "login.invalidToken"],
        [path, { token: `${token} with spaces` }, 400, "login.invalidToken"],
        [path, { token: `olimp_${"a".repeat(40)}` }, 400, "login.invalidToken"],
        ["/api/agents/codex/logins/default/token", { token }, 400, "login.noToken"],
        ["/api/agents/claude/logins/nope/token", { token }, 404, "login.notFound"],
    ] as const) {
        const refused = await call("PUT", where, { token: member.token, body });
        assert.deepEqual([refused.status, refused.json.code], [status, code], where);
    }
    const removed = await call("DELETE", path, { token: member.token, body: {} });
    assert.deepEqual([removed.json.loggedIn, removed.json.token], [false, false]);
    assert.equal(existsSync(file), false);
});

test("each account adds and removes second agent logins of its own", async () => {
    const { call } = await setup();
    const { admin, member } = await accounts(call);
    const logins = async (token: string) =>
        ((await call("GET", "/api/agents", { token })).json as unknown as AgentInfo[])
            .find((a) => a.agent === "claude")
            ?.logins.map((l) => l.name);
    const added = await call("POST", "/api/agents/claude/logins", {
        token: member.token,
        body: { name: "work" },
    });
    assert.equal(added.status, 201);
    assert.deepEqual([added.json.name, added.json.loggedIn], ["work", false]);
    assert.deepEqual(await logins(member.token), ["default", "work"]);
    assert.deepEqual(await logins(admin.token), ["default"]);
    for (const [body, code] of [
        [{ name: "elsewhere", folder: "/tmp/x" }, "login.folderWithAccounts"],
        [{ name: "work" }, "login.exists"],
        [{ name: "default" }, "login.exists"],
        [{ name: "../x" }, "login.invalidName"],
    ] as const) {
        const refused = await call("POST", "/api/agents/claude/logins", {
            token: member.token,
            body,
        });
        assert.equal(refused.json.code, code, JSON.stringify(body));
    }
    for (const [token, name] of [
        [admin.token, "work"],
        [member.token, "default"],
    ] as const) {
        const missing = await call("DELETE", `/api/agents/claude/logins/${name}`, {
            token,
            body: {},
        });
        assert.equal(missing.json.code, "login.notFound");
    }
    await call("DELETE", "/api/agents/claude/logins/work", { token: member.token, body: {} });
    assert.deepEqual(await logins(member.token), ["default"]);
});

test("tightenHomes takes group and others' write off the folders above the agents' caches", () => {
    const home = join(root, "homes", "olimp");
    const cache = join(userHome({ home }, "61acc25cb7e5"), ".cache");
    const shared = join(root, "homes", "shared");
    mkdirSync(cache, { recursive: true });
    mkdirSync(shared);
    const writable = [home, join(home, "users"), cache];
    for (const dir of writable) chmodSync(dir, 0o775);
    chmodSync(shared, 0o1777);
    const umask = process.umask(0o002);
    tightenHomes({ home, installationHome: shared });
    assert.equal(process.umask(umask), 0o022);
    for (const dir of writable) assert.equal(statSync(dir).mode & 0o7777, 0o755, dir);
    assert.equal(statSync(shared).mode & 0o7777, 0o1777);
});
