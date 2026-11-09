import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslations } from "use-intl";
import { api, repoPath } from "./api";
import { type JobKind, jobKind } from "./job-kind";
import type {
    AgentConfigListing,
    AgentDefaults,
    AgentEvent,
    AgentInfo,
    AgentLogin,
    AgentName,
    Automation,
    BranchCommits,
    BranchFile,
    BranchFiles,
    Changes,
    CommitChanges,
    ConfigContent,
    CostGroup,
    CostReport,
    DetectedUrl,
    FolderList,
    GithubDetail,
    GithubItem,
    GithubOwner,
    IntegrationView,
    Machine,
    MemoryGraph,
    MemoryMap,
    MemoryPage,
    MemorySearch,
    ModelOption,
    Note,
    ProjectCommand,
    Reads,
    Repo,
    RunSummary,
    SecretView,
    SettingsView,
    Skill,
    SkillSource,
    Task,
    TerminalSession,
    Unwoven,
    User,
    Version,
    WebhookView,
    Workflow,
    WorkflowRun,
    WorktreeView,
} from "./types";

export type { JobKind };

export const keys = {
    tasks: ["tasks"] as const,
    pins: ["pins"] as const,
    reads: ["reads"] as const,
    task: (id: string) => ["task", id] as const,
    thread: (id: string) => ["thread", id] as const,
    traces: ["trace"] as const,
    trace: (kind: JobKind, id: string) => ["trace", kind, id] as const,
    changes: (kind: JobKind, id: string) => ["changes", kind, id] as const,
    commits: (src: GitSource) => ["commits", src.path, src.branch ?? ""] as const,
    commit: (src: GitSource, sha: string) => [...keys.commits(src), sha] as const,
    files: (src: GitSource) => ["files", src.path, src.branch ?? ""] as const,
    file: (src: GitSource, path: string) => [...keys.files(src), path] as const,
    repoChanges: (repo: string) => ["changes", "repo", repo] as const,
    templates: ["prompt-templates"] as const,
    instructions: ["instructions"] as const,
    branches: (repo: string) => ["branches", repo] as const,
    variants: (group: string) => ["variants", group] as const,
    subtasks: (task: string) => ["subtasks", task] as const,
    runs: ["runs"] as const,
    run: (id: string) => ["run", id] as const,
    runThread: (id: string) => ["run-thread", id] as const,
    workflows: ["workflows"] as const,
    automations: ["automations"] as const,
    repos: ["repos"] as const,
    repo: (id: string) => ["repo", id] as const,
    integrations: (repo: string) => ["integrations", repo] as const,
    secrets: (repo: string) => ["secrets", repo] as const,
    webhooks: (repo: string) => ["webhooks", repo] as const,
    agentConfig: (repo: string) => ["agent-config", repo] as const,
    agentConfigFile: (repo: string, id: string) => ["agent-config", repo, id] as const,
    worktrees: (repo: string) => ["worktrees", repo] as const,
    github: (repo: string, kind: GithubKind) => ["github", repo, kind] as const,
    githubItem: (repo: string, kind: GithubKind, number: number) =>
        ["github", repo, kind, number] as const,
    skills: ["skills"] as const,
    notes: (repo: string) => ["notes", repo] as const,
    memory: (repo: string) => ["memory", repo] as const,
    memoryPage: (repo: string, slug: string) => ["memory", repo, slug] as const,
    unwoven: (repo: string) => ["memory", repo, "unwoven"] as const,
    // A colon never starts a page's slug, so the key cannot meet a page's.
    memoryGraph: (repo: string) => ["memory", repo, ":graph"] as const,
    memorySearch: (repo: string, query: string) => ["memory", repo, "search", query] as const,
    costs: (by: CostGroup, days: number) => ["costs", by, days] as const,
    users: ["users"] as const,
    folders: (path: string | null, hidden = false) => ["folders", path, hidden] as const,
    owners: ["owners"] as const,
    githubStatus: ["githubStatus"] as const,
    machine: ["machine"] as const,
    agents: ["agents"] as const,
    agentDefaults: ["agent-defaults"] as const,
    models: ["models"] as const,
    version: ["version"] as const,
    openApi: ["openapi"] as const,
    settings: ["settings"] as const,
    mail: ["mail"] as const,
    skillSources: ["skill-sources"] as const,
    terminals: (owner: string) => ["terminals", owner] as const,
    terminalUrls: (owner: string) => ["terminals", owner, "urls"] as const,
    terminalCommands: (owner: string) => ["terminals", owner, "commands"] as const,
};

export interface Trace {
    events: AgentEvent[];
}

export const jobPath = (kind: JobKind, id: string) =>
    kind === "task" ? `/api/tasks/${id}` : `/api/workflow-runs/${id}`;

export const jobKey = (kind: JobKind, id: string) =>
    kind === "task" ? keys.task(id) : keys.run(id);

// Whether /tasks/:id is a task or a run: from what the panel already holds, else asked once.
export function useJobKind(id: string) {
    const client = useQueryClient();
    const has = (kind: JobKind) =>
        client.getQueryData(jobKey(kind, id)) !== undefined ||
        !!client
            .getQueryData<{ id: string }[]>(kind === "task" ? keys.tasks : keys.runs)
            ?.some((job) => job.id === id);
    return useQuery({
        queryKey: ["job-kind", id],
        queryFn: () =>
            jobKind((kind) =>
                client.fetchQuery({
                    queryKey: jobKey(kind, id),
                    queryFn: () => api<Task | WorkflowRun>(jobPath(kind, id)),
                }),
            ),
        initialData: () => (has("task") ? "task" : has("run") ? "run" : undefined),
        staleTime: Number.POSITIVE_INFINITY,
    });
}

export const useTasks = () =>
    useQuery({ queryKey: keys.tasks, queryFn: () => api<Task[]>("/api/tasks") });

// The caller's pinned task ids, in the order they were pinned.
export const usePins = () =>
    useQuery({ queryKey: keys.pins, queryFn: () => api<string[]>("/api/pins") });

export function usePin() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
            api<string[]>(`/api/tasks/${id}/pin`, { method: pinned ? "PUT" : "DELETE" }),
        onSuccess: (pins) => client.setQueryData(keys.pins, pins),
    });
}

// The tasks and runs the caller has read; a finished one missing is unread.
export const useReads = () =>
    useQuery({ queryKey: keys.reads, queryFn: () => api<Reads>("/api/reads") });

export function useMarkRead() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ kind, id, read }: { kind: JobKind; id: string; read: boolean }) =>
            api<Reads>(`${jobPath(kind, id)}/read`, { method: read ? "PUT" : "DELETE" }),
        onSuccess: (reads) => client.setQueryData(keys.reads, reads),
    });
}

// Opening a finished task or run reads it; `skip` once it was marked unread here.
export function useReadOnOpen(kind: JobKind, id: string, status: string | undefined, skip = false) {
    const reads = useReads();
    const { mutate } = useMarkRead();
    const finished = status === "done" || status === "failed" || status === "cancelled";
    const read = reads.data?.[kind === "task" ? "tasks" : "runs"].includes(id);
    useEffect(() => {
        if (finished && read === false && !skip) mutate({ kind, id, read: true });
    }, [finished, read, skip, kind, id, mutate]);
}

// The event stream brings the change too; this keeps the lists right without it.
export function useArchive() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
            api<Task>(`/api/tasks/${id}/archive`, { method: archived ? "PUT" : "DELETE" }),
        onSuccess: (task) => {
            client.setQueryData<Task[]>(keys.tasks, (list) =>
                list?.map((old) => (old.id === task.id ? task : old)),
            );
            client.setQueryData(keys.task(task.id), task);
        },
    });
}

export const useTask = (id: string) =>
    useQuery({ queryKey: keys.task(id), queryFn: () => api<Task>(`/api/tasks/${id}`) });

export const useThread = (id: string) =>
    useQuery({
        queryKey: keys.thread(id),
        queryFn: () => api<Task[]>(`/api/tasks/${id}/thread`),
        enabled: !!id,
    });

export const useTrace = (kind: JobKind, id: string) =>
    useQuery({
        queryKey: keys.trace(kind, id),
        queryFn: () => api<Trace>(`${jobPath(kind, id)}/trace`),
    });

export interface PromptTemplate {
    id: string;
    label: string;
    text: string;
}

// Saved templates, or null while the built-in ones apply.
export const usePromptTemplates = () =>
    useQuery({
        queryKey: keys.templates,
        queryFn: () => api<PromptTemplate[] | null>("/api/prompt-templates"),
    });

export function useSavePromptTemplates() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (templates: PromptTemplate[] | null) =>
            api<PromptTemplate[] | null>("/api/prompt-templates", {
                method: "PUT",
                body: { templates },
            }),
        onSuccess: (templates) => client.setQueryData(keys.templates, templates),
    });
}

export const useInstructions = () =>
    useQuery({
        queryKey: keys.instructions,
        queryFn: () => api<{ instructions: string }>("/api/instructions"),
    });

export function useSaveInstructions() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (instructions: string) =>
            api<{ instructions: string }>("/api/instructions", {
                method: "PUT",
                body: { instructions },
            }),
        onSuccess: (saved) => client.setQueryData(keys.instructions, saved),
    });
}

export const useBranches = (repo: string | null) =>
    useQuery({
        queryKey: keys.branches(repo ?? ""),
        queryFn: () => api<{ base: string; branches: string[] }>(`/api/repos/${repo}/branches`),
        enabled: !!repo,
    });

export function useCreateBranch(repo: string) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (name: string) =>
            api<{ base: string; branches: string[] }>(`/api/repos/${repo}/branches`, {
                method: "POST",
                body: { name },
            }),
        onSuccess: (branches) => client.setQueryData(keys.branches(repo), branches),
    });
}

// A GitHub project's origin fetched into its folder, so its Git page shows what was merged since.
export const useFetchRepo = (repo: string) =>
    useMutation({
        mutationFn: () => api<Repo>(`/api/repos/${repo}/fetch`, { method: "POST" }),
    });

// The project's base: new tasks start from it and their pull requests target it.
export function useSetBaseBranch() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ repo, branch }: { repo: string; branch: string }) =>
            api<Repo>(`/api/repos/${repo}/branch`, { method: "PUT", body: { branch } }),
        onSuccess: (repo) => {
            client.setQueryData(keys.repo(repo.id), repo);
            void client.invalidateQueries({ queryKey: keys.repos });
            void client.invalidateQueries({ queryKey: keys.branches(repo.id) });
        },
    });
}

export const useSubtasks = (task: string, enabled: boolean) =>
    useQuery({
        queryKey: keys.subtasks(task),
        queryFn: () => api<Task[]>(`/api/tasks/${task}/subtasks`),
        enabled,
    });

export interface Variants {
    group: string;
    tasks: Task[];
    errors?: string[];
}

export const useVariants = (group: string) =>
    useQuery({
        queryKey: keys.variants(group),
        queryFn: () => api<Variants>(`/api/task-groups/${group}`),
    });

export function usePickVariant(group: string) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (task: string) =>
            api<Variants>(`/api/task-groups/${group}/pick`, { method: "POST", body: { task } }),
        onSuccess: (variants) => {
            client.setQueryData(keys.variants(group), variants);
            void client.invalidateQueries({ queryKey: keys.tasks });
        },
    });
}

// A branch as a page browses it: a task's own, or any of a project's on its Git page (the base
// when `branch` is left out). Each loads when its tab opens.
export interface GitSource {
    path: string;
    branch?: string;
}

export const taskSource = (id: string): GitSource => ({ path: `/api/tasks/${id}` });

function gitUrl(src: GitSource, rest: string, path?: string) {
    const query = new URLSearchParams();
    if (src.branch) query.set("branch", src.branch);
    if (path !== undefined) query.set("path", path);
    const search = query.toString();
    return `${src.path}/${rest}${search ? `?${search}` : ""}`;
}

export const useCommits = (src: GitSource) =>
    useQuery({
        queryKey: keys.commits(src),
        queryFn: () => api<BranchCommits>(gitUrl(src, "commits")),
    });

export const useCommit = (src: GitSource, sha: string) =>
    useQuery({
        queryKey: keys.commit(src, sha),
        queryFn: () => api<CommitChanges>(gitUrl(src, `commits/${sha}`)),
    });

export const useFiles = (src: GitSource) =>
    useQuery({
        queryKey: keys.files(src),
        queryFn: () => api<BranchFiles>(gitUrl(src, "files")),
    });

export const useFile = (src: GitSource, path: string | null) =>
    useQuery({
        queryKey: keys.file(src, path ?? ""),
        queryFn: () => api<BranchFile>(gitUrl(src, "files", path ?? "")),
        enabled: path !== null,
    });

// The project folder's uncommitted work.
export const useRepoChanges = (repo: string) =>
    useQuery({
        queryKey: keys.repoChanges(repo),
        queryFn: () => api<Changes>(`/api/repos/${repo}/changes`),
    });

export const useChanges = (kind: JobKind, id: string, enabled = true) =>
    useQuery({
        queryKey: keys.changes(kind, id),
        queryFn: () => api<Changes>(`${jobPath(kind, id)}/changes`),
        enabled,
    });

export const useRuns = () =>
    useQuery({ queryKey: keys.runs, queryFn: () => api<RunSummary[]>("/api/workflow-runs") });

export const useRun = (id: string) =>
    useQuery({
        queryKey: keys.run(id),
        queryFn: () => api<WorkflowRun>(`/api/workflow-runs/${id}`),
    });

export const useRunThread = (id: string) =>
    useQuery({
        queryKey: keys.runThread(id),
        queryFn: () => api<WorkflowRun[]>(`/api/workflow-runs/${id}/thread`),
        enabled: !!id,
    });

export const useWorkflows = () =>
    useQuery({ queryKey: keys.workflows, queryFn: () => api<Workflow[]>("/api/workflows") });

// The built-in upkeep is named in the viewer's language; the API keeps an English name.
export const useAutomations = () => {
    const t = useTranslations("web");
    return useQuery({
        queryKey: keys.automations,
        queryFn: () => api<Automation[]>("/api/automations"),
        select: (list) =>
            list.map((a) =>
                a.builtin ? { ...a, name: t(`automations.builtin.${a.builtin}.name`) } : a,
            ),
    });
};

export const useRepos = () =>
    useQuery({ queryKey: keys.repos, queryFn: () => api<Repo[]>("/api/repos") });

export const useRepo = (id: string) =>
    useQuery({ queryKey: keys.repo(id), queryFn: () => api<Repo>(`/api/repos/${repoPath(id)}`) });

export const useIntegrations = (repo: string | null) =>
    useQuery({
        queryKey: keys.integrations(repo ?? ""),
        queryFn: () => api<IntegrationView[]>(`/api/repos/${repoPath(repo ?? "")}/integrations`),
        enabled: Boolean(repo),
    });

export const projectApi = (repo: string, rest: string) => `/api/repos/${repoPath(repo)}/${rest}`;

export const useSecrets = (repo: string, enabled = true) =>
    useQuery({
        queryKey: keys.secrets(repo),
        queryFn: () => api<SecretView[]>(projectApi(repo, "secrets")),
        enabled,
    });

export const useWebhooks = (repo: string, enabled = true) =>
    useQuery({
        queryKey: keys.webhooks(repo),
        queryFn: () => api<WebhookView[]>(projectApi(repo, "webhooks")),
        enabled,
    });

export const useAgentConfig = (repo: string) =>
    useQuery({
        queryKey: keys.agentConfig(repo),
        queryFn: () => api<AgentConfigListing>(projectApi(repo, "agent-config")),
    });

export const useAgentConfigFile = (repo: string, id: string | null) =>
    useQuery({
        queryKey: keys.agentConfigFile(repo, id ?? ""),
        queryFn: () => api<ConfigContent>(projectApi(repo, `agent-config/${id}`)),
        enabled: id !== null,
    });

// Worktrees come and go with the jobs, so the list follows them while it is open.
export const useWorktrees = (repo: string) =>
    useQuery({
        queryKey: keys.worktrees(repo),
        queryFn: () => api<WorktreeView[]>(projectApi(repo, "worktrees")),
        refetchInterval: 10_000,
    });

export type GithubKind = "issues" | "prs";

// Read from GitHub on every visit and kept a minute: each one is a gh call.
export const useGithubItems = (repo: string, kind: GithubKind, enabled = true) =>
    useQuery({
        queryKey: keys.github(repo, kind),
        queryFn: () => api<GithubItem[]>(projectApi(repo, `github/${kind}`)),
        staleTime: 60_000,
        enabled,
    });

export const useGithubItem = (repo: string, kind: GithubKind, number: number | null) =>
    useQuery({
        queryKey: keys.githubItem(repo, kind, number ?? 0),
        queryFn: () => api<GithubDetail>(projectApi(repo, `github/${kind}/${number}`)),
        enabled: number !== null,
    });

// A write to one of a project's settings, answered with the project, or with a list kept under
// `list` (its secrets, webhooks), which replaces the cached one.
export function useRepoWrite(repo: string) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ method, path, body }: { method: string; path: string; body?: object }) =>
            api<unknown>(projectApi(repo, path), { method, body }),
        onSuccess: (answer, { path }) => {
            const section = path.split("/")[0];
            // A secret fills an integration's references, which the secrets list shows in turn.
            if (section === "secrets") {
                client.setQueryData(keys.secrets(repo), answer);
                void client.invalidateQueries({ queryKey: keys.integrations(repo) });
            } else if (section === "webhooks")
                void client.invalidateQueries({ queryKey: keys.webhooks(repo) });
            else if (section === "integrations") {
                void client.invalidateQueries({ queryKey: keys.integrations(repo) });
                void client.invalidateQueries({ queryKey: keys.secrets(repo) });
            } else if (section === "worktrees")
                void client.invalidateQueries({ queryKey: keys.worktrees(repo) });
            else if (section === "agent-config") {
                const file = answer as ConfigContent;
                client.setQueryData(keys.agentConfigFile(repo, file.id), file);
                void client.invalidateQueries({ queryKey: keys.agentConfig(repo), exact: true });
            } else {
                client.setQueryData(keys.repo(repo), answer);
                void client.invalidateQueries({ queryKey: keys.repos });
            }
        },
    });
}

// Sources' skills are listed as last fetched; with a project its own skills come first.
export const useSkills = (repo?: string) =>
    useQuery({
        queryKey: repo ? [...keys.skills, repo] : keys.skills,
        queryFn: () =>
            api<Skill[]>(repo ? `/api/skills?repo=${encodeURIComponent(repo)}` : "/api/skills"),
        staleTime: 5 * 60_000,
    });

// A source that could not be fetched fails the refresh, the others are fetched still.
export function useRefreshSkills() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: () => api("/api/skill-sources/refresh", { method: "POST" }),
        onSettled: () => client.invalidateQueries({ queryKey: keys.skills }),
    });
}

export const useSkillText = (ref: string, repo: string | null) =>
    useQuery({
        queryKey: [...keys.skills, "text", ref, repo],
        queryFn: () =>
            api<{ ref: string; content: string }>(
                `/api/skill?${new URLSearchParams({ ref, ...(repo ? { repo } : {}) })}`,
            ),
        staleTime: 5 * 60_000,
    });

// The API asks the Claude CLI once an hour; the list hardly changes within a session.
export const useModels = () =>
    useQuery({
        queryKey: keys.models,
        queryFn: () => api<ModelOption[]>("/api/models"),
        staleTime: 60 * 60_000,
    });

export const useNotes = (repo: string) =>
    useQuery({
        queryKey: keys.notes(repo),
        queryFn: () => api<Note[]>(`/api/notes?repo=${encodeURIComponent(repo)}`),
    });

export const useMemoryGraph = (repo: string) =>
    useQuery({
        queryKey: keys.memoryGraph(repo),
        queryFn: () => api<MemoryGraph>(`/api/repos/${repoPath(repo)}/memory/graph`),
    });

export const useMemoryMap = (repo: string) =>
    useQuery({
        queryKey: keys.memory(repo),
        queryFn: () => api<MemoryMap>(`/api/repos/${repoPath(repo)}/memory`),
    });

export const useMemoryPage = (repo: string, slug: string | null) =>
    useQuery({
        queryKey: keys.memoryPage(repo, slug ?? ""),
        queryFn: () => api<MemoryPage>(`/api/repos/${repoPath(repo)}/memory/pages/${slug}`),
        enabled: slug !== null,
    });

export const useUnwoven = (repo: string) =>
    useQuery({
        queryKey: keys.unwoven(repo),
        queryFn: () => api<Unwoven>(`/api/repos/${repoPath(repo)}/memory/unwoven`),
    });

export const useMemorySearch = (repo: string, query: string) =>
    useQuery({
        queryKey: keys.memorySearch(repo, query),
        queryFn: () =>
            api<MemorySearch>(
                projectApi(repo, `memory/search?${new URLSearchParams({ q: query })}`),
            ),
        enabled: query !== "",
        placeholderData: keepPreviousData,
    });

// A write to a project's memory or notes. It refreshes them also when refused, so after a version
// conflict the editor shows what changed meanwhile.
export function useMemoryWrite(repo: string) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({
            method = "POST",
            path,
            body,
        }: {
            method?: string;
            path: string;
            body: object;
        }) => api<unknown>(path, { method, body }),
        onSettled: () =>
            Promise.all([
                client.invalidateQueries({ queryKey: keys.memory(repo) }),
                client.invalidateQueries({ queryKey: keys.notes(repo) }),
            ]),
    });
}

export const useCosts = (by: CostGroup, days: number) =>
    useQuery({
        queryKey: keys.costs(by, days),
        queryFn: () => api<CostReport>(`/api/costs?by=${by}&days=${days}`),
    });

// Only an admin may list accounts; others see account ids.
export const useUsers = (enabled: boolean) =>
    useQuery({
        queryKey: keys.users,
        queryFn: () => api<User[]>("/api/users"),
        enabled,
        staleTime: 5 * 60_000,
    });

// The folders of the OLIMP machine, from the browse root down; admin only.
export const useFolders = (path: string | null, hidden = false) =>
    useQuery({
        queryKey: keys.folders(path, hidden),
        queryFn: () => {
            const query = new URLSearchParams({
                ...(path ? { path } : {}),
                ...(hidden ? { hidden: "1" } : {}),
            }).toString();
            return api<FolderList>(`/api/folders${query ? `?${query}` : ""}`);
        },
        staleTime: 0,
    });

export const useGithubOwners = () =>
    useQuery({
        queryKey: keys.owners,
        queryFn: () => api<GithubOwner[]>("/api/github/owners"),
        staleTime: 5 * 60_000,
    });

// It asks GitHub, so only where it is shown.
export const useGithubStatus = (enabled = true) =>
    useQuery({
        queryKey: keys.githubStatus,
        queryFn: () => api<{ loggedIn: boolean; login: string | null }>("/api/github/status"),
        staleTime: 60_000,
        enabled,
    });

// Live: every few seconds while a page shows it; otherwise once.
export const useMachine = (live = true) =>
    useQuery({
        queryKey: keys.machine,
        queryFn: () => api<Machine>("/api/machine"),
        refetchInterval: live ? 3000 : false,
        staleTime: live ? 0 : Number.POSITIVE_INFINITY,
    });

export const useAgents = () =>
    useQuery({ queryKey: keys.agents, queryFn: () => api<AgentInfo[]>("/api/agents") });

// Only agents whose CLI OLIMP found; none until the list arrives.
export function useInstalled(): AgentName[] {
    const agents = useAgents();
    return agents.data?.filter((entry) => entry.bin).map((entry) => entry.agent) ?? [];
}

export function useAgentLogin() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({
            agent,
            name,
            folder,
            remove,
        }: {
            agent: AgentName;
            name: string;
            folder?: string;
            remove?: boolean;
        }) =>
            remove
                ? api(`/api/agents/${agent}/logins/${name}`, { method: "DELETE" })
                : api<AgentLogin>(`/api/agents/${agent}/logins`, {
                      method: "POST",
                      body: { ...(name ? { name } : {}), ...(folder ? { folder } : {}) },
                  }),
        onSuccess: () => client.invalidateQueries({ queryKey: keys.agents }),
    });
}

export const useAgentDefaults = () =>
    useQuery({
        queryKey: keys.agentDefaults,
        queryFn: () => api<AgentDefaults>("/api/agent-defaults"),
    });

export function useSaveAgentDefaults() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (defaults: AgentDefaults) =>
            api<AgentDefaults>("/api/agent-defaults", { method: "PUT", body: defaults }),
        onSuccess: (saved) => client.setQueryData(keys.agentDefaults, saved),
    });
}

export const useOpenApi = () =>
    useQuery({
        queryKey: keys.openApi,
        queryFn: () => api<Record<string, unknown>>("/api/openapi.json"),
        staleTime: Number.POSITIVE_INFINITY,
    });

export const useVersion = () =>
    useQuery({
        queryKey: keys.version,
        queryFn: () => api<Version>("/api/version"),
        staleTime: 5 * 60_000,
    });

export const useSettings = () =>
    useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsView>("/api/settings") });

export function useSaveSettings() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (body: Partial<Record<keyof SettingsView["values"], unknown>>) =>
            api<SettingsView>("/api/settings", { method: "PUT", body }),
        onSuccess: (view) => client.setQueryData(keys.settings, view),
    });
}

export const useSkillSources = () =>
    useQuery({
        queryKey: keys.skillSources,
        queryFn: () => api<SkillSource[]>("/api/skill-sources"),
    });

export interface TerminalState {
    available: boolean;
    reason?: string;
    shells?: string[];
    sessions: TerminalSession[];
    folder: string | null;
    host: string;
    takeOver: string | null;
}

// Polled while the tab is open: what each shell runs shows up in the process table, not in events.
// `owner` is the API path of a task, a workflow run or a project.
export function useTerminals(owner: string) {
    return useQuery({
        queryKey: keys.terminals(owner),
        queryFn: () => api<TerminalState>(`${owner}/terminals`),
        refetchInterval: 3000,
    });
}

export function useTerminalUrls(owner: string) {
    return useQuery({
        queryKey: keys.terminalUrls(owner),
        queryFn: () => api<{ urls: DetectedUrl[] }>(`${owner}/terminals/urls`),
        refetchInterval: 3000,
    });
}

export function useTerminalCommands(owner: string, enabled: boolean) {
    return useQuery({
        queryKey: keys.terminalCommands(owner),
        queryFn: () =>
            api<{ commands: ProjectCommand[]; install: string | null }>(
                `${owner}/terminals/commands`,
            ),
        enabled,
    });
}
