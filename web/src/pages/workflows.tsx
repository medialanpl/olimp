import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CellData, Column } from "@tanstack/react-table";
import {
    ChevronDownIcon,
    CopyIcon,
    DownloadIcon,
    FileUpIcon,
    LayoutTemplateIcon,
    PencilIcon,
    PlayIcon,
    PlusIcon,
    Trash2Icon,
    WorkflowIcon,
} from "lucide-react";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { NODE_ICON, toneOf, useNodeTitle } from "@/components/flow/graph";
import { ErrorState, FormError, Loading, PageHeader } from "@/components/page";
import { TableSkeleton } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { ColumnHead, useTableLabels } from "@/components/table-labels";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import type { DataTableColumnDef, DataTableFeatures } from "@/components/ui/data-table-features";
import { DataTableRowActions } from "@/components/ui/data-table-row-actions";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { download, executable, fromText, TEMPLATES, toYaml } from "@/lib/flow";
import { useFormat } from "@/lib/format";
import { keys, useRepos, useRuns, useWorkflows } from "@/lib/queries";
import type { NodeType, RunSummary, Workflow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RunDialog } from "@/pages/workflow";

const SHOWN_TYPES = 8;

function NodeStrip({ workflow }: { workflow: Workflow }) {
    const nodeTitle = useNodeTitle();
    const steps = workflow.definition.nodes.filter(executable);
    const types = [...new Set(steps.map((n) => n.type))] as NodeType[];
    return (
        <ul className="flex flex-wrap items-center gap-1.5">
            {types.slice(0, SHOWN_TYPES).map((type) => {
                const Icon = NODE_ICON[type];
                const count = steps.filter((n) => n.type === type).length;
                return (
                    <li key={type}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span
                                    className={cn(
                                        "inline-flex h-7 items-center gap-1 rounded-lg px-1.5 text-xs [&_svg]:size-3.5",
                                        toneOf(type).tile,
                                    )}
                                >
                                    <Icon />
                                    {count > 1 ? (
                                        <span className="tabular-nums">{count}</span>
                                    ) : null}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>{nodeTitle(type)}</TooltipContent>
                        </Tooltip>
                    </li>
                );
            })}
            {types.length > SHOWN_TYPES ? (
                <li className="text-xs text-muted-foreground">+{types.length - SHOWN_TYPES}</li>
            ) : null}
        </ul>
    );
}

type Row = Workflow & { steps: number; lastRun: RunSummary | undefined };

const COLUMN_NAMES = ["workflow", "steps", "project", "lastRun", "updated"] as const;
const hrefOf = (row: Row) => `/workflows/${row.id}`;

// The dialogs live on the page, so a click inside one never reaches the row under it.
const RowContext = createContext<{ run: (row: Row) => void; remove: (row: Row) => void }>({
    run: () => {},
    remove: () => {},
});

function NameCell({ row }: { row: Row }) {
    return (
        <div className="max-w-[32rem] min-w-48">
            <Link
                to={hrefOf(row)}
                className="block truncate font-medium hover:underline"
                title={row.name}
            >
                {row.name}
            </Link>
            {row.description && (
                <p className="truncate text-xs text-muted-foreground" title={row.description}>
                    {row.description}
                </p>
            )}
        </div>
    );
}

function LastRunCell({ row }: { row: Row }) {
    const t = useTranslations("web");
    const format = useFormat();
    if (!row.lastRun)
        return <span className="text-xs text-muted-foreground">{t("workflows.neverRun")}</span>;
    return (
        <Link
            to={`/tasks/${row.lastRun.id}`}
            className="inline-flex items-center gap-2 hover:underline"
        >
            <StatusBadge status={row.lastRun.status} />
            <span className="text-xs text-muted-foreground">
                {format.relative(row.lastRun.createdAt)}
            </span>
        </Link>
    );
}

function UpdatedCell({ row }: { row: Row }) {
    const format = useFormat();
    return (
        <div
            className="text-right text-muted-foreground tabular-nums"
            title={format.dateTime(row.updatedAt)}
        >
            {format.relative(row.updatedAt)}
        </div>
    );
}

function ActionsCell({ row }: { row: Row }) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const { run, remove } = useContext(RowContext);
    return (
        <DataTableRowActions label={t("workflows.actions", { name: row.name })}>
            <DropdownMenuItem onSelect={() => run(row)}>
                <PlayIcon />
                {t("workflows.run")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate(hrefOf(row))}>
                <PencilIcon />
                {t("workflows.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
                onSelect={() =>
                    navigate("/workflows/new", {
                        state: {
                            draft: {
                                name: t("workflows.copyName", { name: row.name }),
                                description: row.description,
                                repo: row.repo,
                                definition: row.definition,
                            },
                        },
                    })
                }
            >
                <CopyIcon />
                {t("workflows.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => download(row.name, toYaml(row))}>
                <DownloadIcon />
                {t("workflows.export")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => remove(row)}>
                <Trash2Icon />
                {t("workflows.delete")}
            </DropdownMenuItem>
        </DataTableRowActions>
    );
}

function Head<TValue extends CellData>({
    column,
    name,
    end,
}: {
    column: Column<DataTableFeatures, Row, TValue>;
    name: (typeof COLUMN_NAMES)[number];
    end?: boolean;
}) {
    const t = useTranslations("web");
    return <ColumnHead column={column} title={t(`fields.${name}`)} end={end} />;
}

const COLUMNS: DataTableColumnDef<Row>[] = [
    {
        id: "search",
        accessorFn: (r) => `${r.name} ${r.description} ${r.repo} ${r.id}`,
        enableHiding: false,
    },
    {
        id: "workflow",
        accessorKey: "name",
        enableHiding: false,
        header: ({ column }) => <Head column={column} name="workflow" />,
        cell: ({ row }) => <NameCell row={row.original} />,
    },
    {
        id: "steps",
        accessorKey: "steps",
        header: ({ column }) => <Head column={column} name="steps" />,
        cell: ({ row }) => <NodeStrip workflow={row.original} />,
    },
    {
        id: "project",
        accessorKey: "repo",
        header: ({ column }) => <Head column={column} name="project" />,
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.repo}</code>,
    },
    {
        id: "lastRun",
        accessorFn: (r) => r.lastRun?.createdAt ?? "",
        header: ({ column }) => <Head column={column} name="lastRun" />,
        cell: ({ row }) => <LastRunCell row={row.original} />,
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

function DeleteDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
    const t = useTranslations("web");
    const client = useQueryClient();
    const remove = useMutation({
        mutationFn: (id: string) => api(`/api/workflows/${id}`, { method: "DELETE" }),
        onSuccess: () => {
            onClose();
            void client.invalidateQueries({ queryKey: keys.workflows });
        },
    });
    return (
        <Dialog
            open={row !== null}
            onOpenChange={(open) => {
                if (open) return;
                remove.reset();
                onClose();
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {t("workflows.deleteTitle", { name: row?.name ?? "" })}
                    </DialogTitle>
                    <DialogDescription>{t("workflows.deleteDescription")}</DialogDescription>
                </DialogHeader>
                <DialogBody>
                    <FormError error={remove.error} />
                </DialogBody>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        variant="destructive"
                        disabled={remove.isPending || !row}
                        onClick={() => row && remove.mutate(row.id)}
                    >
                        <Trash2Icon />
                        {t("workflows.delete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function NewMenu({ repo }: { repo: string }) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const file = useRef<HTMLInputElement>(null);
    const [error, setError] = useState<string | null>(null);
    const query = repo ? `repo=${encodeURIComponent(repo)}` : "";
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button>
                        <PlusIcon />
                        {t("workflows.new")}
                        <ChevronDownIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuItem onSelect={() => navigate(`/workflows/new?${query}`)}>
                        <WorkflowIcon />
                        {t("workflows.blank")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => file.current?.click()}>
                        <FileUpIcon />
                        {t("workflows.importFile")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {t("workflows.templates")}
                    </DropdownMenuLabel>
                    {TEMPLATES.map((template) => (
                        <DropdownMenuItem
                            key={template.id}
                            onSelect={() =>
                                navigate(`/workflows/new?template=${template.id}&${query}`)
                            }
                            className="items-start"
                        >
                            <LayoutTemplateIcon className="mt-0.5" />
                            <span className="min-w-0">
                                <span className="block">
                                    {t(`workflows.template.${template.id as "quick-task"}.name`)}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {t(
                                        `workflows.template.${template.id as "quick-task"}.description`,
                                    )}
                                </span>
                            </span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <input
                ref={file}
                type="file"
                accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    e.target.value = "";
                    if (!chosen) return;
                    void chosen.text().then((text) => {
                        try {
                            const imported = fromText(text);
                            navigate("/workflows/new", {
                                state: { draft: { ...imported, repo } },
                            });
                        } catch (err) {
                            setError(
                                t("workflows.importFailed", { error: (err as Error).message }),
                            );
                        }
                    });
                }}
            />
            <Dialog open={error !== null} onOpenChange={() => setError(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("workflows.importFile")}</DialogTitle>
                        <DialogDescription>{error}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={() => setError(null)}>{t("common.close")}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

export function WorkflowsPage() {
    const t = useTranslations("web");
    const tableLabels = useTableLabels();
    const workflows = useWorkflows();
    const runs = useRuns();
    const repos = useRepos();
    const [params] = useSearchParams();
    const repo = params.get("repo") ?? "";
    const [running, setRunning] = useState<Row | null>(null);
    const [deleting, setDeleting] = useState<Row | null>(null);
    const actions = useMemo(() => ({ run: setRunning, remove: setDeleting }), []);
    const rows = useMemo(
        () =>
            (workflows.data ?? [])
                .filter((workflow) => !repo || workflow.repo === repo)
                .map(
                    (workflow): Row => ({
                        ...workflow,
                        steps: workflow.definition.nodes.filter(executable).length,
                        lastRun: (runs.data ?? []).find((run) => run.workflow === workflow.id),
                    }),
                ),
        [workflows.data, runs.data, repo],
    );
    const target = repo || repos.data?.[0]?.id || "";
    return (
        <RowContext.Provider value={actions}>
            <PageHeader
                title={t("workflows.title")}
                description={
                    repo ? t("workflows.descriptionOf", { repo }) : t("workflows.description")
                }
                actions={<NewMenu repo={target} />}
            />
            {workflows.isPending ? (
                <Loading>
                    <TableSkeleton columns={5} rows={5} />
                </Loading>
            ) : workflows.isError ? (
                <ErrorState error={workflows.error} onRetry={() => workflows.refetch()} />
            ) : !rows.length ? (
                <EmptyState
                    icon={<WorkflowIcon />}
                    title={t("workflows.emptyTitle")}
                    description={t("workflows.empty")}
                >
                    <div className="flex flex-wrap justify-center gap-2">
                        {TEMPLATES.slice(0, 3).map((template) => (
                            <Button key={template.id} asChild variant="outline" size="sm">
                                <Link
                                    to={`/workflows/new?template=${template.id}${target ? `&repo=${encodeURIComponent(target)}` : ""}`}
                                >
                                    <LayoutTemplateIcon />
                                    {t(`workflows.template.${template.id as "quick-task"}.name`)}
                                </Link>
                            </Button>
                        ))}
                    </div>
                </EmptyState>
            ) : (
                <DataTable
                    // The project column shows only on the list of all projects.
                    key={repo}
                    columns={COLUMNS}
                    data={rows}
                    labels={{
                        empty: t("table.noResults"),
                        search: t("workflows.search"),
                        ...tableLabels,
                    }}
                    searchColumn="search"
                    columnLabels={Object.fromEntries(
                        COLUMN_NAMES.map((name) => [name, t(`fields.${name}`)]),
                    )}
                    getRowId={(row) => row.id}
                    getRowHref={hrefOf}
                    initialColumnVisibility={{ search: false, project: !repo }}
                    initialPageSize={50}
                    pageSizeOptions={[25, 50, 100]}
                />
            )}
            {running && (
                <RunDialog
                    workflow={running}
                    open
                    onOpenChange={(open) => !open && setRunning(null)}
                />
            )}
            <DeleteDialog row={deleting} onClose={() => setDeleting(null)} />
        </RowContext.Provider>
    );
}
