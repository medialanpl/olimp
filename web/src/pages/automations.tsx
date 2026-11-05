import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    CalendarClockIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CopyIcon,
    EllipsisIcon,
    LayoutTemplateIcon,
    PencilIcon,
    PlayIcon,
    PlusIcon,
    SparklesIcon,
    Trash2Icon,
    WorkflowIcon,
    ZapIcon,
} from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useFormatter, useNow, useTranslations } from "use-intl";
import { AgentMark, agentLabel } from "@/components/agent-mark";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, FormError, Loading, PageHeader } from "@/components/page";
import { TableSkeleton } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { keys, useAutomations, useWorkflows } from "@/lib/queries";
import { between, lanes, scheduleOf, upcoming } from "@/lib/schedule";
import { skillOf } from "@/lib/skill-ref";
import type { Automation, Workflow } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
    type AutomationJob,
    blankDraft,
    draftOf,
    ofRepo,
    TEMPLATES,
    useAutomationJobs,
    useDescribe,
    useRunNow,
    WEEK,
    zone,
} from "@/pages/automation";

const DAY = 86_400_000;
const VIEWS = ["list", "week", "day"] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_PX = 44;
const CHIP_PX = 20;
const CHIP_MINUTES = (CHIP_PX / HOUR_PX) * 60;
// More often than hourly would bury the day in chips, so those are named above the calendar.
const FREQUENT_PER_DAY = 24;
// Tasks blue and workflow runs violet, as the "info" and "progress" badges.
const TONE = {
    task: "border-blue-500 bg-blue-500/15 text-blue-700 hover:bg-blue-500/25 dark:text-blue-300",
    workflow:
        "border-violet-500 bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:text-violet-300",
};
const DOT = { task: "bg-blue-500", workflow: "bg-violet-500" };

function Summary({ automations, jobs }: { automations: Automation[]; jobs: AutomationJob[] }) {
    const t = useTranslations("web");
    const format = useFormat();
    const describe = useDescribe();
    const now = useNow({ updateInterval: 60_000 });
    const ids = new Set(automations.map((a) => a.id));
    const week = jobs.filter(
        (job) => ids.has(job.automation) && Date.parse(job.createdAt) >= now.getTime() - 7 * DAY,
    );
    const agentTime = week.reduce((total, job) => total + (job.durationMs ?? 0), 0);
    const next = automations
        .filter((a) => a.enabled)
        .flatMap((automation) =>
            upcoming(automation.cron, now, 5).map((at) => ({ at, automation })),
        )
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .slice(0, 10);
    const first = next[0];
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
            <span className="font-medium tracking-wide uppercase">{t("automations.last7")}</span>
            <span className="tabular-nums">
                {t("automations.runsCount", { count: week.length })}
            </span>
            <span className="tabular-nums">
                {t("automations.failedCount", {
                    count: week.filter((job) => job.status === "failed").length,
                })}
            </span>
            <span className="tabular-nums">
                {t("automations.agentTime", { time: format.duration(agentTime) })}
            </span>
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!first}>
                        <CalendarClockIcon />
                        <span className="max-w-64 truncate">
                            {first
                                ? t("automations.nextUp", {
                                      when: describe.when(first.at),
                                      name: first.automation.name,
                                  })
                                : t("automations.nothingScheduled")}
                        </span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 p-0">
                    <p className="border-b px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {t("automations.nextRuns")} · {zone}
                    </p>
                    <ul className="max-h-80 overflow-y-auto p-1">
                        {next.map(({ at, automation }) => (
                            <li key={`${automation.id}-${at.getTime()}`}>
                                <Link
                                    to={automation.id}
                                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                                >
                                    <span className="w-32 shrink-0 font-mono text-xs tabular-nums">
                                        {describe.when(at)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">
                                        {automation.name}
                                    </span>
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {format.relative(at.toISOString())}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </PopoverContent>
            </Popover>
        </div>
    );
}

function RunsAs({ automation, workflow }: { automation: Automation; workflow?: Workflow }) {
    if (automation.workflow)
        return (
            <span className="inline-flex min-w-0 items-center gap-1.5">
                <WorkflowIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{workflow?.name ?? automation.workflow}</span>
            </span>
        );
    const agent = automation.agent ?? "claude";
    const skill = skillOf(automation.skill);
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            <AgentMark agent={agent} className="size-3.5 shrink-0" />
            <span className="truncate">{agentLabel(agent)}</span>
            {skill && (
                <Badge variant="secondary" className="max-w-36">
                    <SparklesIcon />
                    <span className="truncate">{skill.name}</span>
                </Badge>
            )}
        </span>
    );
}

function Row({
    automation,
    jobs,
    workflows,
}: {
    automation: Automation;
    jobs: AutomationJob[];
    workflows: Workflow[];
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const describe = useDescribe();
    const navigate = useNavigate();
    const client = useQueryClient();
    const [deleting, setDeleting] = useState(false);
    const refresh = () => client.invalidateQueries({ queryKey: keys.automations });
    const toggle = useMutation({
        mutationFn: (enabled: boolean) =>
            api(`/api/automations/${automation.id}`, { method: "PATCH", body: { enabled } }),
        onSuccess: refresh,
    });
    const remove = useMutation({
        mutationFn: () => api(`/api/automations/${automation.id}`, { method: "DELETE" }),
        onSuccess: () => {
            setDeleting(false);
            void refresh();
        },
    });
    const run = useRunNow();
    const mine = jobs.filter((job) => job.automation === automation.id);
    const last = mine[0];
    const week = mine.filter((job) => Date.parse(job.createdAt) >= Date.now() - 7 * DAY).length;
    const next = automation.nextRunAt ? new Date(automation.nextRunAt) : null;
    const custom = scheduleOf(automation.cron).preset === "custom";
    return (
        <TableRow>
            <TableCell>
                <div className="flex items-center gap-2">
                    <Switch
                        checked={automation.enabled}
                        disabled={toggle.isPending}
                        onCheckedChange={(enabled) => toggle.mutate(enabled)}
                        aria-label={t("automations.toggle", { name: automation.name })}
                    />
                    <span
                        className={cn(
                            "text-xs",
                            automation.enabled ? "text-constructive" : "text-muted-foreground",
                        )}
                    >
                        {automation.enabled ? t("automations.enabled") : t("automations.paused")}
                    </span>
                </div>
            </TableCell>
            <TableCell className="max-w-64">
                <Link
                    to={automation.id}
                    className="block truncate font-medium hover:underline"
                    title={automation.name}
                >
                    {automation.name}
                </Link>
                {automation.builtin && (
                    <Badge variant="outline" className="mt-1">
                        {t("automations.builtin.badge")}
                    </Badge>
                )}
                <FormError error={toggle.error ?? run.error} />
            </TableCell>
            <TableCell>
                <span className={cn("text-sm", custom && "font-mono")} title={automation.cron}>
                    {describe.schedule(automation.cron)}
                </span>
            </TableCell>
            <TableCell className="max-w-56">
                <RunsAs
                    automation={automation}
                    workflow={workflows.find((w) => w.id === automation.workflow)}
                />
            </TableCell>
            <TableCell>
                {next ? (
                    <div className="leading-tight">
                        <p className="font-mono text-sm font-medium tabular-nums">
                            {describe.when(next)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {format.relative(next.toISOString())}
                        </p>
                    </div>
                ) : (
                    <span className="text-muted-foreground">–</span>
                )}
            </TableCell>
            <TableCell>
                {last ? (
                    <Link to={last.href} className="inline-flex items-center gap-2 hover:underline">
                        <StatusBadge status={last.status} />
                        <span className="text-xs text-muted-foreground">
                            {format.relative(last.createdAt)}
                        </span>
                    </Link>
                ) : (
                    <span className="text-xs text-muted-foreground">
                        {automation.lastRunAt
                            ? format.relative(automation.lastRunAt)
                            : t("automations.never")}
                    </span>
                )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{week}</TableCell>
            <TableCell>
                <div className="flex justify-end gap-0.5">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("automations.runNow")}
                                disabled={run.isPending}
                                onClick={() => run.mutate(automation.id)}
                            >
                                <PlayIcon />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("automations.runNow")}</TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t("automations.more")}
                            >
                                <EllipsisIcon />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => navigate(automation.id)}>
                                <PencilIcon />
                                {t("automations.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() =>
                                    navigate("new", {
                                        state: {
                                            draft: {
                                                ...draftOf(automation, workflows),
                                                name: t("automations.copyName", {
                                                    name: automation.name,
                                                }),
                                                enabled: false,
                                            },
                                        },
                                    })
                                }
                            >
                                <CopyIcon />
                                {t("automations.duplicate")}
                            </DropdownMenuItem>
                            {!automation.builtin && (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onSelect={() => setDeleting(true)}
                                    >
                                        <Trash2Icon />
                                        {t("automations.delete")}
                                    </DropdownMenuItem>
                                </>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <Dialog open={deleting} onOpenChange={setDeleting}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>
                                {t("automations.deleteTitle", { name: automation.name })}
                            </DialogTitle>
                            <DialogDescription>
                                {t("automations.deleteDescription")}
                            </DialogDescription>
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
                                {t("automations.delete")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </TableCell>
        </TableRow>
    );
}

function List({
    automations,
    jobs,
    workflows,
}: {
    automations: Automation[];
    jobs: AutomationJob[];
    workflows: Workflow[];
}) {
    const t = useTranslations("web");
    return (
        <div className="rounded-xl border bg-card">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead>{t("automations.state")}</TableHead>
                        <TableHead>{t("automations.automation")}</TableHead>
                        <TableHead>{t("automations.schedule")}</TableHead>
                        <TableHead>{t("automations.runsAs")}</TableHead>
                        <TableHead>{t("automations.nextRun")}</TableHead>
                        <TableHead>{t("automations.lastRun")}</TableHead>
                        <TableHead className="text-right">{t("automations.runs7d")}</TableHead>
                        <TableHead>
                            <span className="sr-only">{t("automations.more")}</span>
                        </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {automations.map((automation) => (
                        <Row
                            key={automation.id}
                            automation={automation}
                            jobs={jobs}
                            workflows={workflows}
                        />
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

type CalendarView = "week" | "day";

interface Occurrence {
    automation: Automation;
    at: Date;
}

const minuteOf = (at: Date) => at.getHours() * 60 + at.getMinutes();
const addDays = (day: Date, count: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate() + count);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const kindOf = (automation: Automation) => (automation.workflow ? "workflow" : "task");

function Details({ occurrence, jobs, workflows }: Omit<EntryProps, "now">) {
    const t = useTranslations("web");
    const format = useFormat();
    const describe = useDescribe();
    const { automation, at } = occurrence;
    const last = jobs.find((job) => job.automation === automation.id);
    return (
        <div className="space-y-3 text-sm">
            <div>
                <p className="font-medium">{automation.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                    {describe.when(at)} · {format.relative(at.toISOString())}
                </p>
            </div>
            <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">{t("automations.schedule")}</dt>
                <dd>{describe.schedule(automation.cron)}</dd>
                <dt className="text-muted-foreground">{t("automations.runsAs")}</dt>
                <dd className="min-w-0">
                    <RunsAs
                        automation={automation}
                        workflow={workflows.find((w) => w.id === automation.workflow)}
                    />
                </dd>
                <dt className="text-muted-foreground">{t("automations.lastRun")}</dt>
                <dd>
                    {last ? (
                        <Link to={last.href} className="inline-flex items-center gap-2">
                            <StatusBadge status={last.status} />
                            {format.relative(last.createdAt)}
                        </Link>
                    ) : (
                        t("automations.never")
                    )}
                </dd>
            </dl>
            <Button asChild size="xs" variant="outline">
                <Link to={automation.id}>
                    <PencilIcon />
                    {t("automations.edit")}
                </Link>
            </Button>
        </div>
    );
}

interface EntryProps {
    occurrence: Occurrence;
    now: Date;
    jobs: AutomationJob[];
    workflows: Workflow[];
}

function Chip({ style, ...entry }: EntryProps & { style: React.CSSProperties }) {
    const describe = useDescribe();
    const { automation, at } = entry.occurrence;
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    aria-label={`${automation.name}, ${describe.when(at)}`}
                    className={cn(
                        "absolute flex items-center gap-1 overflow-hidden rounded-md border-l-2 px-1.5 text-left text-[0.7rem] leading-none outline-none hover:z-10 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
                        TONE[kindOf(automation)],
                        at < entry.now && "opacity-50",
                    )}
                    style={{ ...style, height: CHIP_PX }}
                >
                    <span className="shrink-0 font-mono tabular-nums opacity-70">
                        {describe.clock(at.getHours(), at.getMinutes())}
                    </span>
                    <span className="truncate font-medium">{automation.name}</span>
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
                <Details {...entry} />
            </PopoverContent>
        </Popover>
    );
}

interface GridProps {
    days: Date[];
    occurrences: Occurrence[];
    now: Date;
    jobs: AutomationJob[];
    workflows: Workflow[];
}

function WeekGrid({ days, occurrences, now, jobs, workflows }: GridProps) {
    const describe = useDescribe();
    const scroller = useRef<HTMLDivElement>(null);
    // Most automations start at night, so the week opens at its earliest run or at now.
    // biome-ignore lint/correctness/useExhaustiveDependencies: only when the view opens
    useLayoutEffect(() => {
        const first = Math.min(minuteOf(now), ...occurrences.map((o) => minuteOf(o.at)));
        scroller.current?.scrollTo({ top: Math.max(0, (first / 60 - 0.5) * HOUR_PX) });
    }, []);
    return (
        <div className="overflow-x-auto rounded-xl border bg-card">
            <div className="min-w-3xl">
                <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b">
                    <div />
                    {days.map((day) => (
                        <div
                            key={day.getTime()}
                            className="flex items-center gap-1.5 border-l px-2 py-2 text-xs"
                        >
                            <span className="font-medium text-muted-foreground uppercase">
                                {describe.weekday(day.getDay())}
                            </span>
                            <span
                                className={cn(
                                    "rounded-full px-1.5 font-medium tabular-nums",
                                    sameDay(day, now) && "bg-primary text-primary-foreground",
                                )}
                            >
                                {day.getDate()}
                            </span>
                        </div>
                    ))}
                </div>
                <div ref={scroller} className="max-h-[calc(100dvh-20rem)] min-h-96 overflow-y-auto">
                    <div
                        className="relative grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
                        style={{ height: 24 * HOUR_PX }}
                    >
                        <div className="relative">
                            {HOURS.slice(1).map((hour) => (
                                <span
                                    key={hour}
                                    className="absolute right-2 -translate-y-1/2 font-mono text-[0.7rem] text-muted-foreground tabular-nums"
                                    style={{ top: hour * HOUR_PX }}
                                >
                                    {describe.clock(hour, 0)}
                                </span>
                            ))}
                        </div>
                        {days.map((day, i) => (
                            <div
                                key={day.getTime()}
                                className={cn(
                                    "relative border-l",
                                    i > 4 && "bg-muted/25",
                                    sameDay(day, now) && "bg-muted/50",
                                )}
                            >
                                {HOURS.slice(1).map((hour) => (
                                    <span
                                        key={hour}
                                        aria-hidden
                                        className="absolute inset-x-0 h-px bg-border/60"
                                        style={{ top: hour * HOUR_PX }}
                                    />
                                ))}
                                {sameDay(day, now) && (
                                    <div
                                        aria-hidden
                                        className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                                        style={{ top: (minuteOf(now) / 60) * HOUR_PX }}
                                    >
                                        <span className="-ml-1 size-2 rounded-full bg-brand" />
                                        <span className="h-px flex-1 bg-brand" />
                                    </div>
                                )}
                                {lanes(
                                    occurrences.filter((o) => sameDay(o.at, day)),
                                    (o) => minuteOf(o.at),
                                    CHIP_MINUTES,
                                ).map(({ start, lane, count, ...occurrence }) => (
                                    <Chip
                                        key={`${occurrence.automation.id}-${occurrence.at.getTime()}`}
                                        occurrence={occurrence}
                                        now={now}
                                        jobs={jobs}
                                        workflows={workflows}
                                        style={{
                                            top: (start / 60) * HOUR_PX,
                                            left: `calc(${(lane / count) * 100}% + 2px)`,
                                            width: `calc(${100 / count}% - 4px)`,
                                        }}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function NowLine({ now }: { now: Date }) {
    const t = useTranslations("web");
    const describe = useDescribe();
    return (
        <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-brand">
            <span className="font-mono tabular-nums">
                {describe.clock(now.getHours(), now.getMinutes())}
            </span>
            <span className="h-px flex-1 bg-brand" />
            {t("automations.calendar.now")}
        </div>
    );
}

function DayAgenda({ days, occurrences, now, jobs, workflows }: GridProps) {
    const t = useTranslations("web");
    const format = useFormat();
    const describe = useDescribe();
    const today = sameDay(days[0] as Date, now);
    if (!occurrences.length)
        return (
            <EmptyState
                icon={<CalendarClockIcon />}
                title={t("automations.calendar.emptyDay")}
                description={t("automations.pausedHidden")}
            />
        );
    const nowAt = today ? occurrences.findIndex((o) => o.at >= now) : -1;
    return (
        <ol className="space-y-0.5 rounded-xl border bg-card p-2">
            {occurrences.map(({ automation, at }, i) => {
                const last = jobs.find((job) => job.automation === automation.id);
                return (
                    <li key={`${automation.id}-${at.getTime()}`}>
                        {i === nowAt && <NowLine now={now} />}
                        <div
                            className={cn(
                                "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50",
                                at < now && "opacity-60",
                            )}
                        >
                            <span className="pt-0.5 font-mono text-sm tabular-nums">
                                {describe.clock(at.getHours(), at.getMinutes())}
                            </span>
                            <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span
                                        aria-hidden
                                        className={cn(
                                            "size-2.5 rounded-sm",
                                            DOT[kindOf(automation)],
                                        )}
                                    />
                                    <Link
                                        to={automation.id}
                                        className="font-medium underline-offset-4 hover:underline"
                                    >
                                        {automation.name}
                                    </Link>
                                    <span className="text-xs text-muted-foreground">
                                        {format.relative(at.toISOString())}
                                    </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <span>{describe.schedule(automation.cron)}</span>
                                    <RunsAs
                                        automation={automation}
                                        workflow={workflows.find(
                                            (w) => w.id === automation.workflow,
                                        )}
                                    />
                                    {last && (
                                        <Link
                                            to={last.href}
                                            className="inline-flex items-center gap-1.5"
                                        >
                                            <StatusBadge status={last.status} />
                                            {format.relative(last.createdAt)}
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </div>
                    </li>
                );
            })}
            {nowAt < 0 && today && <NowLine now={now} />}
        </ol>
    );
}

// The enabled automations of a week or a day, from the browser's clock like the list's next runs.
function Calendar({
    view,
    automations,
    jobs,
    workflows,
}: {
    view: CalendarView;
    automations: Automation[];
    jobs: AutomationJob[];
    workflows: Workflow[];
}) {
    const t = useTranslations("web");
    const format = useFormatter();
    const now = useNow({ updateInterval: 30_000 });
    const [offset, setOffset] = useState(0);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const first =
        view === "week"
            ? addDays(today, offset * 7 - WEEK.indexOf(today.getDay()))
            : addDays(today, offset);
    const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDays(first, i));
    const from = first.getTime();
    const { occurrences, frequent } = useMemo(() => {
        const start = new Date(from);
        const end = addDays(start, days.length);
        const found: Occurrence[] = [];
        const often: Automation[] = [];
        for (const automation of automations.filter((a) => a.enabled)) {
            const times = between(automation.cron, start, end);
            if (times.length > FREQUENT_PER_DAY * days.length) often.push(automation);
            else for (const at of times) found.push({ automation, at });
        }
        found.sort((a, b) => a.at.getTime() - b.at.getTime());
        return { occurrences: found, frequent: often };
    }, [automations, from, days.length]);
    const last = days[days.length - 1] as Date;
    const label =
        view === "week"
            ? format.dateTimeRange(first, last, { day: "numeric", month: "short", year: "numeric" })
            : format.dateTime(first, { weekday: "long", day: "numeric", month: "long" });
    const grid = { days, occurrences, now, jobs, workflows };
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                    <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={t(`automations.calendar.previous.${view}`)}
                        onClick={() => setOffset((o) => o - 1)}
                    >
                        <ChevronLeftIcon />
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={offset === 0}
                        onClick={() => setOffset(0)}
                    >
                        {t("automations.calendar.today")}
                    </Button>
                    <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label={t(`automations.calendar.next.${view}`)}
                        onClick={() => setOffset((o) => o + 1)}
                    >
                        <ChevronRightIcon />
                    </Button>
                </div>
                <h2 className="text-sm font-semibold first-letter:uppercase tabular-nums">
                    {label}
                </h2>
                <p className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={cn("size-2.5 rounded-sm", DOT.task)} />
                        {t("automations.legendTasks")}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={cn("size-2.5 rounded-sm", DOT.workflow)} />
                        {t("automations.legendWorkflows")}
                    </span>
                </p>
            </div>
            {frequent.length > 0 && (
                <Alert variant="info" role="note">
                    <CalendarClockIcon />
                    <AlertDescription>
                        <p>
                            {t("automations.calendar.frequent")}{" "}
                            {frequent.map((automation, i) => (
                                <Fragment key={automation.id}>
                                    {i > 0 && ", "}
                                    <Link
                                        to={automation.id}
                                        className="font-medium underline-offset-4 hover:underline"
                                    >
                                        {automation.name}
                                    </Link>
                                </Fragment>
                            ))}
                        </p>
                    </AlertDescription>
                </Alert>
            )}
            {view === "week" ? <WeekGrid {...grid} /> : <DayAgenda {...grid} />}
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{t("automations.pausedHidden")}</span>
                <span>{zone}</span>
            </p>
        </div>
    );
}

export function AutomationsPage() {
    const t = useTranslations("web");
    const { id = "" } = useParams();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const view = VIEWS.find((name) => name === params.get("view")) ?? "list";
    const automations = useAutomations();
    const workflows = useWorkflows();
    const jobs = useAutomationJobs();
    const failed = [automations, workflows].find((query) => query.isError);
    const flows = workflows.data ?? [];
    const own = automations.data?.filter((a) => ofRepo(a, id, flows));
    return (
        <>
            <PageHeader
                title={t("automations.title")}
                description={t("automations.description", { repo: id })}
                actions={
                    <Button asChild>
                        <Link to="new">
                            <PlusIcon />
                            {t("automations.new")}
                        </Link>
                    </Button>
                }
            />
            {failed ? (
                <ErrorState error={failed.error} onRetry={() => failed.refetch()} />
            ) : !own || !workflows.data ? (
                <Loading>
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <Skeleton className="h-9 w-40 rounded-4xl" />
                        <Skeleton className="h-4 w-48" />
                    </div>
                    <TableSkeleton columns={8} toolbar={false} className="rounded-xl bg-card" />
                </Loading>
            ) : !own.length ? (
                <EmptyState
                    icon={<ZapIcon />}
                    title={t("automations.emptyTitle")}
                    description={t("automations.empty")}
                >
                    <div className="flex flex-wrap justify-center gap-2">
                        {TEMPLATES.slice(0, 3).map(({ id: template, cron }) => (
                            <Button
                                key={template}
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    navigate("new", {
                                        state: {
                                            draft: {
                                                ...blankDraft(),
                                                name: t(`automations.templates.${template}.name`),
                                                schedule: scheduleOf(cron),
                                                body: t(`automations.templates.${template}.prompt`),
                                            },
                                        },
                                    })
                                }
                            >
                                <LayoutTemplateIcon />
                                {t(`automations.templates.${template}.name`)}
                            </Button>
                        ))}
                    </div>
                </EmptyState>
            ) : (
                <>
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <Tabs
                            value={view}
                            onValueChange={(next) =>
                                setParams(next === "list" ? {} : { view: next }, { replace: true })
                            }
                        >
                            <TabsList>
                                {VIEWS.map((name) => (
                                    <TabsTrigger key={name} value={name}>
                                        {t(`automations.views.${name}`)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                        <Summary automations={own} jobs={jobs} />
                    </div>
                    {view === "list" ? (
                        <List automations={own} jobs={jobs} workflows={workflows.data} />
                    ) : (
                        <Calendar
                            key={view}
                            view={view}
                            automations={own}
                            jobs={jobs}
                            workflows={workflows.data}
                        />
                    )}
                </>
            )}
        </>
    );
}
