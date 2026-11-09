import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { inspect } from "node:util";
import type { RowDataPacket } from "mysql2/promise";
import { loadConfig } from "../src/config.ts";
import { MIGRATIONS, MYSQL_TABLE } from "../src/db/migrations.ts";
import { connectionOptions, describeTarget, parseDatabaseUrl } from "../src/db/mysql.ts";
import { transaction } from "../src/db/sqlite.ts";
import type { ServerSpec } from "../src/integrations.ts";
import { run } from "../src/proc.ts";
import { Store } from "../src/store.ts";
import { parseDefinition } from "../src/workflows.ts";
import {
    chain,
    connect,
    dropDatabase,
    mysqlUrl,
    openStore,
    sharedDatabase,
    testDatabaseUrl,
} from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-db-"));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const home = () => join(root, `home-${n++}`);
const onMysql = mysqlUrl ? null : "OLIMP_TEST_MYSQL_URL is not set";
const onMysqlAdmin =
    onMysql ?? (sharedDatabase ? "needs a MySQL user who may create databases and users" : null);

// A test only MySQL can run passes without it, and says why it did not run.
function mysqlTest(name: string, missing: string | null, fn: () => Promise<void>) {
    test(name, async (t) => {
        if (missing) return t.diagnostic(`not run: ${missing}`);
        await fn();
    });
}
const secret = `s3cret-${randomBytes(6).toString("hex")}`;
const stdio: ServerSpec = { kind: "stdio", command: "mcp", args: [], env: {} };

// The error of a failed open, with everything inspect shows of it (cause, properties, stack).
async function openError(databaseUrl: string): Promise<{ message: string; shown: string }> {
    const error = await Store.open({ home: home(), databaseUrl }).then(
        () => assert.fail("the database opened"),
        (e: Error) => e,
    );
    return { message: error.message, shown: inspect(error, { depth: 10 }) };
}

test("OLIMP_DATABASE_URL chooses MySQL, without it SQLite stays in OLIMP_HOME", async () => {
    assert.equal(loadConfig({}).databaseUrl, null);
    assert.equal(loadConfig({ OLIMP_DATABASE_URL: "" }).databaseUrl, null);
    const url = "mysql://olimp:olimp@127.0.0.1:3306/olimp";
    assert.equal(loadConfig({ OLIMP_DATABASE_URL: url }).databaseUrl, url);
    const h = home();
    const store = await Store.open({ home: h, databaseUrl: null });
    assert.equal(store.description, `SQLite ${join(h, "olimp.db")}`);
    await store.close();
});

test("the database a MySQL URL names is described without its password", () => {
    const target = parseDatabaseUrl(`mysql://olimp:${secret}@db.local:3307/olimp`);
    assert.deepEqual(target, {
        host: "db.local",
        port: 3307,
        user: "olimp",
        password: secret,
        database: "olimp",
        ssl: "DISABLED",
    });
    assert.equal(describeTarget(target), "MySQL olimp@db.local:3307/olimp");
    assert.equal(parseDatabaseUrl("mysql://olimp@127.0.0.1").database, "olimp");
    assert.equal(parseDatabaseUrl("mysql://olimp@127.0.0.1").port, 3306);
});

test("ssl-mode encrypts the MySQL connection, with or without checking the certificate", () => {
    const sslOf = (query: string) => parseDatabaseUrl(`mysql://olimp@db.local/olimp${query}`).ssl;
    assert.equal(sslOf(""), "DISABLED");
    assert.equal(sslOf("?ssl-mode=required"), "REQUIRED");
    assert.equal(sslOf("?ssl-mode=VERIFY_IDENTITY"), "VERIFY_IDENTITY");
    const target = parseDatabaseUrl("mysql://olimp@db.local/olimp?ssl-mode=REQUIRED");
    assert.equal(describeTarget(target), "MySQL olimp@db.local:3306/olimp (TLS, REQUIRED)");
    assert.deepEqual(connectionOptions(target).ssl, { rejectUnauthorized: false });
    assert.deepEqual(connectionOptions({ ...target, ssl: "VERIFY_IDENTITY" }).ssl, {
        rejectUnauthorized: true,
    });
    assert.equal(connectionOptions({ ...target, ssl: "DISABLED" }).ssl, undefined);
});

test("a bad database URL is refused without repeating it", async () => {
    for (const url of [
        `postgres://olimp:${secret}@127.0.0.1/olimp`,
        `mysql://olimp:${secret}@127.0.0.1/bad-name`,
        `not a url ${secret}`,
        `mysql://olimp:${secret}@127.0.0.1/olimp?ssl-mode=PREFERRED`,
        `mysql://olimp:${secret}@127.0.0.1/olimp?sslmode=require`,
    ]) {
        const { message, shown } = await openError(url);
        assert.match(message, /OLIMP_DATABASE_URL/);
        assert.ok(!shown.includes(secret), shown);
    }
});

test("a MySQL server that cannot be reached fails with host and port, never the password", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    await new Promise((resolve) => server.close(resolve));
    const { message, shown } = await openError(`mysql://olimp:${secret}@127.0.0.1:${port}/olimp`);
    assert.ok(message.includes(`cannot connect to MySQL at 127.0.0.1:${port} as olimp`), message);
    assert.ok(!shown.includes(secret), shown);
});

test("no git, gh or agent process inherits a database URL", async () => {
    const saved = process.env.OLIMP_TEST_MYSQL_URL;
    process.env.OLIMP_DATABASE_URL = `mysql://olimp:${secret}@127.0.0.1/olimp`;
    process.env.OLIMP_TEST_MYSQL_URL = `mysql://root:${secret}@127.0.0.1`;
    process.env.EXTRA = "x";
    try {
        const probe = [
            "-c",
            'printenv OLIMP_DATABASE_URL OLIMP_TEST_MYSQL_URL || echo unset; echo "$EXTRA"',
        ];
        assert.equal((await run("sh", probe)).stdout, "unset\nx\n");
        // An agent gets only the environment it is given.
        assert.equal(
            (await run("sh", probe, { env: { PATH: "/usr/bin:/bin" } })).stdout,
            "unset\n\n",
        );
    } finally {
        delete process.env.OLIMP_DATABASE_URL;
        delete process.env.EXTRA;
        if (saved === undefined) delete process.env.OLIMP_TEST_MYSQL_URL;
        else process.env.OLIMP_TEST_MYSQL_URL = saved;
    }
});

test("a SQLite transaction refuses asynchronous work, which would commit before it ended", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    const one = transaction(db, () => {
        db.exec("INSERT INTO t VALUES (1)");
        return 1;
    });
    assert.equal(one, 1);
    // @ts-expect-error the callback returns a Promise
    const refused = () => transaction(db, async () => 2);
    assert.equal(typeof refused, "function");
    db.close();
});

test("ids and names compare with their case, so Acme/Demo and acme/demo are two repositories", async () => {
    const store = await openStore(home());
    await store.addRepo("Acme/Demo", "main");
    await store.addRepo("acme/demo", "trunk");
    assert.deepEqual(
        (await store.repos()).map((r) => [r.id, r.defaultBranch]),
        [
            ["Acme/Demo", "main"],
            ["acme/demo", "trunk"],
        ],
    );
    assert.equal(await store.repo("ACME/DEMO"), undefined);
    assert.ok(await store.addIntegration("acme/demo", "Sentry", stdio));
    assert.ok(await store.addIntegration("acme/demo", "sentry", stdio));
    assert.equal(await store.addIntegration("acme/demo", "sentry", stdio), undefined);
    assert.deepEqual(
        (await store.integrations("acme/demo")).map((i) => i.name),
        ["Sentry", "sentry"],
    );
    assert.deepEqual(await store.integrations("Acme/Demo"), []);
});

test("an issue gets one task in its repository, also from concurrent polls", async () => {
    const store = await openStore(home());
    await store.addRepo("acme/demo", "main");
    await store.addRepo("Acme/Demo", "main");
    const issue = { repo: "acme/demo", title: "Issue", body: "", issue: 4 };
    const polled = await Promise.all(Array.from({ length: 5 }, () => store.createIssueTask(issue)));
    assert.equal(polled.filter(Boolean).length, 1);
    assert.ok(await store.createIssueTask({ ...issue, repo: "Acme/Demo" }));
    assert.ok(await store.createIssueTask({ ...issue, issue: 5 }));
    // Tasks without an issue never collide.
    await store.createTask({ repo: "acme/demo", title: "Plain", body: "" });
    await store.createTask({ repo: "acme/demo", title: "Plain", body: "" });
    assert.equal((await store.tasks()).length, 5);
});

test("a removed repository leaves the lists, its tasks stay, adding it again brings it back", async () => {
    const store = await openStore(home());
    await store.addRepo("kit", "main");
    const task = await store.createTask({ repo: "kit", title: "Kept", body: "" });
    assert.equal(await store.activeJobs("kit"), 1);
    await store.update(task.id, { status: "done" });
    assert.equal(await store.activeJobs("kit"), 0);
    assert.equal(await store.deleteRepo("kit"), true);
    assert.equal(await store.deleteRepo("kit"), false);
    assert.deepEqual(await store.repos(), []);
    assert.equal(await store.repo("kit"), undefined);
    assert.equal((await store.task(task.id))?.repo, "kit");
    await store.addRepo("kit", "trunk");
    assert.equal((await store.repo("kit"))?.defaultBranch, "trunk");
});

test("an archived task keeps its history, and each account has its own pins", async () => {
    const store = await openStore(home());
    await store.addRepo("acme/demo", "main");
    const task = await store.createTask({ repo: "acme/demo", title: "Done", body: "" });
    await store.update(task.id, { status: "done", branch: "olimp/x" });
    const archived = await store.archiveTask(task.id, true);
    assert.ok(archived?.archivedAt);
    assert.equal(archived?.branch, "olimp/x");
    assert.equal((await store.tasks()).length, 1);
    assert.equal((await store.archiveTask(task.id, false))?.archivedAt, null);
    assert.equal(await store.archiveTask("ffffffffffff", true), undefined);
    await store.pinTask("ann", task.id, true);
    await store.pinTask("ann", task.id, true);
    assert.deepEqual(await store.pins("ann"), [task.id]);
    assert.deepEqual(await store.pins("bob"), []);
    assert.deepEqual(await store.pins(""), []);
    await store.pinTask("ann", task.id, false);
    assert.deepEqual(await store.pins("ann"), []);
});

test("each account reads tasks and runs on its own", async () => {
    const store = await openStore(home());
    await store.addRepo("acme/demo", "main");
    const task = await store.createTask({ repo: "acme/demo", title: "Done", body: "" });
    const workflow = await store.createWorkflow({
        name: "Flow",
        repo: "acme/demo",
        definition: parseDefinition(chain({ id: "pr", type: "github.draft-pr" })),
    });
    const run = await store.createRun(workflow);
    await store.markRead("ann", "task", task.id, true);
    await store.markRead("ann", "task", task.id, true);
    await store.markRead("ann", "run", run.id, true);
    assert.deepEqual(await store.reads("ann"), { tasks: [task.id], runs: [run.id] });
    assert.deepEqual(await store.reads(""), { tasks: [], runs: [] });
    await store.markRead("ann", "task", task.id, false);
    assert.deepEqual(await store.reads("ann"), { tasks: [], runs: [run.id] });
});

test("the queue skips jobs already taken and projects that are busy", async () => {
    const store = await openStore(home());
    await store.addRepo("acme/demo", "main");
    await store.addRepo("acme/other", "main");
    const a = await store.createTask({ repo: "acme/demo", title: "a", body: "" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await store.createTask({ repo: "acme/demo", title: "b", body: "" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const workflow = await store.createWorkflow({
        name: "Flow",
        repo: "acme/other",
        definition: parseDefinition(chain({ id: "pr", type: "github.draft-pr" })),
    });
    const run = await store.createRun(workflow);
    const next = async (ids: string[], repos: string[]) => {
        const job = await store.nextJob({ ids, repos });
        return job && (job.kind === "task" ? job.task.id : job.run.id);
    };
    assert.equal(await next([], []), a.id);
    assert.equal(await next([a.id], []), b.id);
    assert.equal(await next([a.id], ["acme/demo"]), run.id);
    assert.equal(await next([a.id, b.id, run.id], []), undefined);
});

test("settings are saved by name and deleted with null", async () => {
    const store = await openStore(home());
    await store.saveSettings({ maxParallel: "3", browseRoot: '"/srv"' });
    await store.saveSettings({ maxParallel: "4", browseRoot: null });
    assert.deepEqual(await store.settings(), { maxParallel: "4" });
});

test("concurrent restarts fail each interrupted task and run once", async () => {
    const store = await openStore(home());
    await store.addRepo("acme/demo", "main");
    for (const title of ["a", "b", "c"]) {
        const task = await store.createTask({ repo: "acme/demo", title, body: "" });
        await store.update(task.id, { status: "running" });
    }
    const workflow = await store.createWorkflow({
        name: "Flow",
        repo: "acme/demo",
        definition: parseDefinition(chain({ id: "pr", type: "github.draft-pr" })),
    });
    const run = await store.createRun(workflow);
    await store.updateRun(run.id, { status: "running" });
    const counts = await Promise.all(Array.from({ length: 4 }, () => store.failInterrupted()));
    assert.equal(
        counts.reduce((a, b) => a + b),
        4,
    );
    assert.equal((await store.run(run.id))?.status, "failed");
});

test("concurrent memory writes: one change per version wins, added sections keep distinct places", async () => {
    const store = await openStore(home());
    await store.addRepo("acme/demo", "main");
    const none = { task: null, run: null, node: null };
    const page = { slug: "build", title: "Build", description: "How to build.", kind: "page" };
    const created = await Promise.all(
        Array.from({ length: 3 }, () =>
            store.createMemoryPage("acme/demo", { ...page, kind: "page" }, none),
        ),
    );
    assert.equal(created.filter(Boolean).length, 1);
    const added = await Promise.all(
        ["A", "B", "C", "A"].map((heading) =>
            store.addMemorySection(
                "acme/demo",
                "build",
                { heading, body: heading, sources: [] },
                none,
            ),
        ),
    );
    assert.equal(added.filter(Boolean).length, 3);
    assert.equal(
        await store.addMemorySection(
            "acme/demo",
            "nope",
            { heading: "A", body: "x", sources: [] },
            none,
        ),
        undefined,
    );
    const updates = await Promise.all(
        ["x", "y", "z"].map((body) =>
            store.updateMemorySection(
                "acme/demo",
                "build",
                { heading: "A", body, sources: [] },
                1,
                none,
            ),
        ),
    );
    assert.equal(updates.filter(Boolean).length, 1);
    const read = await store.memoryPage("acme/demo", "build");
    assert.deepEqual(read?.sections.map((s) => s.heading).sort(), ["A", "B", "C"]);
    assert.equal(read?.sections.find((s) => s.heading === "A")?.version, 2);
    const metas = await Promise.all(
        ["One", "Two"].map((title) =>
            store.updateMemoryPage("acme/demo", { ...page, kind: "page", title }, 1, none),
        ),
    );
    assert.equal(metas.filter(Boolean).length, 1);
    assert.equal((await store.memoryPage("acme/demo", "build"))?.version, 2);
});

const schemaOf = async (url: string) => {
    const c = await connect(url);
    try {
        await c.query(`USE \`${parseDatabaseUrl(url).database}\``);
        const [tables] = await c.query<RowDataPacket[]>("SHOW TABLES");
        const schema: string[] = [];
        for (const row of tables) {
            const table = Object.values(row)[0] as string;
            const [[created]] = await c.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table}\``);
            schema.push(created?.["Create Table"]);
        }
        const [migrations] = await c.query("SELECT * FROM schema_migrations ORDER BY version");
        const [loose] = await c.query(
            "SELECT table_name, column_name, collation_name FROM information_schema.columns " +
                "WHERE table_schema = DATABASE() AND collation_name <> 'utf8mb4_bin'",
        );
        const [[database]] = await c.query<RowDataPacket[]>(
            "SELECT default_character_set_name AS charset, default_collation_name AS collation " +
                "FROM information_schema.schemata WHERE schema_name = DATABASE()",
        );
        return { schema, migrations, loose, database };
    } finally {
        await c.end();
    }
};

// On a shared database the tables are dropped after the test; the database itself is not OLIMP's.
mysqlTest("a new MySQL database is migrated once, a restart changes nothing", onMysql, async () => {
    const url = sharedDatabase ? (mysqlUrl as string) : testDatabaseUrl(mysqlUrl as string);
    try {
        const store = await Store.open({ home: home(), databaseUrl: url });
        assert.deepEqual(
            await store.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
        );
        await store.addRepo("acme/demo", "main");
        await store.addNotes("acme/demo", ["kept"], { task: null, run: null, node: null });
        const before = await schemaOf(url);
        assert.equal(before.schema.length, 20);
        assert.deepEqual(before.loose, []);
        if (!sharedDatabase)
            assert.deepEqual(before.database, { charset: "utf8mb4", collation: "utf8mb4_bin" });
        const again = await Store.open({ home: home(), databaseUrl: url });
        assert.deepEqual(
            await again.migrations(),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
        );
        assert.deepEqual(await schemaOf(url), before);
        assert.deepEqual(
            (await again.notes("acme/demo")).map((note) => note.text),
            ["kept"],
        );
        await store.close();
        await again.close();
    } finally {
        if (!sharedDatabase) await dropDatabase(url);
    }
});

// A database as OLIMP left it before accounts (migrations 1 to 4), with a repository that has
// issues on, a task and a note; the MySQL URL, or null for SQLite in `dir`.
async function beforeAccounts(dir: string): Promise<string | null> {
    const older = MIGRATIONS.filter((m) => m.version <= 4);
    const data = [
        "INSERT INTO repos (id, default_branch, added_at, issue_label) " +
            "VALUES ('acme/demo', 'main', 'then', 'olimp')",
        "INSERT INTO tasks (id, repo, title, body, status, created_at, updated_at) " +
            "VALUES ('0123456789ab', 'acme/demo', 'Old', '', 'done', 'then', 'then')",
        "INSERT INTO notes (id, repo, text, created_at) " +
            "VALUES ('aaaaaaaaaaaa', 'acme/demo', 'Old note', 'then')",
    ];
    if (!mysqlUrl) {
        const db = new DatabaseSync(join(dir, "olimp.db"));
        db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT)");
        for (const m of older) {
            db.exec(m.sql.sqlite);
            db.prepare("INSERT INTO schema_migrations VALUES (?, 'then')").run(m.version);
        }
        for (const statement of data) db.exec(statement);
        db.close();
        return null;
    }
    const url = sharedDatabase ? mysqlUrl : testDatabaseUrl(mysqlUrl);
    const { database } = parseDatabaseUrl(url);
    const c = await connect(url);
    try {
        await c.query(
            `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
        );
        await c.query(`USE \`${database}\``);
        await c.query(
            `CREATE TABLE schema_migrations (version INT PRIMARY KEY, applied_at VARCHAR(32)) ${MYSQL_TABLE}`,
        );
        for (const m of older) {
            for (const statement of m.sql.mysql) await c.query(statement);
            await c.query("INSERT INTO schema_migrations VALUES (?, 'then')", [m.version]);
        }
        for (const statement of data) await c.query(statement);
    } finally {
        await c.end();
    }
    return url;
}

test("a database from before accounts gets them, its records keep no author", async () => {
    const dir = home();
    mkdirSync(dir, { recursive: true });
    const url = await beforeAccounts(dir);
    try {
        const store = await Store.open({ home: dir, databaseUrl: url });
        try {
            assert.deepEqual(
                await store.migrations(),
                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
            );
            assert.equal(await store.hasUsers(), false);
            // Migration 9 names the repository by its name and keeps owner/name as GitHub.
            const repo = await store.repo("demo");
            assert.equal(repo?.github, "acme/demo");
            assert.equal(repo?.issueLabel, "olimp");
            assert.equal(repo?.issueAuthor, null);
            const task = await store.task("0123456789ab");
            assert.equal(task?.title, "Old");
            assert.equal(task?.author, null);
            // Migration 6: no usage, no thread or retry, and an empty trace that accepts events.
            assert.deepEqual(
                [task?.thread, task?.retryOf, task?.turns, task?.costUsd, task?.durationMs],
                [null, null, null, null, null],
            );
            assert.deepEqual(await store.threadTasks("0123456789ab"), [task]);
            assert.deepEqual(await store.agentEvents({ task: "0123456789ab" }), []);
            const where = { task: "0123456789ab", run: null, node: null };
            await store.addAgentEvent(where, { type: "tool", summary: "Bash: ls", position: 0 });
            assert.deepEqual(
                (await store.agentEvents({ task: "0123456789ab" })).map((e) => e.summary),
                ["Bash: ls"],
            );
            assert.deepEqual(await store.costs("day", "2000-01-01"), []);
            const [note] = await store.notes("demo");
            assert.deepEqual([note?.text, note?.author], ["Old note", null]);
            const created = await store.createUser({ name: "ada", role: "admin" }, "a".repeat(64));
            assert.equal(created?.user.role, "admin");
            const mine = await store.createTask({
                repo: "demo",
                title: "New",
                body: "",
                author: created?.user.id,
            });
            assert.equal(mine.author, created?.user.id);
        } finally {
            await store.close();
        }
    } finally {
        if (url && !sharedDatabase) await dropDatabase(url);
    }
});

test("accounts: one first account, unique names, the last admin stays, tokens by hash", async () => {
    const store = await openStore(home());
    const hash = (c: string) => c.repeat(64);
    const firsts = await Promise.all(
        ["ada", "bob"].map((name, i) =>
            store.createUser({ name, role: "admin" }, hash(String(i)), true),
        ),
    );
    assert.equal(firsts.filter(Boolean).length, 1);
    const admin = firsts.find(Boolean)?.user;
    assert.ok(admin);
    assert.equal(
        await store.createUser({ name: admin.name, role: "member" }, hash("x")),
        undefined,
    );
    const member = await store.createUser({ name: "dee", role: "member" }, hash("d"));
    assert.equal((await store.userByToken(hash("d")))?.name, "dee");
    assert.equal(await store.userByToken(hash("e")), undefined);
    const second = await store.addToken(admin.id, hash("f"));
    assert.deepEqual(
        (await store.tokens(admin.id)).map((t) => t.id).sort(),
        [firsts.find(Boolean)?.token?.id, second.id].sort(),
    );
    assert.equal(await store.deleteToken(second.id), true);
    assert.equal(await store.userByToken(hash("f")), undefined);
    assert.equal(await store.deleteUser(admin.id), "lastAdmin");
    assert.equal(await store.deleteUser(member?.user.id as string), "deleted");
    assert.equal(await store.userByToken(hash("d")), undefined);
    assert.equal(await store.deleteUser(member?.user.id as string), "missing");
    assert.deepEqual(
        (await store.users()).map((u) => u.name),
        [admin.name],
    );
});

const where = (url: URL) => `${url.hostname}:${url.port || 3306}`;

mysqlTest("MySQL start-up describes the database without the password", onMysql, async () => {
    const store = await openStore(home());
    const url = new URL(mysqlUrl as string);
    const database = sharedDatabase ? url.pathname.slice(1) : "olimp_test_";
    assert.ok(store.description.startsWith(`MySQL ${url.username}@${where(url)}/${database}`));
    assert.ok(!url.password || !store.description.includes(url.password));
});

mysqlTest(
    "a wrong MySQL password fails with host and port, never the password",
    onMysql,
    async () => {
        const url = new URL(mysqlUrl as string);
        url.password = secret;
        const { message, shown } = await openError(url.toString());
        assert.ok(message.includes(`cannot connect to MySQL at ${where(url)}`), message);
        assert.ok(!shown.includes(secret), shown);
    },
);

mysqlTest(
    "a missing database the user may not create fails with its name",
    onMysqlAdmin,
    async () => {
        const admin = await connect(mysqlUrl as string);
        const user = `olimp_t_${randomBytes(4).toString("hex")}`;
        await admin.query(`CREATE USER '${user}'@'%' IDENTIFIED BY '${secret}'`);
        try {
            const url = new URL(testDatabaseUrl(mysqlUrl as string));
            url.username = user;
            url.password = secret;
            const name = url.pathname.slice(1);
            const { message, shown } = await openError(url.toString());
            const expected = `database ${name} on ${where(url)} does not exist and user ${user}`;
            assert.ok(message.includes(`${expected} cannot create it`), message);
            assert.ok(!shown.includes(secret), shown);
        } finally {
            await admin.query(`DROP USER '${user}'@'%'`);
            await admin.end();
        }
    },
);
