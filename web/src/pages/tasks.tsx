import type { CellData, Column } from "@tanstack/react-table";
import {
    ArchiveIcon,
    ArchiveRestoreIcon,
    ArrowUpRightIcon,
    BellIcon,
    BotIcon,
    CornerDownRightIcon,
    GitPullRequestIcon,
    ListChecksIcon,
    MailIcon,
    MailOpenIcon,
    PinIcon,
    PinOffIcon,
    PlusIcon,
    RotateCcwIcon,
    SquareArrowOutUpRightIcon,
    WorkflowIcon,
    XIcon,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { useAuthorName } from "@/components/author";
import { EmptyState } from "@/components/empty-state";
import { FacetedFilter } from "@/components/faceted-filter";
import { ErrorState, Loading, PageHeader } from "@/components/page";
import { TableSkeleton } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import type { DataTableColumnDef, DataTableFeatures } from "@/components/ui/data-table-features";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { freshInput, InputTokens } from "@/components/usage";
import { useMe } from "@/lib/auth";
import { useFormat } from "@/lib/format";
import { NEW_TASK } from "@/lib/nav";
import {
    useArchive,
    useMarkRead,
    usePin,
    usePins,
    useReads,
    useRuns,
    useTasks,
} from "@/lib/queries";
import { FINISHED, needsYou, threadsOf, unreadOf } from "@/lib/reads";
import type { RunStatus, RunSummary, TaskSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUSES: RunStatus[] = ["queued", "running", "waiting", "done", "failed", "cancelled"];
const KINDS = ["regular", "automations", "all"] as const;
type Kind = (typeof KINDS)[number];
const FILTERS = ["status", "workflow", "project", "view"];
const NEEDS_YOU = "needs-you";
const CONFIRM_MS = 4000;
const right = "text-right tabular-nums";

// One list for tasks and workflow runs; a run has no archive, pins or line counts.
type Row = Omit<RunSummary, "name" | "workflow" | "currentNode" | "input"> &
    Pick<
        TaskSummary,
        "title" | "issue" | "thread" | "linesAdded" | "linesDeleted" | "archivedAt"
    > & {
        run: boolean;
        workflow: string | null;
        currentNode: string | null;
        pinned: boolean;
        unread: boolean;
        // The newest step of a task's thread, whose read the row shows.
        last: string;
    };
const fromTask = (task: TaskSummary & { last: string }, pinned: boolean): Row => ({
    ...task,
    run: false,
    workflow: null,
    currentNode: null,
    pinned,
    unread: false,
});
const fromRun = (run: RunSummary): Row => ({
    unread: false,
    ...run,
    last: run.id,
    title: run.name,
    issue: null,
    thread: null,
    linesAdded: null,
    linesDeleted: null,
    archivedAt: null,
    run: true,
    workflow: run.name,
    pinned: false,
});
const hrefOf = (row: Row) => `/tasks/${row.id}`;

const COLUMN_NAMES = [
    "task",
    "status",
    "workflow",
    "branch",
    "lines",
    "ref",
    "cost",
    "duration",
    "project",
    "tokens",
    "author",
    "updated",
] as const;
type ColumnName = (typeof COLUMN_NAMES)[number];

const isFinished = (task: Row) => FINISHED.includes(task.status);
const ofKind = (task: Row, kind: Kind) =>
    kind === "all" || !!task.automation === (kind === "automations");

// A tab's count rides in a kit badge, which the tabs colour for the active one.
const Count = ({ value }: { value: number }) => (
    <Badge variant="secondary" className="tabular-nums">
        {value}
    </Badge>
);

function Origin({ task }: { task: Row }) {
    const t = useTranslations("web");
    if (task.currentNode) return <span>{t("tasks.step", { node: task.currentNode })}</span>;
    if (task.thread)
        return (
            <span className="flex items-center gap-1">
                <CornerDownRightIcon className="size-3" />
                {t("tasks.continuation")}
            </span>
        );
    if (task.retryOf)
        return (
            <span className="flex items-center gap-1">
                <RotateCcwIcon className="size-3" />
                {t("tasks.retry")}
            </span>
        );
    if (task.issue) return <span>{t("tasks.issue", { number: task.issue })}</span>;
    if (task.automation) return <span>{t("tasks.automation")}</span>;
    return null;
}

function Head<TValue extends CellData>({
    column,
    name,
    end,
}: {
    column: Column<DataTableFeatures, Row, TValue>;
    name: ColumnName;
    end?: boolean;
}) {
    const t = useTranslations("web");
    return (
        <DataTableColumnHeader
            column={column}
            title={t(`fields.${name}`)}
            labels={{
                asc: t("table.asc"),
                desc: t("table.desc"),
                clearSort: t("table.clearSort"),
                hide: t("table.hide"),
            }}
            className={end ? "justify-end" : undefined}
        />
    );
}

// flexRender mounts `cell` as a component, so the columns keep one identity and reach live state
// through this context: a new function per render would remount the cells and close a row's menu.
const RowContext = createContext<{
    pin: (row: Row) => void;
    archive: (row: Row) => void;
    read: (row: Row) => void;
}>({ pin: () => {}, archive: () => {}, read: () => {} });

function TitleCell({ row }: { row: Row }) {
    const t = useTranslations("web");
    return (
        <div className="max-w-[36rem] min-w-56">
            <div className="flex items-center gap-2">
                {row.pinned && (
                    <PinIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label={t("nav.pinned")}
                    />
                )}
                {row.unread && <span className="sr-only">{t("tasks.unread")}:</span>}
                <Link
                    to={hrefOf(row)}
                    className={cn(
                        "min-w-0 truncate hover:underline",
                        row.unread ? "font-semibold" : "text-muted-foreground",
                    )}
                    title={row.title}
                >
                    {row.title}
                </Link>
            </div>
            <div className="text-xs text-muted-foreground">
                <Origin task={row} />
            </div>
        </div>
    );
}

function TokensCell({ row }: { row: Row }) {
    const format = useFormat();
    return (
        <div className={right}>
            {row.inputTokens === null && row.outputTokens === null ? (
                "–"
            ) : (
                <>
                    <InputTokens usage={row} /> / {format.count(row.outputTokens)}
                </>
            )}
        </div>
    );
}

function LinesCell({ row }: { row: Row }) {
    if (row.linesAdded === null) return <div className={`${right} text-muted-foreground`}>–</div>;
    return (
        <div className={`${right} font-mono text-xs`}>
            <span className="text-constructive">+{row.linesAdded}</span>{" "}
            <span className="text-destructive">−{row.linesDeleted ?? 0}</span>
        </div>
    );
}

function WorkflowCell({ row }: { row: Row }) {
    const t = useTranslations("web");
    return (
        <span
            className="flex max-w-48 items-center gap-1.5 text-muted-foreground"
            title={row.workflow ?? undefined}
        >
            {row.workflow ? (
                <WorkflowIcon className="size-3.5 shrink-0" />
            ) : (
                <BotIcon className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{row.workflow ?? t("tasks.plainTask")}</span>
        </span>
    );
}

function AuthorCell({ row }: { row: Row }) {
    const author = useAuthorName();
    return <span className="text-muted-foreground">{author(row.author)}</span>;
}

function UpdatedCell({ row }: { row: Row }) {
    const format = useFormat();
    return (
        <div className={`${right} text-muted-foreground`} title={format.dateTime(row.updatedAt)}>
            {format.relative(row.updatedAt)}
        </div>
    );
}

function ActionsCell({ row }: { row: Row }) {
    const t = useTranslations("web");
    const { pin, archive, read } = useContext(RowContext);
    return (
        <DataTableRowActions label={t("tasks.actions", { title: row.title })}>
            <DropdownMenuItem asChild>
                <Link to={hrefOf(row)}>
                    <SquareArrowOutUpRightIcon />
                    {t("tasks.open")}
                </Link>
            </DropdownMenuItem>
            {row.prUrl && (
                <DropdownMenuItem asChild>
                    <a href={row.prUrl} target="_blank" rel="noreferrer">
                        <GitPullRequestIcon />
                        {t("tasks.openPr")}
                    </a>
                </DropdownMenuItem>
            )}
            {!row.run && (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => pin(row)}>
                        {row.pinned ? <PinOffIcon /> : <PinIcon />}
                        {row.pinned ? t("task.unpin") : t("task.pin")}
                    </DropdownMenuItem>
                </>
            )}
            {isFinished(row) && (
                <DropdownMenuItem onSelect={() => read(row)}>
                    {row.unread ? <MailOpenIcon /> : <MailIcon />}
                    {row.unread ? t("tasks.markRead") : t("tasks.markUnread")}
                </DropdownMenuItem>
            )}
            {!row.run && isFinished(row) && (
                <DropdownMenuItem onSelect={() => archive(row)}>
                    {row.archivedAt ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                    {row.archivedAt ? t("task.restore") : t("task.archive")}
                </DropdownMenuItem>
            )}
        </DataTableRowActions>
    );
}

const COLUMNS: DataTableColumnDef<Row>[] = [
    {
        id: "search",
        accessorFn: (r) => `${r.title} ${r.workflow ?? ""} ${r.repo} ${r.id} ${r.branch ?? ""}`,
        enableHiding: false,
    },
    {
        id: "task",
        accessorKey: "title",
        enableHiding: false,
        header: ({ column }) => <Head column={column} name="task" />,
        cell: ({ row }) => <TitleCell row={row.original} />,
    },
    {
        id: "status",
        accessorFn: (r) => STATUSES.indexOf(r.status),
        header: ({ column }) => <Head column={column} name="status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
        id: "workflow",
        accessorFn: (r) => r.workflow ?? "",
        header: ({ column }) => <Head column={column} name="workflow" />,
        cell: ({ row }) => <WorkflowCell row={row.original} />,
    },
    {
        id: "branch",
        accessorFn: (r) => r.branch ?? "",
        header: ({ column }) => <Head column={column} name="branch" />,
        cell: ({ row }) =>
            row.original.branch ? (
                <code className="max-w-48 truncate rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {row.original.branch}
                </code>
            ) : (
                <span className="text-muted-foreground">–</span>
            ),
    },
    {
        id: "lines",
        accessorFn: (r) => (r.linesAdded ?? -1) + (r.linesDeleted ?? 0),
        header: ({ column }) => <Head column={column} name="lines" end />,
        cell: ({ row }) => <LinesCell row={row.original} />,
    },
    {
        id: "ref",
        accessorFn: (r) => r.prUrl ?? (r.issue ? `#${r.issue}` : ""),
        header: ({ column }) => <Head column={column} name="ref" />,
        cell: ({ row }) =>
            row.original.prUrl ? (
                <a href={row.original.prUrl} target="_blank" rel="noreferrer">
                    <Badge variant="info" className="tabular-nums">
                        #{row.original.prUrl.split("/").pop()}
                        <ArrowUpRightIcon />
                    </Badge>
                </a>
            ) : row.original.issue ? (
                <Badge variant="outline" className="tabular-nums">
                    #{row.original.issue}
                </Badge>
            ) : (
                <span className="text-muted-foreground">–</span>
            ),
    },
    {
        id: "cost",
        accessorFn: (r) => r.costUsd ?? -1,
        header: ({ column }) => <Head column={column} name="cost" end />,
        cell: function Cost({ row }) {
            const format = useFormat();
            return <div className={right}>{format.cost(row.original.costUsd)}</div>;
        },
    },
    {
        id: "duration",
        accessorFn: (r) => r.durationMs ?? -1,
        header: ({ column }) => <Head column={column} name="duration" end />,
        cell: function Duration({ row }) {
            const format = useFormat();
            return (
                <div className={`${right} text-muted-foreground`}>
                    {format.duration(row.original.durationMs)}
                </div>
            );
        },
    },
    {
        id: "project",
        accessorKey: "repo",
        header: ({ column }) => <Head column={column} name="project" />,
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.repo}</code>,
    },
    {
        id: "tokens",
        accessorFn: (r) => (freshInput(r) ?? 0) + (r.outputTokens ?? 0),
        header: ({ column }) => <Head column={column} name="tokens" end />,
        cell: ({ row }) => <TokensCell row={row.original} />,
    },
    {
        id: "author",
        accessorFn: (r) => r.author ?? "",
        header: ({ column }) => <Head column={column} name="author" />,
        cell: ({ row }) => <AuthorCell row={row.original} />,
    },
    {
        id: "updated",
        accessorKey: "updatedAt",
        header: ({ column }) => <Head column={column} name="updated" end />,
        cell: ({ row }) => <UpdatedCell row={row.original} />,
    },
    {
        id: "actions",
        enableHiding: false,
        cell: ({ row }) => <ActionsCell row={row.original} />,
    },
];

export function TasksPage() {
    const t = useTranslations("web");
    const me = useMe();
    const [params, setParams] = useSearchParams();
    const project = useParams().id;
    const archived = params.get("archived") === "1";
    const kind = KINDS.find((k) => k === params.get("kind")) ?? "all";
    const sort = params.get("sort") === "created" ? "createdAt" : "updatedAt";
    const statuses = params.getAll("status");
    const workflows = params.getAll("workflow");
    const projects = project ? [] : params.getAll("project");
    const onlyNeedsYou = params.get("view") === NEEDS_YOU;
    const newTask = project ? `${NEW_TASK}?repo=${project}` : NEW_TASK;
    const tasks = useTasks();
    const runs = useRuns();
    const pins = usePins();
    const reads = useReads();
    const markRead = useMarkRead();
    const pin = usePin();
    const archive = useArchive();
    const [confirm, setConfirm] = useState(false);
    const [archiving, setArchiving] = useState(false);

    useEffect(() => {
        if (!confirm) return;
        const timer = setTimeout(() => setConfirm(false), CONFIRM_MS);
        return () => clearTimeout(timer);
    }, [confirm]);

    const actions = useMemo(
        () => ({
            pin: (row: Row) => pin.mutate({ id: row.id, pinned: !row.pinned }),
            archive: (row: Row) => archive.mutate({ id: row.id, archived: !row.archivedAt }),
            read: (row: Row) =>
                markRead.mutate({ kind: row.run ? "run" : "task", id: row.last, read: row.unread }),
        }),
        [pin.mutate, archive.mutate, markRead.mutate],
    );

    const setParam = (name: string, value: string | string[] | null) =>
        setParams(
            (current) => {
                const next = new URLSearchParams(current);
                next.delete(name);
                for (const v of Array.isArray(value) ? value : value ? [value] : [])
                    next.append(name, v);
                return next;
            },
            { replace: true },
        );

    // A project's tasks live at /project/<id>; old ?repo= links land there.
    const legacy = params.get("repo");
    if (legacy) {
        const rest = new URLSearchParams(params);
        rest.delete("repo");
        return (
            <Navigate to={{ pathname: `/project/${legacy}`, search: rest.toString() }} replace />
        );
    }

    const pinned = new Set(pins.data);
    // Until the reads load nothing counts as unread, so the titles do not flash bold.
    const unread = unreadOf(reads.data);
    const inProject = [
        ...threadsOf(tasks.data ?? []).map((task) => fromTask(task, pinned.has(task.id))),
        ...(runs.data ?? []).map(fromRun),
    ]
        .map((row) => ({ ...row, unread: unread({ id: row.last, status: row.status }) }))
        .filter((row) => !project || row.repo === project);
    const archivedCount = inProject.filter((task) => task.archivedAt).length;
    const inView = inProject.filter((task) => !!task.archivedAt === archived);
    const ofKindRows = inView.filter((task) => ofKind(task, kind));
    const rows: Row[] = ofKindRows
        .filter(
            (task) =>
                (!onlyNeedsYou || needsYou(task)) &&
                (!statuses.length || statuses.includes(task.status)) &&
                (!workflows.length || workflows.includes(task.workflow ?? "")) &&
                (!projects.length || projects.includes(task.repo)),
        )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b[sort].localeCompare(a[sort]));

    const count = (values: string[]) => {
        const counts = new Map<string, number>();
        for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
        return counts;
    };
    const facet = (values: string[], selected: string[], label: (v: string) => string) => {
        const counts = count(values);
        return [...new Set([...counts.keys(), ...selected])].map((value) => ({
            value,
            label: label(value),
            count: counts.get(value) ?? 0,
        }));
    };
    const facetLabels = { empty: t("table.noResults"), clear: t("table.clear") };

    // Archiving skips running and pinned tasks, so nothing waiting leaves the view.
    const archivable = rows.filter((row) => !row.run && isFinished(row) && !row.pinned);
    const archiveFinished = async () => {
        if (!confirm) {
            setConfirm(true);
            return;
        }
        setArchiving(true);
        await Promise.allSettled(
            archivable.map((row) => archive.mutateAsync({ id: row.id, archived: true })),
        );
        setArchiving(false);
        setConfirm(false);
    };

    return (
        <RowContext.Provider value={actions}>
            <PageHeader
                title={
                    <span className="flex flex-wrap items-center gap-3">
                        {t("tasks.title")}
                        {/* The Active and Archived lists of one table. */}
                        <Tabs
                            value={archived ? "archived" : "active"}
                            onValueChange={(v) =>
                                setParam("archived", v === "archived" ? "1" : null)
                            }
                        >
                            <TabsList>
                                <TabsTrigger value="active">
                                    {t("tasks.active")}
                                    <Count value={inProject.length - archivedCount} />
                                </TabsTrigger>
                                <TabsTrigger value="archived">
                                    {t("tasks.archived")}
                                    <Count value={archivedCount} />
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    </span>
                }
                actions={
                    <>
                        {!archived && archivable.length > 0 && (
                            <Button
                                variant={confirm ? "destructive" : "ghost"}
                                disabled={archiving}
                                onClick={() => void archiveFinished()}
                            >
                                {archiving ? <Spinner /> : <ArchiveIcon />}
                                {confirm
                                    ? t("tasks.archiveFinishedConfirm", {
                                          count: archivable.length,
                                      })
                                    : t("tasks.archiveFinished")}
                            </Button>
                        )}
                        <Button asChild>
                            <Link to={newTask}>
                                <PlusIcon />
                                {t("nav.newTask")}
                            </Link>
                        </Button>
                    </>
                }
            />
            {tasks.isPending || runs.isPending ? (
                <Loading>
                    <TableSkeleton columns={8} rows={8} />
                </Loading>
            ) : tasks.isError || runs.isError ? (
                <ErrorState
                    error={tasks.error ?? runs.error}
                    onRetry={() => {
                        void tasks.refetch();
                        void runs.refetch();
                    }}
                />
            ) : !inView.length ? (
                archived ? (
                    <EmptyState
                        icon={<ArchiveIcon />}
                        title={t("tasks.archivedEmptyTitle")}
                        description={t("tasks.archivedEmpty")}
                    />
                ) : (
                    <EmptyState
                        icon={<ListChecksIcon />}
                        title={t("tasks.emptyTitle")}
                        description={t("tasks.empty")}
                    >
                        <Button asChild>
                            <Link to={newTask}>
                                <PlusIcon />
                                {t("nav.newTask")}
                            </Link>
                        </Button>
                    </EmptyState>
                )
            ) : (
                <DataTable
                    // The project column shows only on the list of all projects.
                    key={project ?? ""}
                    columns={COLUMNS}
                    data={rows}
                    labels={{
                        empty: t("tasks.emptyFiltered"),
                        search: t("tasks.search"),
                        columns: {
                            columns: t("table.columns"),
                            search: t("table.columnsSearch"),
                            empty: t("table.noResults"),
                            reset: t("table.reset"),
                        },
                        pagination: {
                            rowsPerPage: t("table.rowsPerPage"),
                            page: t("table.page"),
                            of: t("table.of"),
                            firstPage: t("table.firstPage"),
                            previousPage: t("table.previousPage"),
                            nextPage: t("table.nextPage"),
                            lastPage: t("table.lastPage"),
                        },
                    }}
                    searchColumn="search"
                    columnLabels={Object.fromEntries(
                        COLUMN_NAMES.map((name) => [name, t(`fields.${name}`)]),
                    )}
                    getRowId={(row) => `${row.run ? "run" : "task"}:${row.id}`}
                    getRowHref={hrefOf}
                    initialColumnVisibility={{
                        search: false,
                        project: !project,
                        author: !!me,
                    }}
                    initialPageSize={50}
                    pageSizeOptions={[25, 50, 100]}
                    toolbarStart={
                        <>
                            <Tabs
                                value={kind}
                                onValueChange={(v) => setParam("kind", v === "all" ? null : v)}
                            >
                                <TabsList aria-label={t("tasks.kind")}>
                                    {KINDS.map((k) => (
                                        <TabsTrigger key={k} value={k}>
                                            {t(`tasks.${k}`)}
                                            <Count
                                                value={
                                                    inView.filter((task) => ofKind(task, k)).length
                                                }
                                            />
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                            <Toggle
                                variant="outline"
                                size="sm"
                                pressed={onlyNeedsYou}
                                onPressedChange={(on) => setParam("view", on ? NEEDS_YOU : null)}
                            >
                                <BellIcon />
                                {t("dashboard.needsYou")}
                                <Count value={ofKindRows.filter(needsYou).length} />
                            </Toggle>
                            <FacetedFilter
                                title={t("fields.status")}
                                options={facet(
                                    ofKindRows.map((task) => task.status),
                                    statuses,
                                    (s) => t(`status.${s as RunStatus}`),
                                ).sort(
                                    (a, b) =>
                                        STATUSES.indexOf(a.value as RunStatus) -
                                        STATUSES.indexOf(b.value as RunStatus),
                                )}
                                selected={statuses}
                                onSelectedChange={(next) => setParam("status", next)}
                                labels={facetLabels}
                            />
                            <FacetedFilter
                                title={t("fields.workflow")}
                                options={facet(
                                    ofKindRows.map((row) => row.workflow ?? ""),
                                    workflows,
                                    (w) => w || t("tasks.plainTask"),
                                ).sort((a, b) => a.label.localeCompare(b.label))}
                                selected={workflows}
                                onSelectedChange={(next) => setParam("workflow", next)}
                                labels={facetLabels}
                            />
                            {!project && (
                                <FacetedFilter
                                    title={t("fields.project")}
                                    options={facet(
                                        ofKindRows.map((task) => task.repo),
                                        projects,
                                        (p) => p,
                                    ).sort((a, b) => a.value.localeCompare(b.value))}
                                    selected={projects}
                                    onSelectedChange={(next) => setParam("project", next)}
                                    labels={facetLabels}
                                />
                            )}
                            {(onlyNeedsYou ||
                                statuses.length + workflows.length + projects.length > 0) && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        setParams(
                                            (current) => {
                                                const next = new URLSearchParams(current);
                                                for (const name of FILTERS) next.delete(name);
                                                return next;
                                            },
                                            { replace: true },
                                        )
                                    }
                                >
                                    {t("table.resetFilters")}
                                    <XIcon />
                                </Button>
                            )}
                        </>
                    }
                    toolbarEnd={
                        <>
                            <span className="text-xs text-muted-foreground">
                                {t("tasks.sortBy")}
                            </span>
                            <Tabs
                                value={sort === "createdAt" ? "created" : "recent"}
                                onValueChange={(v) => setParam("sort", v === "created" ? v : null)}
                            >
                                <TabsList aria-label={t("tasks.sortBy")}>
                                    <TabsTrigger value="recent">{t("tasks.recent")}</TabsTrigger>
                                    <TabsTrigger value="created">{t("tasks.created")}</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </>
                    }
                />
            )}
        </RowContext.Provider>
    );
}
