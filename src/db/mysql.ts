import {
    type ConnectionOptions,
    createConnection,
    createPool,
    type Pool,
    type PoolConnection,
    type ResultSetHeader,
    type RowDataPacket,
} from "mysql2/promise";
import type { RepoAgents } from "../agents.ts";
import type { Integration, ServerSpec } from "../integrations.ts";
import type { RepoSettings, StoredSecret } from "../project.ts";
import type { Webhook } from "../webhooks.ts";
import type {
    AgentEvent,
    AgentEventInput,
    AuthLink,
    Automation,
    AutomationInput,
    Builtin,
    CostGroup,
    CostRow,
    Credentials,
    Database,
    EventSource,
    Job,
    JobKind,
    MemoryPage,
    MemoryPageInput,
    MemorySection,
    MemorySectionInput,
    Note,
    NoteSource,
    Reads,
    Repo,
    RunPatch,
    RunState,
    RunSummary,
    RunTemplate,
    Session,
    SessionPatch,
    SkillSource,
    Task,
    TaskInput,
    TaskPatch,
    Token,
    User,
    UserInput,
    UserPatch,
    Workflow,
    WorkflowInput,
    WorkflowRun,
} from "./database.ts";
import { MIGRATIONS, MYSQL_TABLE } from "./migrations.ts";
import {
    commandsColumn,
    costsSql,
    eventsSql,
    eventValues,
    INSERT_EVENT,
    jobTable,
    memorySql,
    NO_SKIP,
    newId,
    OLDEST_UNWOVEN,
    queuedJobs,
    type Row,
    runSets,
    sessionSets,
    taskSets,
    toAgentEvent,
    toAutomation,
    toCostRow,
    toCredentials,
    toIntegration,
    toLink,
    toMemoryPages,
    toMemorySection,
    toNote,
    toReads,
    toRepo,
    toRun,
    toSession,
    toSource,
    toSummary,
    toTask,
    toToken,
    toUser,
    toWorkflow,
    UNWOVEN_COUNT,
    UNWOVEN_NOTES,
    userSets,
} from "./rows.ts";

// The MySQL client's names: REQUIRED encrypts without checking the certificate (a self-signed one,
// as on shared hosting), VERIFY_IDENTITY also checks it and the host name.
export const SSL_MODES = ["DISABLED", "REQUIRED", "VERIFY_IDENTITY"] as const;
export type SslMode = (typeof SSL_MODES)[number];

export interface MysqlTarget {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: SslMode;
}

// The URL holds the password, so no error built here quotes it, nor the URL.
export function parseDatabaseUrl(value: string): MysqlTarget {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error("OLIMP_DATABASE_URL is not a valid URL");
    }
    if (url.protocol !== "mysql:")
        throw new Error(`OLIMP_DATABASE_URL must start with mysql://, not ${url.protocol}//`);
    const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "olimp";
    if (!/^[\w$]{1,64}$/.test(database))
        throw new Error(
            `the database name in OLIMP_DATABASE_URL may hold only letters, digits, _ and $`,
        );
    // A misspelt parameter (sslmode=require) must not leave the connection silently unencrypted.
    for (const name of url.searchParams.keys())
        if (name !== "ssl-mode")
            throw new Error(`OLIMP_DATABASE_URL accepts only the ssl-mode parameter, not ${name}`);
    const ssl = (url.searchParams.get("ssl-mode") ?? "DISABLED").toUpperCase();
    if (!SSL_MODES.includes(ssl as SslMode))
        throw new Error(`ssl-mode in OLIMP_DATABASE_URL must be one of ${SSL_MODES.join(", ")}`);
    return {
        host: url.hostname.replace(/^\[(.*)\]$/, "$1") || "127.0.0.1",
        port: url.port ? Number(url.port) : 3306,
        user: decodeURIComponent(url.username) || "root",
        password: decodeURIComponent(url.password),
        database,
        ssl: ssl as SslMode,
    };
}

export const describeTarget = (t: MysqlTarget) =>
    `MySQL ${t.user}@${t.host}:${t.port}/${t.database}` +
    (t.ssl === "DISABLED" ? "" : ` (TLS, ${t.ssl})`);

// Driver messages do not carry the password, but a server or proxy could echo it back.
function reason(error: unknown, t: MysqlTarget): string {
    const message = error instanceof Error ? error.message : String(error);
    return t.password ? message.replaceAll(t.password, "***") : message;
}

export const connectionOptions = (t: MysqlTarget): ConnectionOptions => ({
    host: t.host,
    port: t.port,
    user: t.user,
    password: t.password,
    ssl: t.ssl === "DISABLED" ? undefined : { rejectUnauthorized: t.ssl === "VERIFY_IDENTITY" },
    charset: "UTF8MB4_BIN",
    // Without FOUND_ROWS, INSERT … ON DUPLICATE KEY UPDATE that changes nothing reports 0 rows,
    // which tells a skipped insert from a new row.
    flags: ["-FOUND_ROWS"],
});

// Creates the database when it is missing and the user may; otherwise a readable error.
async function ensureDatabase(t: MysqlTarget): Promise<void> {
    const where = `${t.host}:${t.port}`;
    const connection = await createConnection(connectionOptions(t)).catch((error: unknown) => {
        throw new Error(`cannot connect to MySQL at ${where} as ${t.user}: ${reason(error, t)}`);
    });
    try {
        const [found] = await connection.query<RowDataPacket[]>(
            "SELECT 1 FROM information_schema.schemata WHERE schema_name = ?",
            [t.database],
        );
        if (found.length) return;
        await connection.query(
            `CREATE DATABASE IF NOT EXISTS \`${t.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
        );
    } catch (error) {
        // A database the user has no rights on is not listed either, so it looks missing.
        throw new Error(
            `MySQL database ${t.database} on ${where} does not exist and user ${t.user} ` +
                `cannot create it: ${reason(error, t)}`,
        );
    } finally {
        await connection.end();
    }
}

type Conn = Pool | PoolConnection;

async function all(c: Conn, sql: string, values: unknown[] = []): Promise<Row[]> {
    const [rows] = await c.query<RowDataPacket[]>(sql, values);
    return rows as Row[];
}

const get = async (c: Conn, sql: string, values: unknown[] = []): Promise<Row | undefined> =>
    (await all(c, sql, values))[0];

async function exec(c: Conn, sql: string, values: unknown[] = []): Promise<number> {
    const [result] = await c.query<ResultSetHeader>(sql, values);
    return result.affectedRows;
}

// MySQL through a pool of mysql2 connections. Every atomic operation is one method that takes its
// own connection from the pool and runs in a transaction there, so concurrent requests never share
// it; row locks (UPDATE, SELECT … FOR UPDATE) order them.
export class MysqlDatabase implements Database {
    readonly description: string;
    private readonly pool: Pool;

    private constructor(pool: Pool, description: string) {
        this.pool = pool;
        this.description = description;
    }

    static async open(url: string): Promise<MysqlDatabase> {
        const target = parseDatabaseUrl(url);
        await ensureDatabase(target);
        const pool = createPool({ ...connectionOptions(target), database: target.database });
        const db = new MysqlDatabase(pool, describeTarget(target));
        try {
            await db.migrate(target.database);
        } catch (error) {
            await pool.end();
            throw new Error(`cannot migrate ${db.description}: ${reason(error, target)}`);
        }
        return db;
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    // InnoDB may pick a transaction as a deadlock victim (concurrent inserts against one unique
    // key, say); it was rolled back whole, so it is run again.
    private async transaction<T>(work: (c: PoolConnection) => Promise<T>): Promise<T> {
        const c = await this.pool.getConnection();
        try {
            for (let attempt = 1; ; attempt++) {
                await c.beginTransaction();
                try {
                    const result = await work(c);
                    await c.commit();
                    return result;
                } catch (error) {
                    await c.rollback();
                    const deadlock = (error as { code?: string }).code === "ER_LOCK_DEADLOCK";
                    if (!deadlock || attempt === 3) throw error;
                }
            }
        } finally {
            c.release();
        }
    }

    // A named lock keeps two processes starting at once from applying the same migration; DDL
    // commits implicitly, so a migration interrupted before its row is simply repeated.
    private async migrate(database: string): Promise<void> {
        const c = await this.pool.getConnection();
        const lock = `olimp.${database}`.slice(0, 64);
        try {
            const got = await get(c, "SELECT GET_LOCK(?, 60) AS got", [lock]);
            if (Number(got?.got) !== 1) throw new Error("another OLIMP is still migrating");
            try {
                await c.query(
                    "CREATE TABLE IF NOT EXISTS schema_migrations " +
                        `(version INT PRIMARY KEY, applied_at VARCHAR(32) NOT NULL) ${MYSQL_TABLE}`,
                );
                const applied = new Set(
                    (await all(c, "SELECT version FROM schema_migrations")).map((r) =>
                        Number(r.version),
                    ),
                );
                for (const migration of MIGRATIONS) {
                    if (applied.has(migration.version)) continue;
                    for (const statement of migration.sql.mysql) await c.query(statement);
                    await c.query(
                        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                        [migration.version, new Date().toISOString()],
                    );
                }
            } finally {
                await c.query("SELECT RELEASE_LOCK(?)", [lock]);
            }
        } finally {
            c.release();
        }
    }

    async migrations(): Promise<number[]> {
        const rows = await all(this.pool, "SELECT version FROM schema_migrations ORDER BY version");
        return rows.map((r) => Number(r.version));
    }

    async hasUsers(): Promise<boolean> {
        return (await get(this.pool, "SELECT 1 AS one FROM users LIMIT 1")) !== undefined;
    }

    async users(): Promise<User[]> {
        return (await all(this.pool, "SELECT * FROM users ORDER BY created_at, name")).map(toUser);
    }

    private async readUser(c: Conn, id: string, lock = ""): Promise<User | undefined> {
        const row = await get(c, `SELECT * FROM users WHERE id = ?${lock}`, [id]);
        return row && toUser(row);
    }

    async user(id: string): Promise<User | undefined> {
        return this.readUser(this.pool, id);
    }

    // The locking read of an empty table locks its gap, so a concurrent first account deadlocks
    // and is retried, then finds this one.
    async createUser(
        input: UserInput,
        tokenHash: string | null,
        first = false,
    ): Promise<{ user: User; token: Token | null } | undefined> {
        return this.transaction(async (c) => {
            if (first && (await get(c, "SELECT id FROM users LIMIT 1 FOR UPDATE")))
                return undefined;
            const id = newId();
            const added = await exec(
                c,
                "INSERT INTO users (id, name, role, created_at, email, password_hash) " +
                    "VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
                [
                    id,
                    input.name,
                    input.role,
                    new Date().toISOString(),
                    input.email ?? null,
                    input.passwordHash ?? null,
                ],
            );
            if (!added) return undefined;
            return {
                user: (await this.readUser(c, id)) as User,
                token: tokenHash ? await this.insertToken(c, id, tokenHash) : null,
            };
        });
    }

    async userByEmail(email: string): Promise<User | undefined> {
        const row = await get(this.pool, "SELECT * FROM users WHERE email = ?", [email]);
        return row && toUser(row);
    }

    async credentials(id: string): Promise<Credentials | undefined> {
        const row = await get(this.pool, "SELECT * FROM users WHERE id = ?", [id]);
        return row && toCredentials(row);
    }

    async updateUser(
        id: string,
        patch: UserPatch,
    ): Promise<User | "missing" | "lastAdmin" | "taken"> {
        return this.transaction(async (c) => {
            const user = await this.readUser(c, id, " FOR UPDATE");
            if (!user) return "missing";
            if (user.role === "admin" && patch.role && patch.role !== "admin") {
                const admins = await get(
                    c,
                    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' FOR UPDATE",
                );
                if (Number(admins?.n) <= 1) return "lastAdmin";
            }
            const { sql, values } = userSets(patch);
            if (sql) {
                const clash = await get(
                    c,
                    "SELECT id FROM users WHERE id <> ? AND (name = ? OR email = ?)",
                    [id, patch.name ?? null, patch.email ?? null],
                );
                if (clash) return "taken";
                await exec(c, `UPDATE users SET ${sql} WHERE id = ?`, [...values, id]);
            }
            return (await this.readUser(c, id)) as User;
        });
    }

    async spendBackupCode(id: string, hash: string): Promise<boolean> {
        return this.transaction(async (c) => {
            const row = await get(c, "SELECT * FROM users WHERE id = ? FOR UPDATE", [id]);
            const codes = row ? toCredentials(row).backupCodes : [];
            if (!codes.includes(hash)) return false;
            await exec(c, "UPDATE users SET backup_codes = ? WHERE id = ?", [
                JSON.stringify(codes.filter((code) => code !== hash)),
                id,
            ]);
            return true;
        });
    }

    async createSession(session: Session): Promise<void> {
        await exec(
            this.pool,
            "INSERT INTO sessions (id, user_id, created_at, seen_at, verified_at, code_hash, " +
                "code_expires_at, attempts, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                session.id,
                session.user,
                session.createdAt,
                session.seenAt,
                session.verifiedAt,
                session.codeHash,
                session.codeExpiresAt,
                session.attempts,
                session.ip,
                session.userAgent,
            ],
        );
    }

    async session(id: string): Promise<Session | undefined> {
        const row = await get(this.pool, "SELECT * FROM sessions WHERE id = ?", [id]);
        return row && toSession(row);
    }

    async updateSession(id: string, patch: SessionPatch): Promise<void> {
        const { sql, values } = sessionSets(patch);
        if (sql) await exec(this.pool, `UPDATE sessions SET ${sql} WHERE id = ?`, [...values, id]);
    }

    async sessions(user: string): Promise<Session[]> {
        const sql = "SELECT * FROM sessions WHERE user_id = ? ORDER BY seen_at DESC, id";
        return (await all(this.pool, sql, [user])).map(toSession);
    }

    async deleteSession(id: string): Promise<void> {
        await exec(this.pool, "DELETE FROM sessions WHERE id = ?", [id]);
    }

    async deleteSessions(user: string, keep = ""): Promise<void> {
        await exec(this.pool, "DELETE FROM sessions WHERE user_id = ? AND id <> ?", [user, keep]);
    }

    async purgeSessions(idleBefore: string, startedBefore: string): Promise<number> {
        return exec(this.pool, "DELETE FROM sessions WHERE seen_at < ? OR created_at < ?", [
            idleBefore,
            startedBefore,
        ]);
    }

    async createLink(link: AuthLink): Promise<void> {
        await this.transaction(async (c) => {
            await exec(c, "DELETE FROM auth_links WHERE user_id = ? AND kind = ?", [
                link.user,
                link.kind,
            ]);
            await exec(
                c,
                "INSERT INTO auth_links (id, user_id, kind, expires_at) VALUES (?, ?, ?, ?)",
                [link.id, link.user, link.kind, link.expiresAt],
            );
        });
    }

    async link(id: string): Promise<AuthLink | undefined> {
        const row = await get(this.pool, "SELECT * FROM auth_links WHERE id = ?", [id]);
        return row && toLink(row);
    }

    async takeLink(id: string): Promise<AuthLink | undefined> {
        return this.transaction(async (c) => {
            const row = await get(c, "SELECT * FROM auth_links WHERE id = ? FOR UPDATE", [id]);
            if (!row) return undefined;
            await exec(c, "DELETE FROM auth_links WHERE id = ?", [id]);
            return toLink(row);
        });
    }

    async deleteUser(id: string): Promise<"deleted" | "missing" | "lastAdmin"> {
        return this.transaction(async (c) => {
            const user = await this.readUser(c, id, " FOR UPDATE");
            if (!user) return "missing";
            const admins = await get(
                c,
                "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' FOR UPDATE",
            );
            if (user.role === "admin" && Number(admins?.n) <= 1) return "lastAdmin";
            for (const table of ["tokens", "sessions", "auth_links"])
                await exec(c, `DELETE FROM ${table} WHERE user_id = ?`, [id]);
            await exec(c, "DELETE FROM users WHERE id = ?", [id]);
            return "deleted";
        });
    }

    private async insertToken(c: Conn, user: string, tokenHash: string): Promise<Token> {
        const id = newId();
        await exec(c, "INSERT INTO tokens (id, user_id, hash, created_at) VALUES (?, ?, ?, ?)", [
            id,
            user,
            tokenHash,
            new Date().toISOString(),
        ]);
        return toToken((await get(c, "SELECT * FROM tokens WHERE id = ?", [id])) as Row);
    }

    async addToken(user: string, tokenHash: string): Promise<Token> {
        return this.insertToken(this.pool, user, tokenHash);
    }

    async tokens(user: string): Promise<Token[]> {
        const sql = "SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at, id";
        return (await all(this.pool, sql, [user])).map(toToken);
    }

    async token(id: string): Promise<Token | undefined> {
        const row = await get(this.pool, "SELECT * FROM tokens WHERE id = ?", [id]);
        return row && toToken(row);
    }

    async deleteToken(id: string): Promise<boolean> {
        return (await exec(this.pool, "DELETE FROM tokens WHERE id = ?", [id])) > 0;
    }

    async userByToken(tokenHash: string): Promise<User | undefined> {
        const row = await get(
            this.pool,
            "SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?",
            [tokenHash],
        );
        return row && toUser(row);
    }

    async addRepo(
        id: string,
        defaultBranch: string,
        path: string | null = null,
        github: string | null = null,
    ): Promise<Repo> {
        await exec(
            this.pool,
            "INSERT INTO repos (id, default_branch, added_at, path, github) VALUES (?, ?, ?, ?, ?) " +
                "ON DUPLICATE KEY UPDATE default_branch = ?, removed_at = NULL, path = COALESCE(?, path), " +
                "github = COALESCE(?, github)",
            [
                id,
                defaultBranch,
                new Date().toISOString(),
                path,
                github,
                defaultBranch,
                path,
                github,
            ],
        );
        return (await this.repo(id)) as Repo;
    }

    async repo(id: string): Promise<Repo | undefined> {
        const sql = "SELECT * FROM repos WHERE id = ? AND removed_at IS NULL";
        const row = await get(this.pool, sql, [id]);
        return row && toRepo(row);
    }

    async repos(): Promise<Repo[]> {
        const sql = "SELECT * FROM repos WHERE removed_at IS NULL ORDER BY id";
        return (await all(this.pool, sql)).map(toRepo);
    }

    async setIssueLabel(
        id: string,
        label: string | null,
        author: string | null = null,
    ): Promise<Repo | undefined> {
        await exec(this.pool, "UPDATE repos SET issue_label = ?, issue_author = ? WHERE id = ?", [
            label,
            label === null ? null : author,
            id,
        ]);
        return this.repo(id);
    }

    async setCommands(id: string, commands: string[]): Promise<Repo | undefined> {
        const sql = "UPDATE repos SET commands = ? WHERE id = ?";
        await exec(this.pool, sql, [commandsColumn(commands), id]);
        return this.repo(id);
    }

    async setDefaultBranch(id: string, branch: string): Promise<Repo | undefined> {
        await exec(this.pool, "UPDATE repos SET default_branch = ? WHERE id = ?", [branch, id]);
        return this.repo(id);
    }

    async setRepoAgents(id: string, agents: RepoAgents): Promise<Repo | undefined> {
        await exec(this.pool, "UPDATE repos SET agents = ? WHERE id = ?", [
            JSON.stringify(agents),
            id,
        ]);
        return this.repo(id);
    }

    async setRepoSettings(id: string, settings: RepoSettings): Promise<Repo | undefined> {
        await exec(this.pool, "UPDATE repos SET settings = ? WHERE id = ?", [
            JSON.stringify(settings),
            id,
        ]);
        return this.repo(id);
    }

    private async repoColumn(repo: string, column: "secrets" | "webhooks") {
        const row = await get(this.pool, `SELECT ${column} FROM repos WHERE id = ?`, [repo]);
        return (row?.[column] as string | null | undefined) ?? null;
    }

    async secrets(repo: string): Promise<Record<string, StoredSecret>> {
        return JSON.parse((await this.repoColumn(repo, "secrets")) ?? "{}");
    }

    async setSecrets(repo: string, secrets: Record<string, StoredSecret>): Promise<void> {
        await exec(this.pool, "UPDATE repos SET secrets = ? WHERE id = ?", [
            JSON.stringify(secrets),
            repo,
        ]);
    }

    async webhooks(repo: string): Promise<Webhook[]> {
        return JSON.parse((await this.repoColumn(repo, "webhooks")) ?? "[]");
    }

    async setWebhooks(repo: string, webhooks: Webhook[]): Promise<void> {
        await exec(this.pool, "UPDATE repos SET webhooks = ? WHERE id = ?", [
            JSON.stringify(webhooks),
            repo,
        ]);
    }

    async deleteRepo(id: string): Promise<boolean> {
        const sql = "UPDATE repos SET removed_at = ? WHERE id = ? AND removed_at IS NULL";
        return (await exec(this.pool, sql, [new Date().toISOString(), id])) > 0;
    }

    async activeJobs(repo: string): Promise<number> {
        const sql =
            "SELECT (SELECT COUNT(*) FROM tasks WHERE repo = ? AND status IN ('queued', 'running')) + " +
            "(SELECT COUNT(*) FROM workflow_runs WHERE repo = ? AND status IN ('queued', 'running')) AS n";
        return Number((await get(this.pool, sql, [repo, repo]))?.n ?? 0);
    }

    async integrations(repo: string): Promise<Integration[]> {
        const sql = "SELECT * FROM integrations WHERE repo = ? ORDER BY name";
        return (await all(this.pool, sql, [repo])).map(toIntegration);
    }

    async integration(repo: string, name: string): Promise<Integration | undefined> {
        const sql = "SELECT * FROM integrations WHERE repo = ? AND name = ?";
        const row = await get(this.pool, sql, [repo, name]);
        return row && toIntegration(row);
    }

    async addIntegration(
        repo: string,
        name: string,
        spec: ServerSpec,
    ): Promise<Integration | undefined> {
        const now = new Date().toISOString();
        const { kind, ...config } = spec;
        const added = await exec(
            this.pool,
            "INSERT INTO integrations (repo, name, kind, config, created_at, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = name",
            [repo, name, kind, JSON.stringify(config), now, now],
        );
        return added ? this.integration(repo, name) : undefined;
    }

    async updateIntegration(
        repo: string,
        name: string,
        spec: ServerSpec,
    ): Promise<Integration | undefined> {
        const { kind, ...config } = spec;
        await exec(
            this.pool,
            "UPDATE integrations SET kind = ?, config = ?, updated_at = ? " +
                "WHERE repo = ? AND name = ?",
            [kind, JSON.stringify(config), new Date().toISOString(), repo, name],
        );
        return this.integration(repo, name);
    }

    async deleteIntegration(repo: string, name: string): Promise<boolean> {
        const sql = "DELETE FROM integrations WHERE repo = ? AND name = ?";
        return (await exec(this.pool, sql, [repo, name])) > 0;
    }

    async addSkillSource(id: string, defaultBranch: string): Promise<SkillSource> {
        await exec(
            this.pool,
            "INSERT INTO skill_sources (id, default_branch, added_at) VALUES (?, ?, ?) " +
                "ON DUPLICATE KEY UPDATE default_branch = ?",
            [id, defaultBranch, new Date().toISOString(), defaultBranch],
        );
        return (await this.skillSource(id)) as SkillSource;
    }

    async skillSource(id: string): Promise<SkillSource | undefined> {
        const row = await get(this.pool, "SELECT * FROM skill_sources WHERE id = ?", [id]);
        return row && toSource(row);
    }

    async skillSources(): Promise<SkillSource[]> {
        return (await all(this.pool, "SELECT * FROM skill_sources ORDER BY id")).map(toSource);
    }

    async deleteSkillSource(id: string): Promise<void> {
        await exec(this.pool, "DELETE FROM skill_sources WHERE id = ?", [id]);
    }

    async createTask(input: TaskInput): Promise<Task> {
        return (await this.insertTask(this.pool, input)) as Task;
    }

    async createIssueTask(input: TaskInput & { issue: number }): Promise<Task | undefined> {
        return this.transaction((c) => this.insertTask(c, input));
    }

    async createReviewTask(
        input: TaskInput & { reviewPr: number; reviewSha: string },
    ): Promise<Task | undefined> {
        return this.transaction((c) => this.insertTask(c, input));
    }

    private async insertTask(
        c: Conn,
        input: TaskInput & { issue?: number; reviewSha?: string },
    ): Promise<Task | undefined> {
        const id = newId();
        const now = new Date().toISOString();
        const inserted = await exec(
            c,
            "INSERT INTO tasks (id, repo, title, body, agent, skill, integrations, automation, " +
                "issue, review_pr, review_sha, author, thread, retry_of, model, attachments, variant_group, variant, dispatch, parent, " +
                "parent_run, workspace, branch_name, " +
                "status, created_at, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?) " +
                "ON DUPLICATE KEY UPDATE id = id",
            [
                id,
                input.repo,
                input.title,
                input.body,
                input.agent ?? "claude",
                input.skill ?? null,
                JSON.stringify(input.integrations ?? []),
                input.automation ?? null,
                input.issue ?? null,
                input.reviewPr ?? null,
                input.reviewSha ?? null,
                input.author ?? null,
                input.thread ?? null,
                input.retryOf ?? null,
                input.model ?? null,
                JSON.stringify(input.attachments ?? []),
                input.variantGroup ?? null,
                input.variant ?? null,
                input.dispatch ? JSON.stringify(input.dispatch) : null,
                input.parent ?? null,
                input.parentRun ?? null,
                input.workspace && input.workspace !== "worktree" ? input.workspace : null,
                input.branchName ?? null,
                now,
                now,
            ],
        );
        return inserted ? this.readTask(c, id) : undefined;
    }

    private async readTask(c: Conn, id: string): Promise<Task | undefined> {
        const row = await get(c, "SELECT * FROM tasks WHERE id = ?", [id]);
        return row && toTask(row);
    }

    async task(id: string): Promise<Task | undefined> {
        return this.readTask(this.pool, id);
    }

    async tasks(limit = 100): Promise<Task[]> {
        const sql = "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?";
        return (await all(this.pool, sql, [limit])).map(toTask);
    }

    async threadTasks(thread: string): Promise<Task[]> {
        const sql = "SELECT * FROM tasks WHERE id = ? OR thread = ? ORDER BY created_at, id";
        return (await all(this.pool, sql, [thread, thread])).map(toTask);
    }

    async variantTasks(group: string): Promise<Task[]> {
        const sql = "SELECT * FROM tasks WHERE variant_group = ? ORDER BY variant";
        return (await all(this.pool, sql, [group])).map(toTask);
    }

    async subtasks(parent: string): Promise<Task[]> {
        const sql =
            "SELECT * FROM tasks WHERE parent = ? AND thread IS NULL ORDER BY created_at, id";
        return (await all(this.pool, sql, [parent])).map(toTask);
    }

    async claimDispatchMerge(parent: string): Promise<boolean> {
        const sql = "UPDATE tasks SET dispatch_merge = '' WHERE id = ? AND dispatch_merge IS NULL";
        return (await exec(this.pool, sql, [parent])) === 1;
    }

    async setDispatchMerge(parent: string, merge: string): Promise<void> {
        await exec(this.pool, "UPDATE tasks SET dispatch_merge = ? WHERE id = ?", [merge, parent]);
    }

    async startJob(kind: JobKind, id: string, branch: string): Promise<boolean> {
        const started = await exec(
            this.pool,
            `UPDATE ${jobTable(kind)} SET status = 'running', branch = ?, updated_at = ? ` +
                "WHERE id = ? AND status = 'queued'",
            [branch, new Date().toISOString(), id],
        );
        return started > 0;
    }

    async cancelQueued(kind: JobKind, id: string, error: string): Promise<boolean> {
        const cancelled = await exec(
            this.pool,
            `UPDATE ${jobTable(kind)} SET status = 'cancelled', error = ?, updated_at = ? ` +
                "WHERE id = ? AND status = 'queued'",
            [error, new Date().toISOString(), id],
        );
        return cancelled > 0;
    }

    async nextJob(skip = NO_SKIP): Promise<Job | undefined> {
        const { sql, values } = queuedJobs(skip);
        const row = await get(this.pool, sql, values);
        if (!row) return undefined;
        const id = row.id as string;
        return row.kind === "task"
            ? { kind: "task", task: (await this.task(id)) as Task }
            : { kind: "run", run: (await this.run(id)) as WorkflowRun };
    }

    async update(id: string, patch: TaskPatch): Promise<void> {
        const { sql, values } = taskSets(patch);
        if (!sql) return;
        await exec(this.pool, `UPDATE tasks SET ${sql}, updated_at = ? WHERE id = ?`, [
            ...values,
            new Date().toISOString(),
            id,
        ]);
    }

    async archiveTask(id: string, archived: boolean): Promise<Task | undefined> {
        const now = new Date().toISOString();
        await exec(this.pool, "UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?", [
            archived ? now : null,
            now,
            id,
        ]);
        return this.task(id);
    }

    async pins(user: string): Promise<string[]> {
        const sql = "SELECT task FROM task_pins WHERE user_id = ? ORDER BY created_at, task";
        return (await all(this.pool, sql, [user])).map((r) => r.task as string);
    }

    async pinTask(user: string, task: string, pinned: boolean): Promise<void> {
        if (pinned)
            await exec(this.pool, "INSERT IGNORE INTO task_pins VALUES (?, ?, ?)", [
                user,
                task,
                new Date().toISOString(),
            ]);
        else
            await exec(this.pool, "DELETE FROM task_pins WHERE user_id = ? AND task = ?", [
                user,
                task,
            ]);
    }

    async reads(user: string): Promise<Reads> {
        const sql = "SELECT kind, job FROM job_reads WHERE user_id = ? ORDER BY job";
        return toReads(await all(this.pool, sql, [user]));
    }

    async markRead(user: string, kind: JobKind, id: string, read: boolean): Promise<void> {
        if (read)
            await exec(this.pool, "INSERT IGNORE INTO job_reads VALUES (?, ?, ?, ?)", [
                user,
                kind,
                id,
                new Date().toISOString(),
            ]);
        else
            await exec(
                this.pool,
                "DELETE FROM job_reads WHERE user_id = ? AND kind = ? AND job = ?",
                [user, kind, id],
            );
    }

    async settings(): Promise<Record<string, string>> {
        const rows = await all(this.pool, "SELECT name, value FROM settings");
        return Object.fromEntries(rows.map((r) => [r.name as string, r.value as string]));
    }

    async saveSettings(values: Record<string, string | null>): Promise<void> {
        const now = new Date().toISOString();
        for (const [name, value] of Object.entries(values)) {
            if (value === null)
                await exec(this.pool, "DELETE FROM settings WHERE name = ?", [name]);
            else
                await exec(
                    this.pool,
                    "INSERT INTO settings VALUES (?, ?, ?) " +
                        "ON DUPLICATE KEY UPDATE value = ?, updated_at = ?",
                    [name, value, now, value, now],
                );
        }
    }

    async failInterrupted(): Promise<number> {
        const now = new Date().toISOString();
        const error = "interrupted by restart";
        return this.transaction(async (c) => {
            const tasks = await exec(
                c,
                "UPDATE tasks SET status = 'failed', error = ?, updated_at = ? " +
                    "WHERE status = 'running'",
                [error, now],
            );
            const sql = "SELECT * FROM workflow_runs WHERE status = 'running' FOR UPDATE";
            const running = (await all(c, sql)).map(toRun);
            for (const run of running)
                await this.patchRun(c, run.id, {
                    status: "failed",
                    error,
                    steps: run.steps.map((s) =>
                        s.status === "running"
                            ? { ...s, status: "failed", finishedAt: now, error }
                            : s,
                    ),
                });
            return tasks + running.length;
        });
    }

    async createAutomation(
        input: AutomationInput,
        author: string | null = null,
        builtin: Builtin | null = null,
    ): Promise<Automation> {
        const id = newId();
        await exec(
            this.pool,
            "INSERT INTO automations (id, name, cron, workflow, repo, title, body, agent, " +
                "skill, integrations, enabled, created_at, author, builtin) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                id,
                input.name,
                input.cron,
                input.workflow,
                input.repo,
                input.title,
                input.body,
                input.agent,
                input.skill,
                input.integrations && JSON.stringify(input.integrations),
                input.enabled ? 1 : 0,
                new Date().toISOString(),
                author,
                builtin,
            ],
        );
        return (await this.automation(id)) as Automation;
    }

    private async readAutomation(c: Conn, id: string): Promise<Automation | undefined> {
        const row = await get(c, "SELECT * FROM automations WHERE id = ?", [id]);
        return row && toAutomation(row);
    }

    async automation(id: string): Promise<Automation | undefined> {
        return this.readAutomation(this.pool, id);
    }

    async automations(): Promise<Automation[]> {
        const sql = "SELECT * FROM automations ORDER BY created_at, id";
        return (await all(this.pool, sql)).map(toAutomation);
    }

    async updateAutomation(id: string, input: AutomationInput): Promise<Automation | undefined> {
        await exec(
            this.pool,
            "UPDATE automations SET name = ?, cron = ?, workflow = ?, repo = ?, title = ?, " +
                "body = ?, agent = ?, skill = ?, integrations = ?, enabled = ? WHERE id = ?",
            [
                input.name,
                input.cron,
                input.workflow,
                input.repo,
                input.title,
                input.body,
                input.agent,
                input.skill,
                input.integrations && JSON.stringify(input.integrations),
                input.enabled ? 1 : 0,
                id,
            ],
        );
        return this.automation(id);
    }

    async deleteAutomation(id: string): Promise<boolean> {
        return (await exec(this.pool, "DELETE FROM automations WHERE id = ?", [id])) > 0;
    }

    async automationsOf(workflow: string): Promise<Automation[]> {
        const sql = "SELECT * FROM automations WHERE workflow = ?";
        return (await all(this.pool, sql, [workflow])).map(toAutomation);
    }

    async runAutomation(id: string, slot?: string): Promise<Task | WorkflowRun | undefined> {
        const now = new Date().toISOString();
        return this.transaction(async (c) => {
            // The UPDATE takes the row lock: a concurrent claim of the slot waits, then sees it.
            if (slot) {
                const claimed = await exec(
                    c,
                    "UPDATE automations SET last_slot = ?, last_run_at = ? WHERE id = ? " +
                        "AND enabled = 1 AND (last_slot IS NULL OR last_slot < ?)",
                    [slot, now, id, slot],
                );
                if (!claimed) return undefined;
            } else {
                await exec(c, "UPDATE automations SET last_run_at = ? WHERE id = ?", [now, id]);
            }
            const a = await this.readAutomation(c, id);
            if (!a) return undefined;
            return a.workflow ? this.queueAutomationRun(c, a) : this.queueAutomationTask(c, a);
        });
    }

    private async queueAutomationTask(c: Conn, a: Automation): Promise<Task> {
        return (await this.insertTask(c, {
            repo: a.repo as string,
            title: a.title as string,
            body: a.body ?? "",
            agent: a.agent ?? "claude",
            skill: a.skill,
            integrations: a.integrations ?? [],
            automation: a.id,
            author: a.author,
        })) as Task;
    }

    private async queueAutomationRun(c: Conn, a: Automation): Promise<WorkflowRun> {
        const workflow = await this.readWorkflow(c, a.workflow as string);
        if (!workflow) throw new Error(`workflow ${a.workflow} of automation ${a.id} is gone`);
        return this.insertRun(c, workflow, a.id, a.author);
    }

    async createWorkflow(input: WorkflowInput, author: string | null = null): Promise<Workflow> {
        const id = newId();
        const now = new Date().toISOString();
        await exec(
            this.pool,
            "INSERT INTO workflows (id, name, description, repo, definition, author, created_at, " +
                "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                id,
                input.name,
                input.description ?? "",
                input.repo,
                JSON.stringify(input.definition),
                author,
                now,
                now,
            ],
        );
        return (await this.workflow(id)) as Workflow;
    }

    private async readWorkflow(c: Conn, id: string): Promise<Workflow | undefined> {
        const row = await get(c, "SELECT * FROM workflows WHERE id = ?", [id]);
        return row && toWorkflow(row);
    }

    async workflow(id: string): Promise<Workflow | undefined> {
        return this.readWorkflow(this.pool, id);
    }

    async workflows(): Promise<Workflow[]> {
        const sql = "SELECT * FROM workflows ORDER BY created_at, id";
        return (await all(this.pool, sql)).map(toWorkflow);
    }

    async updateWorkflow(id: string, input: WorkflowInput): Promise<Workflow | undefined> {
        await exec(
            this.pool,
            "UPDATE workflows SET name = ?, description = ?, repo = ?, definition = ?, " +
                "updated_at = ? WHERE id = ?",
            [
                input.name,
                input.description ?? "",
                input.repo,
                JSON.stringify(input.definition),
                new Date().toISOString(),
                id,
            ],
        );
        return this.workflow(id);
    }

    async deleteWorkflow(id: string): Promise<boolean> {
        return (await exec(this.pool, "DELETE FROM workflows WHERE id = ?", [id])) > 0;
    }

    async createRun(
        workflow: RunTemplate,
        automation: string | null = null,
        author: string | null = null,
        retryOf: string | null = null,
        input: string | null = null,
        parentRun: string | null = null,
        thread: string | null = null,
    ): Promise<WorkflowRun> {
        return this.insertRun(
            this.pool,
            workflow,
            automation,
            author,
            retryOf,
            input,
            parentRun,
            thread,
        );
    }

    private async insertRun(
        c: Conn,
        workflow: RunTemplate,
        automation: string | null,
        author: string | null,
        retryOf: string | null = null,
        input: string | null = null,
        parentRun: string | null = null,
        thread: string | null = null,
    ): Promise<WorkflowRun> {
        const id = newId();
        const now = new Date().toISOString();
        await exec(
            c,
            "INSERT INTO workflow_runs (id, workflow, name, repo, definition, automation, " +
                "author, retry_of, input, parent_run, thread, status, created_at, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
            [
                id,
                workflow.id,
                workflow.name,
                workflow.repo,
                JSON.stringify(workflow.definition),
                automation,
                author,
                retryOf,
                input,
                parentRun,
                thread,
                now,
                now,
            ],
        );
        return (await this.readRun(c, id)) as WorkflowRun;
    }

    private async readRun(c: Conn, id: string): Promise<WorkflowRun | undefined> {
        const row = await get(c, "SELECT * FROM workflow_runs WHERE id = ?", [id]);
        return row && toRun(row);
    }

    async run(id: string): Promise<WorkflowRun | undefined> {
        return this.readRun(this.pool, id);
    }

    async threadRuns(thread: string): Promise<WorkflowRun[]> {
        const sql =
            "SELECT * FROM workflow_runs WHERE id = ? OR thread = ? ORDER BY created_at, id";
        return (await all(this.pool, sql, [thread, thread])).map(toRun);
    }

    async runs(limit = 100): Promise<RunSummary[]> {
        const sql = "SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT ?";
        return (await all(this.pool, sql, [limit])).map(toSummary);
    }

    async updateRun(id: string, patch: RunPatch): Promise<void> {
        await this.patchRun(this.pool, id, patch);
    }

    async resumeRun(id: string, state: RunState, from = "waiting"): Promise<boolean> {
        const sql =
            "UPDATE workflow_runs SET status = 'queued', state = ?, error = NULL, updated_at = ? " +
            "WHERE id = ? AND status = ?";
        const values = [JSON.stringify(state), new Date().toISOString(), id, from];
        return (await exec(this.pool, sql, values)) > 0;
    }

    async cancelWaiting(id: string, error: string): Promise<boolean> {
        const sql =
            "UPDATE workflow_runs SET status = 'cancelled', error = ?, updated_at = ? " +
            "WHERE id = ? AND status = 'waiting'";
        return (await exec(this.pool, sql, [error, new Date().toISOString(), id])) > 0;
    }

    async waitingRuns(): Promise<WorkflowRun[]> {
        const sql = "SELECT * FROM workflow_runs WHERE status = 'waiting' ORDER BY created_at";
        return (await all(this.pool, sql)).map(toRun);
    }

    private async patchRun(c: Conn, id: string, patch: RunPatch): Promise<void> {
        const { sql, values } = runSets(patch);
        if (!sql) return;
        await exec(c, `UPDATE workflow_runs SET ${sql}, updated_at = ? WHERE id = ?`, [
            ...values,
            new Date().toISOString(),
            id,
        ]);
    }

    async addAgentEvent(source: EventSource, event: AgentEventInput): Promise<AgentEvent> {
        const at = new Date().toISOString();
        const [added] = await this.pool.query<ResultSetHeader>(
            INSERT_EVENT,
            eventValues(source, event, at),
        );
        return {
            seq: Number(added.insertId),
            ...source,
            ...event,
            detail: event.detail ?? null,
            createdAt: at,
        };
    }

    async agentEvents(of: { task: string } | { run: string }): Promise<AgentEvent[]> {
        const { sql, value } = eventsSql(of);
        return (await all(this.pool, sql, [value])).map(toAgentEvent);
    }

    async purgeAgentEvents(before: string): Promise<number> {
        return exec(this.pool, "DELETE FROM agent_events WHERE created_at < ?", [before]);
    }

    async costs(group: CostGroup, since: string): Promise<CostRow[]> {
        return (await all(this.pool, costsSql(group), [since, since])).map(toCostRow);
    }

    async addNotes(repo: string, texts: string[], source: NoteSource): Promise<Note[]> {
        const now = new Date().toISOString();
        return this.transaction(async (c) => {
            const notes: Note[] = [];
            for (const text of texts) {
                const id = newId();
                await exec(
                    c,
                    "INSERT INTO notes (id, repo, text, task, run, node, author, created_at) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        id,
                        repo,
                        text,
                        source.task,
                        source.run,
                        source.node,
                        source.author ?? null,
                        now,
                    ],
                );
                notes.push(toNote((await get(c, "SELECT * FROM notes WHERE id = ?", [id])) as Row));
            }
            return notes;
        });
    }

    async note(id: string): Promise<Note | undefined> {
        const row = await get(this.pool, "SELECT * FROM notes WHERE id = ?", [id]);
        return row && toNote(row);
    }

    async notes(repo: string | null, limit = 500): Promise<Note[]> {
        const order = "ORDER BY created_at DESC, seq DESC LIMIT ?";
        const rows = repo
            ? await all(this.pool, `SELECT * FROM notes WHERE repo = ? ${order}`, [repo, limit])
            : await all(this.pool, `SELECT * FROM notes ${order}`, [limit]);
        return rows.map(toNote);
    }

    async deleteNote(id: string): Promise<boolean> {
        return (await exec(this.pool, "DELETE FROM notes WHERE id = ?", [id])) > 0;
    }

    // In one transaction, so the three reads see the same moment.
    private readPages(repo: string, slug?: string): Promise<MemoryPage[]> {
        const sql = memorySql(slug !== undefined);
        const args = slug === undefined ? [repo] : [repo, slug];
        return this.transaction(async (c) =>
            toMemoryPages(
                await all(c, sql.pages, args),
                await all(c, sql.sections, args),
                await all(c, sql.sources, args),
            ),
        );
    }

    async memoryPages(repo: string): Promise<MemoryPage[]> {
        return this.readPages(repo);
    }

    async memoryPage(repo: string, slug: string): Promise<MemoryPage | undefined> {
        return (await this.readPages(repo, slug))[0];
    }

    async unwovenNotes(
        repo: string,
        limit = 500,
        oldestFirst = false,
    ): Promise<{ total: number; notes: Note[] }> {
        const count = await get(this.pool, UNWOVEN_COUNT, [repo]);
        const rows = await all(this.pool, oldestFirst ? OLDEST_UNWOVEN : UNWOVEN_NOTES, [
            repo,
            limit,
        ]);
        return { total: Number(count?.total), notes: rows.map(toNote) };
    }

    async createMemoryPage(
        repo: string,
        input: MemoryPageInput,
        source: NoteSource,
    ): Promise<MemoryPage | undefined> {
        const now = new Date().toISOString();
        // In a transaction for its retry: concurrent inserts against one key can deadlock.
        const added = await this.transaction((c) =>
            exec(
                c,
                "INSERT INTO memory_pages (repo, slug, title, description, kind, version, task, " +
                    "run, node, author, created_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE slug = slug",
                [
                    repo,
                    input.slug,
                    input.title,
                    input.description,
                    input.kind,
                    source.task,
                    source.run,
                    source.node,
                    source.author ?? null,
                    now,
                    now,
                ],
            ),
        );
        return added ? this.memoryPage(repo, input.slug) : undefined;
    }

    async updateMemoryPage(
        repo: string,
        input: MemoryPageInput,
        version: number,
        source: NoteSource,
    ): Promise<MemoryPage | undefined> {
        const updated = await exec(
            this.pool,
            "UPDATE memory_pages SET title = ?, description = ?, kind = ?, version = version + 1, " +
                "task = ?, run = ?, node = ?, author = ?, updated_at = ? " +
                "WHERE repo = ? AND slug = ? AND version = ?",
            [
                input.title,
                input.description,
                input.kind,
                source.task,
                source.run,
                source.node,
                source.author ?? null,
                new Date().toISOString(),
                repo,
                input.slug,
                version,
            ],
        );
        return updated ? this.memoryPage(repo, input.slug) : undefined;
    }

    private async readSection(
        c: Conn,
        repo: string,
        slug: string,
        heading: string,
    ): Promise<MemorySection | undefined> {
        const row = await get(
            c,
            "SELECT * FROM memory_sections WHERE repo = ? AND page = ? AND heading = ?",
            [repo, slug, heading],
        );
        if (!row) return undefined;
        const sql = "SELECT note FROM memory_sources WHERE section = ? ORDER BY position";
        const sources = await all(c, sql, [row.id]);
        return toMemorySection(
            row,
            sources.map((s) => s.note as string),
        );
    }

    private async cite(c: Conn, section: string, sources: string[]): Promise<void> {
        await exec(c, "DELETE FROM memory_sources WHERE section = ?", [section]);
        for (const [i, note] of sources.entries())
            await exec(c, "INSERT INTO memory_sources (section, note, position) VALUES (?, ?, ?)", [
                section,
                note,
                i,
            ]);
    }

    // The page row is locked first, so concurrent additions to one page get distinct positions.
    async addMemorySection(
        repo: string,
        slug: string,
        input: MemorySectionInput,
        source: NoteSource,
    ): Promise<MemorySection | undefined> {
        return this.transaction(async (c) => {
            const page = await get(
                c,
                "SELECT slug FROM memory_pages WHERE repo = ? AND slug = ? FOR UPDATE",
                [repo, slug],
            );
            if (!page) return undefined;
            const last = await get(
                c,
                "SELECT COALESCE(MAX(position), 0) AS last_position FROM memory_sections " +
                    "WHERE repo = ? AND page = ?",
                [repo, slug],
            );
            const id = newId();
            const added = await exec(
                c,
                "INSERT INTO memory_sections (id, repo, page, position, heading, body, version, " +
                    "task, run, node, author, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
                [
                    id,
                    repo,
                    slug,
                    Number(last?.last_position) + 1,
                    input.heading,
                    input.body,
                    source.task,
                    source.run,
                    source.node,
                    source.author ?? null,
                    new Date().toISOString(),
                ],
            );
            if (!added) return undefined;
            await this.cite(c, id, input.sources);
            return this.readSection(c, repo, slug, input.heading);
        });
    }

    async updateMemorySection(
        repo: string,
        slug: string,
        input: MemorySectionInput,
        version: number,
        source: NoteSource,
    ): Promise<MemorySection | undefined> {
        return this.transaction(async (c) => {
            const row = await get(
                c,
                "SELECT id FROM memory_sections " +
                    "WHERE repo = ? AND page = ? AND heading = ? AND version = ? FOR UPDATE",
                [repo, slug, input.heading, version],
            );
            if (!row) return undefined;
            await exec(
                c,
                "UPDATE memory_sections SET body = ?, version = version + 1, task = ?, run = ?, " +
                    "node = ?, author = ?, updated_at = ? WHERE id = ?",
                [
                    input.body,
                    source.task,
                    source.run,
                    source.node,
                    source.author ?? null,
                    new Date().toISOString(),
                    row.id,
                ],
            );
            await this.cite(c, row.id as string, input.sources);
            return this.readSection(c, repo, slug, input.heading);
        });
    }
}
