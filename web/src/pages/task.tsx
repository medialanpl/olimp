import {
    ActivityIcon,
    AppWindowIcon,
    ArchiveIcon,
    ArchiveRestoreIcon,
    ChevronDownIcon,
    FileDiffIcon,
    FolderTreeIcon,
    GitCommitHorizontalIcon,
    GitForkIcon,
    MessageSquareIcon,
    NotebookPenIcon,
    PinIcon,
    PinOffIcon,
    SparklesIcon,
    SquareTerminalIcon,
} from "lucide-react";
import { lazy, type ReactNode, Suspense, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslations } from "use-intl";
import { AgentMark, agentLabel } from "@/components/agent-mark";
import { useAuthorName } from "@/components/author";
import { ChangesView } from "@/components/changes-view";
import { Delta } from "@/components/diff";
import {
    Action,
    BranchChip,
    JobActions,
    JobHeader,
    JobPage,
    JobPageError,
    JobTab,
    MetaLink,
    PrChip,
    useJobTab,
    useTerminalShortcut,
} from "@/components/job-page";
import { Markdown } from "@/components/markdown";
import { NotesView } from "@/components/notes-view";
import { Fact } from "@/components/page";
import { RunView } from "@/components/run/run-view";
import { JobPageSkeleton, TerminalSkeleton } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { Composer, isActive, TaskChat } from "@/components/task-chat";
import { TaskGraph, useStepName } from "@/components/task-graph";
import { CommitsView, FilesView } from "@/components/task-repo";
import { TraceView } from "@/components/trace-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InputTokens } from "@/components/usage";
import { handToComposer } from "@/lib/drafts";
import { shortId, useFormat } from "@/lib/format";
import {
    taskSource,
    useArchive,
    useChanges,
    useJobKind,
    usePin,
    usePins,
    useReadOnOpen,
    useRepos,
    useTask,
    useThread,
} from "@/lib/queries";
import type { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS = [
    "chat",
    "changes",
    "commits",
    "files",
    "graph",
    "notes",
    "trace",
    "terminal",
    "preview",
] as const;

// Its own chunk: xterm is loaded only when a terminal is opened.
const TerminalPanel = lazy(() => import("@/components/terminal-panel"));
const PreviewPanel = lazy(() => import("@/components/preview-panel"));

const DOT: Record<TaskStatus, string> = {
    queued: "bg-muted-foreground",
    running: "bg-violet-500",
    done: "bg-constructive",
    failed: "bg-destructive",
    cancelled: "bg-muted-foreground/50",
};

type Summed =
    | "costUsd"
    | "inputTokens"
    | "cacheReadTokens"
    | "cacheWriteTokens"
    | "outputTokens"
    | "durationMs";

const sum = (thread: Task[], key: Summed) =>
    thread.some((task) => task[key] !== null)
        ? thread.reduce((total, task) => total + (task[key] ?? 0), 0)
        : null;

// The thread's first task is what pins and archives it; cancel, retry and read act on its newest step.
function TaskActions({ first, last, onUnread }: { first: Task; last: Task; onUnread: () => void }) {
    const t = useTranslations("web");
    const pins = usePins();
    const pin = usePin();
    const archive = useArchive();
    const pinned = pins.data?.includes(first.id) ?? false;
    return (
        <JobActions kind="task" job={last} onUnread={onUnread} error={archive.error ?? pin.error}>
            <Action
                label={t(pinned ? "task.unpin" : "task.pin")}
                onClick={() => pin.mutate({ id: first.id, pinned: !pinned })}
                disabled={pin.isPending}
            >
                {pinned ? <PinOffIcon /> : <PinIcon />}
            </Action>
            {!isActive(last) && (
                <Action
                    label={t(first.archivedAt ? "task.restore" : "task.archive")}
                    onClick={() => archive.mutate({ id: first.id, archived: !first.archivedAt })}
                    disabled={archive.isPending}
                >
                    {first.archivedAt ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                </Action>
            )}
        </JobActions>
    );
}

function Meta({ task, thread }: { task: Task; thread: Task[] }) {
    const t = useTranslations("web");
    const added = thread.some((step) => step.linesAdded !== null)
        ? thread.reduce((total, step) => total + (step.linesAdded ?? 0), 0)
        : null;
    const deleted = thread.reduce((total, step) => total + (step.linesDeleted ?? 0), 0);
    return (
        <>
            <span className="inline-flex items-center gap-1">
                <AgentMark agent={task.agent} className="size-3.5" />
                {agentLabel(task.agent)}
            </span>
            {task.skill && (
                <span className="inline-flex items-center gap-1">
                    <SparklesIcon className="size-3.5" />
                    {task.skill}
                </span>
            )}
            {task.branch && <BranchChip branch={task.branch} />}
            {added !== null && <Delta added={added} deleted={deleted} />}
            <MetaLink to={`/project/${task.repo}`}>{task.repo}</MetaLink>
            {task.prUrl && <PrChip url={task.prUrl} />}
            {task.retryOf && (
                <MetaLink to={`/tasks/${task.retryOf}`}>
                    {t("task.retryOf", { id: shortId(task.retryOf) })}
                </MetaLink>
            )}
            {task.parent && (
                <MetaLink chip to={`/tasks/${task.parent}`}>
                    {task.thread ? t("task.subtasks.mergeOf") : t("task.subtasks.of")}{" "}
                    <span className="font-mono">{shortId(task.parent)}</span>
                </MetaLink>
            )}
            {task.variantGroup && (
                <MetaLink chip to={`/tasks/compare/${task.variantGroup}`}>
                    {t("task.variant", { variant: task.variant ?? "" })}
                </MetaLink>
            )}
            {task.model && <span className="font-mono">{task.model}</span>}
            {task.archivedAt && (
                <Badge variant="secondary">
                    <ArchiveIcon />
                    {t("task.archived")}
                </Badge>
            )}
        </>
    );
}

// The thread's tasks as steps, as infra's step bar.
function StepBar({ thread, current }: { thread: Task[]; current: Task }) {
    const t = useTranslations("web");
    const format = useFormat();
    const stepName = useStepName();
    const [open, setOpen] = useState(false);
    const first = thread[0] ?? current;
    const at = Math.max(
        0,
        thread.findIndex((step) => step.id === current.id),
    );
    return (
        <div className="rounded-xl border bg-card px-3 py-2">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-3 text-left"
            >
                <span className={cn("size-2 shrink-0 rounded-full", DOT[current.status])} />
                <span className="min-w-0 truncate text-sm font-medium">
                    {stepName(current, first)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {t("task.step", { step: at + 1, count: thread.length })}
                </span>
                <span className="flex min-w-16 flex-1 gap-1">
                    {thread.map((step) => (
                        <span
                            key={step.id}
                            className={cn("h-1 flex-1 rounded-full", DOT[step.status])}
                        />
                    ))}
                </span>
                <ChevronDownIcon
                    className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
                />
            </button>
            {open && (
                <ol className="mt-2 space-y-1 border-t pt-2">
                    {thread.map((step, index) => (
                        <li key={step.id}>
                            <Link
                                to={`/tasks/${step.id}`}
                                className={cn(
                                    "flex items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted/60",
                                    step.id === current.id && "bg-muted",
                                )}
                            >
                                <span className="w-5 text-xs text-muted-foreground tabular-nums">
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                    {stepName(step, first)}
                                    <span className="ml-2 text-muted-foreground">
                                        {step.body.trim().split("\n", 1)[0]}
                                    </span>
                                </span>
                                <StatusBadge status={step.status} />
                                <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">
                                    {format.cost(step.costUsd)}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}

// The handoff: what was asked, how each step went and what the last one answered.
function Handoff({ task, thread }: { task: Task; thread: Task[] }) {
    const t = useTranslations("web");
    const format = useFormat();
    const author = useAuthorName();
    const stepName = useStepName();
    const first = thread[0] ?? task;
    const last = thread.at(-1) ?? task;
    const ids = new Set(thread.map((step) => step.id));
    return (
        <div className="mx-auto max-w-3xl space-y-8">
            <section className="space-y-4">
                <h2 className="text-lg font-semibold">
                    {t("task.handoff.title", { title: first.title })}
                </h2>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
                    <Fact label={t("fields.task")}>
                        <span className="font-mono">{shortId(task.id)}</span>
                    </Fact>
                    <Fact label={t("fields.project")}>{task.repo}</Fact>
                    <Fact label={t("fields.branch")}>
                        <span className="font-mono">{task.branch ?? "–"}</span>
                    </Fact>
                    <Fact label={t("fields.agent")}>{task.agent}</Fact>
                    <Fact label={t("fields.skill")}>{task.skill ?? "–"}</Fact>
                    <Fact label={t("fields.integrations")}>
                        {task.integrations.length ? task.integrations.join(", ") : "–"}
                    </Fact>
                    <Fact label={t("fields.author")}>{author(first.author)}</Fact>
                    <Fact label={t("fields.created")}>{format.dateTime(first.createdAt)}</Fact>
                    <Fact label={t("fields.updated")}>{format.dateTime(last.updatedAt)}</Fact>
                </dl>
            </section>
            <section className="space-y-2">
                <h3 className="font-medium">{t("task.handoff.goal")}</h3>
                <Markdown>{first.body.trim() || first.title}</Markdown>
            </section>
            <section className="space-y-2">
                <h3 className="font-medium">{t("task.handoff.progress")}</h3>
                <ol className="space-y-2">
                    {thread.map((step, index) => (
                        <li key={step.id} className="text-sm">
                            <details className="group">
                                <summary className="flex cursor-pointer list-none items-center gap-2">
                                    <span className={cn("size-2 rounded-full", DOT[step.status])} />
                                    <span className="text-muted-foreground tabular-nums">
                                        {format.dateTime(step.updatedAt)}
                                    </span>
                                    <span>
                                        {t("task.step", { step: index + 1, count: thread.length })}{" "}
                                        · {stepName(step, first)} · {t(`status.${step.status}`)}
                                    </span>
                                </summary>
                                <div className="mt-2 ml-4 space-y-2 border-l pl-4">
                                    <Markdown>{step.body.trim() || step.title}</Markdown>
                                    {step.error && (
                                        <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                                            {step.error}
                                        </p>
                                    )}
                                </div>
                            </details>
                        </li>
                    ))}
                </ol>
            </section>
            <section className="space-y-2">
                <h3 className="font-medium">{t("task.handoff.result")}</h3>
                {last.log.trim() ? (
                    <Markdown>{last.log}</Markdown>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {isActive(last) ? t("task.handoff.pending") : t("task.noAnswer")}
                    </p>
                )}
            </section>
            <section className="space-y-2">
                <h3 className="font-medium">{t("task.notes")}</h3>
                <NotesView repo={task.repo} match={(note) => !!note.task && ids.has(note.task)} />
            </section>
        </div>
    );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{children}</p>
        </div>
    );
}

function TraceTab({
    thread,
    step,
    onStep,
}: {
    thread: Task[];
    step: Task;
    onStep: (id: string) => void;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    return (
        <div className="space-y-4">
            {thread.length > 1 && (
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={step.id}
                    onValueChange={(value) => value && onStep(value)}
                    className="flex-wrap"
                >
                    {thread.map((entry, index) => (
                        <ToggleGroupItem key={entry.id} value={entry.id}>
                            {t("task.step", { step: index + 1, count: thread.length })}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            )}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label={t("fields.duration")}>
                    {isActive(step) ? t("task.chat.working") : format.duration(step.durationMs)}
                </Metric>
                <Metric label={t("fields.turns")}>{format.count(step.turns)}</Metric>
                <Metric label={t("fields.cost")}>{format.cost(step.costUsd)}</Metric>
                <Metric label={t("fields.tokens")}>
                    <InputTokens usage={step} /> / {format.count(step.outputTokens)}
                </Metric>
            </div>
            {step.error && (
                <Alert variant="destructive">
                    <AlertTitle>{t("task.error")}</AlertTitle>
                    <AlertDescription>
                        <p className="whitespace-pre-wrap break-words font-mono text-xs">
                            {step.error}
                        </p>
                    </AlertDescription>
                </Alert>
            )}
            <TraceView kind="task" id={step.id} />
        </div>
    );
}

// One address for tasks and workflow runs; keyed by the id, so a view's state starts over on
// another task of the thread.
export function TaskPage() {
    const { id = "" } = useParams();
    const kind = useJobKind(id);
    if (kind.isPending) return <JobPageSkeleton />;
    if (kind.isError) return <JobPageError error={kind.error} onRetry={() => kind.refetch()} />;
    return kind.data === "run" ? <RunView key={id} id={id} /> : <TaskView key={id} id={id} />;
}

function TaskView({ id }: { id: string }) {
    const t = useTranslations("web");
    const query = useTask(id);
    const [keepUnread, setKeepUnread] = useState(false);
    const thread = useThread(query.data ? (query.data.thread ?? query.data.id) : "");
    // A thread reads as one task: opening it reads its newest step, which the lists show.
    const newest = thread.data?.at(-1) ?? query.data;
    useReadOnOpen("task", newest?.id ?? id, newest?.status, keepUnread);
    const changes = useChanges("task", id, !!query.data);
    const repos = useRepos();
    const [focus, setFocus] = useState<string | null>(null);
    const [traceStep, setTraceStep] = useState<string | null>(null);
    const [tab, setTab] = useJobTab(TABS);
    useTerminalShortcut(tab, setTab);

    if (query.isPending) return <JobPageSkeleton />;
    if (query.isError) return <JobPageError error={query.error} onRetry={() => query.refetch()} />;
    const task = query.data;
    const steps = thread.data?.length ? thread.data : [task];
    const last = steps.at(-1) ?? task;
    const project = repos.data?.find((r) => r.id === task.repo);
    const git = project?.git !== false;
    // A local project keeps the task's commit on its branch; a folder without git has neither.
    const done = project?.git && last.status === "done" && task.branch;
    // A task in the checkout without a branch of its own leaves its changes there uncommitted.
    const uncommitted = done && task.workspace === "checkout";
    const merge = done && !uncommitted && !project.github && !!changes.data?.files.length;
    const traced = steps.find((step) => step.id === (traceStep ?? task.id)) ?? task;

    return (
        <JobPage
            tab={tab}
            onTab={setTab}
            header={
                <>
                    <JobHeader
                        title={task.title}
                        status={last.status}
                        usage={{
                            inputTokens: sum(steps, "inputTokens"),
                            cacheReadTokens: sum(steps, "cacheReadTokens"),
                            cacheWriteTokens: sum(steps, "cacheWriteTokens"),
                            outputTokens: sum(steps, "outputTokens"),
                            costUsd: sum(steps, "costUsd"),
                            durationMs: sum(steps, "durationMs"),
                        }}
                        meta={<Meta task={task} thread={steps} />}
                        actions={
                            <TaskActions
                                first={steps[0] ?? task}
                                last={last}
                                onUnread={() => setKeepUnread(true)}
                            />
                        }
                    />
                    <StepBar thread={steps} current={task.thread ? task : last} />
                </>
            }
            tabs={
                <>
                    <JobTab value="chat">
                        <MessageSquareIcon />
                        {t("task.conversation")}
                    </JobTab>
                    {git && (
                        <>
                            <JobTab value="changes" count={changes.data?.files.length}>
                                <FileDiffIcon />
                                {t("task.changes")}
                            </JobTab>
                            <JobTab value="commits">
                                <GitCommitHorizontalIcon />
                                {t("task.commits.tab")}
                            </JobTab>
                            <JobTab value="files">
                                <FolderTreeIcon />
                                {t("task.files.tab")}
                            </JobTab>
                        </>
                    )}
                    <JobTab value="graph">
                        <GitForkIcon />
                        {t("task.graph.tab")}
                    </JobTab>
                    <JobTab value="notes">
                        <NotebookPenIcon />
                        {t("task.handoff.tab")}
                    </JobTab>
                    <JobTab value="trace">
                        <ActivityIcon />
                        {t("task.trace")}
                    </JobTab>
                    <JobTab value="terminal">
                        <SquareTerminalIcon />
                        {t("terminal.title")}
                    </JobTab>
                    <JobTab value="preview">
                        <AppWindowIcon />
                        {t("preview.title")}
                    </JobTab>
                </>
            }
            footer={tab === "chat" && <Composer last={last} />}
        >
            <TabsContent value="chat">
                <TaskChat
                    thread={steps}
                    merge={merge ? task.branch : null}
                    uncommitted={uncommitted ? task.branch : null}
                    focus={focus}
                    base={git ? (project?.defaultBranch ?? null) : null}
                    onShowChanges={() => setTab("changes")}
                />
            </TabsContent>
            {git && (
                <>
                    <TabsContent value="changes">
                        <ChangesView kind="task" id={task.id} prUrl={task.prUrl} />
                    </TabsContent>
                    <TabsContent value="commits">
                        <CommitsView
                            source={taskSource(task.id)}
                            github={project?.github ?? null}
                        />
                    </TabsContent>
                    <TabsContent value="files">
                        <FilesView source={taskSource(task.id)} changed={changes.data?.files} />
                    </TabsContent>
                </>
            )}
            <TabsContent value="graph">
                <TaskGraph
                    thread={steps}
                    onShowStep={(step) => {
                        setFocus(step);
                        setTab("chat");
                    }}
                    onShowTrace={(step) => {
                        setTraceStep(step);
                        setTab("trace");
                    }}
                />
            </TabsContent>
            <TabsContent value="notes">
                <Handoff task={task} thread={steps} />
            </TabsContent>
            <TabsContent value="trace">
                <TraceTab thread={steps} step={traced} onStep={setTraceStep} />
            </TabsContent>
            <TabsContent value="terminal">
                <Suspense fallback={<TerminalSkeleton />}>
                    <TerminalPanel owner={`/api/tasks/${task.id}`} repo={task.repo} />
                </Suspense>
            </TabsContent>
            <TabsContent value="preview">
                <Suspense fallback={<TerminalSkeleton />}>
                    <PreviewPanel
                        owner={`/api/tasks/${task.id}`}
                        sendLabel={t("preview.toTask")}
                        onSend={(text) => {
                            handToComposer(task.thread ?? task.id, text);
                            setTab("chat");
                        }}
                    />
                </Suspense>
            </TabsContent>
        </JobPage>
    );
}
