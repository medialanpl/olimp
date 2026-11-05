import { useState } from "react";
import { useTranslations } from "use-intl";
import { SidePanel } from "@/components/flow/canvas";
import { FlowGraph, type NodeView, useNodeTitle } from "@/components/flow/graph";
import { StepDetail, StepState } from "@/components/run/steps";
import { isFailurePort, labelOf, nodeById } from "@/lib/flow";
import type { GraphNode, Step, TaskStatus, WorkflowRun } from "@/lib/types";

export const STEP_TONE: Record<Step["status"] | TaskStatus, string> = {
    queued: "",
    running: "border-violet-500/60 ring-4 ring-violet-500/15",
    waiting: "border-info ring-4 ring-info/20",
    done: "",
    failed: "border-destructive/60",
    cancelled: "opacity-70",
};

function NodePanel({
    run,
    node,
    onClose,
}: {
    run: WorkflowRun;
    node: GraphNode;
    onClose: () => void;
}) {
    const t = useTranslations("web");
    const nodeTitle = useNodeTitle();
    const visits = run.steps
        .map((step, index) => ({ step, index }))
        .filter(({ step }) => step.node === node.id);
    const outputs = run.state?.outputs[node.id];
    return (
        <SidePanel title={labelOf(node)} subtitle={nodeTitle(node.type)} onClose={onClose}>
            {visits.length ? (
                <ol className="space-y-3">
                    {visits.map(({ step, index }) => (
                        <StepDetail key={index} step={step} index={index} />
                    ))}
                </ol>
            ) : (
                <p className="text-sm text-muted-foreground">{t("runs.notVisited")}</p>
            )}
            {outputs && Object.keys(outputs).length ? (
                <section className="space-y-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {t("flow.outputs")}
                    </h3>
                    <dl className="space-y-2">
                        {Object.entries(outputs).map(([key, value]) => (
                            <div key={key} className="space-y-1">
                                <dt className="font-mono text-[11px] text-muted-foreground">
                                    {`{{nodes.${node.id}.${key}}}`}
                                </dt>
                                <dd className="scroll-fade max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-2 font-mono text-xs">
                                    {String(value) || "–"}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </section>
            ) : null}
        </SidePanel>
    );
}

export function RunGraph({ run }: { run: WorkflowRun }) {
    const [selected, setSelected] = useState<string | null>(null);
    const last = new Map<string, Step>();
    const ports = new Map<string, Set<string>>();
    for (const step of run.steps) {
        last.set(step.node, step);
        if (step.port) ports.set(step.node, (ports.get(step.node) ?? new Set()).add(step.port));
    }
    const taken = new Set(
        (run.state?.transitions ?? []).filter((x) => x.to).map((x) => `${x.from}.${x.port}`),
    );
    const finished = run.status === "done" || run.status === "failed" || run.status === "cancelled";
    const visited = new Set([
        ...run.steps.map((s) => s.node),
        ...(run.state?.transitions ?? []).flatMap((x) => [x.from, x.to ?? ""]),
    ]);
    const views = (node: GraphNode): NodeView => {
        const step = last.get(node.id);
        const count = run.steps.filter((s) => s.node === node.id).length;
        return {
            status: step ? <StepState step={step} /> : undefined,
            below: count > 1 ? `×${count}` : undefined,
            tone: step ? STEP_TONE[step.status] : undefined,
            dim: finished && !visited.has(node.id),
            taken: ports.get(node.id),
        };
    };
    const edgeKind = (edge: { from: string; to: string }) => {
        const port = edge.from.split(".")[1] ?? "";
        if (taken.has(edge.from))
            return {
                kind:
                    edge.to === run.currentNode && !finished
                        ? ("running" as const)
                        : isFailurePort(port)
                          ? ("error" as const)
                          : ("done" as const),
            };
        return { kind: "pending" as const, dim: finished };
    };
    const node = selected ? nodeById(run.definition, selected) : undefined;
    return (
        <FlowGraph
            definition={run.definition}
            views={views}
            edgeKind={edgeKind}
            selected={selected}
            onSelect={setSelected}
            focusId={run.currentNode}
            className="h-[calc(100dvh-13rem)] min-h-[24rem]"
            overlay={
                node ? <NodePanel run={run} node={node} onClose={() => setSelected(null)} /> : null
            }
        />
    );
}
