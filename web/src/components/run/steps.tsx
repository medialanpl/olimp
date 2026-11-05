import {
    CheckIcon,
    ClockIcon,
    HandIcon,
    LoaderIcon,
    SquareIcon,
    SquareStackIcon,
    XIcon,
} from "lucide-react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { useNodeTitle, usePortLabel } from "@/components/flow/graph";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { UsageFacts } from "@/components/usage";
import { isFailurePort, labelOf, nodeById } from "@/lib/flow";
import { elapsed, shortId, useFormat } from "@/lib/format";
import { useRun, useTask } from "@/lib/queries";
import type { Child, Step, TaskStatus, WorkflowRun } from "@/lib/types";
import { cn } from "@/lib/utils";

// A task in a thread graph shows its state like a step, queued included.
export function StepState({ step }: { step: { status: Step["status"] | TaskStatus } }) {
    const t = useTranslations("web");
    const Icon =
        step.status === "running"
            ? LoaderIcon
            : step.status === "waiting"
              ? HandIcon
              : step.status === "failed"
                ? XIcon
                : step.status === "cancelled"
                  ? SquareIcon
                  : step.status === "queued"
                    ? ClockIcon
                    : CheckIcon;
    return (
        <span
            className={cn(
                "inline-flex min-w-0 items-center gap-1 truncate",
                step.status === "failed"
                    ? "text-destructive"
                    : step.status === "done"
                      ? "text-constructive"
                      : step.status === "waiting"
                        ? "text-info"
                        : "text-muted-foreground",
            )}
        >
            <Icon
                className={cn(
                    "size-3.5 shrink-0",
                    step.status === "running" && "animate-spin motion-reduce:animate-none",
                )}
            />
            {t(`status.${step.status === "waiting" ? "waiting" : step.status}`)}
        </span>
    );
}

export function ChildLink({ child }: { child: Child }) {
    return child.kind === "task" ? <TaskChild id={child.id} /> : <RunChild id={child.id} />;
}

function TaskChild({ id }: { id: string }) {
    const task = useTask(id);
    return (
        <Link
            to={`/tasks/${id}`}
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
        >
            <span className="flex min-w-0 items-center gap-2">
                <SquareStackIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{task.data?.title ?? shortId(id)}</span>
            </span>
            {task.data ? <StatusBadge status={task.data.status} /> : null}
        </Link>
    );
}

function RunChild({ id }: { id: string }) {
    const run = useRun(id);
    return (
        <Link
            to={`/tasks/${id}`}
            className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
        >
            <span className="truncate">{run.data?.name ?? shortId(id)}</span>
            {run.data ? <StatusBadge status={run.data.status} /> : null}
        </Link>
    );
}

export function StepDetail({ step, index }: { step: Step; index: number }) {
    const t = useTranslations("web");
    const format = useFormat();
    const portLabel = usePortLabel();
    return (
        <li className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">#{index + 1}</span>
                <StepState step={step} />
                {step.port ? (
                    <Badge
                        variant="outline"
                        className={cn(isFailurePort(step.port) ? "text-destructive" : "")}
                    >
                        {t("runs.leftBy", { port: portLabel(step.port) })}
                    </Badge>
                ) : null}
                {step.agent && <span className="text-xs text-muted-foreground">{step.agent}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                    {format.time(step.startedAt)} ·{" "}
                    {format.duration(step.durationMs ?? elapsed(step.startedAt, step.finishedAt))}
                </span>
            </div>
            {step.type === "agent" && step.costUsd !== undefined ? (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                    <UsageFacts usage={step} />
                </dl>
            ) : null}
            {step.error ? (
                <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                    {step.error}
                </p>
            ) : null}
            {step.children?.length ? (
                <ul className="grid gap-2">
                    {step.children.map((child) => (
                        <li key={child.id}>
                            <ChildLink child={child} />
                        </li>
                    ))}
                </ul>
            ) : null}
            {step.log ? (
                <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        {t("runs.log")}
                    </summary>
                    <pre className="scroll-fade mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono text-xs">
                        {step.log}
                    </pre>
                </details>
            ) : null}
        </li>
    );
}

// Every visit in order, under the graph that shows only each node's last one.
export function StepList({ run }: { run: WorkflowRun }) {
    const t = useTranslations("web");
    const nodeTitle = useNodeTitle();
    if (!run.steps.length) return null;
    return (
        <section className="space-y-3">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t("runs.steps")} <span className="tabular-nums">{run.steps.length}</span>
            </h2>
            <ol className="space-y-3">
                {run.steps.map((step, index) => {
                    const node = nodeById(run.definition, step.node);
                    return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a loop visits one node many times; steps only grow.
                        <li key={index} className="space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                                <Badge variant="outline" className="font-mono">
                                    {step.node}
                                </Badge>
                                <span className="font-medium">
                                    {node ? labelOf(node) : step.node}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {node
                                        ? nodeTitle(node.type)
                                        : t(
                                              `runs.type.${step.type === "pr" ? "pr" : step.type === "condition" ? "condition" : "agent"}`,
                                          )}
                                </span>
                            </div>
                            <ol>
                                <StepDetail step={step} index={index} />
                            </ol>
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}
