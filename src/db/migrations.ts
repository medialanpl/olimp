export const automationsTable = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cron TEXT NOT NULL,
    workflow TEXT,
    repo TEXT REFERENCES repos (id),
    title TEXT,
    body TEXT,
    agent TEXT,
    skill TEXT,
    integrations TEXT,
    enabled INTEGER NOT NULL,
    last_run_at TEXT,
    last_slot TEXT,
    created_at TEXT NOT NULL
);`;

// The stage 5 schema. IF NOT EXISTS lets it complete a database from before numbered migrations
// after the SQLite store's `adoptLegacy` has brought its existing tables up to date.
const SQLITE_V1 = `
CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    default_branch TEXT NOT NULL,
    added_at TEXT NOT NULL,
    issue_label TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL REFERENCES repos (id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    agent TEXT NOT NULL DEFAULT 'claude',
    skill TEXT,
    integrations TEXT NOT NULL DEFAULT '[]',
    automation TEXT,
    issue INTEGER,
    status TEXT NOT NULL,
    branch TEXT,
    pr_url TEXT,
    error TEXT,
    log TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks (status, created_at);
CREATE TABLE IF NOT EXISTS skill_sources (
    id TEXT PRIMARY KEY,
    default_branch TEXT NOT NULL,
    added_at TEXT NOT NULL
);
${automationsTable("automations")}
CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo TEXT NOT NULL REFERENCES repos (id),
    definition TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow TEXT NOT NULL,
    name TEXT NOT NULL,
    repo TEXT NOT NULL,
    definition TEXT NOT NULL,
    automation TEXT,
    status TEXT NOT NULL,
    current_node TEXT,
    steps TEXT NOT NULL DEFAULT '[]',
    branch TEXT,
    pr_url TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workflow_runs_status ON workflow_runs (status, created_at);
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL REFERENCES repos (id),
    text TEXT NOT NULL,
    task TEXT,
    run TEXT,
    node TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_repo ON notes (repo, created_at);
CREATE TABLE IF NOT EXISTS integrations (
    repo TEXT NOT NULL REFERENCES repos (id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repo, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_issue ON tasks (repo, issue) WHERE issue IS NOT NULL;
`;

// Notes are ordered by an explicit column instead of SQLite's rowid, which MySQL does not have.
const SQLITE_V2 = `
CREATE TABLE notes_new (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    repo TEXT NOT NULL REFERENCES repos (id),
    text TEXT NOT NULL,
    task TEXT,
    run TEXT,
    node TEXT,
    created_at TEXT NOT NULL
);
INSERT INTO notes_new (seq, id, repo, text, task, run, node, created_at)
    SELECT rowid, id, repo, text, task, run, node, created_at FROM notes;
DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;
CREATE INDEX notes_repo ON notes (repo, created_at);
`;

// utf8mb4_bin compares text byte by byte like SQLite, so `Acme/Demo` and `acme/demo` stay two
// repositories. node:sqlite enforces REFERENCES, so MySQL gets the same foreign keys.
export const MYSQL_TABLE = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";
const ID = "VARCHAR(64)";
const REF = "VARCHAR(255)";
const TIME = "VARCHAR(32)";
const TO_REPOS = "FOREIGN KEY (repo) REFERENCES repos (id)";

// The stage 5 schema, with notes already ordered by `seq`. MySQL commits DDL implicitly, so every
// statement must be safe to repeat: indexes live inside CREATE TABLE IF NOT EXISTS.
const MYSQL_V1 = [
    `CREATE TABLE IF NOT EXISTS repos (
        id ${REF} PRIMARY KEY,
        default_branch ${REF} NOT NULL,
        added_at ${TIME} NOT NULL,
        issue_label ${REF}
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS tasks (
        id ${ID} PRIMARY KEY,
        repo ${REF} NOT NULL,
        title ${REF} NOT NULL,
        body LONGTEXT NOT NULL,
        agent ${ID} NOT NULL DEFAULT 'claude',
        skill ${REF},
        integrations LONGTEXT NOT NULL DEFAULT ('[]'),
        automation ${ID},
        issue INT,
        status ${ID} NOT NULL,
        branch ${REF},
        pr_url TEXT,
        error LONGTEXT,
        log LONGTEXT NOT NULL DEFAULT (''),
        created_at ${TIME} NOT NULL,
        updated_at ${TIME} NOT NULL,
        INDEX tasks_status (status, created_at),
        UNIQUE INDEX tasks_issue (repo, issue),
        ${TO_REPOS}
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS skill_sources (
        id ${REF} PRIMARY KEY,
        default_branch ${REF} NOT NULL,
        added_at ${TIME} NOT NULL
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS automations (
        id ${ID} PRIMARY KEY,
        name ${REF} NOT NULL,
        cron ${REF} NOT NULL,
        workflow ${ID},
        repo ${REF},
        title ${REF},
        body LONGTEXT,
        agent ${ID},
        skill ${REF},
        integrations LONGTEXT,
        enabled TINYINT NOT NULL,
        last_run_at ${TIME},
        last_slot ${TIME},
        created_at ${TIME} NOT NULL,
        ${TO_REPOS}
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS workflows (
        id ${ID} PRIMARY KEY,
        name ${REF} NOT NULL,
        repo ${REF} NOT NULL,
        definition LONGTEXT NOT NULL,
        created_at ${TIME} NOT NULL,
        updated_at ${TIME} NOT NULL,
        ${TO_REPOS}
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS workflow_runs (
        id ${ID} PRIMARY KEY,
        workflow ${ID} NOT NULL,
        name ${REF} NOT NULL,
        repo ${REF} NOT NULL,
        definition LONGTEXT NOT NULL,
        automation ${ID},
        status ${ID} NOT NULL,
        current_node ${ID},
        steps LONGTEXT NOT NULL DEFAULT ('[]'),
        branch ${REF},
        pr_url TEXT,
        error LONGTEXT,
        created_at ${TIME} NOT NULL,
        updated_at ${TIME} NOT NULL,
        INDEX workflow_runs_status (status, created_at)
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS notes (
        seq BIGINT AUTO_INCREMENT PRIMARY KEY,
        id ${ID} NOT NULL UNIQUE,
        repo ${REF} NOT NULL,
        text LONGTEXT NOT NULL,
        task ${ID},
        run ${ID},
        node ${ID},
        created_at ${TIME} NOT NULL,
        INDEX notes_repo (repo, created_at),
        ${TO_REPOS}
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS integrations (
        repo ${REF} NOT NULL,
        name ${ID} NOT NULL,
        kind ${ID} NOT NULL,
        config LONGTEXT NOT NULL,
        created_at ${TIME} NOT NULL,
        updated_at ${TIME} NOT NULL,
        PRIMARY KEY (repo, name),
        ${TO_REPOS}
    ) ${MYSQL_TABLE}`,
];

// Repository memory: pages, their ordered sections and the notes each section cites. Note ids are
// unique across repositories and a section only cites notes of its own, so the citations need no
// repository column; a note may be deleted while cited, so there is no foreign key to notes.
const SQLITE_V3 = `
CREATE TABLE memory_pages (
    repo TEXT NOT NULL REFERENCES repos (id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL,
    task TEXT,
    run TEXT,
    node TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (repo, slug)
);
CREATE TABLE memory_sections (
    id TEXT PRIMARY KEY,
    repo TEXT NOT NULL,
    page TEXT NOT NULL,
    position INTEGER NOT NULL,
    heading TEXT NOT NULL,
    body TEXT NOT NULL,
    version INTEGER NOT NULL,
    task TEXT,
    run TEXT,
    node TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (repo, page) REFERENCES memory_pages (repo, slug)
);
CREATE UNIQUE INDEX memory_sections_heading ON memory_sections (repo, page, heading);
CREATE TABLE memory_sources (
    section TEXT NOT NULL REFERENCES memory_sections (id),
    note TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (section, note)
);
CREATE INDEX memory_sources_note ON memory_sources (note);
`;

const MYSQL_V3 = [
    `CREATE TABLE IF NOT EXISTS memory_pages (
        repo ${REF} NOT NULL,
        slug ${ID} NOT NULL,
        title ${REF} NOT NULL,
        description TEXT NOT NULL,
        kind ${ID} NOT NULL,
        version INT NOT NULL,
        task ${ID},
        run ${ID},
        node ${ID},
        created_at ${TIME} NOT NULL,
        updated_at ${TIME} NOT NULL,
        PRIMARY KEY (repo, slug),
        ${TO_REPOS}
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS memory_sections (
        id ${ID} PRIMARY KEY,
        repo ${REF} NOT NULL,
        page ${ID} NOT NULL,
        position INT NOT NULL,
        heading ${REF} NOT NULL,
        body LONGTEXT NOT NULL,
        version INT NOT NULL,
        task ${ID},
        run ${ID},
        node ${ID},
        updated_at ${TIME} NOT NULL,
        UNIQUE INDEX memory_sections_heading (repo, page, heading),
        FOREIGN KEY (repo, page) REFERENCES memory_pages (repo, slug)
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS memory_sources (
        section ${ID} NOT NULL,
        note ${ID} NOT NULL,
        position INT NOT NULL,
        PRIMARY KEY (section, note),
        INDEX memory_sources_note (note),
        FOREIGN KEY (section) REFERENCES memory_sections (id)
    ) ${MYSQL_TABLE}`,
];

// Tables whose records name the account that created or last changed them. No foreign key: a
// deleted account stays the author of what it did.
const AUTHORED = [
    "tasks",
    "automations",
    "workflows",
    "workflow_runs",
    "notes",
    "memory_pages",
    "memory_sections",
];

// Accounts and the SHA-256 hashes of their tokens; the authors of existing records stay NULL.
const SQLITE_V5 = `
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE INDEX tokens_user ON tokens (user_id);
${AUTHORED.map((table) => `ALTER TABLE ${table} ADD COLUMN author TEXT;`).join("\n")}
ALTER TABLE repos ADD COLUMN issue_author TEXT;
`;

const MYSQL_V5 = [
    `CREATE TABLE IF NOT EXISTS users (
        id ${ID} PRIMARY KEY,
        name ${REF} NOT NULL UNIQUE,
        role ${ID} NOT NULL,
        created_at ${TIME} NOT NULL
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS tokens (
        id ${ID} PRIMARY KEY,
        user_id ${ID} NOT NULL,
        hash CHAR(64) NOT NULL UNIQUE,
        created_at ${TIME} NOT NULL,
        INDEX tokens_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    ) ${MYSQL_TABLE}`,
    ...AUTHORED.map((table) => `ALTER TABLE ${table} ADD COLUMN author ${ID}`),
    `ALTER TABLE repos ADD COLUMN issue_author ${ID}`,
];

const USAGE_COLUMNS: [string, string, string][] = [
    ["turns", "INTEGER", "INT"],
    ["cost_usd", "REAL", "DOUBLE"],
    ["input_tokens", "INTEGER", "BIGINT"],
    ["output_tokens", "INTEGER", "BIGINT"],
    ["duration_ms", "INTEGER", "BIGINT"],
];

// Usage of tasks and runs, task threads and retries, and the agent events of every step. Existing
// tasks and runs keep no usage, and each task is a thread of its own.
const SQLITE_V6 = `
${["tasks", "workflow_runs"]
    .flatMap((table) => [
        `ALTER TABLE ${table} ADD COLUMN retry_of TEXT;`,
        ...USAGE_COLUMNS.map(
            ([column, type]) => `ALTER TABLE ${table} ADD COLUMN ${column} ${type};`,
        ),
    ])
    .join("\n")}
ALTER TABLE tasks ADD COLUMN thread TEXT;
CREATE INDEX tasks_thread ON tasks (thread, created_at);
CREATE TABLE agent_events (
    seq INTEGER PRIMARY KEY,
    task TEXT,
    run TEXT,
    node TEXT,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX agent_events_task ON agent_events (task, seq);
CREATE INDEX agent_events_run ON agent_events (run, seq);
CREATE INDEX agent_events_time ON agent_events (created_at);
`;

// One ALTER TABLE per table: InnoDB applies it whole or not at all.
const usageColumns = USAGE_COLUMNS.map(([column, , type]) => `ADD COLUMN ${column} ${type}`);
const MYSQL_V6 = [
    `ALTER TABLE tasks ADD COLUMN thread ${ID}, ADD COLUMN retry_of ${ID}, ` +
        `${usageColumns.join(", ")}, ADD INDEX tasks_thread (thread, created_at)`,
    `ALTER TABLE workflow_runs ADD COLUMN retry_of ${ID}, ${usageColumns.join(", ")}`,
    `CREATE TABLE IF NOT EXISTS agent_events (
        seq BIGINT AUTO_INCREMENT PRIMARY KEY,
        task ${ID},
        run ${ID},
        node ${ID},
        position INT NOT NULL,
        kind ${ID} NOT NULL,
        summary TEXT NOT NULL,
        created_at ${TIME} NOT NULL,
        INDEX agent_events_task (task, seq),
        INDEX agent_events_run (run, seq),
        INDEX agent_events_time (created_at)
    ) ${MYSQL_TABLE}`,
];

// Archived tasks leave the active lists. Pins are an account's own; "" is the installation while
// there are no accounts.
const SQLITE_V8 = `
ALTER TABLE tasks ADD COLUMN archived_at TEXT;
CREATE TABLE task_pins (
    user_id TEXT NOT NULL,
    task TEXT NOT NULL REFERENCES tasks (id),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, task)
);
`;

const MYSQL_V8 = [
    `ALTER TABLE tasks ADD COLUMN archived_at ${TIME}`,
    `CREATE TABLE IF NOT EXISTS task_pins (
        user_id ${ID} NOT NULL,
        task ${ID} NOT NULL,
        created_at ${TIME} NOT NULL,
        PRIMARY KEY (user_id, task),
        FOREIGN KEY (task) REFERENCES tasks (id)
    ) ${MYSQL_TABLE}`,
];

// Projects are named by a short slug; a GitHub repository keeps owner/name in
// `github`. The slug is the name lowercased with . and _ as -, or owner-name when two share a name.
interface Dialect {
    nameOf: (id: string) => string;
    trim: (text: string) => string;
    temp: string;
}
const SQLITE: Dialect = {
    nameOf: (id) => `substr(${id}, instr(${id}, '/') + 1)`,
    trim: (text) => `trim(${text}, '-')`,
    temp: "TEMP",
};
const MYSQL: Dialect = {
    nameOf: (id) => `SUBSTRING_INDEX(${id}, '/', -1)`,
    trim: (text) => `TRIM(BOTH '-' FROM ${text})`,
    temp: "TEMPORARY",
};
const slug = (d: Dialect, text: string) =>
    d.trim(`REPLACE(REPLACE(LOWER(${text}), '.', '-'), '_', '-')`);
const repoIds = (d: Dialect) => {
    const short = (id: string) => slug(d, d.nameOf(id));
    return (
        `CREATE ${d.temp} TABLE repo_ids AS SELECT r.id AS old_id, CASE WHEN ${short("r.id")} <> '' ` +
        `AND (SELECT COUNT(*) FROM repos s WHERE ${short("s.id")} = ${short("r.id")}) = 1 ` +
        `THEN ${short("r.id")} ELSE ${slug(d, "REPLACE(r.id, '/', '-')")} END AS new_id FROM repos r`
    );
};
const RENAME_REPOS = [
    ...[
        "tasks",
        "automations",
        "workflows",
        "workflow_runs",
        "notes",
        "integrations",
        "memory_pages",
        "memory_sections",
    ].map(
        (table) =>
            `UPDATE ${table} SET repo = ` +
            `COALESCE((SELECT new_id FROM repo_ids WHERE old_id = ${table}.repo), repo)`,
    ),
    "UPDATE repos SET id = (SELECT new_id FROM repo_ids WHERE old_id = repos.id)",
];
const GITHUB_FROM_ID = "UPDATE repos SET github = id WHERE github IS NULL AND id LIKE '%/%'";

// The new ids are checked once, at commit.
const SQLITE_V9 = [
    "PRAGMA defer_foreign_keys = ON",
    "ALTER TABLE repos ADD COLUMN github TEXT",
    GITHUB_FROM_ID,
    repoIds(SQLITE),
    ...RENAME_REPOS,
    "DROP TABLE repo_ids",
]
    .map((statement) => `${statement};`)
    .join("\n");

// One connection runs them all, so the foreign key checks stay off in between.
const MYSQL_V9 = [
    `ALTER TABLE repos ADD COLUMN github ${REF}`,
    GITHUB_FROM_ID,
    "SET FOREIGN_KEY_CHECKS = 0",
    "DROP TEMPORARY TABLE IF EXISTS repo_ids",
    repoIds(MYSQL),
    ...RENAME_REPOS,
    "DROP TEMPORARY TABLE repo_ids",
    "SET FOREIGN_KEY_CHECKS = 1",
];

const SQLITE_V10 = `
CREATE TABLE settings (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`;

const MYSQL_V10 = [
    `CREATE TABLE IF NOT EXISTS settings (
        name ${ID} PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at ${TIME} NOT NULL
    ) ${MYSQL_TABLE}`,
];

const USER_COLUMNS: [string, string, string][] = [
    ["email", "TEXT", REF],
    ["password_hash", "TEXT", "TEXT"],
    ["totp_secret", "TEXT", "TEXT"],
    ["backup_codes", "TEXT", "TEXT"],
    ["last_login_at", "TEXT", TIME],
];

const SQLITE_V11 = `
${USER_COLUMNS.map(([name, type]) => `ALTER TABLE users ADD COLUMN ${name} ${type};`).join("\n")}
CREATE UNIQUE INDEX users_email ON users (email);
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    created_at TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    verified_at TEXT,
    code_hash TEXT,
    code_expires_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    user_agent TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE TABLE auth_links (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id),
    kind TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
`;

const MYSQL_V11 = [
    ...USER_COLUMNS.map(([name, , type]) => `ALTER TABLE users ADD COLUMN ${name} ${type}`),
    "ALTER TABLE users ADD UNIQUE INDEX users_email (email)",
    `CREATE TABLE IF NOT EXISTS sessions (
        id CHAR(64) PRIMARY KEY,
        user_id ${ID} NOT NULL,
        created_at ${TIME} NOT NULL,
        seen_at ${TIME} NOT NULL,
        verified_at ${TIME},
        code_hash CHAR(64),
        code_expires_at ${TIME},
        attempts INT NOT NULL DEFAULT 0,
        ip ${REF},
        user_agent ${REF},
        INDEX sessions_user (user_id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    ) ${MYSQL_TABLE}`,
    `CREATE TABLE IF NOT EXISTS auth_links (
        id CHAR(64) PRIMARY KEY,
        user_id ${ID} NOT NULL,
        kind ${ID} NOT NULL,
        expires_at ${TIME} NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id)
    ) ${MYSQL_TABLE}`,
];

// Applied in order, each with its row in schema_migrations; never reordered or rewritten. SQLite
// runs a migration's script in one transaction, MySQL its statements one by one.
// Lines a task's commit adds and deletes (earlier tasks keep none), and the finished tasks and runs
// each account has read; "" is the installation. What finished before counts as read by everyone.
const READ_BEFORE = (kind: string, table: string) =>
    `INSERT INTO job_reads (user_id, kind, job, read_at)
    SELECT '', '${kind}', id, updated_at FROM ${table} WHERE status IN ('done', 'failed', 'cancelled')
    UNION ALL
    SELECT users.id, '${kind}', ${table}.id, ${table}.updated_at FROM users CROSS JOIN ${table}
    WHERE ${table}.status IN ('done', 'failed', 'cancelled')`;

const SQLITE_V12 = `
ALTER TABLE tasks ADD COLUMN lines_added INTEGER;
ALTER TABLE tasks ADD COLUMN lines_deleted INTEGER;
CREATE TABLE job_reads (
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    job TEXT NOT NULL,
    read_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind, job)
);
${READ_BEFORE("task", "tasks")};
${READ_BEFORE("run", "workflow_runs")};
`;

const MYSQL_V12 = [
    "ALTER TABLE tasks ADD COLUMN lines_added INT",
    "ALTER TABLE tasks ADD COLUMN lines_deleted INT",
    `CREATE TABLE IF NOT EXISTS job_reads (
        user_id ${ID} NOT NULL,
        kind VARCHAR(8) NOT NULL,
        job ${ID} NOT NULL,
        read_at ${TIME} NOT NULL,
        PRIMARY KEY (user_id, kind, job)
    ) ${MYSQL_TABLE}`,
    READ_BEFORE("task", "tasks"),
    READ_BEFORE("run", "workflow_runs"),
];

const SQLITE_V13 = `
ALTER TABLE tasks ADD COLUMN model TEXT;
ALTER TABLE tasks ADD COLUMN attachments TEXT;
ALTER TABLE tasks ADD COLUMN variant_group TEXT;
ALTER TABLE tasks ADD COLUMN variant TEXT;
ALTER TABLE tasks ADD COLUMN dispatch TEXT;
ALTER TABLE tasks ADD COLUMN parent TEXT;
ALTER TABLE tasks ADD COLUMN dispatch_merge TEXT;
CREATE INDEX tasks_variant_group ON tasks (variant_group);
CREATE INDEX tasks_parent ON tasks (parent);
`;

const MYSQL_V13 = [
    "ALTER TABLE tasks ADD COLUMN model VARCHAR(64)",
    "ALTER TABLE tasks ADD COLUMN attachments TEXT",
    `ALTER TABLE tasks ADD COLUMN variant_group ${ID}`,
    "ALTER TABLE tasks ADD COLUMN variant VARCHAR(1)",
    "ALTER TABLE tasks ADD COLUMN dispatch TEXT",
    `ALTER TABLE tasks ADD COLUMN parent ${ID}`,
    `ALTER TABLE tasks ADD COLUMN dispatch_merge ${ID}`,
    "CREATE INDEX tasks_variant_group ON tasks (variant_group)",
    "CREATE INDEX tasks_parent ON tasks (parent)",
];

export const MIGRATIONS: { version: number; sql: { sqlite: string; mysql: string[] } }[] = [
    { version: 1, sql: { sqlite: SQLITE_V1, mysql: MYSQL_V1 } },
    // A MySQL database gets `notes.seq` from migration 1.
    { version: 2, sql: { sqlite: SQLITE_V2, mysql: [] } },
    { version: 3, sql: { sqlite: SQLITE_V3, mysql: MYSQL_V3 } },
    // The commands a repository lets agents run, a JSON list; NULL is none.
    {
        version: 4,
        sql: {
            sqlite: "ALTER TABLE repos ADD COLUMN commands TEXT;",
            mysql: ["ALTER TABLE repos ADD COLUMN commands TEXT"],
        },
    },
    { version: 5, sql: { sqlite: SQLITE_V5, mysql: MYSQL_V5 } },
    { version: 6, sql: { sqlite: SQLITE_V6, mysql: MYSQL_V6 } },
    // The folder a repository works in; NULL keeps OLIMP's clone in OLIMP_HOME.
    {
        version: 7,
        sql: {
            sqlite: "ALTER TABLE repos ADD COLUMN path TEXT;",
            mysql: ["ALTER TABLE repos ADD COLUMN path TEXT"],
        },
    },
    { version: 8, sql: { sqlite: SQLITE_V8, mysql: MYSQL_V8 } },
    { version: 9, sql: { sqlite: SQLITE_V9, mysql: MYSQL_V9 } },
    // Settings changed in the panel, as JSON; a missing row keeps the value from the environment.
    { version: 10, sql: { sqlite: SQLITE_V10, mysql: MYSQL_V10 } },
    // Panel sign-in: e-mail and password, a second factor, sessions and one-time e-mail links.
    { version: 11, sql: { sqlite: SQLITE_V11, mysql: MYSQL_V11 } },
    { version: 12, sql: { sqlite: SQLITE_V12, mysql: MYSQL_V12 } },
    // The model a task asked for, its attached files, its group of variants (A, B, C), and the
    // subtasks a dispatched task splits into with the step that merges them.
    { version: 13, sql: { sqlite: SQLITE_V13, mysql: MYSQL_V13 } },
    // What the user who started a workflow run asked; where a task works when not in a worktree
    // of its own, and the branch it makes there; when a repository was unregistered (its tasks
    // keep pointing at it).
    {
        version: 14,
        sql: {
            sqlite:
                "ALTER TABLE workflow_runs ADD COLUMN input TEXT;\n" +
                "ALTER TABLE tasks ADD COLUMN workspace TEXT;\n" +
                "ALTER TABLE tasks ADD COLUMN branch_name TEXT;\n" +
                "ALTER TABLE repos ADD COLUMN removed_at TEXT;",
            mysql: [
                "ALTER TABLE workflow_runs ADD COLUMN input TEXT",
                "ALTER TABLE tasks ADD COLUMN workspace VARCHAR(16)",
                "ALTER TABLE tasks ADD COLUMN branch_name VARCHAR(255)",
                `ALTER TABLE repos ADD COLUMN removed_at ${TIME}`,
            ],
        },
    },
    // What an agent's edit changed, for the panel's preview of a tool call.
    {
        version: 15,
        sql: {
            sqlite: "ALTER TABLE agent_events ADD COLUMN detail TEXT;",
            mysql: ["ALTER TABLE agent_events ADD COLUMN detail MEDIUMTEXT"],
        },
    },
    // The agent, models and logins a project chose, as JSON; NULL takes the installation's.
    {
        version: 16,
        sql: {
            sqlite: "ALTER TABLE repos ADD COLUMN agents TEXT;",
            mysql: ["ALTER TABLE repos ADD COLUMN agents TEXT"],
        },
    },
    // A project's own settings, its sealed secrets and its webhook receivers, as JSON; NULL is none.
    // On MySQL a settings value may hold a longer system prompt.
    {
        version: 17,
        sql: {
            sqlite:
                "ALTER TABLE repos ADD COLUMN settings TEXT;\n" +
                "ALTER TABLE repos ADD COLUMN secrets TEXT;\n" +
                "ALTER TABLE repos ADD COLUMN webhooks TEXT;",
            mysql: [
                "ALTER TABLE repos ADD COLUMN settings MEDIUMTEXT",
                "ALTER TABLE repos ADD COLUMN secrets MEDIUMTEXT",
                "ALTER TABLE repos ADD COLUMN webhooks MEDIUMTEXT",
                // The global system prompt, one row, outgrows TEXT's 64 KB.
                "ALTER TABLE settings MODIFY value MEDIUMTEXT NOT NULL",
            ],
        },
    },
    // Graph workflows: a description, where a run's walk is while it waits, and the run whose
    // sub-workflow, fork or dispatch node started a run or a task.
    {
        version: 18,
        sql: {
            sqlite:
                "ALTER TABLE workflows ADD COLUMN description TEXT;\n" +
                "ALTER TABLE workflow_runs ADD COLUMN state TEXT;\n" +
                "ALTER TABLE workflow_runs ADD COLUMN parent_run TEXT;\n" +
                "ALTER TABLE tasks ADD COLUMN parent_run TEXT;",
            mysql: [
                "ALTER TABLE workflows ADD COLUMN description TEXT",
                "ALTER TABLE workflow_runs ADD COLUMN state MEDIUMTEXT",
                `ALTER TABLE workflow_runs ADD COLUMN parent_run ${ID}`,
                `ALTER TABLE tasks ADD COLUMN parent_run ${ID}`,
            ],
        },
    },
    // The memory upkeep OLIMP gives every project, one automation of each kind per project.
    {
        version: 19,
        sql: {
            sqlite:
                "ALTER TABLE automations ADD COLUMN builtin TEXT;\n" +
                "CREATE UNIQUE INDEX automations_builtin ON automations (repo, builtin);",
            mysql: [
                `ALTER TABLE automations ADD COLUMN builtin ${ID}`,
                "CREATE UNIQUE INDEX automations_builtin ON automations (repo, builtin)",
            ],
        },
    },
    // The agent session a continuation resumes.
    {
        version: 20,
        sql: {
            sqlite: "ALTER TABLE tasks ADD COLUMN session_id TEXT;",
            mysql: [`ALTER TABLE tasks ADD COLUMN session_id ${REF}`],
        },
    },
    // The cache's share of a job's input tokens; jobs before it keep only the total.
    {
        version: 21,
        sql: {
            sqlite:
                "ALTER TABLE tasks ADD COLUMN cache_read_tokens INTEGER;\n" +
                "ALTER TABLE tasks ADD COLUMN cache_write_tokens INTEGER;\n" +
                "ALTER TABLE workflow_runs ADD COLUMN cache_read_tokens INTEGER;\n" +
                "ALTER TABLE workflow_runs ADD COLUMN cache_write_tokens INTEGER;",
            // One ALTER TABLE per table: InnoDB applies it whole or not at all.
            mysql: [
                "ALTER TABLE tasks ADD COLUMN cache_read_tokens BIGINT, ADD COLUMN cache_write_tokens BIGINT",
                "ALTER TABLE workflow_runs ADD COLUMN cache_read_tokens BIGINT, ADD COLUMN cache_write_tokens BIGINT",
            ],
        },
    },
    // The first run of the thread a run continues, as tasks have.
    {
        version: 22,
        sql: {
            sqlite:
                "ALTER TABLE workflow_runs ADD COLUMN thread TEXT;\n" +
                "CREATE INDEX workflow_runs_thread ON workflow_runs (thread, created_at);",
            mysql: [
                `ALTER TABLE workflow_runs ADD COLUMN thread ${ID}, ADD INDEX workflow_runs_thread (thread, created_at)`,
            ],
        },
    },
    // The pull request a task reviews, and the head it was queued for: one review per head.
    {
        version: 23,
        sql: {
            sqlite:
                "ALTER TABLE tasks ADD COLUMN review_pr INTEGER;\n" +
                "ALTER TABLE tasks ADD COLUMN review_sha TEXT;\n" +
                "CREATE UNIQUE INDEX tasks_review ON tasks (repo, review_pr, review_sha) " +
                "WHERE review_sha IS NOT NULL;",
            mysql: [
                "ALTER TABLE tasks ADD COLUMN review_pr INT, ADD COLUMN review_sha CHAR(40), " +
                    "ADD UNIQUE INDEX tasks_review (repo, review_pr, review_sha)",
            ],
        },
    },
];
