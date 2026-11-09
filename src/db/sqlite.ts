import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
import { automationsTable, MIGRATIONS } from "./migrations.ts";
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

const AUTOMATION_COLUMNS =
    "id, name, cron, repo, title, body, agent, skill, enabled, last_run_at, last_slot, created_at";

// node:sqlite works synchronously and all requests share one connection, so a transaction must
// never span an await or another request would run inside it. The type refuses async work, which
// would commit before it finished.
export function transaction<T>(
    db: DatabaseSync,
    work: () => T & (T extends PromiseLike<unknown> ? never : unknown),
): T {
    db.exec("BEGIN IMMEDIATE");
    try {
        const result = work();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

// SQLite through the built-in node:sqlite, one file in OLIMP_HOME. Atomic operations are whole
// methods that go from BEGIN to COMMIT without yielding.
export class SqliteDatabase implements Database {
    readonly description: string;
    private readonly db: DatabaseSync;

    private constructor(db: DatabaseSync, path: string) {
        this.db = db;
        this.description = `SQLite ${path}`;
    }

    static async open(home: string): Promise<SqliteDatabase> {
        mkdirSync(home, { recursive: true });
        const path = join(home, "olimp.db");
        const store = new SqliteDatabase(new DatabaseSync(path), path);
        store.migrate();
        return store;
    }

    async close(): Promise<void> {
        if (this.db.isOpen) this.db.close();
    }

    private transaction<T>(work: () => T & (T extends PromiseLike<unknown> ? never : unknown)): T {
        return transaction(this.db, work);
    }

    private migrate(): void {
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec(
            "CREATE TABLE IF NOT EXISTS schema_migrations " +
                "(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        );
        const applied = new Set(
            (this.db.prepare("SELECT version FROM schema_migrations").all() as Row[]).map((r) =>
                Number(r.version),
            ),
        );
        for (const migration of MIGRATIONS) {
            if (applied.has(migration.version)) continue;
            this.transaction(() => {
                // A database from before numbered migrations has tables but no version yet.
                if (migration.version === 1 && this.columns("repos").length) this.adoptLegacy();
                this.db.exec(migration.sql.sqlite);
                this.db
                    .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
                    .run(migration.version, new Date().toISOString());
            });
        }
    }

    private columns(table: string): string[] {
        const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
        return rows.map((c) => c.name as string);
    }

    // Brings the existing tables of a database from stages 0 to 5 to the stage 5 schema; the
    // tables it lacks are then created by migration 1. MySQL always starts with migrations.
    private adoptLegacy(): void {
        const tasks = this.columns("tasks");
        const addTo = (table: string, have: string[], column: string, type: string) => {
            if (have.length && !have.includes(column))
                this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
        };
        addTo("tasks", tasks, "agent", "TEXT NOT NULL DEFAULT 'claude'");
        addTo("tasks", tasks, "skill", "TEXT");
        addTo("tasks", tasks, "automation", "TEXT");
        addTo("tasks", tasks, "integrations", "TEXT NOT NULL DEFAULT '[]'");
        addTo("tasks", tasks, "issue", "INTEGER");
        addTo("repos", this.columns("repos"), "issue_label", "TEXT");
        const automations = this.columns("automations");
        if (!automations.length) return;
        // Automations from before workflows have NOT NULL template columns, which ALTER TABLE
        // cannot relax in SQLite: the table is rebuilt with every row copied.
        if (!automations.includes("workflow"))
            this.db.exec(
                `DROP TABLE IF EXISTS automations_new; ${automationsTable("automations_new")}
                INSERT INTO automations_new (${AUTOMATION_COLUMNS})
                    SELECT ${AUTOMATION_COLUMNS} FROM automations;
                DROP TABLE automations;
                ALTER TABLE automations_new RENAME TO automations;`,
            );
        addTo("automations", this.columns("automations"), "integrations", "TEXT");
    }

    async migrations(): Promise<number[]> {
        const rows = this.db.prepare("SELECT version FROM schema_migrations ORDER BY version");
        return (rows.all() as Row[]).map((r) => Number(r.version));
    }

    async hasUsers(): Promise<boolean> {
        return this.db.prepare("SELECT 1 FROM users LIMIT 1").get() !== undefined;
    }

    async users(): Promise<User[]> {
        const rows = this.db.prepare("SELECT * FROM users ORDER BY created_at, name").all();
        return (rows as Row[]).map(toUser);
    }

    private readUser(id: string): User | undefined {
        const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
        return row && toUser(row);
    }

    async user(id: string): Promise<User | undefined> {
        return this.readUser(id);
    }

    async createUser(
        input: UserInput,
        tokenHash: string | null,
        first = false,
    ): Promise<{ user: User; token: Token | null } | undefined> {
        return this.transaction(() => {
            if (first && this.db.prepare("SELECT 1 FROM users LIMIT 1").get()) return undefined;
            const id = newId();
            const added = this.db
                .prepare(
                    "INSERT INTO users (id, name, role, created_at, email, password_hash) " +
                        "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                )
                .run(
                    id,
                    input.name,
                    input.role,
                    new Date().toISOString(),
                    input.email ?? null,
                    input.passwordHash ?? null,
                );
            if (!Number(added.changes)) return undefined;
            return {
                user: this.readUser(id) as User,
                token: tokenHash ? this.insertToken(id, tokenHash) : null,
            };
        });
    }

    async userByEmail(email: string): Promise<User | undefined> {
        const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
            | Row
            | undefined;
        return row && toUser(row);
    }

    async credentials(id: string): Promise<Credentials | undefined> {
        const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
        return row && toCredentials(row);
    }

    async updateUser(
        id: string,
        patch: UserPatch,
    ): Promise<User | "missing" | "lastAdmin" | "taken"> {
        return this.transaction(() => {
            const user = this.readUser(id);
            if (!user) return "missing";
            if (user.role === "admin" && patch.role && patch.role !== "admin") {
                const admins = this.db
                    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
                    .get() as Row;
                if (Number(admins.n) <= 1) return "lastAdmin";
            }
            const { sql, values } = userSets(patch);
            if (sql) {
                const clash = this.db
                    .prepare("SELECT 1 FROM users WHERE id <> ? AND (name = ? OR email = ?)")
                    .get(id, patch.name ?? null, patch.email ?? null);
                if (clash) return "taken";
                this.db.prepare(`UPDATE users SET ${sql} WHERE id = ?`).run(...values, id);
            }
            return this.readUser(id) as User;
        });
    }

    async spendBackupCode(id: string, hash: string): Promise<boolean> {
        return this.transaction(() => {
            const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
                | Row
                | undefined;
            const codes = row ? toCredentials(row).backupCodes : [];
            if (!codes.includes(hash)) return false;
            this.db
                .prepare("UPDATE users SET backup_codes = ? WHERE id = ?")
                .run(JSON.stringify(codes.filter((code) => code !== hash)), id);
            return true;
        });
    }

    async createSession(session: Session): Promise<void> {
        this.db
            .prepare(
                "INSERT INTO sessions (id, user_id, created_at, seen_at, verified_at, code_hash, " +
                    "code_expires_at, attempts, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
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
            );
    }

    async session(id: string): Promise<Session | undefined> {
        const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
            | Row
            | undefined;
        return row && toSession(row);
    }

    async updateSession(id: string, patch: SessionPatch): Promise<void> {
        const { sql, values } = sessionSets(patch);
        if (sql) this.db.prepare(`UPDATE sessions SET ${sql} WHERE id = ?`).run(...values, id);
    }

    async sessions(user: string): Promise<Session[]> {
        const rows = this.db
            .prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY seen_at DESC, id")
            .all(user) as Row[];
        return rows.map(toSession);
    }

    async deleteSession(id: string): Promise<void> {
        this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    }

    async deleteSessions(user: string, keep = ""): Promise<void> {
        this.db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(user, keep);
    }

    async purgeSessions(idleBefore: string, startedBefore: string): Promise<number> {
        return Number(
            this.db
                .prepare("DELETE FROM sessions WHERE seen_at < ? OR created_at < ?")
                .run(idleBefore, startedBefore).changes,
        );
    }

    async createLink(link: AuthLink): Promise<void> {
        this.transaction(() => {
            this.db
                .prepare("DELETE FROM auth_links WHERE user_id = ? AND kind = ?")
                .run(link.user, link.kind);
            this.db
                .prepare(
                    "INSERT INTO auth_links (id, user_id, kind, expires_at) VALUES (?, ?, ?, ?)",
                )
                .run(link.id, link.user, link.kind, link.expiresAt);
        });
    }

    async link(id: string): Promise<AuthLink | undefined> {
        const row = this.db.prepare("SELECT * FROM auth_links WHERE id = ?").get(id) as
            | Row
            | undefined;
        return row && toLink(row);
    }

    async takeLink(id: string): Promise<AuthLink | undefined> {
        return this.transaction(() => {
            const row = this.db.prepare("SELECT * FROM auth_links WHERE id = ?").get(id) as
                | Row
                | undefined;
            if (!row) return undefined;
            this.db.prepare("DELETE FROM auth_links WHERE id = ?").run(id);
            return toLink(row);
        });
    }

    async deleteUser(id: string): Promise<"deleted" | "missing" | "lastAdmin"> {
        return this.transaction(() => {
            const user = this.readUser(id);
            if (!user) return "missing";
            const admins = this.db
                .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
                .get() as Row;
            if (user.role === "admin" && Number(admins.n) <= 1) return "lastAdmin";
            for (const table of ["tokens", "sessions", "auth_links"])
                this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(id);
            this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
            return "deleted";
        });
    }

    private insertToken(user: string, tokenHash: string): Token {
        const id = newId();
        this.db
            .prepare("INSERT INTO tokens (id, user_id, hash, created_at) VALUES (?, ?, ?, ?)")
            .run(id, user, tokenHash, new Date().toISOString());
        return this.readToken(id) as Token;
    }

    async addToken(user: string, tokenHash: string): Promise<Token> {
        return this.insertToken(user, tokenHash);
    }

    private readToken(id: string): Token | undefined {
        const row = this.db.prepare("SELECT * FROM tokens WHERE id = ?").get(id) as Row | undefined;
        return row && toToken(row);
    }

    async tokens(user: string): Promise<Token[]> {
        const rows = this.db
            .prepare("SELECT * FROM tokens WHERE user_id = ? ORDER BY created_at, id")
            .all(user);
        return (rows as Row[]).map(toToken);
    }

    async token(id: string): Promise<Token | undefined> {
        return this.readToken(id);
    }

    async deleteToken(id: string): Promise<boolean> {
        return Number(this.db.prepare("DELETE FROM tokens WHERE id = ?").run(id).changes) > 0;
    }

    async userByToken(tokenHash: string): Promise<User | undefined> {
        const row = this.db
            .prepare("SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?")
            .get(tokenHash) as Row | undefined;
        return row && toUser(row);
    }

    async addRepo(
        id: string,
        defaultBranch: string,
        path: string | null = null,
        github: string | null = null,
    ): Promise<Repo> {
        this.db
            .prepare(
                "INSERT INTO repos (id, default_branch, added_at, path, github) VALUES (?, ?, ?, ?, ?) " +
                    "ON CONFLICT (id) DO UPDATE SET default_branch = excluded.default_branch, " +
                    "removed_at = NULL, " +
                    "path = COALESCE(excluded.path, repos.path), " +
                    "github = COALESCE(excluded.github, repos.github)",
            )
            .run(id, defaultBranch, new Date().toISOString(), path, github);
        return this.readRepo(id) as Repo;
    }

    private readRepo(id: string): Repo | undefined {
        const row = this.db
            .prepare("SELECT * FROM repos WHERE id = ? AND removed_at IS NULL")
            .get(id) as Row | undefined;
        return row && toRepo(row);
    }

    async repo(id: string): Promise<Repo | undefined> {
        return this.readRepo(id);
    }

    async repos(): Promise<Repo[]> {
        const sql = "SELECT * FROM repos WHERE removed_at IS NULL ORDER BY id";
        return (this.db.prepare(sql).all() as Row[]).map(toRepo);
    }

    async setIssueLabel(
        id: string,
        label: string | null,
        author: string | null = null,
    ): Promise<Repo | undefined> {
        this.db
            .prepare("UPDATE repos SET issue_label = ?, issue_author = ? WHERE id = ?")
            .run(label, label === null ? null : author, id);
        return this.readRepo(id);
    }

    async setCommands(id: string, commands: string[]): Promise<Repo | undefined> {
        this.db
            .prepare("UPDATE repos SET commands = ? WHERE id = ?")
            .run(commandsColumn(commands), id);
        return this.readRepo(id);
    }

    async setDefaultBranch(id: string, branch: string): Promise<Repo | undefined> {
        this.db.prepare("UPDATE repos SET default_branch = ? WHERE id = ?").run(branch, id);
        return this.readRepo(id);
    }

    async setRepoAgents(id: string, agents: RepoAgents): Promise<Repo | undefined> {
        this.db.prepare("UPDATE repos SET agents = ? WHERE id = ?").run(JSON.stringify(agents), id);
        return this.readRepo(id);
    }

    async setRepoSettings(id: string, settings: RepoSettings): Promise<Repo | undefined> {
        this.db
            .prepare("UPDATE repos SET settings = ? WHERE id = ?")
            .run(JSON.stringify(settings), id);
        return this.readRepo(id);
    }

    private repoColumn(repo: string, column: "secrets" | "webhooks"): string | null {
        const row = this.db.prepare(`SELECT ${column} FROM repos WHERE id = ?`).get(repo) as
            | Row
            | undefined;
        return row?.[column] ?? null;
    }

    async secrets(repo: string): Promise<Record<string, StoredSecret>> {
        return JSON.parse(this.repoColumn(repo, "secrets") ?? "{}");
    }

    async setSecrets(repo: string, secrets: Record<string, StoredSecret>): Promise<void> {
        this.db
            .prepare("UPDATE repos SET secrets = ? WHERE id = ?")
            .run(JSON.stringify(secrets), repo);
    }

    async webhooks(repo: string): Promise<Webhook[]> {
        return JSON.parse(this.repoColumn(repo, "webhooks") ?? "[]");
    }

    async setWebhooks(repo: string, webhooks: Webhook[]): Promise<void> {
        this.db
            .prepare("UPDATE repos SET webhooks = ? WHERE id = ?")
            .run(JSON.stringify(webhooks), repo);
    }

    async deleteRepo(id: string): Promise<boolean> {
        const sql = "UPDATE repos SET removed_at = ? WHERE id = ? AND removed_at IS NULL";
        return Number(this.db.prepare(sql).run(new Date().toISOString(), id).changes) > 0;
    }

    async activeJobs(repo: string): Promise<number> {
        const sql =
            "SELECT (SELECT COUNT(*) FROM tasks WHERE repo = ? AND status IN ('queued', 'running')) + " +
            "(SELECT COUNT(*) FROM workflow_runs WHERE repo = ? AND status IN ('queued', 'running')) AS n";
        return Number((this.db.prepare(sql).get(repo, repo) as Row).n);
    }

    async integrations(repo: string): Promise<Integration[]> {
        const rows = this.db
            .prepare("SELECT * FROM integrations WHERE repo = ? ORDER BY name")
            .all(repo);
        return (rows as Row[]).map(toIntegration);
    }

    private readIntegration(repo: string, name: string): Integration | undefined {
        const row = this.db
            .prepare("SELECT * FROM integrations WHERE repo = ? AND name = ?")
            .get(repo, name);
        return row ? toIntegration(row as Row) : undefined;
    }

    async integration(repo: string, name: string): Promise<Integration | undefined> {
        return this.readIntegration(repo, name);
    }

    async addIntegration(
        repo: string,
        name: string,
        spec: ServerSpec,
    ): Promise<Integration | undefined> {
        const now = new Date().toISOString();
        const { kind, ...config } = spec;
        const added = this.db
            .prepare(
                "INSERT INTO integrations (repo, name, kind, config, created_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
            )
            .run(repo, name, kind, JSON.stringify(config), now, now);
        return Number(added.changes) ? this.readIntegration(repo, name) : undefined;
    }

    async updateIntegration(
        repo: string,
        name: string,
        spec: ServerSpec,
    ): Promise<Integration | undefined> {
        const { kind, ...config } = spec;
        this.db
            .prepare(
                "UPDATE integrations SET kind = ?, config = ?, updated_at = ? " +
                    "WHERE repo = ? AND name = ?",
            )
            .run(kind, JSON.stringify(config), new Date().toISOString(), repo, name);
        return this.readIntegration(repo, name);
    }

    async deleteIntegration(repo: string, name: string): Promise<boolean> {
        const deleted = this.db
            .prepare("DELETE FROM integrations WHERE repo = ? AND name = ?")
            .run(repo, name);
        return Number(deleted.changes) > 0;
    }

    async addSkillSource(id: string, defaultBranch: string): Promise<SkillSource> {
        this.db
            .prepare(
                "INSERT INTO skill_sources (id, default_branch, added_at) VALUES (?, ?, ?) " +
                    "ON CONFLICT (id) DO UPDATE SET default_branch = excluded.default_branch",
            )
            .run(id, defaultBranch, new Date().toISOString());
        return this.readSkillSource(id) as SkillSource;
    }

    private readSkillSource(id: string): SkillSource | undefined {
        const row = this.db.prepare("SELECT * FROM skill_sources WHERE id = ?").get(id);
        return row ? toSource(row as Row) : undefined;
    }

    async skillSource(id: string): Promise<SkillSource | undefined> {
        return this.readSkillSource(id);
    }

    async skillSources(): Promise<SkillSource[]> {
        const rows = this.db.prepare("SELECT * FROM skill_sources ORDER BY id").all();
        return (rows as Row[]).map(toSource);
    }

    async deleteSkillSource(id: string): Promise<void> {
        this.db.prepare("DELETE FROM skill_sources WHERE id = ?").run(id);
    }

    async createTask(input: TaskInput): Promise<Task> {
        return this.insertTask(input) as Task;
    }

    async createIssueTask(input: TaskInput & { issue: number }): Promise<Task | undefined> {
        return this.insertTask(input);
    }

    private insertTask(input: TaskInput & { issue?: number }): Task | undefined {
        const id = newId();
        const now = new Date().toISOString();
        const inserted = this.db
            .prepare(
                "INSERT INTO tasks (id, repo, title, body, agent, skill, integrations, automation, " +
                    "issue, author, thread, retry_of, model, attachments, variant_group, variant, dispatch, parent, " +
                    "parent_run, workspace, branch_name, " +
                    "status, created_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?) " +
                    "ON CONFLICT DO NOTHING",
            )
            .run(
                id,
                input.repo,
                input.title,
                input.body,
                input.agent ?? "claude",
                input.skill ?? null,
                JSON.stringify(input.integrations ?? []),
                input.automation ?? null,
                input.issue ?? null,
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
            );
        return Number(inserted.changes) ? this.readTask(id) : undefined;
    }

    private readTask(id: string): Task | undefined {
        const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
        return row && toTask(row);
    }

    async task(id: string): Promise<Task | undefined> {
        return this.readTask(id);
    }

    async tasks(limit = 100): Promise<Task[]> {
        const rows = this.db
            .prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?")
            .all(limit) as Row[];
        return rows.map(toTask);
    }

    async threadTasks(thread: string): Promise<Task[]> {
        const rows = this.db
            .prepare("SELECT * FROM tasks WHERE id = ? OR thread = ? ORDER BY created_at, id")
            .all(thread, thread) as Row[];
        return rows.map(toTask);
    }

    async variantTasks(group: string): Promise<Task[]> {
        const rows = this.db
            .prepare("SELECT * FROM tasks WHERE variant_group = ? ORDER BY variant")
            .all(group) as Row[];
        return rows.map(toTask);
    }

    async subtasks(parent: string): Promise<Task[]> {
        const rows = this.db
            .prepare(
                "SELECT * FROM tasks WHERE parent = ? AND thread IS NULL ORDER BY created_at, id",
            )
            .all(parent) as Row[];
        return rows.map(toTask);
    }

    async claimDispatchMerge(parent: string): Promise<boolean> {
        const claimed = this.db
            .prepare("UPDATE tasks SET dispatch_merge = '' WHERE id = ? AND dispatch_merge IS NULL")
            .run(parent);
        return Number(claimed.changes) === 1;
    }

    async setDispatchMerge(parent: string, merge: string): Promise<void> {
        this.db.prepare("UPDATE tasks SET dispatch_merge = ? WHERE id = ?").run(merge, parent);
    }

    async startJob(kind: JobKind, id: string, branch: string): Promise<boolean> {
        const started = this.db
            .prepare(
                `UPDATE ${jobTable(kind)} SET status = 'running', branch = ?, updated_at = ? ` +
                    "WHERE id = ? AND status = 'queued'",
            )
            .run(branch, new Date().toISOString(), id);
        return Number(started.changes) > 0;
    }

    async cancelQueued(kind: JobKind, id: string, error: string): Promise<boolean> {
        const cancelled = this.db
            .prepare(
                `UPDATE ${jobTable(kind)} SET status = 'cancelled', error = ?, updated_at = ? ` +
                    "WHERE id = ? AND status = 'queued'",
            )
            .run(error, new Date().toISOString(), id);
        return Number(cancelled.changes) > 0;
    }

    async nextJob(skip = NO_SKIP): Promise<Job | undefined> {
        const { sql, values } = queuedJobs(skip);
        const row = this.db.prepare(sql).get(...values) as Row | undefined;
        if (!row) return undefined;
        const id = row.id as string;
        return row.kind === "task"
            ? { kind: "task", task: this.readTask(id) as Task }
            : { kind: "run", run: this.readRun(id) as WorkflowRun };
    }

    async update(id: string, patch: TaskPatch): Promise<void> {
        const { sql, values } = taskSets(patch);
        if (!sql) return;
        this.db
            .prepare(`UPDATE tasks SET ${sql}, updated_at = ? WHERE id = ?`)
            .run(...values, new Date().toISOString(), id);
    }

    async archiveTask(id: string, archived: boolean): Promise<Task | undefined> {
        const now = new Date().toISOString();
        this.db
            .prepare("UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?")
            .run(archived ? now : null, now, id);
        return this.task(id);
    }

    async pins(user: string): Promise<string[]> {
        const rows = this.db
            .prepare("SELECT task FROM task_pins WHERE user_id = ? ORDER BY created_at, task")
            .all(user) as Row[];
        return rows.map((r) => r.task as string);
    }

    async pinTask(user: string, task: string, pinned: boolean): Promise<void> {
        if (pinned)
            this.db
                .prepare("INSERT OR IGNORE INTO task_pins VALUES (?, ?, ?)")
                .run(user, task, new Date().toISOString());
        else
            this.db.prepare("DELETE FROM task_pins WHERE user_id = ? AND task = ?").run(user, task);
    }

    async reads(user: string): Promise<Reads> {
        const rows = this.db
            .prepare("SELECT kind, job FROM job_reads WHERE user_id = ? ORDER BY job")
            .all(user) as Row[];
        return toReads(rows);
    }

    async markRead(user: string, kind: JobKind, id: string, read: boolean): Promise<void> {
        if (read)
            this.db
                .prepare("INSERT OR IGNORE INTO job_reads VALUES (?, ?, ?, ?)")
                .run(user, kind, id, new Date().toISOString());
        else
            this.db
                .prepare("DELETE FROM job_reads WHERE user_id = ? AND kind = ? AND job = ?")
                .run(user, kind, id);
    }

    async settings(): Promise<Record<string, string>> {
        const rows = this.db.prepare("SELECT name, value FROM settings").all() as Row[];
        return Object.fromEntries(rows.map((r) => [r.name as string, r.value as string]));
    }

    async saveSettings(values: Record<string, string | null>): Promise<void> {
        const now = new Date().toISOString();
        this.transaction(() => {
            for (const [name, value] of Object.entries(values)) {
                if (value === null)
                    this.db.prepare("DELETE FROM settings WHERE name = ?").run(name);
                else
                    this.db
                        .prepare(
                            "INSERT INTO settings VALUES (?, ?, ?) ON CONFLICT (name) " +
                                "DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                        )
                        .run(name, value, now);
            }
        });
    }

    async failInterrupted(): Promise<number> {
        const now = new Date().toISOString();
        const error = "interrupted by restart";
        return this.transaction(() => {
            const tasks = this.db
                .prepare(
                    "UPDATE tasks SET status = 'failed', error = ?, updated_at = ? " +
                        "WHERE status = 'running'",
                )
                .run(error, now);
            const running = this.db
                .prepare("SELECT * FROM workflow_runs WHERE status = 'running'")
                .all() as Row[];
            for (const run of running.map(toRun))
                this.patchRun(run.id, {
                    status: "failed",
                    error,
                    steps: run.steps.map((s) =>
                        s.status === "running"
                            ? { ...s, status: "failed", finishedAt: now, error }
                            : s,
                    ),
                });
            return Number(tasks.changes) + running.length;
        });
    }

    async createAutomation(
        input: AutomationInput,
        author: string | null = null,
        builtin: Builtin | null = null,
    ): Promise<Automation> {
        const id = newId();
        this.db
            .prepare(
                "INSERT INTO automations (id, name, cron, workflow, repo, title, body, agent, " +
                    "skill, integrations, enabled, created_at, author, builtin) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
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
            );
        return this.readAutomation(id) as Automation;
    }

    private readAutomation(id: string): Automation | undefined {
        const row = this.db.prepare("SELECT * FROM automations WHERE id = ?").get(id);
        return row ? toAutomation(row as Row) : undefined;
    }

    async automation(id: string): Promise<Automation | undefined> {
        return this.readAutomation(id);
    }

    async automations(): Promise<Automation[]> {
        const rows = this.db.prepare("SELECT * FROM automations ORDER BY created_at, id").all();
        return (rows as Row[]).map(toAutomation);
    }

    async updateAutomation(id: string, input: AutomationInput): Promise<Automation | undefined> {
        this.db
            .prepare(
                "UPDATE automations SET name = ?, cron = ?, workflow = ?, repo = ?, title = ?, " +
                    "body = ?, agent = ?, skill = ?, integrations = ?, enabled = ? WHERE id = ?",
            )
            .run(
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
            );
        return this.readAutomation(id);
    }

    async deleteAutomation(id: string): Promise<boolean> {
        return Number(this.db.prepare("DELETE FROM automations WHERE id = ?").run(id).changes) > 0;
    }

    async automationsOf(workflow: string): Promise<Automation[]> {
        const rows = this.db.prepare("SELECT * FROM automations WHERE workflow = ?").all(workflow);
        return (rows as Row[]).map(toAutomation);
    }

    async runAutomation(id: string, slot?: string): Promise<Task | WorkflowRun | undefined> {
        const now = new Date().toISOString();
        return this.transaction(() => {
            const claimed = slot
                ? this.db
                      .prepare(
                          "UPDATE automations SET last_slot = ?, last_run_at = ? WHERE id = ? " +
                              "AND enabled = 1 AND (last_slot IS NULL OR last_slot < ?)",
                      )
                      .run(slot, now, id, slot)
                : this.db
                      .prepare("UPDATE automations SET last_run_at = ? WHERE id = ?")
                      .run(now, id);
            const a = Number(claimed.changes) ? this.readAutomation(id) : undefined;
            return a && (a.workflow ? this.queueAutomationRun(a) : this.queueAutomationTask(a));
        });
    }

    private queueAutomationTask(a: Automation): Task {
        return this.insertTask({
            repo: a.repo as string,
            title: a.title as string,
            body: a.body ?? "",
            agent: a.agent ?? "claude",
            skill: a.skill,
            integrations: a.integrations ?? [],
            automation: a.id,
            author: a.author,
        }) as Task;
    }

    private queueAutomationRun(a: Automation): WorkflowRun {
        const workflow = this.readWorkflow(a.workflow as string);
        if (!workflow) throw new Error(`workflow ${a.workflow} of automation ${a.id} is gone`);
        return this.insertRun(workflow, a.id, a.author);
    }

    async createWorkflow(input: WorkflowInput, author: string | null = null): Promise<Workflow> {
        const id = newId();
        const now = new Date().toISOString();
        this.db
            .prepare(
                "INSERT INTO workflows (id, name, description, repo, definition, author, " +
                    "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
                id,
                input.name,
                input.description ?? "",
                input.repo,
                JSON.stringify(input.definition),
                author,
                now,
                now,
            );
        return this.readWorkflow(id) as Workflow;
    }

    private readWorkflow(id: string): Workflow | undefined {
        const row = this.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
        return row ? toWorkflow(row as Row) : undefined;
    }

    async workflow(id: string): Promise<Workflow | undefined> {
        return this.readWorkflow(id);
    }

    async workflows(): Promise<Workflow[]> {
        const rows = this.db.prepare("SELECT * FROM workflows ORDER BY created_at, id").all();
        return (rows as Row[]).map(toWorkflow);
    }

    async updateWorkflow(id: string, input: WorkflowInput): Promise<Workflow | undefined> {
        this.db
            .prepare(
                "UPDATE workflows SET name = ?, description = ?, repo = ?, definition = ?, " +
                    "updated_at = ? WHERE id = ?",
            )
            .run(
                input.name,
                input.description ?? "",
                input.repo,
                JSON.stringify(input.definition),
                new Date().toISOString(),
                id,
            );
        return this.readWorkflow(id);
    }

    async deleteWorkflow(id: string): Promise<boolean> {
        return Number(this.db.prepare("DELETE FROM workflows WHERE id = ?").run(id).changes) > 0;
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
        return this.insertRun(workflow, automation, author, retryOf, input, parentRun, thread);
    }

    private insertRun(
        workflow: RunTemplate,
        automation: string | null,
        author: string | null,
        retryOf: string | null = null,
        input: string | null = null,
        parentRun: string | null = null,
        thread: string | null = null,
    ): WorkflowRun {
        const id = newId();
        const now = new Date().toISOString();
        this.db
            .prepare(
                "INSERT INTO workflow_runs (id, workflow, name, repo, definition, automation, " +
                    "author, retry_of, input, parent_run, thread, status, created_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)",
            )
            .run(
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
            );
        return this.readRun(id) as WorkflowRun;
    }

    private readRun(id: string): WorkflowRun | undefined {
        const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id);
        return row ? toRun(row as Row) : undefined;
    }

    async run(id: string): Promise<WorkflowRun | undefined> {
        return this.readRun(id);
    }

    async threadRuns(thread: string): Promise<WorkflowRun[]> {
        const rows = this.db
            .prepare(
                "SELECT * FROM workflow_runs WHERE id = ? OR thread = ? ORDER BY created_at, id",
            )
            .all(thread, thread) as Row[];
        return rows.map(toRun);
    }

    async runs(limit = 100): Promise<RunSummary[]> {
        const rows = this.db
            .prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT ?")
            .all(limit) as Row[];
        return rows.map(toSummary);
    }

    async updateRun(id: string, patch: RunPatch): Promise<void> {
        this.patchRun(id, patch);
    }

    async resumeRun(id: string, state: RunState, from = "waiting"): Promise<boolean> {
        const resumed = this.db
            .prepare(
                "UPDATE workflow_runs SET status = 'queued', state = ?, error = NULL, updated_at = ? " +
                    "WHERE id = ? AND status = ?",
            )
            .run(JSON.stringify(state), new Date().toISOString(), id, from);
        return Number(resumed.changes) > 0;
    }

    async cancelWaiting(id: string, error: string): Promise<boolean> {
        const cancelled = this.db
            .prepare(
                "UPDATE workflow_runs SET status = 'cancelled', error = ?, updated_at = ? " +
                    "WHERE id = ? AND status = 'waiting'",
            )
            .run(error, new Date().toISOString(), id);
        return Number(cancelled.changes) > 0;
    }

    async waitingRuns(): Promise<WorkflowRun[]> {
        const rows = this.db
            .prepare("SELECT * FROM workflow_runs WHERE status = 'waiting' ORDER BY created_at")
            .all() as Row[];
        return rows.map(toRun);
    }

    private patchRun(id: string, patch: RunPatch): void {
        const { sql, values } = runSets(patch);
        if (!sql) return;
        this.db
            .prepare(`UPDATE workflow_runs SET ${sql}, updated_at = ? WHERE id = ?`)
            .run(...values, new Date().toISOString(), id);
    }

    async addAgentEvent(source: EventSource, event: AgentEventInput): Promise<AgentEvent> {
        const at = new Date().toISOString();
        const added = this.db.prepare(INSERT_EVENT).run(...eventValues(source, event, at));
        return {
            seq: Number(added.lastInsertRowid),
            ...source,
            ...event,
            detail: event.detail ?? null,
            createdAt: at,
        };
    }

    async agentEvents(of: { task: string } | { run: string }): Promise<AgentEvent[]> {
        const { sql, value } = eventsSql(of);
        return (this.db.prepare(sql).all(value) as Row[]).map(toAgentEvent);
    }

    async purgeAgentEvents(before: string): Promise<number> {
        const sql = "DELETE FROM agent_events WHERE created_at < ?";
        return Number(this.db.prepare(sql).run(before).changes);
    }

    async costs(group: CostGroup, since: string): Promise<CostRow[]> {
        return (this.db.prepare(costsSql(group)).all(since, since) as Row[]).map(toCostRow);
    }

    async addNotes(repo: string, texts: string[], source: NoteSource): Promise<Note[]> {
        const now = new Date().toISOString();
        const insert = this.db.prepare(
            "INSERT INTO notes (id, repo, text, task, run, node, author, created_at) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        );
        const author = source.author ?? null;
        return this.transaction(() =>
            texts.map((text) => {
                const id = newId();
                insert.run(id, repo, text, source.task, source.run, source.node, author, now);
                return this.readNote(id) as Note;
            }),
        );
    }

    private readNote(id: string): Note | undefined {
        const row = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
        return row ? toNote(row as Row) : undefined;
    }

    async note(id: string): Promise<Note | undefined> {
        return this.readNote(id);
    }

    async notes(repo: string | null, limit = 500): Promise<Note[]> {
        const order = "ORDER BY created_at DESC, seq DESC LIMIT ?";
        const rows = repo
            ? this.db.prepare(`SELECT * FROM notes WHERE repo = ? ${order}`).all(repo, limit)
            : this.db.prepare(`SELECT * FROM notes ${order}`).all(limit);
        return (rows as Row[]).map(toNote);
    }

    async deleteNote(id: string): Promise<boolean> {
        return Number(this.db.prepare("DELETE FROM notes WHERE id = ?").run(id).changes) > 0;
    }

    private readPages(repo: string, slug?: string): MemoryPage[] {
        const sql = memorySql(slug !== undefined);
        const args = slug === undefined ? [repo] : [repo, slug];
        const rows = (query: string) => this.db.prepare(query).all(...args) as Row[];
        return toMemoryPages(rows(sql.pages), rows(sql.sections), rows(sql.sources));
    }

    async memoryPages(repo: string): Promise<MemoryPage[]> {
        return this.readPages(repo);
    }

    async memoryPage(repo: string, slug: string): Promise<MemoryPage | undefined> {
        return this.readPages(repo, slug)[0];
    }

    async unwovenNotes(
        repo: string,
        limit = 500,
        oldestFirst = false,
    ): Promise<{ total: number; notes: Note[] }> {
        const count = this.db.prepare(UNWOVEN_COUNT).get(repo) as Row;
        const rows = this.db
            .prepare(oldestFirst ? OLDEST_UNWOVEN : UNWOVEN_NOTES)
            .all(repo, limit) as Row[];
        return { total: Number(count.total), notes: rows.map(toNote) };
    }

    async createMemoryPage(
        repo: string,
        input: MemoryPageInput,
        source: NoteSource,
    ): Promise<MemoryPage | undefined> {
        const now = new Date().toISOString();
        const added = this.db
            .prepare(
                "INSERT INTO memory_pages (repo, slug, title, description, kind, version, task, " +
                    "run, node, author, created_at, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
            )
            .run(
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
            );
        return Number(added.changes) ? this.readPages(repo, input.slug)[0] : undefined;
    }

    async updateMemoryPage(
        repo: string,
        input: MemoryPageInput,
        version: number,
        source: NoteSource,
    ): Promise<MemoryPage | undefined> {
        const updated = this.db
            .prepare(
                "UPDATE memory_pages SET title = ?, description = ?, kind = ?, " +
                    "version = version + 1, task = ?, run = ?, node = ?, author = ?, " +
                    "updated_at = ? WHERE repo = ? AND slug = ? AND version = ?",
            )
            .run(
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
            );
        return Number(updated.changes) ? this.readPages(repo, input.slug)[0] : undefined;
    }

    private readSection(repo: string, slug: string, heading: string): MemorySection | undefined {
        const row = this.db
            .prepare("SELECT * FROM memory_sections WHERE repo = ? AND page = ? AND heading = ?")
            .get(repo, slug, heading) as Row | undefined;
        if (!row) return undefined;
        const sources = this.db
            .prepare("SELECT note FROM memory_sources WHERE section = ? ORDER BY position")
            .all(row.id) as Row[];
        return toMemorySection(
            row,
            sources.map((s) => s.note as string),
        );
    }

    private cite(section: string, sources: string[]): void {
        this.db.prepare("DELETE FROM memory_sources WHERE section = ?").run(section);
        const insert = this.db.prepare(
            "INSERT INTO memory_sources (section, note, position) VALUES (?, ?, ?)",
        );
        for (const [i, note] of sources.entries()) insert.run(section, note, i);
    }

    async addMemorySection(
        repo: string,
        slug: string,
        input: MemorySectionInput,
        source: NoteSource,
    ): Promise<MemorySection | undefined> {
        return this.transaction(() => {
            const page = this.db
                .prepare(
                    "SELECT (SELECT COALESCE(MAX(position), 0) FROM memory_sections " +
                        "WHERE repo = p.repo AND page = p.slug) AS last_position FROM memory_pages p " +
                        "WHERE p.repo = ? AND p.slug = ?",
                )
                .get(repo, slug) as Row | undefined;
            if (!page) return undefined;
            const id = newId();
            const added = this.db
                .prepare(
                    "INSERT INTO memory_sections (id, repo, page, position, heading, body, " +
                        "version, task, run, node, author, updated_at) " +
                        "VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                )
                .run(
                    id,
                    repo,
                    slug,
                    Number(page.last_position) + 1,
                    input.heading,
                    input.body,
                    source.task,
                    source.run,
                    source.node,
                    source.author ?? null,
                    new Date().toISOString(),
                );
            if (!Number(added.changes)) return undefined;
            this.cite(id, input.sources);
            return this.readSection(repo, slug, input.heading);
        });
    }

    async updateMemorySection(
        repo: string,
        slug: string,
        input: MemorySectionInput,
        version: number,
        source: NoteSource,
    ): Promise<MemorySection | undefined> {
        return this.transaction(() => {
            const updated = this.db
                .prepare(
                    "UPDATE memory_sections SET body = ?, version = version + 1, task = ?, " +
                        "run = ?, node = ?, author = ?, updated_at = ? " +
                        "WHERE repo = ? AND page = ? AND heading = ? AND version = ? RETURNING id",
                )
                .get(
                    input.body,
                    source.task,
                    source.run,
                    source.node,
                    source.author ?? null,
                    new Date().toISOString(),
                    repo,
                    slug,
                    input.heading,
                    version,
                ) as Row | undefined;
            if (!updated) return undefined;
            this.cite(updated.id as string, input.sources);
            return this.readSection(repo, slug, input.heading);
        });
    }
}
