import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { dirname, join } from "node:path";
import { afterEach, before } from "node:test";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import { connectionOptions, parseDatabaseUrl } from "../src/db/mysql.ts";
import { must } from "../src/proc.ts";
import { Store } from "../src/store.ts";

process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "OLIMP test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "test@olimp.invalid";

// With OLIMP_TEST_MYSQL_URL every test runs on MySQL. Without a database in the URL (a user who
// may create databases, as in CI) each test gets its own; with one (a hosting account that may
// not) all tests share it, start from no tables and must run one at a time (`pnpm test:mysql`).
export const mysqlUrl = process.env.OLIMP_TEST_MYSQL_URL || null;
export const sharedDatabase = mysqlUrl !== null && new URL(mysqlUrl).pathname.length > 1;
if (process.env.npm_lifecycle_event === "test:mysql" && !mysqlUrl)
    throw new Error("pnpm test:mysql needs OLIMP_TEST_MYSQL_URL, in .env or the environment");

const databases = new Map<string, string>();
const opened: Store[] = [];

// A fresh MySQL database URL, dropped after the current test.
export function testDatabaseUrl(base: string): string {
    const url = new URL(base);
    url.pathname = `/olimp_test_${randomBytes(6).toString("hex")}`;
    return url.toString();
}

const forHome = (home: string, base: string) => {
    const url = databases.get(home) ?? testDatabaseUrl(base);
    databases.set(home, url);
    return url;
};

// The store of a test's OLIMP_HOME: SQLite there, or with OLIMP_TEST_MYSQL_URL a MySQL database of
// its own, the same one again when the test reopens that home (a restart).
export async function openStore(home: string): Promise<Store> {
    const databaseUrl = mysqlUrl && (sharedDatabase ? mysqlUrl : forHome(home, mysqlUrl));
    const store = await Store.open({ home, databaseUrl });
    opened.push(store);
    return store;
}

// A connection as OLIMP makes it (ssl-mode included), without selecting a database.
export const connect = (url: string) => createConnection(connectionOptions(parseDatabaseUrl(url)));

export async function dropDatabase(url: string): Promise<void> {
    const connection = await connect(url);
    try {
        await connection.query(`DROP DATABASE IF EXISTS \`${parseDatabaseUrl(url).database}\``);
    } finally {
        await connection.end();
    }
}

async function dropTables(url: string): Promise<void> {
    const connection = await connect(url);
    try {
        const { database } = parseDatabaseUrl(url);
        await connection.query("SET FOREIGN_KEY_CHECKS = 0");
        const [tables] = await connection.query<RowDataPacket[]>(
            "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?",
            [database],
        );
        for (const { name } of tables)
            await connection.query(`DROP TABLE IF EXISTS \`${database}\`.\`${name}\``);
    } finally {
        await connection.end();
    }
}

// Every test starts with its own databases, or with an empty shared one, so the suite still passes
// alone and in any order. The shared one is also emptied first, after a run that was cut short.
if (sharedDatabase) before(() => dropTables(mysqlUrl as string));
afterEach(async () => {
    for (const store of opened.splice(0)) await store.close();
    if (sharedDatabase) await dropTables(mysqlUrl as string);
    for (const url of databases.values()) await dropDatabase(url);
    databases.clear();
});

export function script(root: string, name: string, body: string): string {
    const path = join(root, name);
    writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
}

// A local bare repository stands in for one on GitHub.
export async function bareRepo(
    root: string,
    name: string,
    files: Record<string, string>,
): Promise<{ bare: string; seed: string }> {
    const seed = join(root, `${name}-seed`);
    const bare = join(root, `${name}.git`);
    await must("git", ["init", "-q", "-b", "main", seed]);
    await commitFiles(seed, files, "init");
    await must("git", ["clone", "-q", "--bare", seed, bare]);
    return { bare, seed };
}

export async function commitFiles(
    dir: string,
    files: Record<string, string>,
    message: string,
): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
    await must("git", ["-C", dir, "add", "-A"]);
    await must("git", ["-C", dir, "commit", "-q", "-m", message]);
}

// A `${NAME}` reference to an environment variable of the OLIMP process.
export const ref = (name: string) => `\${${name}}`;

export const ghFiles = (root: string) => ({
    // One line per `gh issue list`: the repository and the label.
    issueCalls: join(root, "gh-issue-list.log"),
    // The issues of a repository as `gh issue list --json` prints them; without the file it fails.
    issues: (repo: string) => join(root, `issues-${repo.replace("/", "_")}.json`),
    // The arguments of the last `gh pr create`, one per line.
    prArgs: join(root, "gh-pr-create.args"),
    // The arguments of the last `gh repo create`, one per line.
    createArgs: join(root, "gh-repo-create.args"),
    // What `gh pr view` prints, checks in statusCheckRollup; without the file the pull request merges
    // cleanly and has no checks yet.
    prView: join(root, "gh-pr-view.json"),
    // One line per comment, edit or ready call on a pull request or issue.
    calls: join(root, "gh-calls.log"),
});

// The fake gh knows each repository by its owner/name, clones the matching bare one, lists issues
// from files, "creates" a repository and "opens" a PR.
export function fakeGh(root: string, repos: Record<string, string>): string {
    const files = ghFiles(root);
    const clones = Object.entries(repos)
        .map(([id, bare]) => `  "repo clone ${id}") git clone -q "${bare}" "$4" ;;`)
        .join("\n");
    return script(
        root,
        "gh",
        `case "$1 $2 $3" in
${clones}
  "repo view "*) echo '{"defaultBranchRef":{"name":"main"}}' ;;
  "api user --jq") echo '{"login":"octo","name":"Octo Cat","avatar_url":"https://avatars.githubusercontent.com/u/1"}' ;;
  "api --paginate user/orgs") printf '%s\n' '{"login":"acme","description":"Acme Inc"}' '{"login":"bad name"}' ;;
  "repo create "*) printf '%s\\n' "$@" > "${files.createArgs}"; echo "https://github.com/$3" ;;
  "issue list --repo")
    echo "$4 $8" >> "${files.issueCalls}"
    f="${root}/issues-$(echo "$4" | tr / _).json"
    [ -f "$f" ] && cat "$f" || { echo "could not resolve to a Repository: $4" >&2; exit 1; } ;;
  "pr create "*) printf '%s\\n' "$@" > "${files.prArgs}"; echo "https://github.com/acme/demo/pull/7" ;;
  "pr view "*) cat "${files.prView}" 2>/dev/null || echo '{"mergeable":"MERGEABLE"}' ;;
  "pr comment "*|"pr edit "*|"pr ready "*|"issue comment "*|"label create "*) echo "$*" >> "${files.calls}" ;;
  "label list "*) echo '[{"name":"olimp"}]' ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac`,
    );
}

// An SMTP server that accepts every message and keeps it, decoded, for the test to read.
export async function fakeSmtp(): Promise<{
    url: string;
    messages: string[];
    close: () => void;
}> {
    const messages: string[] = [];
    const server = createNetServer((socket) => {
        let data: string | null = null;
        let buffer = "";
        socket.write("220 fake ESMTP\r\n");
        socket.on("data", (chunk) => {
            buffer += chunk.toString("utf8");
            for (;;) {
                if (data !== null) {
                    const end = buffer.indexOf("\r\n.\r\n");
                    if (end < 0) return;
                    // Quoted-printable: soft line breaks and =XX escapes.
                    messages.push(
                        (data + buffer.slice(0, end))
                            .replace(/=\r\n/g, "")
                            .replace(/=([0-9A-F]{2})/g, (_, hex) =>
                                String.fromCharCode(parseInt(hex, 16)),
                            ),
                    );
                    buffer = buffer.slice(end + 5);
                    data = null;
                    socket.write("250 queued\r\n");
                    continue;
                }
                const line = buffer.indexOf("\r\n");
                if (line < 0) return;
                const command = buffer.slice(0, line).toUpperCase();
                buffer = buffer.slice(line + 2);
                if (command.startsWith("DATA")) {
                    data = "";
                    socket.write("354 go on\r\n");
                } else if (command.startsWith("QUIT")) socket.end("221 bye\r\n");
                else socket.write(command.startsWith("EHLO") ? "250 fake\r\n" : "250 ok\r\n");
            }
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return { url: `smtp://127.0.0.1:${port}`, messages, close: () => server.close() };
}

// Workflow graphs as the editor saves them: an agent step, and steps chained from the start node
// through each one's first port.
export const step = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: "agent",
    name,
    prompt: "Do the step.",
    ...extra,
});

const firstPort = (node: Record<string, unknown>) =>
    node.type === "github.draft-pr" ? "created" : node.type === "check" ? "pass" : "done";

export function chain(...nodes: Record<string, unknown>[]) {
    return {
        nodes: [{ id: "start", type: "start" }, ...nodes],
        edges: nodes.map((node, i) => {
            const before = nodes[i - 1];
            return {
                from: before ? `${before.id}.${firstPort(before)}` : "start.next",
                to: node.id as string,
            };
        }),
    };
}
