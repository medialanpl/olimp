import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    AlertCircleIcon,
    ArrowDownIcon,
    ArrowUpRightIcon,
    BotIcon,
    CheckCircle2Icon,
    ChevronRightIcon,
    ClockIcon,
    FileIcon,
    FilePenIcon,
    FileTextIcon,
    FolderIcon,
    GitBranchIcon,
    GitMergeIcon,
    GlobeIcon,
    ListChecksIcon,
    type LucideIcon,
    PlugIcon,
    SearchIcon,
    SparklesIcon,
    SplitIcon,
    SquareIcon,
    TerminalIcon,
    WrenchIcon,
    XCircleIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { AgentAvatar, AgentMark, agentLabel } from "@/components/agent-mark";
import { useAuthorName } from "@/components/author";
import { CopyButton } from "@/components/copy-button";
import { Delta, EditDiff } from "@/components/diff";
import { Markdown } from "@/components/markdown";
import { FormError } from "@/components/page";
import { PromptBox } from "@/components/prompt-box";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { useAttachments } from "@/lib/attachments";
import { useComposerInbox } from "@/lib/drafts";
import { useFormat } from "@/lib/format";
import { keys, useSubtasks, useTrace } from "@/lib/queries";
import type { AgentEvent, Task } from "@/lib/types";
import { cn } from "@/lib/utils";

export const isActive = (task: Task) => task.status === "queued" || task.status === "running";
export const prNumber = (url: string | null) => url?.match(/\/pull\/(\d+)/)?.[1] ?? null;
export const stepAnchor = (id: string) => `step-${id}`;

const CLAMP = 600;
const VISIBLE_TOOLS = 3;

export function UserTurn({
    text,
    author: authorId,
    createdAt,
    children,
}: {
    text: string;
    author: string | null;
    createdAt: string;
    children?: ReactNode;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const author = useAuthorName();
    const [whole, setWhole] = useState(false);
    const long = text.length > CLAMP;
    return (
        <div className="flex flex-col items-end gap-1.5 pl-10">
            <div className="max-w-full rounded-2xl rounded-tr-md bg-muted px-4 py-3">
                <div className={cn("relative", long && !whole && "max-h-48 overflow-hidden")}>
                    <Markdown>{text}</Markdown>
                    {long && !whole && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-muted to-transparent" />
                    )}
                </div>
                <p className="mt-1.5 text-right text-xs text-muted-foreground">
                    {author(authorId)} · {format.dateTime(createdAt)}
                </p>
            </div>
            {long && (
                <button
                    type="button"
                    onClick={() => setWhole(!whole)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                    {whole ? t("task.chat.collapse") : t("task.chat.showAll")}
                </button>
            )}
            {children}
        </div>
    );
}

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

// The files sent with the request: images as thumbnails, anything else to download.
function Attached({ task }: { task: Task }) {
    if (!task.attachments.length) return null;
    const href = (name: string) => `/api/tasks/${task.id}/attachments/${encodeURIComponent(name)}`;
    return (
        <ul className="flex flex-wrap justify-end gap-2">
            {task.attachments.map((name) => (
                <li key={name}>
                    <a
                        href={href(name)}
                        target="_blank"
                        rel="noreferrer"
                        title={name}
                        className="block overflow-hidden rounded-xl border bg-card transition-colors hover:border-ring"
                    >
                        {IMAGE.test(name) ? (
                            <img
                                src={href(name)}
                                alt={name}
                                loading="lazy"
                                className="size-24 object-cover"
                            />
                        ) : (
                            <span className="flex h-10 max-w-52 items-center gap-2 px-3 text-xs">
                                <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                                <span className="truncate">{name}</span>
                            </span>
                        )}
                    </a>
                </li>
            ))}
        </ul>
    );
}

// A tool event's summary is "Tool: input"; the tool name is shown apart.
function toolParts(summary: string): [string, string] {
    const at = summary.indexOf(": ");
    return at > 0 && at < 60 ? [summary.slice(0, at), summary.slice(at + 2)] : [summary, ""];
}

// Paths inside the task's worktree read from the repository root.
const shortPaths = (input: string) => input.replace(/\/\S*?\/worktrees\/[^/\s]+\//g, "");

function toolIcon(tool: string): LucideIcon {
    const name = tool.toLowerCase();
    if (name === "bash" || name === "shell") return TerminalIcon;
    if (name === "read" || name === "ls") return FileTextIcon;
    if (["edit", "write", "multiedit", "notebookedit"].includes(name)) return FilePenIcon;
    if (name === "grep" || name === "glob") return SearchIcon;
    if (name.startsWith("web")) return GlobeIcon;
    if (name === "task" || name === "agent") return BotIcon;
    if (name === "todowrite") return ListChecksIcon;
    if (name.startsWith("mcp__") || name.includes(".")) return PlugIcon;
    return WrenchIcon;
}

function ToolCall({ event }: { event: AgentEvent }) {
    const format = useFormat();
    const [open, setOpen] = useState(false);
    const [tool, raw] = toolParts(event.summary);
    const input = shortPaths(raw);
    const Icon = toolIcon(tool);
    return (
        <li>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                disabled={!input && !event.detail}
                className="group flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:hover:bg-transparent"
            >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-xs font-medium">{tool}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {input}
                </span>
                <time
                    className="shrink-0 text-xs text-muted-foreground/70 tabular-nums"
                    dateTime={event.createdAt}
                >
                    {format.time(event.createdAt)}
                </time>
                {(input || event.detail) && (
                    <ChevronRightIcon
                        className={cn(
                            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
                            open && "rotate-90",
                        )}
                    />
                )}
            </button>
            {/* An edit's detail is its - and + lines, any other tool's its whole input. */}
            {open &&
                (event.detail && ["Edit", "MultiEdit", "Write"].includes(tool) ? (
                    <div className="mx-3 mb-2">
                        <EditDiff detail={event.detail} />
                    </div>
                ) : (
                    <pre className="mx-3 mb-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs scroll-fade">
                        {event.detail ? shortPaths(event.detail) : input}
                    </pre>
                ))}
        </li>
    );
}

// The agent's tool calls in one card, the latest few in view, as in infra.
export function Activity({ events, error }: { events: AgentEvent[]; error: string | null }) {
    const t = useTranslations("web");
    const [all, setAll] = useState(false);
    const tools = events.filter((event) => event.type === "tool");
    // The step's own error is shown once, below.
    const errors = events.filter((event) => event.type === "error" && !error);
    const hidden = all ? 0 : Math.max(0, tools.length - VISIBLE_TOOLS);
    if (!tools.length && !errors.length) return null;
    return (
        <div className="space-y-2">
            {tools.length > 0 && (
                <div className="overflow-hidden rounded-xl border bg-card">
                    {hidden > 0 && (
                        <button
                            type="button"
                            onClick={() => setAll(true)}
                            className="flex w-full items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                            <WrenchIcon className="size-3.5" />
                            {t("task.chat.earlierTools", { count: hidden })}
                            <ChevronRightIcon className="ml-auto size-3.5" />
                        </button>
                    )}
                    <ol className="divide-y">
                        {tools.slice(hidden).map((event) => (
                            <ToolCall key={event.seq} event={event} />
                        ))}
                    </ol>
                </div>
            )}
            {errors.map((event) => (
                <p key={event.seq} className="flex items-start gap-2 text-xs text-destructive">
                    <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span className="whitespace-pre-wrap break-words">{event.summary}</span>
                </p>
            ))}
        </div>
    );
}

// How the step was set up, before the agent's first call.
function Setup({ task, base }: { task: Task; base: string | null }) {
    const t = useTranslations("web");
    const agent = task.model ? `${agentLabel(task.agent)} (${task.model})` : agentLabel(task.agent);
    const lines = [t("task.chat.setup.started", { agent })];
    if (base !== null) {
        lines.push(t(`task.chat.setup.${task.workspace}`));
        if (task.branch)
            lines.push(
                task.workspace === "checkout"
                    ? t("task.chat.branch", { branch: task.branch })
                    : t(
                          `task.chat.setup.${task.workspace === "worktree" ? "worktreeReady" : "branchCreated"}`,
                          {
                              branch: task.branch,
                              base,
                          },
                      ),
            );
    }
    return (
        <div className="space-y-0.5 text-xs text-muted-foreground">
            {lines.map((line) => (
                <p key={line}>· {line}</p>
            ))}
        </div>
    );
}

const END = {
    done: { Icon: CheckCircle2Icon, tone: "text-constructive" },
    failed: { Icon: XCircleIcon, tone: "text-destructive" },
    cancelled: { Icon: SquareIcon, tone: "text-muted-foreground" },
} as const;

function Footer({ task, onShowChanges }: { task: Task; onShowChanges: () => void }) {
    const t = useTranslations("web");
    const format = useFormat();
    const pr = prNumber(task.prUrl);
    const end = END[task.status as keyof typeof END];
    if (!end) return null;
    const pill =
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors";
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("inline-flex items-center gap-1 pr-1 font-medium", end.tone)}>
                <end.Icon className="size-3.5" />
                {t(`task.chat.end.${task.status}`)}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
                <ClockIcon className="size-3.5" />
                {format.duration(task.durationMs)}
            </span>
            <span>·</span>
            <span className="tabular-nums">{t("task.chat.turns", { count: task.turns ?? 0 })}</span>
            <span>·</span>
            <span className="tabular-nums">{format.cost(task.costUsd)}</span>
            {task.linesAdded !== null && (
                <button
                    type="button"
                    onClick={onShowChanges}
                    className={cn(pill, "ml-1 hover:bg-muted")}
                >
                    <Delta added={task.linesAdded} deleted={task.linesDeleted} />
                </button>
            )}
            {task.prUrl && (
                <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={cn(pill, "text-foreground hover:bg-muted")}
                >
                    {pr ? t("task.chat.pr", { number: pr }) : t("fields.pr")}
                    <ArrowUpRightIcon className="size-3" />
                </a>
            )}
        </div>
    );
}

function AgentTurn({ task, onShowChanges }: { task: Task; onShowChanges: () => void }) {
    const t = useTranslations("web");
    const active = isActive(task);
    const trace = useTrace("task", task.id);
    return (
        <div className="flex gap-3">
            <AgentAvatar agent={task.agent} />
            <div className="min-w-0 flex-1 space-y-3 pt-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="text-sm font-semibold text-foreground">
                        {agentLabel(task.agent)}
                    </span>
                    {task.skill && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                            <SparklesIcon className="size-3" />
                            {task.skill}
                        </span>
                    )}
                </p>
                <Activity events={trace.data?.events ?? []} error={task.error} />
                {active && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="text-brand" />
                        <span className="animate-pulse motion-reduce:animate-none">
                            {task.status === "queued"
                                ? t("task.chat.queued")
                                : t("task.chat.working")}
                        </span>
                    </p>
                )}
                {task.error && (
                    <Alert variant={task.status === "cancelled" ? "default" : "destructive"}>
                        <AlertCircleIcon />
                        <AlertTitle>
                            {t(task.status === "cancelled" ? "status.cancelled" : "task.error")}
                        </AlertTitle>
                        <AlertDescription>
                            <p className="whitespace-pre-wrap break-words font-mono text-xs">
                                {task.error}
                            </p>
                        </AlertDescription>
                    </Alert>
                )}
                {task.log.trim() ? (
                    <Markdown>{task.log}</Markdown>
                ) : (
                    !active &&
                    !task.error && (
                        <p className="text-sm text-muted-foreground">{t("task.noAnswer")}</p>
                    )
                )}
                <Footer task={task} onShowChanges={onShowChanges} />
                {task.dispatch && <Subtasks task={task} />}
            </div>
        </div>
    );
}

// The subtasks the agent split this task into, live, and the step that merges them.
function Subtasks({ task }: { task: Task }) {
    const t = useTranslations("web");
    const subtasks = useSubtasks(task.id, true);
    const list = subtasks.data ?? [];
    return (
        <div className="overflow-hidden rounded-xl border bg-card">
            <p className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
                <SplitIcon className="size-3.5 text-brand" />
                {t("task.subtasks.title", { count: list.length })}
                <span className="font-normal text-muted-foreground">
                    {t("task.subtasks.limits", {
                        max: task.dispatch?.maxSubtasks ?? 0,
                        inFlight: task.dispatch?.inFlight ?? 0,
                    })}
                </span>
            </p>
            {list.length ? (
                <ol className="divide-y">
                    {list.map((sub) => (
                        <li key={sub.id}>
                            <Link
                                to={`/tasks/${sub.id}`}
                                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60"
                            >
                                <span className="min-w-0 flex-1 truncate">{sub.title}</span>
                                <StatusBadge status={sub.status} />
                            </Link>
                        </li>
                    ))}
                </ol>
            ) : (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                    {isActive(task) ? t("task.subtasks.waiting") : t("task.subtasks.none")}
                </p>
            )}
            {task.dispatchMerge && (
                <Link
                    to={`/tasks/${task.dispatchMerge}`}
                    className="flex items-center gap-2 border-t px-3 py-2 text-xs font-medium hover:bg-muted/60"
                >
                    <GitMergeIcon className="size-3.5" />
                    {t("task.subtasks.merge")}
                    <ArrowUpRightIcon className="ml-auto size-3.5" />
                </Link>
            )}
        </div>
    );
}

// The whole thread as one conversation: each task's request, then the agent's work and answer.
export function TaskChat({
    thread,
    merge,
    uncommitted,
    focus,
    base,
    onShowChanges,
}: {
    thread: Task[];
    // A local project's branch to merge by hand: it has no pull request.
    merge: string | null;
    // The checked-out branch a task left its changes on, uncommitted.
    uncommitted: string | null;
    focus: string | null;
    // The project's default branch; null for a folder without git.
    base: string | null;
    onShowChanges: () => void;
}) {
    const t = useTranslations("web");
    const end = useRef<HTMLDivElement>(null);
    const [atEnd, setAtEnd] = useState(true);
    const last = thread.at(-1);
    // Open at the start of the step asked for, or of the latest one.
    const target = focus ?? last?.id;
    useEffect(() => {
        if (target) document.getElementById(stepAnchor(target))?.scrollIntoView({ block: "start" });
    }, [target]);
    useEffect(() => {
        const node = end.current;
        if (!node) return;
        const observer = new IntersectionObserver(([entry]) => setAtEnd(!!entry?.isIntersecting));
        observer.observe(node);
        return () => observer.disconnect();
    }, []);
    return (
        <div>
            <div className="mb-8 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("task.chat.start")}
                <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-10">
                {thread.map((step, index) => (
                    <section
                        key={step.id}
                        id={stepAnchor(step.id)}
                        className="scroll-mt-4 space-y-6"
                    >
                        <UserTurn
                            text={step.body.trim() || step.title}
                            author={step.author}
                            createdAt={step.createdAt}
                        >
                            <Attached task={step} />
                        </UserTurn>
                        {index === 0 && <Setup task={step} base={base} />}
                        <AgentTurn task={step} onShowChanges={onShowChanges} />
                    </section>
                ))}
            </div>
            {merge && (
                <div className="mt-6 ml-11 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
                    <GitMergeIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium">{t("task.localBranchTitle")}</p>
                        <p className="text-xs text-muted-foreground">
                            {t("task.localBranch", { branch: merge })}
                        </p>
                    </div>
                    <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
                        git merge {merge}
                    </code>
                    <CopyButton value={`git merge ${merge}`} label={t("task.files.copy")} />
                </div>
            )}
            {uncommitted && (
                <div className="mt-6 ml-11 flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-sm font-medium">{t("task.uncommittedTitle")}</p>
                        <p className="text-xs text-muted-foreground">
                            {t("task.uncommitted", { branch: uncommitted })}
                        </p>
                    </div>
                </div>
            )}
            <div ref={end} className="h-px" />
            {!atEnd && (
                <div className="pointer-events-none sticky bottom-2 flex justify-center">
                    <button
                        type="button"
                        onClick={() => end.current?.scrollIntoView({ behavior: "smooth" })}
                        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur transition-colors hover:bg-muted"
                    >
                        <ArrowDownIcon className="size-3.5" />
                        {t("task.chat.latest")}
                    </button>
                </div>
            )}
        </div>
    );
}

// A reply continues the thread on its branch, with the same agent.
export function Composer({ last }: { last: Task }) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const client = useQueryClient();
    const [body, setBody] = useState("");
    useComposerInbox(last.thread ?? last.id, (text) =>
        setBody((current) => (current.trim() ? `${current}\n\n${text}` : text)),
    );
    const attachments = useAttachments();
    const busy = isActive(last);
    const send = useMutation({
        mutationFn: (text: string) =>
            api<Task>(`/api/tasks/${last.id}/continue`, {
                method: "POST",
                body: { body: text.trim(), attachments: attachments.ids },
            }),
        onSuccess: (created) => {
            setBody("");
            attachments.clear();
            void client.invalidateQueries({ queryKey: keys.thread(last.thread ?? last.id) });
            navigate(`/tasks/${created.id}`);
        },
    });
    const context =
        "inline-flex h-7 items-center gap-1.5 rounded-full bg-muted/60 px-2.5 text-xs text-muted-foreground [&_svg]:size-3.5";
    return (
        <div className="shrink-0 px-4 pt-2 pb-4 md:px-6">
            <div className="space-y-2">
                <PromptBox
                    value={body}
                    onChange={setBody}
                    onSubmit={(text) => send.mutate(text)}
                    attachments={attachments}
                    label={t("task.chat.reply")}
                    placeholder={busy ? t("task.chat.busy") : t("task.chat.replyHint")}
                    disabled={busy}
                    pending={send.isPending}
                    canSend={!!body.trim() || attachments.ids.length > 0}
                    toolbar={
                        <>
                            <span className={context}>
                                <AgentMark agent={last.agent} />
                                {agentLabel(last.agent)}
                            </span>
                            {last.branch && (
                                <span className={cn(context, "font-mono")}>
                                    <GitBranchIcon />
                                    <span className="max-w-48 truncate">{last.branch}</span>
                                </span>
                            )}
                        </>
                    }
                />
                <FormError error={send.error} />
            </div>
        </div>
    );
}
