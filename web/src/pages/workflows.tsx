import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    ChevronDownIcon,
    CopyIcon,
    DownloadIcon,
    EllipsisIcon,
    FileUpIcon,
    LayoutTemplateIcon,
    PencilIcon,
    PlayIcon,
    PlusIcon,
    Trash2Icon,
    WorkflowIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { NODE_ICON, toneOf, useNodeTitle } from "@/components/flow/graph";
import { ErrorState, FormError, Loading, PageHeader } from "@/components/page";
import { times } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
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

function WorkflowCard({ workflow, lastRun }: { workflow: Workflow; lastRun?: RunSummary }) {
    const t = useTranslations("web");
    const format = useFormat();
    const navigate = useNavigate();
    const client = useQueryClient();
    const [running, setRunning] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const remove = useMutation({
        mutationFn: () => api(`/api/workflows/${workflow.id}`, { method: "DELETE" }),
        onSuccess: () => {
            setDeleting(false);
            void client.invalidateQueries({ queryKey: keys.workflows });
        },
    });
    const steps = workflow.definition.nodes.filter(executable).length;
    return (
        <Card className="relative transition-shadow hover:shadow-md">
            <CardHeader>
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                        <CardTitle className="truncate">
                            <Link
                                to={`/workflows/${workflow.id}`}
                                className="outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
                            >
                                {workflow.name}
                            </Link>
                        </CardTitle>
                        <CardDescription className="line-clamp-2 min-h-10">
                            {workflow.description || t("workflows.noDescription")}
                        </CardDescription>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("workflows.more")}
                                className="relative z-10 -mt-1 -mr-2"
                            >
                                <EllipsisIcon />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                onSelect={() => navigate(`/workflows/${workflow.id}`)}
                            >
                                <PencilIcon />
                                {t("workflows.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() =>
                                    navigate("/workflows/new", {
                                        state: {
                                            draft: {
                                                name: t("workflows.copyName", {
                                                    name: workflow.name,
                                                }),
                                                description: workflow.description,
                                                repo: workflow.repo,
                                                definition: workflow.definition,
                                            },
                                        },
                                    })
                                }
                            >
                                <CopyIcon />
                                {t("workflows.duplicate")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() => download(workflow.name, toYaml(workflow))}
                            >
                                <DownloadIcon />
                                {t("workflows.export")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setDeleting(true)}
                            >
                                <Trash2Icon />
                                {t("workflows.delete")}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <NodeStrip workflow={workflow} />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <Badge variant="outline" className="font-mono">
                        {workflow.repo}
                    </Badge>
                    <span>{t("workflows.steps", { count: steps })}</span>
                    <span>
                        {t("workflows.updated", { when: format.relative(workflow.updatedAt) })}
                    </span>
                </div>
            </CardContent>
            <CardFooter className="relative z-10 mt-auto flex items-center justify-between gap-2">
                {lastRun ? (
                    <Link
                        to={`/tasks/${lastRun.id}`}
                        className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <StatusBadge status={lastRun.status} />
                        <span className="truncate">{format.relative(lastRun.createdAt)}</span>
                    </Link>
                ) : (
                    <span className="text-xs text-muted-foreground">{t("workflows.neverRun")}</span>
                )}
                <Button size="sm" variant="outline" onClick={() => setRunning(true)}>
                    <PlayIcon />
                    {t("workflows.run")}
                </Button>
            </CardFooter>
            <RunDialog workflow={workflow} open={running} onOpenChange={setRunning} />
            <Dialog open={deleting} onOpenChange={setDeleting}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("workflows.deleteTitle", { name: workflow.name })}
                        </DialogTitle>
                        <DialogDescription>{t("workflows.deleteDescription")}</DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormError error={remove.error} />
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleting(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate()}
                        >
                            <Trash2Icon />
                            {t("workflows.delete")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
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

function WorkflowCardSkeleton() {
    return (
        <Card>
            <CardHeader className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-10 w-full" />
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex gap-1.5">
                    {times(3).map((node) => (
                        <Skeleton key={node} className="h-7 w-9 rounded-lg" />
                    ))}
                </div>
                <div className="flex gap-3">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                </div>
            </CardContent>
            <CardFooter className="mt-auto justify-between gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20 rounded-4xl" />
            </CardFooter>
        </Card>
    );
}

export function WorkflowsPage() {
    const t = useTranslations("web");
    const workflows = useWorkflows();
    const runs = useRuns();
    const repos = useRepos();
    const [params] = useSearchParams();
    const repo = params.get("repo") ?? "";
    const shown = (workflows.data ?? []).filter((workflow) => !repo || workflow.repo === repo);
    const lastRun = (id: string) => (runs.data ?? []).find((run) => run.workflow === id);
    const target = repo || repos.data?.[0]?.id || "";
    return (
        <>
            <PageHeader
                title={t("workflows.title")}
                description={
                    repo ? t("workflows.descriptionOf", { repo }) : t("workflows.description")
                }
                actions={<NewMenu repo={target} />}
            />
            {workflows.isPending ? (
                <Loading className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {times(3).map((card) => (
                        <WorkflowCardSkeleton key={card} />
                    ))}
                </Loading>
            ) : workflows.isError ? (
                <ErrorState error={workflows.error} onRetry={() => workflows.refetch()} />
            ) : !shown.length ? (
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
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {shown.map((workflow) => (
                        <WorkflowCard
                            key={workflow.id}
                            workflow={workflow}
                            lastRun={lastRun(workflow.id)}
                        />
                    ))}
                </div>
            )}
        </>
    );
}
