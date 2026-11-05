import {
    ActivityIcon,
    AlertCircleIcon,
    ChevronRightIcon,
    CornerDownRightIcon,
    FlagIcon,
    InfoIcon,
    MessageSquareIcon,
    SendIcon,
    TerminalIcon,
    WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { CopyButton } from "@/components/copy-button";
import { EditDiff } from "@/components/diff";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/lib/format";
import { type JobKind, useTrace } from "@/lib/queries";
import type { AgentEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS = {
    prompt: SendIcon,
    command: TerminalIcon,
    session: InfoIcon,
    text: MessageSquareIcon,
    tool: WrenchIcon,
    output: CornerDownRightIcon,
    result: FlagIcon,
    error: AlertCircleIcon,
} as const;

const EDITS = ["Edit", "MultiEdit", "Write"];

// A tool event's summary is "Tool: input"; the tool name is shown apart.
function toolParts(summary: string): [string, string] {
    const at = summary.indexOf(": ");
    return at > 0 && at < 60 ? [summary.slice(0, at), summary.slice(at + 2)] : [summary, ""];
}

// Claude's result splits the input: fresh tokens, cache writes and cache reads.
function Tokens({ detail }: { detail: string }) {
    const t = useTranslations("web");
    const format = useFormat();
    let usage: Record<string, unknown> = {};
    try {
        usage = JSON.parse(detail).usage ?? {};
    } catch {}
    const parts = [
        ["trace.fresh", usage.input_tokens],
        ["trace.cacheWrite", usage.cache_creation_input_tokens],
        ["trace.cacheRead", usage.cache_read_input_tokens],
        ["trace.outputTokens", usage.output_tokens],
    ] as const;
    if (parts.every(([, value]) => typeof value !== "number")) return null;
    return (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {parts.map(([key, value]) => (
                <div key={key} className="flex gap-1.5">
                    <dt className="text-muted-foreground">{t(key)}</dt>
                    <dd className="font-medium tabular-nums">
                        {format.count(typeof value === "number" ? value : null)}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

function Detail({ event, tool }: { event: AgentEvent; tool: string }) {
    const t = useTranslations("web");
    const detail = event.detail ?? "";
    if (event.type === "tool" && EDITS.includes(tool)) return <EditDiff detail={detail} />;
    return (
        <div className="relative rounded-lg border bg-muted/40">
            <div className="absolute top-1 right-1">
                <CopyButton value={detail} label={t("trace.copy")} />
            </div>
            <pre className="max-h-[70vh] overflow-auto px-3 py-2 pr-10 font-mono text-xs whitespace-pre-wrap break-words scroll-fade">
                {detail}
            </pre>
        </div>
    );
}

function Event({ event }: { event: AgentEvent }) {
    const t = useTranslations("web");
    const format = useFormat();
    // What OLIMP sent is what one opens the trace for.
    const [open, setOpen] = useState(event.type === "prompt");
    const Icon = ICONS[event.type] ?? ActivityIcon;
    const [tool, input] = event.type === "tool" ? toolParts(event.summary) : ["", event.summary];
    const label = event.type === "tool" ? tool : t(`trace.${event.type}`);
    return (
        <li className="relative flex gap-3 pb-4 pl-1 last:pb-0">
            <span
                className={cn(
                    "z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-card",
                    event.type === "error" && "border-destructive/40 text-destructive",
                    event.type === "result" && "border-constructive/40 text-constructive",
                    event.type === "prompt" && "border-brand/40 text-brand",
                )}
            >
                <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{label}</span>
                    <time dateTime={event.createdAt}>{format.time(event.createdAt)}</time>
                    {event.detail && (
                        <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpen(!open)}
                            className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                            {t(open ? "trace.hide" : "trace.showAll", {
                                count: event.detail.length,
                            })}
                            <ChevronRightIcon
                                className={cn("size-3.5 transition-transform", open && "rotate-90")}
                            />
                        </button>
                    )}
                </div>
                {!open && input && (
                    <p
                        className={cn(
                            "text-sm break-words whitespace-pre-wrap",
                            ["tool", "command", "output", "session"].includes(event.type) &&
                                "font-mono text-xs text-muted-foreground",
                        )}
                    >
                        {input}
                    </p>
                )}
                {event.type === "result" && event.detail && <Tokens detail={event.detail} />}
                {open && event.detail && <Detail event={event} tool={tool} />}
            </div>
        </li>
    );
}

function EventList({ events }: { events: AgentEvent[] }) {
    return (
        <ol className="relative before:absolute before:top-2 before:bottom-2 before:left-[16px] before:w-px before:bg-border">
            {events.map((event) => (
                <Event key={event.seq} event={event} />
            ))}
        </ol>
    );
}

function TraceSkeleton() {
    return (
        <div className="relative before:absolute before:top-2 before:bottom-2 before:left-[16px] before:w-px before:bg-border">
            {times(5).map((event) => (
                <div key={event} className="relative flex gap-3 pb-4 pl-1 last:pb-0">
                    <Skeleton className="z-10 mt-0.5 size-6 shrink-0 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-3/4" />
                    </div>
                </div>
            ))}
        </div>
    );
}

// The agent's events in order; a run's are grouped by step.
export function TraceView({ kind, id }: { kind: JobKind; id: string }) {
    const t = useTranslations("web");
    const trace = useTrace(kind, id);
    if (trace.isPending)
        return (
            <Loading>
                <TraceSkeleton />
            </Loading>
        );
    if (trace.isError) return <ErrorState error={trace.error} onRetry={() => trace.refetch()} />;
    const { events } = trace.data;
    if (!events.length)
        return (
            <EmptyState
                icon={<ActivityIcon />}
                title={t("trace.emptyTitle")}
                description={t("trace.empty")}
            />
        );
    if (kind === "task") return <EventList events={events} />;
    const steps = new Map<string, AgentEvent[]>();
    for (const event of events) {
        const node = event.node ?? "";
        steps.set(node, [...(steps.get(node) ?? []), event]);
    }
    return (
        <div className="space-y-6">
            {[...steps].map(([node, list]) => (
                <section key={node} className="space-y-3">
                    <Badge variant="outline" className="font-mono">
                        {t("trace.step", { node })}
                    </Badge>
                    <EventList events={list} />
                </section>
            ))}
        </div>
    );
}
