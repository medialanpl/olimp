import { ArrowUpRightIcon, MessageSquareIcon } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { type EdgeKind, SidePanel } from "@/components/flow/canvas";
import { FlowGraph, type NodeView, useNodeTitle } from "@/components/flow/graph";
import { Markdown } from "@/components/markdown";
import { Fact } from "@/components/page";
import { STEP_TONE } from "@/components/run/graph";
import { StepState } from "@/components/run/steps";
import { isActive } from "@/components/task-chat";
import { Button } from "@/components/ui/button";
import { isFailurePort, splitFrom } from "@/lib/flow";
import { useFormat } from "@/lib/format";
import type { Definition, Edge, GraphNode, Task } from "@/lib/types";

const portOf = (task: Task) => (task.status === "failed" ? "failed" : "done");

// A continuation copies the thread's title, so a step is named by its role unless given its own.
export function useStepName() {
    const t = useTranslations("web");
    return useCallback(
        (step: Task, first: Task) =>
            step.id === first.id
                ? t("task.stepName.first")
                : step.title === first.title
                  ? t("task.stepName.continue")
                  : step.title,
        [t],
    );
}

// The thread as a workflow: start, one agent node per task, end; each edge leaves by the port its
// task ended on.
function definitionOf(
    thread: Task[],
    failed: boolean,
    names: { start: string; end: string; step: (step: Task) => string },
): Definition {
    const nodes: GraphNode[] = [
        { id: "start", type: "start", name: names.start },
        ...thread.map(
            (task): GraphNode => ({
                id: task.id,
                type: "agent",
                name: names.step(task),
                prompt: "",
            }),
        ),
        { id: "end", type: "end", name: names.end, status: failed ? "failed" : "success" },
    ];
    const edges = nodes.slice(1).map((node, i) => {
        const before = thread[i - 1];
        return { from: `${nodes[i]?.id}.${before ? portOf(before) : "next"}`, to: node.id };
    });
    return { nodes, edges };
}

export function TaskGraph({
    thread,
    onShowStep,
    onShowTrace,
}: {
    thread: Task[];
    onShowStep: (id: string) => void;
    onShowTrace: (id: string) => void;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const nodeTitle = useNodeTitle();
    const [selected, setSelected] = useState<string | null>(null);
    const first = thread[0];
    const last = thread.at(-1);
    const ended = !!last && !isActive(last);
    const failed = ended && last?.status !== "done";
    const stepName = useStepName();
    const start = t("task.graph.start");
    const end = t("task.graph.end");
    const definition = useMemo(
        () =>
            definitionOf(thread, failed, {
                start,
                end,
                step: (step) => (thread[0] ? stepName(step, thread[0]) : step.title),
            }),
        [thread, failed, start, end, stepName],
    );
    if (!first || !last) return null;
    const byId = new Map(thread.map((task) => [task.id, task]));
    const total = thread.reduce((sum, task) => sum + (task.costUsd ?? 0), 0);
    const step = selected ? byId.get(selected) : undefined;

    const views = (node: GraphNode): NodeView => {
        if (node.type === "start") return { status: format.dateTime(first.createdAt) };
        if (node.type === "end")
            return {
                status: ended ? t(`status.${last.status}`) : t("task.graph.notReached"),
            };
        const task = byId.get(node.id);
        if (!task) return {};
        return {
            status: <StepState step={task} />,
            tone: STEP_TONE[task.status],
            below: `${format.cost(task.costUsd)} · ${format.duration(task.durationMs)}`,
            taken: isActive(task) ? undefined : new Set([portOf(task)]),
        };
    };
    const edgeKind = (edge: Edge): { kind: EdgeKind } => {
        const to = byId.get(edge.to);
        if (!(to ? to.status !== "queued" : ended)) return { kind: "pending" };
        if (to?.status === "running") return { kind: "running" };
        return { kind: isFailurePort(splitFrom(edge.from).port) ? "error" : "done" };
    };

    let panel: ReactNode = null;
    if (selected === "start")
        panel = (
            <SidePanel
                title={t("task.graph.start")}
                subtitle={nodeTitle("start")}
                onClose={() => setSelected(null)}
            >
                <dl className="grid grid-cols-2 gap-3">
                    <Fact label={t("fields.created")}>{format.dateTime(first.createdAt)}</Fact>
                    <Fact label={t("fields.project")}>{first.repo}</Fact>
                </dl>
                <Markdown>{first.body.trim() || first.title}</Markdown>
            </SidePanel>
        );
    else if (selected === "end")
        panel = (
            <SidePanel
                title={t("task.graph.end")}
                subtitle={nodeTitle("end")}
                onClose={() => setSelected(null)}
            >
                <dl className="grid grid-cols-2 gap-3">
                    <Fact label={t("fields.status")}>
                        {ended ? t(`status.${last.status}`) : t("task.graph.notReached")}
                    </Fact>
                    <Fact label={t("fields.cost")}>{format.cost(total)}</Fact>
                    <Fact label={t("task.graph.steps")}>{format.count(thread.length)}</Fact>
                    {last.prUrl && (
                        <Fact label={t("fields.pr")}>
                            <a
                                href={last.prUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 hover:underline"
                            >
                                GitHub
                                <ArrowUpRightIcon className="size-3.5" />
                            </a>
                        </Fact>
                    )}
                </dl>
                {last.log.trim() && <Markdown>{last.log}</Markdown>}
            </SidePanel>
        );
    else if (step)
        panel = (
            <SidePanel
                title={stepName(step, first)}
                subtitle={nodeTitle("agent")}
                onClose={() => setSelected(null)}
            >
                <dl className="grid grid-cols-2 gap-3">
                    <Fact label={t("fields.status")}>{t(`status.${step.status}`)}</Fact>
                    <Fact label={t("fields.agent")}>{step.agent}</Fact>
                    <Fact label={t("fields.cost")}>{format.cost(step.costUsd)}</Fact>
                    <Fact label={t("fields.duration")}>{format.duration(step.durationMs)}</Fact>
                    <Fact label={t("fields.turns")}>{format.count(step.turns)}</Fact>
                    <Fact label={t("fields.created")}>{format.dateTime(step.createdAt)}</Fact>
                </dl>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => onShowStep(step.id)}>
                        <MessageSquareIcon />
                        {t("task.graph.showInChat")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => onShowTrace(step.id)}>
                        {t("task.graph.showTrace")}
                    </Button>
                </div>
                {step.error && (
                    <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                        {step.error}
                    </p>
                )}
                <Markdown>{step.log.trim() || step.body.trim() || step.title}</Markdown>
            </SidePanel>
        );

    return (
        <FlowGraph
            definition={definition}
            views={views}
            edgeKind={edgeKind}
            selected={selected}
            onSelect={setSelected}
            focusId={thread.find(isActive)?.id ?? last.id}
            className="h-[calc(100dvh-13rem)] min-h-[24rem]"
            overlay={panel}
        />
    );
}
