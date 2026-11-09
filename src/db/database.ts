import type { AgentName, RepoAgents } from "../agents.ts";
import type { Integration, ServerSpec } from "../integrations.ts";
import type { CostGroup } from "../limits.ts";
import type { RepoSettings, StoredSecret } from "../project.ts";
import type { Webhook } from "../webhooks.ts";
import type { Definition, NodeType, Outputs, Transition } from "../workflow-graph.ts";

export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";
// A run also waits, holding no worker slot: for a person, for CI or for its subtasks.
export type RunStatus = TaskStatus | "waiting";

// What agent calls cost as their CLI reported it; null before an agent ran and for what the CLI
// does not report (Codex reports no cost).
export interface Usage {
    turns: number | null;
    costUsd: number | null;
    // The whole input, cache included; the cache's share is null for jobs before migration 21.
    inputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
}

// `prompt` and `command` are what OLIMP sent and how it started the agent; `session` what the
// agent says it loaded, `output` a tool's result.
export type AgentEventType =
    | "text"
    | "tool"
    | "result"
    | "error"
    | "prompt"
    | "command"
    | "session"
    | "output";

// One line of an agent step's trace: a message, a tool call with a short summary of its input,
// the final result or an error. `position` orders the events of one step.
export interface AgentEventInput {
    type: AgentEventType;
    summary: string;
    // What an edit changed, as "-" and "+" lines; none for other events.
    detail?: string | null;
    position: number;
}

export interface AgentEvent extends AgentEventInput {
    seq: number;
    detail: string | null;
    task: string | null;
    run: string | null;
    node: string | null;
    createdAt: string;
}

export type EventSource = Pick<NoteSource, "task" | "run" | "node">;

export type { CostGroup };

// One group of the cost report: a UTC day, repository, agent (`workflow` for a workflow run,
// whose steps may use both) or author. `unpriced` counts jobs without a reported cost, but not
// cancelled ones.
export interface CostRow extends Usage {
    key: string | null;
    jobs: number;
    unpriced: number;
}

export interface SkillSource {
    id: string;
    defaultBranch: string;
    addedAt: string;
}

export type Role = "admin" | "member";

// An account. Repositories and everything in them are shared; an admin also manages accounts.
export interface User {
    id: string;
    name: string;
    role: Role;
    createdAt: string;
    // The sign-in of the panel; null for an account that only has API tokens.
    email: string | null;
    // Whether the account set up an authenticator app; without one its codes come by e-mail.
    totp: boolean;
    lastLoginAt: string | null;
}

export type UserInput = Pick<User, "name" | "role"> & {
    email?: string | null;
    passwordHash?: string | null;
};

// What signs an account in; never leaves the API. The TOTP secret is stored encrypted.
export interface Credentials {
    passwordHash: string | null;
    totpSecret: string | null;
    // SHA-256 hashes of the unused backup codes.
    backupCodes: string[];
}

export type UserPatch = Partial<
    Pick<User, "name" | "email" | "role" | "lastLoginAt"> & {
        passwordHash: string;
        totpSecret: string | null;
        backupCodes: string[];
    }
>;

// A panel sign-in. Its id is the SHA-256 hash of the cookie; it works once the second factor
// passed (verifiedAt). Until then it may hold the hash of a code sent by e-mail.
export interface Session {
    id: string;
    user: string;
    createdAt: string;
    seenAt: string;
    verifiedAt: string | null;
    codeHash: string | null;
    codeExpiresAt: string | null;
    attempts: number;
    ip: string | null;
    userAgent: string | null;
}

export type SessionPatch = Partial<
    Pick<Session, "seenAt" | "verifiedAt" | "codeHash" | "codeExpiresAt" | "attempts">
>;

// A one-time link from an e-mail: an invitation or a password reset. Its id is the link's hash.
export interface AuthLink {
    id: string;
    user: string;
    kind: "invite" | "reset";
    expiresAt: string;
}

// Only the hash of a token is stored; the token itself is shown once, when created.
export interface Token {
    id: string;
    user: string;
    createdAt: string;
}

// The account that created or changed a record; null without accounts and for older data.
export interface Authored {
    author: string | null;
}

export interface Repo extends SkillSource {
    // Open issues with this label become tasks; null when issues are not a task source.
    issueLabel: string | null;
    // Who turned issues on: the tasks of the issues run as that account.
    issueAuthor: string | null;
    // Shell commands agents may run to check their work, e.g. `pnpm typecheck`.
    commands: string[];
    // The folder the repository works in; null for one registered before folders, in OLIMP_HOME.
    path: string | null;
    // owner/name on GitHub; null for a local project, which gets no push, pull request or issues.
    github: string | null;
    agents: RepoAgents;
    settings: RepoSettings;
}

export interface TaskTemplate {
    repo: string;
    title: string;
    body: string;
    agent: AgentName;
    // Canonical `owner/repo:name`, resolved when the task or automation is created.
    skill: string | null;
    // Names of MCP integrations of the repository, checked when the task or automation is created.
    integrations: string[];
}

// What a task adds to its template: the model (null is the agent's own default) and the names of
// the files attached to it, kept beside the task in OLIMP_HOME, not in the repository.
export interface TaskExtras {
    model: string | null;
    attachments: string[];
}

// A dispatched task's agent splits it into subtasks while it works; they run after it.
export interface Dispatch {
    maxSubtasks: number;
    inFlight: number;
    // The subtasks' agent and model; null is the dispatched task's own.
    agent?: AgentName | null;
    model?: string | null;
    // What the user would like one subtask to cost at most: told to the agent, not enforced.
    budgetUsd?: number | null;
}

// Where a task works: a worktree of its own (the default), the project's checkout on
// the branch it has, or the checkout switched to a new branch from the base.
export type Workspace = "worktree" | "checkout" | "branch";

export interface Task extends TaskTemplate, TaskExtras, Authored, Usage {
    id: string;
    workspace: Workspace;
    // The branch a "branch" task makes; null is olimp/<the thread's first task>.
    branchName: string | null;
    dispatch: Dispatch | null;
    // A subtask's dispatched task; also on the step of the thread that merges the subtasks.
    parent: string | null;
    // The workflow run whose fork or dispatch node started it.
    parentRun: string | null;
    // The step that merges a dispatched task's subtasks, once queued.
    dispatchMerge: string | null;
    // Variants of one prompt share a group; each has a letter, A first.
    variantGroup: string | null;
    variant: string | null;
    automation: string | null;
    // The GitHub issue the task came from, unique within its repository.
    issue: number | null;
    // The pull request the task reviews, and the head the poll queued it for (unique with it);
    // a retry or continuation reviews it again with no head of its own.
    reviewPr: number | null;
    reviewSha: string | null;
    // The first task of the thread this one continues, on that task's branch; null for a first.
    thread: string | null;
    // The task this one retries.
    retryOf: string | null;
    status: TaskStatus;
    branch: string | null;
    prUrl: string | null;
    error: string | null;
    // The agent's final answer, or its raw output when it gave none.
    log: string;
    // Set while the task is archived: out of the active lists, its history kept.
    archivedAt: string | null;
    // Lines the task's own commit adds and deletes; null until it commits, or in a folder without git.
    linesAdded: number | null;
    linesDeleted: number | null;
    // The agent's session after the task's step; a continuation on Claude resumes it.
    sessionId: string | null;
    createdAt: string;
    updatedAt: string;
}

export type TaskInput = Pick<Task, "repo" | "title" | "body"> &
    Partial<
        Pick<
            Task,
            | "agent"
            | "skill"
            | "integrations"
            | "automation"
            | "author"
            | "thread"
            | "retryOf"
            | "model"
            | "attachments"
            | "variantGroup"
            | "variant"
            | "dispatch"
            | "parent"
            | "parentRun"
            | "workspace"
            | "branchName"
            | "reviewPr"
        >
    >;

export type TaskPatch = Partial<
    Pick<
        Task,
        | "status"
        | "branch"
        | "prUrl"
        | "error"
        | "log"
        | "linesAdded"
        | "linesDeleted"
        | "sessionId"
        | keyof Usage
    >
>;

// An automation queues either a task from its template or a run of `workflow`, never both: in
// workflow mode the template fields are null. Its tasks and runs are queued as its author.
export interface Automation extends Authored {
    id: string;
    name: string;
    cron: string;
    enabled: boolean;
    workflow: string | null;
    repo: string | null;
    title: string | null;
    body: string | null;
    agent: AgentName | null;
    skill: string | null;
    integrations: string[] | null;
    lastRunAt: string | null;
    createdAt: string;
    // The memory upkeep every project gets; OLIMP makes it, so it cannot be deleted, only turned off.
    builtin: Builtin | null;
}

export type Builtin = "weave" | "lint";

// The author is set when the automation is created and stays when someone else changes it.
export type AutomationInput = Omit<
    Automation,
    "id" | "lastRunAt" | "createdAt" | "author" | "builtin"
>;

export interface Workflow extends Authored {
    id: string;
    name: string;
    description: string;
    repo: string;
    definition: Definition;
    createdAt: string;
    updatedAt: string;
}

export type WorkflowInput = Pick<Workflow, "name" | "repo" | "definition"> &
    Partial<Pick<Workflow, "description">>;

export type StepStatus = "running" | "waiting" | "done" | "failed" | "cancelled";

// One visit of a node; a loop visits a node again as a new step. An agent step also has its
// agent and usage; steps from before stage 9 have neither.
export interface Step extends Partial<Usage> {
    node: string;
    // Old runs store the types agent, condition and pr.
    type: NodeType | "condition" | "pr";
    agent?: AgentName;
    status: StepStatus;
    startedAt: string;
    finishedAt: string | null;
    log: string;
    error: string | null;
    // The port the node left by.
    port?: string | null;
    // Subtasks and runs it started.
    children?: Child[];
}

export interface Child {
    kind: JobKind;
    id: string;
    // The fork branch it runs.
    node: string;
    review?: boolean;
}

// What a waiting run waits for, and what ended the wait once it is queued again.
export interface RunWait {
    node: string;
    kind: "gate" | "ask" | "ci" | "children";
    since: string;
    // When the timeout port fires; null waits without one.
    until: string | null;
    question?: string;
    options?: string[];
    children?: Child[];
    mode?: "all" | "any";
    pr?: number;
    // The worktree's commit, whose checks count.
    sha?: string;
    pollMs?: number;
    nextPoll?: string;
    answer?: string;
    comment?: string;
    answeredBy?: string | null;
    ci?: "passing" | "failing" | "conflict";
    timedOut?: boolean;
}

// Where a graph walk is, kept between the visits of the worker.
export interface RunState {
    outputs: Outputs;
    loops: Record<string, number>;
    // The session of each agent node, for a later node that continues it.
    sessions: Record<string, { agent: AgentName; id: string }>;
    transitions: Transition[];
    wait: RunWait | null;
    // The output of a check that failed, for the next agent step.
    failedCheck: { node: string; output: string } | null;
    // What checks wrote, left out of the run's commits until something else changes it.
    checkOwned?: Record<string, string>;
    walked: number;
    // The node a resumed failed run visits again first.
    resumeAt?: string | null;
}

// A run keeps a copy of the workflow's name, repository and definition from the moment it was
// queued, so editing or deleting the workflow does not change a run. Its author started it, or
// is the author of the automation that queued it. Its usage is the sum of its agent steps.
export interface WorkflowRun extends Authored, Usage {
    id: string;
    workflow: string;
    name: string;
    repo: string;
    definition: Definition;
    automation: string | null;
    // The run this one retries.
    retryOf: string | null;
    // The first run of the thread this one continues, on that run's branch; null for a first.
    thread: string | null;
    // What the user who started the run asked; every agent step sees it.
    input: string | null;
    // The run of a sub-workflow node that started this one.
    parentRun: string | null;
    status: RunStatus;
    currentNode: string | null;
    steps: Step[];
    state: RunState | null;
    branch: string | null;
    prUrl: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
}

export type RunSummary = Omit<WorkflowRun, "definition" | "steps" | "state">;

export type RunPatch = Partial<
    Pick<
        WorkflowRun,
        "status" | "currentNode" | "steps" | "state" | "branch" | "prUrl" | "error" | keyof Usage
    >
>;

export type Job = { kind: "task"; task: Task } | { kind: "run"; run: WorkflowRun };
export type JobKind = Job["kind"];

export interface Reads {
    tasks: string[];
    runs: string[];
}

// What a run copies from its workflow when queued.
export type RunTemplate = Pick<Workflow, "id" | "name" | "repo" | "definition">;

// Where a note came from: a task, a workflow run's agent step, or neither (added through the API),
// and on whose behalf.
export interface NoteSource {
    task: string | null;
    run: string | null;
    node: string | null;
    author?: string | null;
}

export interface Note extends Required<NoteSource> {
    id: string;
    repo: string;
    text: string;
    createdAt: string;
}

export type MemoryKind = "page" | "hub";

// A section of a repository memory page. Its source is the last change: a task, a workflow run's
// agent step, or neither (a change through the API).
export interface MemorySection extends Required<NoteSource> {
    heading: string;
    body: string;
    // Ids of the notes the section rests on, in the order cited.
    sources: string[];
    version: number;
    updatedAt: string;
}

// `version` counts changes of the title, description and kind; every section has its own.
export interface MemoryPage extends Required<NoteSource> {
    repo: string;
    slug: string;
    title: string;
    description: string;
    kind: MemoryKind;
    version: number;
    createdAt: string;
    updatedAt: string;
    sections: MemorySection[];
}

export type MemoryPageInput = Pick<MemoryPage, "slug" | "title" | "description" | "kind">;

export type MemorySectionInput = Pick<MemorySection, "heading" | "body" | "sources">;

// The database behind OLIMP, SQLite or MySQL. Every operation that must be atomic is one method:
// there is no transaction API outside the implementations.
export interface Database {
    // Which database this is, for the start-up log; never contains a password.
    readonly description: string;
    close(): Promise<void>;
    migrations(): Promise<number[]>;

    hasUsers(): Promise<boolean>;
    users(): Promise<User[]>;
    user(id: string): Promise<User | undefined>;
    // The account with its first token, in one transaction. Undefined when the name is taken or,
    // with `first`, when any account exists already.
    createUser(
        input: UserInput,
        tokenHash: string | null,
        first?: boolean,
    ): Promise<{ user: User; token: Token | null } | undefined>;
    userByEmail(email: string): Promise<User | undefined>;
    credentials(id: string): Promise<Credentials | undefined>;
    // "taken" when another account has the name or e-mail; the last admin stays an admin.
    updateUser(id: string, patch: UserPatch): Promise<User | "missing" | "lastAdmin" | "taken">;
    // Uses up one backup code; false when the account does not have it (any more).
    spendBackupCode(id: string, hash: string): Promise<boolean>;
    createSession(session: Session): Promise<void>;
    session(id: string): Promise<Session | undefined>;
    updateSession(id: string, patch: SessionPatch): Promise<void>;
    // Newest first.
    sessions(user: string): Promise<Session[]>;
    deleteSession(id: string): Promise<void>;
    // Every session of the account but `keep`.
    deleteSessions(user: string, keep?: string): Promise<void>;
    // Sessions idle since `idleBefore` or started before `startedBefore`; returns how many.
    purgeSessions(idleBefore: string, startedBefore: string): Promise<number>;
    // Replaces the account's earlier link of the same kind.
    createLink(link: AuthLink): Promise<void>;
    link(id: string): Promise<AuthLink | undefined>;
    // The link, deleted so it works once; undefined when it is gone.
    takeLink(id: string): Promise<AuthLink | undefined>;
    // Deletes the account with its tokens, sessions and links; the last admin stays.
    deleteUser(id: string): Promise<"deleted" | "missing" | "lastAdmin">;
    addToken(user: string, tokenHash: string): Promise<Token>;
    tokens(user: string): Promise<Token[]>;
    token(id: string): Promise<Token | undefined>;
    deleteToken(id: string): Promise<boolean>;
    userByToken(tokenHash: string): Promise<User | undefined>;

    // A repository registered again keeps its folder and GitHub repository unless given.
    addRepo(
        id: string,
        defaultBranch: string,
        path?: string | null,
        github?: string | null,
    ): Promise<Repo>;
    repo(id: string): Promise<Repo | undefined>;
    repos(): Promise<Repo[]>;
    setIssueLabel(
        id: string,
        label: string | null,
        author?: string | null,
    ): Promise<Repo | undefined>;
    setCommands(id: string, commands: string[]): Promise<Repo | undefined>;
    // The branch new tasks start from and their pull requests target.
    setDefaultBranch(id: string, branch: string): Promise<Repo | undefined>;
    setRepoAgents(id: string, agents: RepoAgents): Promise<Repo | undefined>;
    setRepoSettings(id: string, settings: RepoSettings): Promise<Repo | undefined>;
    // Kept out of Repo, so no listing of projects carries them, sealed as they are.
    secrets(repo: string): Promise<Record<string, StoredSecret>>;
    setSecrets(repo: string, secrets: Record<string, StoredSecret>): Promise<void>;
    webhooks(repo: string): Promise<Webhook[]>;
    setWebhooks(repo: string, webhooks: Webhook[]): Promise<void>;
    // Only the registration, marked removed: the repository's tasks, runs, notes, memory and
    // integrations stay, and registering it again (addRepo) finds them.
    deleteRepo(id: string): Promise<boolean>;
    // Its tasks and workflow runs that are queued or running.
    activeJobs(repo: string): Promise<number>;

    integrations(repo: string): Promise<Integration[]>;
    integration(repo: string, name: string): Promise<Integration | undefined>;
    // Undefined when the repository already has an integration of that name.
    addIntegration(repo: string, name: string, spec: ServerSpec): Promise<Integration | undefined>;
    updateIntegration(
        repo: string,
        name: string,
        spec: ServerSpec,
    ): Promise<Integration | undefined>;
    deleteIntegration(repo: string, name: string): Promise<boolean>;

    addSkillSource(id: string, defaultBranch: string): Promise<SkillSource>;
    skillSource(id: string): Promise<SkillSource | undefined>;
    skillSources(): Promise<SkillSource[]>;
    deleteSkillSource(id: string): Promise<void>;

    createTask(input: TaskInput): Promise<Task>;
    // Undefined when the issue already has a task in its repository: the INSERT and the unique
    // index decide in one statement, so concurrent polls cannot both queue it.
    createIssueTask(input: TaskInput & { issue: number }): Promise<Task | undefined>;
    // Undefined when a review of that head was queued already.
    createReviewTask(
        input: TaskInput & { reviewPr: number; reviewSha: string },
    ): Promise<Task | undefined>;
    task(id: string): Promise<Task | undefined>;
    tasks(limit?: number): Promise<Task[]>;
    // The first task of a thread and its continuations, oldest first.
    threadTasks(thread: string): Promise<Task[]>;
    // The variants of one prompt, A first.
    variantTasks(group: string): Promise<Task[]>;
    // A dispatched task's subtasks, oldest first.
    subtasks(parent: string): Promise<Task[]>;
    // True for exactly one caller: the one that queues the merge step.
    claimDispatchMerge(parent: string): Promise<boolean>;
    setDispatchMerge(parent: string, merge: string): Promise<void>;
    // Tasks and workflow runs share one queue, oldest first.
    // `skip` leaves out jobs already taken and jobs of projects that are busy.
    nextJob(skip?: { ids: string[]; repos: string[] }): Promise<Job | undefined>;
    // Marks a queued job running on `branch`; false when it is no longer queued (cancelled).
    startJob(kind: JobKind, id: string, branch: string): Promise<boolean>;
    // Cancels a job that is still queued; false when it is not.
    cancelQueued(kind: JobKind, id: string, error: string): Promise<boolean>;
    update(id: string, patch: TaskPatch): Promise<void>;
    // Archives or restores a task; undefined when there is no such task.
    archiveTask(id: string, archived: boolean): Promise<Task | undefined>;
    // The tasks an account pinned, in the order it pinned them (within one millisecond by task id);
    // "" is the installation without accounts.
    pins(user: string): Promise<string[]>;
    pinTask(user: string, task: string, pinned: boolean): Promise<void>;
    // The tasks and runs an account has read; one without a read is unread once it finishes.
    reads(user: string): Promise<Reads>;
    markRead(user: string, kind: JobKind, id: string, read: boolean): Promise<void>;
    // Saved settings by name; null deletes one.
    settings(): Promise<Record<string, string>>;
    saveSettings(values: Record<string, string | null>): Promise<void>;
    // A task or run left running by a crashed process would never finish; it fails on the next
    // start, and so does the step it was in.
    failInterrupted(): Promise<number>;

    createAutomation(
        input: AutomationInput,
        author?: string | null,
        builtin?: Builtin | null,
    ): Promise<Automation>;
    automation(id: string): Promise<Automation | undefined>;
    automations(): Promise<Automation[]>;
    updateAutomation(id: string, input: AutomationInput): Promise<Automation | undefined>;
    deleteAutomation(id: string): Promise<boolean>;
    automationsOf(workflow: string): Promise<Automation[]>;
    // Queues the automation's task or workflow run. With a slot (the scheduled minute) only an
    // enabled automation runs and only once per slot; the slot is stored in the same transaction
    // as the job, so a restart within that minute cannot queue it again.
    runAutomation(id: string, slot?: string): Promise<Task | WorkflowRun | undefined>;

    createWorkflow(input: WorkflowInput, author?: string | null): Promise<Workflow>;
    workflow(id: string): Promise<Workflow | undefined>;
    workflows(): Promise<Workflow[]>;
    updateWorkflow(id: string, input: WorkflowInput): Promise<Workflow | undefined>;
    deleteWorkflow(id: string): Promise<boolean>;

    createRun(
        workflow: RunTemplate,
        automation?: string | null,
        author?: string | null,
        retryOf?: string | null,
        input?: string | null,
        parentRun?: string | null,
        thread?: string | null,
    ): Promise<WorkflowRun>;
    run(id: string): Promise<WorkflowRun | undefined>;
    // The first run of a thread and its continuations, oldest first.
    threadRuns(thread: string): Promise<WorkflowRun[]>;
    runs(limit?: number): Promise<RunSummary[]>;
    updateRun(id: string, patch: RunPatch): Promise<void>;
    // A waiting run back in the queue with what ended its wait, or a failed one to go on from its
    // failed step; false when it was not in that status, so a second answer or a timeout after an
    // answer changes nothing.
    resumeRun(id: string, state: RunState, from?: "waiting" | "failed"): Promise<boolean>;
    // A waiting run cancelled in one step; false when it was not waiting.
    cancelWaiting(id: string, error: string): Promise<boolean>;
    waitingRuns(): Promise<WorkflowRun[]>;

    addAgentEvent(source: EventSource, event: AgentEventInput): Promise<AgentEvent>;
    // The trace of a task, or of every agent step of a run, in order.
    agentEvents(of: { task: string } | { run: string }): Promise<AgentEvent[]>;
    // Deletes events older than `before` (an ISO time); returns how many.
    purgeAgentEvents(before: string): Promise<number>;
    // Usage of the tasks and runs queued since `since` (an ISO time) that ran an agent, by group.
    costs(group: CostGroup, since: string): Promise<CostRow[]>;

    addNotes(repo: string, texts: string[], source: NoteSource): Promise<Note[]>;
    note(id: string): Promise<Note | undefined>;
    // Newest first; the notes of one step share a timestamp, so insertion order breaks the tie.
    notes(repo: string | null, limit?: number): Promise<Note[]>;
    deleteNote(id: string): Promise<boolean>;

    // Every page of the repository with its sections in order, pages by slug.
    memoryPages(repo: string): Promise<MemoryPage[]>;
    memoryPage(repo: string, slug: string): Promise<MemoryPage | undefined>;
    // Notes of the repository that no section cites, newest first (or oldest), and how many there are.
    unwovenNotes(
        repo: string,
        limit?: number,
        oldestFirst?: boolean,
    ): Promise<{ total: number; notes: Note[] }>;
    // Undefined when the repository already has a page with that slug.
    createMemoryPage(
        repo: string,
        input: MemoryPageInput,
        source: NoteSource,
    ): Promise<MemoryPage | undefined>;
    // The writes below change a record only while it still has `version`; otherwise, and when it
    // does not exist, they return undefined and change nothing.
    updateMemoryPage(
        repo: string,
        input: MemoryPageInput,
        version: number,
        source: NoteSource,
    ): Promise<MemoryPage | undefined>;
    // Appends a section; undefined when the page is missing or already has the heading.
    addMemorySection(
        repo: string,
        slug: string,
        input: MemorySectionInput,
        source: NoteSource,
    ): Promise<MemorySection | undefined>;
    updateMemorySection(
        repo: string,
        slug: string,
        input: MemorySectionInput,
        version: number,
        source: NoteSource,
    ): Promise<MemorySection | undefined>;
}
