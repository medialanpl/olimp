import { randomBytes } from "node:crypto";
import { type AgentName, noAgents } from "../agents.ts";
import type { Integration } from "../integrations.ts";
import { settingsFrom } from "../project.ts";
import { type Definition, fromLegacy, isLegacy } from "../workflow-graph.ts";
import type {
    AgentEvent,
    AgentEventInput,
    AgentEventType,
    AuthLink,
    Automation,
    Builtin,
    CostGroup,
    CostRow,
    Credentials,
    EventSource,
    JobKind,
    MemoryKind,
    MemoryPage,
    MemorySection,
    Note,
    Reads,
    Repo,
    Role,
    RunPatch,
    RunStatus,
    RunSummary,
    Session,
    SessionPatch,
    SkillSource,
    Task,
    TaskPatch,
    TaskStatus,
    Token,
    Usage,
    User,
    UserPatch,
    Workflow,
    WorkflowRun,
    Workspace,
} from "./database.ts";

// Both drivers return text columns as strings; numbers come as numbers or, for MySQL sums, strings.
export type Row = Record<string, string | null>;

export const newId = () => randomBytes(6).toString("hex");

export const NO_SKIP = { ids: [] as string[], repos: [] as string[] };

const notIn = (column: string, values: string[]) =>
    values.length ? ` AND ${column} NOT IN (${values.map(() => "?").join(", ")})` : "";

// The oldest queued task or workflow run, outside `skip`.
// A subtask waits until its dispatched task is done; the merge step names a finished parent.
const PARENT_DONE =
    " AND (parent IS NULL OR parent IN (SELECT p.id FROM tasks p WHERE p.status = 'done'))";

// A workflow run's subtask or sub-run starts only once the run waits for it, so it always finds
// what the run waits for (a reviewer branch, for one) already stored.
const RUN_WAITING =
    " AND (parent_run IS NULL OR parent_run IN " +
    "(SELECT w.id FROM workflow_runs w WHERE w.status = 'waiting'))";

export function queuedJobs(skip: { ids: string[]; repos: string[] }) {
    const where = `status = 'queued'${notIn("id", skip.ids)}${notIn("repo", skip.repos)}${RUN_WAITING}`;
    return {
        sql:
            `SELECT 'task' AS kind, id, created_at FROM tasks WHERE ${where}${PARENT_DONE} ` +
            `UNION ALL SELECT 'run', id, created_at FROM workflow_runs WHERE ${where} ` +
            "ORDER BY created_at, kind LIMIT 1",
        values: [...skip.ids, ...skip.repos, ...skip.ids, ...skip.repos],
    };
}

export const toSource = (r: Row): SkillSource => ({
    id: r.id as string,
    defaultBranch: r.default_branch as string,
    addedAt: r.added_at as string,
});

export const toRepo = (r: Row): Repo => ({
    ...toSource(r),
    issueLabel: r.issue_label ?? null,
    issueAuthor: r.issue_author ?? null,
    commands: r.commands ? JSON.parse(r.commands) : [],
    path: r.path ?? null,
    github: r.github ?? null,
    agents: r.agents ? JSON.parse(r.agents) : noAgents(),
    settings: settingsFrom(r.settings ?? null),
});

export const toUser = (r: Row): User => ({
    id: r.id as string,
    name: r.name as string,
    role: r.role as Role,
    createdAt: r.created_at as string,
    email: r.email ?? null,
    totp: Boolean(r.totp_secret),
    lastLoginAt: r.last_login_at ?? null,
});

export const toCredentials = (r: Row): Credentials => ({
    passwordHash: r.password_hash ?? null,
    totpSecret: r.totp_secret ?? null,
    backupCodes: r.backup_codes ? JSON.parse(r.backup_codes) : [],
});

export const toSession = (r: Row): Session => ({
    id: r.id as string,
    user: r.user_id as string,
    createdAt: r.created_at as string,
    seenAt: r.seen_at as string,
    verifiedAt: r.verified_at ?? null,
    codeHash: r.code_hash ?? null,
    codeExpiresAt: r.code_expires_at ?? null,
    attempts: Number(r.attempts),
    ip: r.ip ?? null,
    userAgent: r.user_agent ?? null,
});

export const toLink = (r: Row): AuthLink => ({
    id: r.id as string,
    user: r.user_id as string,
    kind: r.kind as AuthLink["kind"],
    expiresAt: r.expires_at as string,
});

const USER_SETS: Record<keyof UserPatch, string> = {
    name: "name",
    email: "email",
    role: "role",
    lastLoginAt: "last_login_at",
    passwordHash: "password_hash",
    totpSecret: "totp_secret",
    backupCodes: "backup_codes",
};

export function userSets(patch: UserPatch) {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    return {
        sql: entries.map(([key]) => `${USER_SETS[key as keyof UserPatch]} = ?`).join(", "),
        values: entries.map(([key, value]) =>
            key === "backupCodes" ? JSON.stringify(value) : (value as string | null),
        ),
    };
}

const SESSION_SETS: Record<keyof SessionPatch, string> = {
    seenAt: "seen_at",
    verifiedAt: "verified_at",
    codeHash: "code_hash",
    codeExpiresAt: "code_expires_at",
    attempts: "attempts",
};

export function sessionSets(patch: SessionPatch) {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    return {
        sql: entries.map(([key]) => `${SESSION_SETS[key as keyof SessionPatch]} = ?`).join(", "),
        values: entries.map(([, value]) => value as string | number | null),
    };
}

export const toToken = (r: Row): Token => ({
    id: r.id as string,
    user: r.user_id as string,
    createdAt: r.created_at as string,
});

// No commands is NULL, as in a repository from before migration 4.
export const commandsColumn = (commands: string[]) =>
    commands.length ? JSON.stringify(commands) : null;

const num = (value: string | number | null | undefined) =>
    value === null || value === undefined ? null : Number(value);

const toUsage = (r: Row): Usage => ({
    turns: num(r.turns),
    costUsd: num(r.cost_usd),
    inputTokens: num(r.input_tokens),
    cacheReadTokens: num(r.cache_read_tokens),
    cacheWriteTokens: num(r.cache_write_tokens),
    outputTokens: num(r.output_tokens),
    durationMs: num(r.duration_ms),
});

const USAGE_SQL: Record<keyof Usage, string> = {
    turns: "turns",
    costUsd: "cost_usd",
    inputTokens: "input_tokens",
    cacheReadTokens: "cache_read_tokens",
    cacheWriteTokens: "cache_write_tokens",
    outputTokens: "output_tokens",
    durationMs: "duration_ms",
};

export const toReads = (rows: Row[]): Reads => ({
    tasks: rows.filter((r) => r.kind === "task").map((r) => r.job as string),
    runs: rows.filter((r) => r.kind === "run").map((r) => r.job as string),
});

export const toTask = (r: Row): Task => ({
    id: r.id as string,
    repo: r.repo as string,
    title: r.title as string,
    body: r.body as string,
    agent: r.agent as AgentName,
    skill: r.skill ?? null,
    integrations: JSON.parse(r.integrations ?? "[]"),
    automation: r.automation ?? null,
    issue: num(r.issue),
    reviewPr: num(r.review_pr),
    reviewSha: r.review_sha ?? null,
    thread: r.thread ?? null,
    retryOf: r.retry_of ?? null,
    model: r.model ?? null,
    attachments: JSON.parse(r.attachments ?? "[]"),
    variantGroup: r.variant_group ?? null,
    variant: r.variant ?? null,
    dispatch: r.dispatch ? JSON.parse(r.dispatch) : null,
    parent: r.parent ?? null,
    parentRun: r.parent_run ?? null,
    dispatchMerge: r.dispatch_merge ?? null,
    workspace: (r.workspace ?? "worktree") as Workspace,
    branchName: r.branch_name ?? null,
    status: r.status as TaskStatus,
    branch: r.branch ?? null,
    prUrl: r.pr_url ?? null,
    error: r.error ?? null,
    log: r.log ?? "",
    archivedAt: r.archived_at ?? null,
    linesAdded: num(r.lines_added),
    linesDeleted: num(r.lines_deleted),
    sessionId: r.session_id ?? null,
    ...toUsage(r),
    author: r.author ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
});

export const toAutomation = (r: Row): Automation => ({
    id: r.id as string,
    name: r.name as string,
    cron: r.cron as string,
    enabled: Number(r.enabled) === 1,
    workflow: r.workflow ?? null,
    repo: r.repo ?? null,
    title: r.title ?? null,
    body: r.body ?? null,
    agent: (r.agent ?? null) as AgentName | null,
    skill: r.skill ?? null,
    // Template automations from before integrations have none.
    integrations: r.workflow ? null : JSON.parse(r.integrations ?? "[]"),
    lastRunAt: r.last_run_at ?? null,
    author: r.author ?? null,
    createdAt: r.created_at as string,
    builtin: (r.builtin ?? null) as Builtin | null,
});

// Definitions saved before the graph editor are read in the graph format.
function toDefinition(json: string): Definition {
    const definition: unknown = JSON.parse(json);
    return isLegacy(definition) ? fromLegacy(definition) : (definition as Definition);
}

export const toIntegration = (r: Row): Integration => ({
    repo: r.repo as string,
    name: r.name as string,
    kind: r.kind,
    ...JSON.parse(r.config as string),
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
});

export const toWorkflow = (r: Row): Workflow => ({
    id: r.id as string,
    name: r.name as string,
    description: r.description ?? "",
    repo: r.repo as string,
    definition: toDefinition(r.definition as string),
    author: r.author ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
});

export const toSummary = (r: Row): RunSummary => ({
    id: r.id as string,
    workflow: r.workflow as string,
    name: r.name as string,
    repo: r.repo as string,
    automation: r.automation ?? null,
    retryOf: r.retry_of ?? null,
    thread: r.thread ?? null,
    input: r.input ?? null,
    parentRun: r.parent_run ?? null,
    status: r.status as RunStatus,
    currentNode: r.current_node ?? null,
    branch: r.branch ?? null,
    prUrl: r.pr_url ?? null,
    error: r.error ?? null,
    ...toUsage(r),
    author: r.author ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
});

export const toRun = (r: Row): WorkflowRun => ({
    ...toSummary(r),
    definition: toDefinition(r.definition as string),
    steps: JSON.parse(r.steps ?? "[]"),
    state: r.state ? JSON.parse(r.state) : null,
});

export const toNote = (r: Row): Note => ({
    id: r.id as string,
    repo: r.repo as string,
    text: r.text as string,
    task: r.task ?? null,
    run: r.run ?? null,
    node: r.node ?? null,
    author: r.author ?? null,
    createdAt: r.created_at as string,
});

const sourceOf = (r: Row) => ({
    task: r.task ?? null,
    run: r.run ?? null,
    node: r.node ?? null,
    author: r.author ?? null,
});

// Pages from their rows, the rows of their sections (by page and position) and of the citations
// (by section and position), as the three queries of `memorySql` return them.
export function toMemoryPages(pages: Row[], sections: Row[], sources: Row[]): MemoryPage[] {
    const cited = new Map<string, string[]>();
    for (const r of sources) {
        const list = cited.get(r.section as string) ?? [];
        list.push(r.note as string);
        cited.set(r.section as string, list);
    }
    const byPage = new Map<string, MemorySection[]>();
    for (const r of sections) {
        const list = byPage.get(r.page as string) ?? [];
        list.push(toMemorySection(r, cited.get(r.id as string) ?? []));
        byPage.set(r.page as string, list);
    }
    return pages.map((r) => ({
        repo: r.repo as string,
        slug: r.slug as string,
        title: r.title as string,
        description: r.description as string,
        kind: r.kind as MemoryKind,
        version: Number(r.version),
        ...sourceOf(r),
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
        sections: byPage.get(r.slug as string) ?? [],
    }));
}

export const toMemorySection = (r: Row, sources: string[]): MemorySection => ({
    heading: r.heading as string,
    body: r.body as string,
    sources,
    version: Number(r.version),
    ...sourceOf(r),
    updatedAt: r.updated_at as string,
});

// The same queries in both databases; with `one` they take the slug as a second parameter.
export const memorySql = (one: boolean) => ({
    pages: `SELECT * FROM memory_pages WHERE repo = ?${one ? " AND slug = ?" : ""} ORDER BY slug`,
    sections:
        `SELECT * FROM memory_sections WHERE repo = ?${one ? " AND page = ?" : ""} ` +
        "ORDER BY page, position",
    sources:
        "SELECT s.section, s.note FROM memory_sources s " +
        `JOIN memory_sections c ON c.id = s.section WHERE c.repo = ?${one ? " AND c.page = ?" : ""} ` +
        "ORDER BY s.section, s.position",
});

const UNWOVEN =
    "FROM notes n WHERE n.repo = ? AND NOT EXISTS (SELECT 1 FROM memory_sources s WHERE s.note = n.id)";
export const UNWOVEN_COUNT = `SELECT COUNT(*) AS total ${UNWOVEN}`;
export const UNWOVEN_NOTES = `SELECT n.* ${UNWOVEN} ORDER BY n.created_at DESC, n.seq DESC LIMIT ?`;
export const OLDEST_UNWOVEN = `SELECT n.* ${UNWOVEN} ORDER BY n.created_at, n.seq LIMIT ?`;

export const toAgentEvent = (r: Row): AgentEvent => ({
    seq: Number(r.seq),
    task: r.task ?? null,
    run: r.run ?? null,
    node: r.node ?? null,
    position: Number(r.position),
    type: r.kind as AgentEventType,
    summary: r.summary as string,
    detail: r.detail ?? null,
    createdAt: r.created_at as string,
});

export const INSERT_EVENT =
    "INSERT INTO agent_events (task, run, node, position, kind, summary, detail, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)";

export const eventValues = (source: EventSource, event: AgentEventInput, at: string) => [
    source.task,
    source.run,
    source.node,
    event.position,
    event.type,
    event.summary,
    event.detail ?? null,
    at,
];

export const eventsSql = (of: { task: string } | { run: string }) =>
    "task" in of
        ? { sql: "SELECT * FROM agent_events WHERE task = ? ORDER BY seq", value: of.task }
        : { sql: "SELECT * FROM agent_events WHERE run = ? ORDER BY seq", value: of.run };

const COST_KEYS: Record<CostGroup, string> = {
    day: "SUBSTR(created_at, 1, 10)",
    repo: "repo",
    agent: "agent",
    author: "author",
};

const usageList = Object.values(USAGE_SQL).join(", ");

// Takes `since` twice. A run counts as agent `workflow`; jobs that never reached an agent are left
// out, and a cancelled one without a cost is not unpriced. The same SQL in both databases.
export const costsSql = (group: CostGroup) =>
    `SELECT ${COST_KEYS[group]} AS k, COUNT(*) AS jobs, ` +
    "SUM(CASE WHEN cost_usd IS NULL AND status <> 'cancelled' THEN 1 ELSE 0 END) AS unpriced, " +
    `${Object.values(USAGE_SQL)
        .map((c) => `SUM(${c}) AS ${c}`)
        .join(", ")} FROM (` +
    `SELECT created_at, repo, agent, author, status, ${usageList} FROM tasks ` +
    "WHERE created_at >= ? AND duration_ms IS NOT NULL UNION ALL " +
    `SELECT created_at, repo, 'workflow' AS agent, author, status, ${usageList} FROM workflow_runs ` +
    "WHERE created_at >= ? AND duration_ms IS NOT NULL) jobs GROUP BY k ORDER BY k";

export const toCostRow = (r: Row): CostRow => ({
    key: r.k === null || r.k === undefined ? null : String(r.k),
    jobs: Number(r.jobs),
    unpriced: Number(r.unpriced),
    ...toUsage(r),
});

const TASK_COLUMNS: Record<keyof TaskPatch, string> = {
    status: "status",
    branch: "branch",
    prUrl: "pr_url",
    error: "error",
    log: "log",
    linesAdded: "lines_added",
    linesDeleted: "lines_deleted",
    sessionId: "session_id",
    ...USAGE_SQL,
};

const RUN_COLUMNS: Record<keyof RunPatch, string> = {
    status: "status",
    currentNode: "current_node",
    steps: "steps",
    state: "state",
    branch: "branch",
    prUrl: "pr_url",
    error: "error",
    ...USAGE_SQL,
};

export const jobTable = (kind: JobKind) => (kind === "task" ? "tasks" : "workflow_runs");

// The SET clause and its values for a patch; JSON columns are serialised.
function sets<P extends object>(columns: Record<keyof P, string>, patch: P) {
    const keys = Object.keys(patch) as (keyof P)[];
    return {
        sql: keys.map((k) => `${columns[k]} = ?`).join(", "),
        values: keys.map((k) => {
            const value = patch[k];
            return typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : ((value ?? null) as string | null);
        }),
    };
}

export const taskSets = (patch: TaskPatch) => sets(TASK_COLUMNS, patch);
export const runSets = (patch: RunPatch) => sets(RUN_COLUMNS, patch);
