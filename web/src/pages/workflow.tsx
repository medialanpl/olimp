import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeftIcon,
    CircleAlertIcon,
    CircleCheckIcon,
    CopyIcon,
    DownloadIcon,
    EllipsisIcon,
    LayoutGridIcon,
    PlayIcon,
    PlugIcon,
    PlusIcon,
    SaveIcon,
    Settings2Icon,
    SparklesIcon,
    SquareIcon,
    Trash2Icon,
    Undo2Icon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { Hint, SidePanel } from "@/components/flow/canvas";
import { FlowGraph, type NodeView, usePortLabel } from "@/components/flow/graph";
import { NodeInspector } from "@/components/flow/inspector";
import { Field } from "@/components/flow/inspector/fields";
import { type NodeChoice, NodePalette } from "@/components/flow/palette";
import { ProjectIntegrations } from "@/components/integrations/project-integrations";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import {
    addNode,
    blankDefinition,
    connect,
    type Draft,
    download,
    fromText,
    graphIssues,
    isFailurePort,
    labelOf,
    moveNode,
    nodeById,
    portsOf,
    removeNode,
    renameNode,
    resizeFork,
    simulate,
    TEMPLATES,
    tidy,
    toYaml,
    withLayout,
} from "@/lib/flow";
import { keys, useRepos, useWorkflows } from "@/lib/queries";
import { triggered } from "@/lib/shortcuts";
import type { GraphNode, Issue, Workflow, WorkflowRun } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NotFoundPage } from "@/pages/not-found";

type Panel =
    | { kind: "node"; id: string }
    | { kind: "add"; from: From }
    | { kind: "settings" }
    | null;
type From = { node: string; port: string } | null;

const payloadOf = (d: Draft) => ({
    name: d.name.trim(),
    description: d.description.trim(),
    repo: d.repo,
    definition: d.definition,
});
const signature = (d: Draft) => JSON.stringify(payloadOf(d));

export function useIssueText() {
    const t = useTranslations("web");
    return (issue: Issue) => t(`workflows.issue.${issue.code as "cycle"}`, issue.params);
}

const MINUTE = 60_000;

// One line under a node's title: what it is set to do.
export function useNodeSummary() {
    const t = useTranslations("web");
    return (node: GraphNode, workflows: Workflow[] = []): ReactNode => {
        const mono = (text: string) => (
            <span className="truncate font-mono text-muted-foreground">{text}</span>
        );
        const muted = (text: string) => (
            <span className="truncate text-muted-foreground">{text}</span>
        );
        switch (node.type) {
            case "start":
                return t("flow.summary.start");
            case "end":
                return node.status === "failed" ? t("flow.endFailed") : t("flow.endSuccess");
            case "agent":
                return node.verdicts?.length
                    ? muted(t("flow.summary.verdicts", { verdicts: node.verdicts.join(", ") }))
                    : node.session
                      ? muted(t("flow.summary.continues", { node: node.session.continue }))
                      : node.skill
                        ? mono(node.skill.split(":").pop() ?? node.skill)
                        : muted(node.prompt.replace(/\s+/g, " ").slice(0, 60));
            case "check":
                return mono(node.command);
            case "loop":
                return muted(t("flow.summary.loop", { max: node.max }));
            case "if": {
                const c = node.condition;
                return mono(
                    c.kind === "paths-changed"
                        ? c.glob
                        : c.kind === "output"
                          ? `${c.ref} ${c.op} ${c.value}`
                          : `${t(`flow.condition.${c.kind}`)} ${c.op} ${c.value}`,
                );
            }
            case "gate.human":
                return muted(node.message);
            case "ask-user":
                return muted(node.question);
            case "dispatch":
                return muted(node.prompt);
            case "fork":
                return muted(t("flow.summary.branches", { count: node.branches }));
            case "join":
                return muted(
                    node.wait === "any" ? t("flow.field.waitAny") : t("flow.field.waitAll"),
                );
            case "workflow":
                return mono(
                    workflows.find((w) => w.id === node.workflow)?.name ??
                        (node.workflow || t("flow.field.pickWorkflow")),
                );
            case "git.commit":
                return mono(node.message);
            case "github.draft-pr":
                return muted(
                    node.title ??
                        (node.draft === false ? t("flow.field.prDraftNo") : t("flow.summary.pr")),
                );
            case "github.pr-comment":
                return muted(node.body);
            case "github.issue-comment":
                return muted(node.issue ? `#${node.issue}` : t("flow.summary.markedIssue"));
            case "github.wait-ci":
                return muted(
                    t("flow.summary.ci", { minutes: Math.round(node.timeoutMs / MINUTE) }),
                );
            case "notify.webhook":
                return mono(node.url || t("flow.field.url"));
            default:
                return null;
        }
    };
}

function SimulationBar({
    node,
    end,
    canUndo,
    onChoose,
    onUndo,
    onRestart,
}: {
    node: GraphNode | undefined;
    end: "done" | "failed" | null;
    canUndo: boolean;
    onChoose: (port: string) => void;
    onUndo: () => void;
    onRestart: () => void;
}) {
    const t = useTranslations("web");
    const portLabel = usePortLabel();
    return (
        <div className="absolute inset-x-3 bottom-3 z-10 flex justify-center sm:left-16">
            <div
                role="status"
                className="flex max-w-full flex-wrap items-center gap-2 rounded-2xl border bg-card px-3 py-2 text-sm shadow-md"
            >
                {node ? (
                    <>
                        <span>
                            <span className="font-semibold">{labelOf(node)}</span>{" "}
                            {t("flow.simulateLeaves")}
                        </span>
                        {portsOf(node).map((port) => (
                            <Button
                                key={port}
                                size="xs"
                                variant="outline"
                                className={
                                    isFailurePort(port) ? "text-destructive" : "text-constructive"
                                }
                                onClick={() => onChoose(port)}
                            >
                                {portLabel(port)}
                            </Button>
                        ))}
                    </>
                ) : (
                    <>
                        <span className="font-medium">
                            {end === "failed" ? t("flow.simulateFailed") : t("flow.simulateDone")}
                        </span>
                        <Button size="xs" variant="outline" onClick={onRestart}>
                            {t("flow.simulateRestart")}
                        </Button>
                    </>
                )}
                {canUndo ? (
                    <Button size="xs" variant="ghost" onClick={onUndo}>
                        <Undo2Icon />
                        {t("flow.simulateUndo")}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function SettingsPanel({
    draft,
    onDescription,
    onReplace,
    onClose,
}: {
    draft: Draft;
    onDescription: (text: string) => void;
    onReplace: (next: Pick<Draft, "name" | "description" | "definition">) => void;
    onClose: () => void;
}) {
    const t = useTranslations("web");
    const [text, setText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const yaml = toYaml(draft);
    return (
        <SidePanel title={t("workflows.settings")} onClose={onClose}>
            <Field id="workflow-description" label={t("workflows.descriptionLabel")}>
                <Textarea
                    id="workflow-description"
                    value={draft.description}
                    onChange={(e) => onDescription(e.target.value)}
                    placeholder={t("workflows.descriptionPlaceholder")}
                    className="min-h-20"
                />
            </Field>
            <section className="space-y-2">
                <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("workflows.templates")}
                </h3>
                <ul className="grid gap-1.5">
                    {TEMPLATES.map((template) => (
                        <li key={template.id}>
                            <button
                                type="button"
                                onClick={() =>
                                    onReplace({
                                        name: draft.name || template.id,
                                        description:
                                            draft.description ||
                                            t(
                                                `workflows.template.${template.id as "quick-task"}.description`,
                                            ),
                                        definition: template.definition,
                                    })
                                }
                                className="w-full rounded-xl border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                                <span className="block text-sm font-medium">
                                    {t(`workflows.template.${template.id as "quick-task"}.name`)}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                    {t(
                                        `workflows.template.${template.id as "quick-task"}.description`,
                                    )}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
                <p className="text-xs text-muted-foreground">{t("workflows.templatesHint")}</p>
            </section>
            <section className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        YAML
                    </h3>
                    <div className="flex gap-1">
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                                void navigator.clipboard.writeText(yaml).then(() => {
                                    setCopied(true);
                                    setTimeout(() => setCopied(false), 1500);
                                })
                            }
                        >
                            <CopyIcon />
                            {copied ? t("workflows.copied") : t("workflows.copy")}
                        </Button>
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => download(draft.name, yaml)}
                        >
                            <DownloadIcon />
                            {t("workflows.export")}
                        </Button>
                    </div>
                </div>
                <pre className="scroll-fade max-h-64 overflow-auto rounded-xl bg-muted/50 p-3 font-mono text-xs">
                    {yaml}
                </pre>
            </section>
            <Field id="workflow-import" label={t("workflows.importLabel")}>
                <Textarea
                    id="workflow-import"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("workflows.importPlaceholder")}
                    className="scroll-fade min-h-24 font-mono text-xs"
                />
                {error ? (
                    <p role="alert" className="text-xs text-destructive">
                        {error}
                    </p>
                ) : null}
                <Button
                    size="sm"
                    variant="outline"
                    disabled={!text.trim()}
                    onClick={() => {
                        try {
                            const imported = fromText(text);
                            setError(null);
                            setText("");
                            onReplace({
                                name: imported.name || draft.name,
                                description: imported.description || draft.description,
                                definition: imported.definition,
                            });
                        } catch (e) {
                            setError(t("workflows.importFailed", { error: (e as Error).message }));
                        }
                    }}
                >
                    {t("workflows.importReplace")}
                </Button>
            </Field>
        </SidePanel>
    );
}

function BuildDialog({
    open,
    repo,
    onOpenChange,
    onBuilt,
}: {
    open: boolean;
    repo: string;
    onOpenChange: (open: boolean) => void;
    onBuilt: (built: Pick<Draft, "name" | "description" | "definition">) => void;
}) {
    const t = useTranslations("web");
    const [request, setRequest] = useState("");
    const build = useMutation({
        mutationFn: () =>
            api<Pick<Draft, "name" | "description" | "definition">>("/api/workflows/build", {
                method: "POST",
                body: { repo, request },
            }),
        onSuccess: (built) => {
            onBuilt(built);
            onOpenChange(false);
            setRequest("");
        },
    });
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("workflows.buildTitle")}</DialogTitle>
                    <DialogDescription>{t("workflows.buildDescription")}</DialogDescription>
                </DialogHeader>
                <DialogBody className="space-y-3">
                    <Textarea
                        value={request}
                        onChange={(e) => setRequest(e.target.value)}
                        placeholder={t("workflows.buildPlaceholder")}
                        className="min-h-32"
                        autoFocus
                        aria-label={t("workflows.buildTitle")}
                    />
                    {!repo ? (
                        <p className="text-xs text-destructive">
                            {t("workflows.pickProjectFirst")}
                        </p>
                    ) : null}
                    <FormError error={build.error} />
                </DialogBody>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        disabled={!request.trim() || !repo || build.isPending}
                        onClick={() => build.mutate()}
                    >
                        {build.isPending ? <Spinner /> : <SparklesIcon />}
                        {build.isPending ? t("workflows.building") : t("workflows.build")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function RunDialog({
    workflow,
    open,
    onOpenChange,
}: {
    workflow: Pick<Workflow, "id" | "name">;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const client = useQueryClient();
    const [input, setInput] = useState("");
    const run = useMutation({
        mutationFn: () =>
            api<WorkflowRun>(`/api/workflows/${workflow.id}/run`, {
                method: "POST",
                body: input.trim() ? { input: input.trim() } : {},
            }),
        onSuccess: (created) => {
            void client.invalidateQueries({ queryKey: keys.runs });
            client.setQueryData(keys.run(created.id), created);
            navigate(`/tasks/${created.id}`);
        },
    });
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t("workflows.runTitle", { name: workflow.name })}</DialogTitle>
                    <DialogDescription>{t("workflows.runDescription")}</DialogDescription>
                </DialogHeader>
                <DialogBody className="space-y-3">
                    <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={t("workflows.runPlaceholder")}
                        className="min-h-28"
                        autoFocus
                        aria-label={t("workflows.runInput")}
                        onKeyDown={(e) => {
                            if (triggered(e.nativeEvent, "send")) run.mutate();
                        }}
                    />
                    <FormError error={run.error} />
                </DialogBody>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.cancel")}
                    </Button>
                    <Button disabled={run.isPending} onClick={() => run.mutate()}>
                        {run.isPending ? <Spinner /> : <PlayIcon />}
                        {t("workflows.runNow")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// The editor's toolbar over the canvas, with a few nodes in a column.
function EditorSkeleton() {
    return (
        <Loading className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2.5 md:px-4">
                <Skeleton className="size-8 rounded-4xl" />
                <Skeleton className="h-8 w-48 rounded-3xl sm:w-60" />
                <Skeleton className="h-8 w-44 rounded-3xl" />
                <div className="ml-auto flex items-center gap-1">
                    {times(4).map((button) => (
                        <Skeleton key={button} className="size-8 rounded-4xl" />
                    ))}
                    <Skeleton className="h-8 w-20 rounded-4xl" />
                </div>
            </div>
            <div className="relative min-h-0 flex-1 p-3 md:p-4">
                <div className="flex h-full min-h-[26rem] flex-col items-center justify-center gap-8 rounded-2xl border">
                    {times(3).map((node) => (
                        <Skeleton key={node} className="h-14 w-56 rounded-xl" />
                    ))}
                </div>
            </div>
        </Loading>
    );
}

function Editor({ initial, saved }: { initial: Draft; saved: Workflow | null }) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const client = useQueryClient();
    const repos = useRepos();
    const workflows = useWorkflows();
    const issueText = useIssueText();
    const summary = useNodeSummary();
    const [draft, setDraft] = useState(initial);
    const [base, setBase] = useState(() => (saved ? signature(initial) : ""));
    const [panel, setPanel] = useState<Panel>(null);
    const [choices, setChoices] = useState<string[] | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [building, setBuilding] = useState(false);
    const [running, setRunning] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [integrations, setIntegrations] = useState(false);
    const others = (workflows.data ?? []).filter((w) => w.id !== saved?.id);
    const issues = useMemo(() => graphIssues(draft.definition), [draft.definition]);
    const troubled = useMemo(
        () => new Set(issues.map((i) => String(i.params.node ?? ""))),
        [issues],
    );
    const dirty = signature(draft) !== base;
    const sim = choices ? simulate(draft.definition, choices) : null;
    const selected = panel?.kind === "node" ? nodeById(draft.definition, panel.id) : undefined;

    const save = useMutation({
        mutationFn: () =>
            saved
                ? api<Workflow>(`/api/workflows/${saved.id}`, {
                      method: "PATCH",
                      body: payloadOf(draft),
                  })
                : api<Workflow>("/api/workflows", { method: "POST", body: payloadOf(draft) }),
        onSuccess: (workflow) => {
            void client.invalidateQueries({ queryKey: keys.workflows });
            const next = {
                name: workflow.name,
                description: workflow.description,
                repo: workflow.repo,
                definition: workflow.definition,
            };
            setDraft(next);
            setBase(signature(next));
            if (!saved) navigate(`/workflows/${workflow.id}`, { replace: true });
        },
    });
    const remove = useMutation({
        mutationFn: () => api(`/api/workflows/${saved?.id}`, { method: "DELETE" }),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.workflows });
            navigate(`/workflows?repo=${encodeURIComponent(draft.repo)}`);
        },
    });

    const canSave = dirty && !issues.length && draft.name.trim() && draft.repo && !save.isPending;
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable]");
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                e.preventDefault();
                if (canSave) save.mutate();
            } else if (e.key === "Escape" && !typing) setPanel(null);
            else if (
                (e.key === "Delete" || e.key === "Backspace") &&
                !typing &&
                selected &&
                selected.type !== "start"
            ) {
                setDraft((d) => ({ ...d, definition: removeNode(d.definition, selected.id) }));
                setPanel(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [canSave, save, selected]);
    useEffect(() => {
        if (!dirty) return;
        const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
        window.addEventListener("beforeunload", onLeave);
        return () => window.removeEventListener("beforeunload", onLeave);
    }, [dirty]);

    const edit = (definition: Draft["definition"]) => {
        setDraft((d) => ({ ...d, definition }));
        setChoices(null);
    };
    const pick = (choice: NodeChoice, from: From) => {
        const added = addNode(draft.definition, choice.type, choice.extra, from);
        edit(added.definition);
        setPanel({ kind: "node", id: added.id });
    };
    const patchNode = (id: string, patch: Partial<GraphNode>) =>
        edit({
            ...draft.definition,
            nodes: draft.definition.nodes.map((n) =>
                n.id === id ? ({ ...n, ...patch } as GraphNode) : n,
            ),
        });
    const replace = (next: Pick<Draft, "name" | "description" | "definition">) => {
        setDraft((d) => ({ ...d, ...next, definition: tidy(next.definition) }));
        setChoices(null);
        setPanel(null);
    };

    const views = (node: GraphNode): NodeView => ({
        status: summary(node, others),
        dim: sim ? !sim.visited.has(node.id) : false,
        tone: sim?.at === node.id ? "border-info ring-4 ring-info/15" : undefined,
        problem: troubled.has(node.id),
    });
    const edgeKind = (edge: { from: string }) =>
        sim
            ? {
                  kind: sim.taken.has(edge.from) ? ("done" as const) : ("idle" as const),
                  dim: !sim.taken.has(edge.from),
              }
            : {
                  kind: isFailurePort(edge.from.split(".")[1] ?? "")
                      ? ("error" as const)
                      : ("idle" as const),
              };

    // Only aria-disabled: a disabled button gets no hover or focus, so its hint would never show.
    const integrationsButton = (
        <Button
            size="sm"
            variant="ghost"
            aria-disabled={!draft.repo}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => draft.repo && setIntegrations(true)}
        >
            <PlugIcon />
            {t("integrations.title")}
        </Button>
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b px-3 py-2.5 md:px-4">
                <Hint label={t("workflows.title")}>
                    <Button
                        asChild
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("workflows.title")}
                    >
                        <Link
                            to={
                                draft.repo
                                    ? `/workflows?repo=${encodeURIComponent(draft.repo)}`
                                    : "/workflows"
                            }
                        >
                            <ArrowLeftIcon />
                        </Link>
                    </Button>
                </Hint>
                <Input
                    aria-label={t("workflows.nameLabel")}
                    value={draft.name}
                    placeholder={t("workflows.namePlaceholder")}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="h-8 w-48 font-medium sm:w-60"
                />
                <SearchableSelect
                    aria-label={t("fields.project")}
                    value={draft.repo}
                    onValueChange={(repo) => setDraft((d) => ({ ...d, repo }))}
                    placeholder={t("workflows.pickProject")}
                    className="h-8 w-44"
                    options={(repos.data ?? []).map((r) => ({ value: r.id, label: r.id }))}
                />
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            className="rounded-4xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                            <Badge
                                variant="outline"
                                className={cn(
                                    "h-7 cursor-pointer gap-1.5 px-2.5",
                                    issues.length ? "text-warning" : "text-constructive",
                                )}
                            >
                                {issues.length ? <CircleAlertIcon /> : <CircleCheckIcon />}
                                {issues.length
                                    ? t("workflows.problems", { count: issues.length })
                                    : t("workflows.valid")}
                            </Badge>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] p-2">
                        {issues.length ? (
                            <ul className="scroll-fade max-h-80 space-y-0.5 overflow-y-auto">
                                {issues.map((issue) => {
                                    const node = String(issue.params.node ?? "");
                                    return (
                                        <li key={`${issue.code}:${JSON.stringify(issue.params)}`}>
                                            <button
                                                type="button"
                                                disabled={!nodeById(draft.definition, node)}
                                                onClick={() => setPanel({ kind: "node", id: node })}
                                                className="flex w-full gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted disabled:pointer-events-none"
                                            >
                                                <CircleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
                                                {issueText(issue)}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <p className="px-2 py-1.5 text-sm text-muted-foreground">
                                {t("workflows.validHint")}
                            </p>
                        )}
                    </PopoverContent>
                </Popover>
                {dirty ? <Badge variant="secondary">{t("workflows.unsaved")}</Badge> : null}
                <div className="ml-auto flex flex-wrap items-center gap-1">
                    <Button
                        size="sm"
                        variant={panel?.kind === "add" ? "secondary" : "outline"}
                        onClick={() =>
                            setPanel(panel?.kind === "add" ? null : { kind: "add", from: null })
                        }
                    >
                        <PlusIcon />
                        {t("flow.addNode")}
                    </Button>
                    <Button
                        size="sm"
                        variant={choices ? "secondary" : "ghost"}
                        onClick={() => setChoices(choices ? null : [])}
                    >
                        {choices ? <SquareIcon /> : <PlayIcon />}
                        {choices ? t("flow.simulateStop") : t("flow.simulate")}
                    </Button>
                    {draft.repo ? (
                        integrationsButton
                    ) : (
                        <Hint label={t("workflows.pickProjectFirst")}>{integrationsButton}</Hint>
                    )}
                    <Hint label={t("flow.tidy")}>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("flow.tidy")}
                            onClick={() => edit(tidy(draft.definition))}
                        >
                            <LayoutGridIcon />
                        </Button>
                    </Hint>
                    <Hint label={t("workflows.build")}>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("workflows.build")}
                            onClick={() => setBuilding(true)}
                        >
                            <SparklesIcon />
                        </Button>
                    </Hint>
                    <Hint label={t("workflows.settingsHint")}>
                        <Button
                            size="icon-sm"
                            variant={panel?.kind === "settings" ? "secondary" : "ghost"}
                            aria-label={t("workflows.settings")}
                            onClick={() =>
                                setPanel(panel?.kind === "settings" ? null : { kind: "settings" })
                            }
                        >
                            <Settings2Icon />
                        </Button>
                    </Hint>
                    {saved ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("workflows.more")}
                                >
                                    <EllipsisIcon />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                    onSelect={() =>
                                        navigate("/workflows/new", {
                                            state: {
                                                draft: {
                                                    ...draft,
                                                    name: t("workflows.copyName", {
                                                        name: draft.name,
                                                    }),
                                                },
                                            },
                                        })
                                    }
                                >
                                    <CopyIcon />
                                    {t("workflows.duplicate")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onSelect={() => download(draft.name, toYaml(draft))}
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
                    ) : null}
                    {saved && !dirty ? (
                        <Button size="sm" variant="outline" onClick={() => setRunning(true)}>
                            <PlayIcon />
                            {t("workflows.run")}
                        </Button>
                    ) : null}
                    <Button size="sm" disabled={!canSave} onClick={() => save.mutate()}>
                        {save.isPending ? <Spinner /> : <SaveIcon />}
                        {t("workflows.save")}
                    </Button>
                </div>
            </header>
            {notice || save.error ? (
                <div className="space-y-2 px-3 pt-3 md:px-4">
                    {notice ? (
                        <Alert variant="info" role="status">
                            <SparklesIcon />
                            <AlertDescription className="flex items-center justify-between gap-2">
                                {notice}
                                <Button size="xs" variant="ghost" onClick={() => setNotice(null)}>
                                    {t("common.close")}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    <FormError error={save.error} />
                </div>
            ) : null}
            <div className="relative min-h-0 flex-1 p-3 md:p-4">
                <FlowGraph
                    definition={draft.definition}
                    views={views}
                    edgeKind={edgeKind}
                    selected={selected?.id ?? null}
                    onSelect={(id) => setPanel({ kind: "node", id })}
                    legend={false}
                    pan
                    focusId={selected?.id ?? null}
                    className="h-full min-h-[26rem]"
                    edit={{
                        onMove: (id, at) =>
                            setDraft((d) => ({ ...d, definition: moveNode(d.definition, id, at) })),
                        onConnect: (node, port, to) =>
                            edit(connect(draft.definition, node, port, to)),
                        onAddFromPort: (node, port) =>
                            setPanel({ kind: "add", from: { node, port } }),
                    }}
                    overlay={
                        <>
                            {panel?.kind === "add" ? (
                                <NodePalette
                                    workflows={others.filter((w) => w.repo === draft.repo)}
                                    onPick={(c) => pick(c, panel.from)}
                                    onClose={() => setPanel(null)}
                                />
                            ) : selected ? (
                                <NodeInspector
                                    key={selected.id}
                                    definition={draft.definition}
                                    node={selected}
                                    repo={draft.repo}
                                    workflows={others}
                                    readOnly={false}
                                    onChange={(patch) => patchNode(selected.id, patch)}
                                    onAddReviewers={(id, logins) => {
                                        const target = nodeById(draft.definition, id);
                                        if (target?.type === "github.pr-update")
                                            patchNode(id, {
                                                reviewers: [...(target.reviewers ?? []), ...logins],
                                            });
                                    }}
                                    onManageIntegrations={
                                        draft.repo ? () => setIntegrations(true) : undefined
                                    }
                                    onRename={(id) => {
                                        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(id)) return;
                                        if (nodeById(draft.definition, id)) return;
                                        edit(renameNode(draft.definition, selected.id, id));
                                        setPanel({ kind: "node", id });
                                    }}
                                    onRemove={() => {
                                        edit(removeNode(draft.definition, selected.id));
                                        setPanel(null);
                                    }}
                                    onConnect={(port, to) =>
                                        edit(connect(draft.definition, selected.id, port, to))
                                    }
                                    onResizeFork={(n) =>
                                        edit(resizeFork(draft.definition, selected.id, n))
                                    }
                                    onClose={() => setPanel(null)}
                                />
                            ) : panel?.kind === "settings" ? (
                                <SettingsPanel
                                    draft={draft}
                                    onDescription={(description) =>
                                        setDraft((d) => ({ ...d, description }))
                                    }
                                    onReplace={replace}
                                    onClose={() => setPanel(null)}
                                />
                            ) : null}
                            {sim ? (
                                <SimulationBar
                                    node={sim.at ? nodeById(draft.definition, sim.at) : undefined}
                                    end={sim.end}
                                    canUndo={(choices?.length ?? 0) > 0}
                                    onChoose={(port) => setChoices([...(choices ?? []), port])}
                                    onUndo={() => setChoices((c) => (c ?? []).slice(0, -1))}
                                    onRestart={() => setChoices([])}
                                />
                            ) : null}
                        </>
                    }
                />
            </div>
            <Sheet open={integrations} onOpenChange={setIntegrations}>
                <SheetContent size="wide">
                    <SheetHeader>
                        <SheetTitle>
                            {t("integrations.sheetTitle", { repo: draft.repo })}
                        </SheetTitle>
                        <SheetDescription>{t("integrations.sheetHint")}</SheetDescription>
                    </SheetHeader>
                    <SheetBody>
                        {draft.repo ? <ProjectIntegrations repo={draft.repo} newTab /> : null}
                    </SheetBody>
                </SheetContent>
            </Sheet>
            <BuildDialog
                open={building}
                repo={draft.repo}
                onOpenChange={setBuilding}
                onBuilt={(built) => {
                    replace({
                        name: draft.name || built.name,
                        description: draft.description || built.description,
                        definition: built.definition,
                    });
                    setNotice(t("workflows.built"));
                }}
            />
            {saved ? (
                <RunDialog
                    workflow={{ id: saved.id, name: draft.name }}
                    open={running}
                    onOpenChange={setRunning}
                />
            ) : null}
            <Dialog open={deleting} onOpenChange={setDeleting}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("workflows.deleteTitle", { name: draft.name })}
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
        </div>
    );
}

// `/workflows/new` takes a project, a template or a draft handed over by the list (an import, a
// copy); `/workflows/<id>` opens a saved one.
export function WorkflowPage() {
    const { id = "" } = useParams();
    const [params] = useSearchParams();
    const location = useLocation();
    const workflows = useWorkflows();
    const handed = (location.state as { draft?: Draft } | null)?.draft;
    if (id === "new") {
        const template = TEMPLATES.find((tpl) => tpl.id === params.get("template"));
        const initial: Draft = handed
            ? { ...handed, definition: withLayout(handed.definition) }
            : {
                  name: template?.id ?? "",
                  description: "",
                  repo: params.get("repo") ?? "",
                  definition: tidy(template?.definition ?? blankDefinition()),
              };
        return <Editor key={location.key} initial={initial} saved={null} />;
    }
    if (workflows.isPending) return <EditorSkeleton />;
    if (workflows.isError)
        return <ErrorState error={workflows.error} onRetry={() => workflows.refetch()} />;
    const saved = workflows.data.find((w) => w.id === id);
    if (!saved) return <NotFoundPage />;
    const initial: Draft = {
        name: saved.name,
        description: saved.description,
        repo: saved.repo,
        definition: saved.definition,
    };
    return <Editor key={saved.id} initial={initial} saved={saved} />;
}
