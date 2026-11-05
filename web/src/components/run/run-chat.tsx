import { AlertCircleIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { AgentAvatar, agentLabel } from "@/components/agent-mark";
import { useNodeTitle, usePortLabel } from "@/components/flow/graph";
import { Markdown } from "@/components/markdown";
import { ChildLink, StepState } from "@/components/run/steps";
import { WaitCard } from "@/components/run/wait-card";
import { Activity, UserTurn } from "@/components/task-chat";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { labelOf, nodeById } from "@/lib/flow";
import { elapsed, useFormat } from "@/lib/format";
import { useTrace } from "@/lib/queries";
import type { AgentEvent, AgentName, Step, WorkflowRun } from "@/lib/types";

function StepFacts({ step }: { step: Step }) {
    const t = useTranslations("web");
    const format = useFormat();
    const portLabel = usePortLabel();
    return (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <StepState step={step} />
            <span className="tabular-nums">
                {format.duration(step.durationMs ?? elapsed(step.startedAt, step.finishedAt))}
            </span>
            {step.costUsd !== undefined && (
                <span className="tabular-nums">{format.cost(step.costUsd)}</span>
            )}
            {step.port && <span>{t("runs.leftBy", { port: portLabel(step.port) })}</span>}
        </p>
    );
}

function Children({ step }: { step: Step }) {
    if (!step.children?.length) return null;
    return (
        <ul className="grid gap-2">
            {step.children.map((child) => (
                <li key={child.id}>
                    <ChildLink child={child} />
                </li>
            ))}
        </ul>
    );
}

function AgentStep({
    run,
    step,
    agent,
    events,
}: {
    run: WorkflowRun;
    step: Step;
    agent: AgentName;
    events: AgentEvent[];
}) {
    const t = useTranslations("web");
    const node = nodeById(run.definition, step.node);
    const running = step.status === "running";
    return (
        <div className="flex gap-3">
            <AgentAvatar agent={agent} />
            <div className="min-w-0 flex-1 space-y-3 pt-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="text-sm font-semibold text-foreground">
                        {agentLabel(agent)}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">
                        {node ? labelOf(node) : step.node}
                    </span>
                </p>
                <Activity events={events} error={step.error} />
                {running && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="text-brand" />
                        <span className="animate-pulse motion-reduce:animate-none">
                            {t("task.chat.working")}
                        </span>
                    </p>
                )}
                {step.error && (
                    <Alert variant={step.status === "cancelled" ? "default" : "destructive"}>
                        <AlertCircleIcon />
                        <AlertTitle>
                            {t(step.status === "cancelled" ? "status.cancelled" : "task.error")}
                        </AlertTitle>
                        <AlertDescription>
                            <p className="whitespace-pre-wrap break-words font-mono text-xs">
                                {step.error}
                            </p>
                        </AlertDescription>
                    </Alert>
                )}
                {step.log.trim() ? (
                    <Markdown>{step.log}</Markdown>
                ) : (
                    !running &&
                    !step.error && (
                        <p className="text-sm text-muted-foreground">{t("task.noAnswer")}</p>
                    )
                )}
                <StepFacts step={step} />
                <Children step={step} />
            </div>
        </div>
    );
}

// Checks, conditions, gates and git steps read as one line between the agents' turns.
function NodeStep({ run, step }: { run: WorkflowRun; step: Step }) {
    const nodeTitle = useNodeTitle();
    const node = nodeById(run.definition, step.node);
    return (
        <div className="space-y-2 pl-11">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                    {node ? labelOf(node) : step.node}
                </span>
                {node && <span>{nodeTitle(node.type)}</span>}
                <StepFacts step={step} />
            </div>
            {step.log.trim() && (
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {step.log}
                </p>
            )}
            {step.error && (
                <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                    {step.error}
                </p>
            )}
            <Children step={step} />
        </div>
    );
}

// The run as a conversation: the request, each agent's work and answer, and what waits for you.
export function RunChat({ run }: { run: WorkflowRun }) {
    const t = useTranslations("web");
    const trace = useTrace("run", run.id);
    const events = trace.data?.events ?? [];
    const wait = run.status === "waiting" ? run.state?.wait : null;
    // A loop visits a node again, so a visit's events are the node's within its time.
    const visit = (step: Step) =>
        events.filter(
            (event) =>
                event.node === step.node &&
                event.createdAt >= step.startedAt &&
                (!step.finishedAt || event.createdAt <= step.finishedAt),
        );
    return (
        <div>
            <div className="mb-8 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("task.chat.start")}
                <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-8">
                <UserTurn
                    text={run.input?.trim() || run.name}
                    author={run.author}
                    createdAt={run.createdAt}
                />
                {run.steps.map((step) =>
                    step.type === "agent" && step.agent ? (
                        <AgentStep
                            key={`${step.node}-${step.startedAt}`}
                            run={run}
                            step={step}
                            agent={step.agent}
                            events={visit(step)}
                        />
                    ) : (
                        <NodeStep key={`${step.node}-${step.startedAt}`} run={run} step={step} />
                    ),
                )}
                {wait && <WaitCard run={run} wait={wait} />}
                {run.error && run.error !== run.steps.at(-1)?.error && (
                    <Alert variant="destructive">
                        <AlertTitle>{t("task.error")}</AlertTitle>
                        <AlertDescription>
                            <p className="whitespace-pre-wrap break-words font-mono text-xs">
                                {run.error}
                            </p>
                        </AlertDescription>
                    </Alert>
                )}
            </div>
        </div>
    );
}
