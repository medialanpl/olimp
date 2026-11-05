import {
    ArrowUpRightIcon,
    BellIcon,
    BotIcon,
    CheckCircle2Icon,
    CheckIcon,
    ChevronRightIcon,
    CircleIcon,
    FolderGit2Icon,
    InboxIcon,
    ListChecksIcon,
    LoaderIcon,
    XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { AddRepoMenu } from "@/components/add-repo";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, Loading, PageHeader, Stat } from "@/components/page";
import { SkeletonText, StatSkeleton, TableSkeleton, times } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { freshInput, InputTokens } from "@/components/usage";
import { useFormat } from "@/lib/format";
import { NEW_TASK } from "@/lib/nav";
import {
    useAgents,
    useAutomations,
    useCosts,
    useGithubStatus,
    useReads,
    useRepos,
    useRuns,
    useTasks,
    useWorkflows,
} from "@/lib/queries";
import { FINISHED, needsYou as jobNeedsYou, threadsOf, unreadOf } from "@/lib/reads";
import type { Automation, CostRow, RunStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const VIEWS = ["overview", "usage", "automations"] as const;
type View = (typeof VIEWS)[number];
const PERIODS = [7, 30];
const DAY = 86_400_000;
const ACTIVE: RunStatus[] = ["queued", "running", "waiting"];
const right = "text-right tabular-nums";

// A task or a workflow run, as the dashboard counts them.
interface Job {
    id: string;
    href: string;
    title: string;
    repo: string;
    status: RunStatus;
    automation: string | null;
    prUrl: string | null;
    issue: number | null;
    linesAdded: number | null;
    linesDeleted: number | null;
    error: string | null;
    costUsd: number | null;
    createdAt: string;
    updatedAt: string;
    unread: boolean;
}

// shortcut: counts only the latest 100 tasks and 100 runs the API lists, add a server summary when a period holds more.
function useJobs() {
    const tasks = useTasks();
    const runs = useRuns();
    const reads = useReads();
    const failed = [tasks, runs, reads].find((query) => query.isError);
    if (failed || !tasks.data || !runs.data || !reads.data) return { failed, jobs: undefined };
    const unread = unreadOf(reads.data);
    const jobs: Job[] = [
        ...threadsOf(tasks.data)
            .filter((task) => !task.archivedAt)
            .map((task) => ({
                ...task,
                href: `/tasks/${task.id}`,
                unread: unread({ id: task.last, status: task.status }),
            })),
        ...runs.data.map((run) => ({
            ...run,
            href: `/tasks/${run.id}`,
            title: run.name,
            issue: null,
            linesAdded: null,
            linesDeleted: null,
            unread: unread(run),
        })),
    ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { failed, jobs };
}

const cycleOf = (job: Job) => Date.parse(job.updatedAt) - Date.parse(job.createdAt);

function median(values: number[]) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? (sorted[middle] as number)
        : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

// Without `to` it only looks like a link, inside a tile that is one.
function More({ to, children }: { to?: string; children: ReactNode }) {
    const look =
        "group/more inline-flex items-center gap-1 font-medium text-foreground/75 transition-colors hover:text-foreground group-hover/stat:text-foreground";
    const body = (
        <>
            {children}
            <ChevronRightIcon className="size-3.5 transition-transform group-hover/more:translate-x-0.5 group-hover/stat:translate-x-0.5" />
        </>
    );
    return to ? (
        <Link to={to} className={look}>
            {body}
        </Link>
    ) : (
        <span className={look}>{body}</span>
    );
}

function Section({
    title,
    action,
    children,
    className,
}: {
    title: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <Card className={className}>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                {action && <CardAction>{action}</CardAction>}
            </CardHeader>
            <CardContent className="space-y-3">{children}</CardContent>
        </Card>
    );
}

function SectionSkeleton({ children }: { children: ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">{children}</CardContent>
        </Card>
    );
}

// A ranked row with its bar, as in the top projects and the failure reasons.
function BarRowSkeleton() {
    return (
        <div className="space-y-1">
            <div className="flex gap-2">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="h-1" />
        </div>
    );
}

const SECTION_TABLE = "rounded-none border-0";

function OverviewSkeleton() {
    return (
        <Loading className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {times(4).map((stat) => (
                    <StatSkeleton key={stat} hint />
                ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                <SectionSkeleton>
                    <SkeletonText lines={2} />
                </SectionSkeleton>
                <SectionSkeleton>
                    {times(3).map((row) => (
                        <BarRowSkeleton key={row} />
                    ))}
                </SectionSkeleton>
                <SectionSkeleton>
                    <SkeletonText lines={2} />
                </SectionSkeleton>
                <SectionSkeleton>
                    <SkeletonText lines={3} />
                </SectionSkeleton>
            </div>
            <SectionSkeleton>
                <TableSkeleton columns={6} rows={4} toolbar={false} className={SECTION_TABLE} />
            </SectionSkeleton>
        </Loading>
    );
}

function UsageSkeleton() {
    return (
        <Loading className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {times(3).map((stat) => (
                    <StatSkeleton key={stat} hint={stat === 0} />
                ))}
            </div>
            <SectionSkeleton>
                {times(5).map((row) => (
                    <BarRowSkeleton key={row} />
                ))}
            </SectionSkeleton>
            <SectionSkeleton>
                <div className="grid gap-3 md:grid-cols-3">
                    {times(3).map((trend) => (
                        <div key={trend} className="space-y-2 rounded-lg border p-3">
                            <Skeleton className="h-3 w-16" />
                            <Skeleton className="h-20 rounded-sm" />
                            <div className="flex justify-between">
                                <Skeleton className="h-3 w-8" />
                                <Skeleton className="h-3 w-8" />
                            </div>
                        </div>
                    ))}
                </div>
            </SectionSkeleton>
            <SectionSkeleton>
                <TableSkeleton columns={5} rows={3} toolbar={false} className={SECTION_TABLE} />
            </SectionSkeleton>
        </Loading>
    );
}

// A share of the largest value, as a thin bar under a row.
function Bar({ value, max, className }: { value: number; max: number; className?: string }) {
    return (
        <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
                className={cn("h-full rounded-full bg-brand", className)}
                style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }}
            />
        </div>
    );
}

function Muted({ children }: { children: ReactNode }) {
    return <p className="text-sm text-muted-foreground">{children}</p>;
}

// A section with nothing to show: good news gets a green check, plain absence an empty tray.
function Nothing({ good = false, children }: { good?: boolean; children: ReactNode }) {
    const Icon = good ? CheckCircle2Icon : InboxIcon;
    return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className={cn("size-4 shrink-0", good && "text-constructive")} />
            {children}
        </p>
    );
}

function PeriodSelect({ days, onChange }: { days: number; onChange: (days: number) => void }) {
    const t = useTranslations("web");
    return (
        <Select value={String(days)} onValueChange={(value) => onChange(Number(value))}>
            <SelectTrigger size="sm" className="w-36" aria-label={t("costs.period")}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {PERIODS.map((period) => (
                    <SelectItem key={period} value={String(period)}>
                        {t("costs.lastDays", { days: period })}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function JobLine({ job }: { job: Job }) {
    const format = useFormat();
    return (
        <li className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
                <Link
                    to={job.href}
                    className={cn("block truncate hover:underline", job.unread && "font-semibold")}
                >
                    {job.title}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                    {job.repo} · {format.relative(job.updatedAt)}
                </p>
            </div>
            {job.prUrl && (
                <a href={job.prUrl} target="_blank" rel="noreferrer">
                    <Badge variant="info">
                        #{job.prUrl.split("/").pop()}
                        <ArrowUpRightIcon />
                    </Badge>
                </a>
            )}
            <StatusBadge status={job.status} />
        </li>
    );
}

function Overview({ jobs, days }: { jobs: Job[]; days: number }) {
    const t = useTranslations("web");
    const format = useFormat();
    const automations = useAutomations();
    const repos = useRepos();
    const since = Date.now() - days * DAY;
    const inPeriod = jobs.filter((job) => Date.parse(job.updatedAt) >= since);
    const done = inPeriod.filter((job) => job.status === "done");
    const failed = inPeriod.filter((job) => job.status === "failed");
    const running = jobs.filter((job) => job.status === "running");
    const queued = jobs.filter((job) => job.status === "queued");
    const needsYou = jobs.filter(jobNeedsYou);
    const period = t("costs.lastDays", { days });

    const reasons = new Map<string, Job[]>();
    for (const job of failed) {
        const reason = job.error?.trim().split("\n")[0] || t("dashboard.noError");
        reasons.set(reason, [...(reasons.get(reason) ?? []), job]);
    }
    const why = [...reasons].sort((a, b) => b[1].length - a[1].length).slice(0, 5);

    const projects = [...new Set(jobs.map((job) => job.repo))]
        .map((repo) => {
            const of = (list: Job[]) => list.filter((job) => job.repo === repo);
            return {
                repo,
                needsYou: of(needsYou).length,
                running: of(jobs.filter((job) => ACTIVE.includes(job.status))).length,
                done: of(done).length,
                failed: of(failed).length,
                cycle: median(of(done).map(cycleOf)),
            };
        })
        .sort((a, b) => b.needsYou - a.needsYou || b.running - a.running || b.done - a.done);

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                    label={t("dashboard.needsYou")}
                    icon={<BellIcon />}
                    tone="bg-warning/10 text-warning"
                    value={format.count(needsYou.length)}
                    hint={t("dashboard.needsYouHint")}
                    to="/tasks?view=needs-you"
                    action={<More>{t("dashboard.viewTasks")}</More>}
                />
                <Stat
                    label={t("dashboard.working")}
                    icon={<LoaderIcon />}
                    tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
                    value={format.count(running.length)}
                    hint={t("dashboard.now")}
                    to="/tasks?status=running"
                    action={<More>{t("dashboard.viewTasks")}</More>}
                />
                <Stat
                    label={t("dashboard.done")}
                    icon={<CheckIcon />}
                    tone="bg-constructive/10 text-constructive"
                    value={format.count(done.length)}
                    hint={period}
                    to="/tasks?status=done"
                    action={<More>{t("dashboard.viewTasks")}</More>}
                />
                <Stat
                    label={t("dashboard.failed")}
                    icon={<XIcon />}
                    tone="bg-destructive/10 text-destructive"
                    value={format.count(failed.length)}
                    hint={period}
                    to="/tasks?status=failed"
                    action={<More>{t("dashboard.viewTasks")}</More>}
                />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
                <Section title={t("dashboard.delivered")}>
                    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <Figure label={t("dashboard.prs")}>
                            {format.count(done.filter((job) => job.prUrl).length)}
                        </Figure>
                        <Figure label={t("fields.lines")}>
                            <span className="text-constructive">
                                +{format.count(sum(done, "linesAdded"))}
                            </span>{" "}
                            <span className="text-destructive">
                                −{format.count(sum(done, "linesDeleted"))}
                            </span>
                        </Figure>
                        <Figure label={t("dashboard.issues")}>
                            {format.count(done.filter((job) => job.issue).length)}
                        </Figure>
                        <Figure label={t("dashboard.cycle")}>
                            {format.duration(median(done.map(cycleOf)))}
                        </Figure>
                    </dl>
                    <Muted>{t("dashboard.deliveredHint", { count: done.length })}</Muted>
                </Section>
                <Section
                    title={t("dashboard.whyFailed")}
                    action={<Muted>{format.count(failed.length)}</Muted>}
                >
                    {!why.length && <Nothing good>{t("dashboard.noFailures")}</Nothing>}
                    {why.map(([reason, list]) => {
                        const latest = list[0] as Job;
                        return (
                            <div key={reason} className="space-y-1">
                                <div className="flex items-baseline gap-2">
                                    <p className="min-w-0 flex-1 truncate font-medium">{reason}</p>
                                    <span className="tabular-nums">{list.length}</span>
                                </div>
                                <Bar
                                    value={list.length}
                                    max={failed.length}
                                    className="bg-destructive"
                                />
                                <p className="truncate text-xs text-muted-foreground">
                                    {t("dashboard.latest")}{" "}
                                    <Link
                                        to={latest.href}
                                        className="text-foreground hover:underline"
                                    >
                                        {latest.title}
                                    </Link>{" "}
                                    · {latest.repo} · {format.relative(latest.updatedAt)}
                                </p>
                            </div>
                        );
                    })}
                </Section>
                <Section title={t("dashboard.queue")}>
                    <dl className="grid grid-cols-2 gap-4">
                        <Figure label={t("status.queued")}>{format.count(queued.length)}</Figure>
                        <Figure label={t("dashboard.scheduled")}>
                            {format.count(automations.data?.filter((a) => a.enabled).length)}
                        </Figure>
                    </dl>
                </Section>
                <Section
                    title={t("dashboard.needsYou")}
                    action={<Muted>{format.count(needsYou.length)}</Muted>}
                >
                    {needsYou.length ? (
                        <ul className="divide-y">
                            {needsYou.slice(0, 5).map((job) => (
                                <JobLine key={job.id} job={job} />
                            ))}
                        </ul>
                    ) : (
                        <Nothing good>{t("dashboard.caughtUp")}</Nothing>
                    )}
                </Section>
            </div>
            <Section title={t("dashboard.projects")}>
                {!projects.length ? (
                    repos.data && !repos.data.length ? (
                        <EmptyState
                            icon={<FolderGit2Icon />}
                            title={t("repos.emptyTitle")}
                            description={t("repos.empty")}
                        >
                            <AddRepoMenu />
                        </EmptyState>
                    ) : (
                        <EmptyState
                            icon={<ListChecksIcon />}
                            title={t("tasks.emptyTitle")}
                            description={t("tasks.empty")}
                        >
                            <Button asChild>
                                <Link to={NEW_TASK}>{t("nav.newTask")}</Link>
                            </Button>
                        </EmptyState>
                    )
                ) : (
                    <>
                        <Muted>{t("dashboard.projectsHint")}</Muted>
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    <TableHead>{t("fields.project")}</TableHead>
                                    <TableHead className={right}>
                                        {t("dashboard.needsYou")}
                                    </TableHead>
                                    <TableHead className={right}>
                                        {t("dashboard.working")}
                                    </TableHead>
                                    <TableHead className={right}>{t("dashboard.done")}</TableHead>
                                    <TableHead className={right}>{t("dashboard.failed")}</TableHead>
                                    <TableHead className={right}>{t("dashboard.cycle")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {projects.map((project) => (
                                    <TableRow key={project.repo}>
                                        <TableCell className="font-medium">
                                            <Link
                                                to={`/project/${project.repo}`}
                                                className="hover:underline"
                                            >
                                                {project.repo}
                                            </Link>
                                        </TableCell>
                                        <TableCell className={right}>{project.needsYou}</TableCell>
                                        <TableCell className={right}>{project.running}</TableCell>
                                        <TableCell className={right}>{project.done}</TableCell>
                                        <TableCell className={right}>{project.failed}</TableCell>
                                        <TableCell className={right}>
                                            {format.duration(project.cycle)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </>
                )}
            </Section>
            <Section title={t("dashboard.recent")} action={<Muted>{period}</Muted>}>
                {inPeriod.some((job) => FINISHED.includes(job.status)) ? (
                    <ul className="divide-y">
                        {inPeriod
                            .filter((job) => FINISHED.includes(job.status))
                            .slice(0, 8)
                            .map((job) => (
                                <JobLine key={job.id} job={job} />
                            ))}
                    </ul>
                ) : (
                    <Nothing>{t("dashboard.noResults")}</Nothing>
                )}
            </Section>
        </div>
    );
}

function Figure({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{children}</dd>
        </div>
    );
}

const sum = (jobs: Job[], key: "linesAdded" | "linesDeleted") =>
    jobs.reduce((total, job) => total + (job[key] ?? 0), 0);

// Daily bars, with the days that had no work filled in.
function Trend({
    title,
    rows,
    days,
    value,
    show,
    className,
}: {
    title: string;
    rows: CostRow[];
    days: number;
    value: (row: CostRow) => number;
    show: (value: number) => string;
    className: string;
}) {
    const byDay = new Map(rows.map((row) => [row.key, value(row)]));
    const bars = Array.from({ length: days }, (_, index) => {
        const day = new Date(Date.now() - (days - 1 - index) * DAY).toISOString().slice(0, 10);
        return { day, value: byDay.get(day) ?? 0 };
    });
    const max = Math.max(...bars.map((bar) => bar.value));
    return (
        <div className="space-y-2 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground">{title}</p>
            <div className="flex h-20 items-end gap-0.5">
                {bars.map((bar) => (
                    <div
                        key={bar.day}
                        title={`${bar.day}: ${show(bar.value)}`}
                        className={cn("flex-1 rounded-sm", className)}
                        style={{ height: max ? `${(bar.value / max) * 100}%` : 0 }}
                    />
                ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{bars[0]?.day.slice(5)}</span>
                <span>{bars.at(-1)?.day.slice(5)}</span>
            </div>
        </div>
    );
}

function Usage({ days }: { days: number }) {
    const t = useTranslations("web");
    const format = useFormat();
    const repos = useCosts("repo", days);
    const daily = useCosts("day", days);
    const agents = useCosts("agent", days);
    const failed = [repos, daily, agents].find((query) => query.isError);
    if (failed) return <ErrorState error={failed.error} onRetry={() => failed.refetch()} />;
    if (!repos.data || !daily.data || !agents.data) return <UsageSkeleton />;
    const total = repos.data.total;
    const reported = t("dashboard.reported", {
        priced: total.jobs - total.unpriced,
        jobs: total.jobs,
    });
    const top = [...repos.data.groups].sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0));
    const topCost = top[0]?.costUsd ?? 0;

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat
                    label={t("fields.cost")}
                    value={format.cost(total.costUsd ?? 0)}
                    hint={reported}
                />
                <Stat
                    label={t("fields.inputTokens")}
                    value={
                        <InputTokens usage={total}>
                            {format.count(freshInput(total) ?? 0)}
                        </InputTokens>
                    }
                />
                <Stat
                    label={t("fields.outputTokens")}
                    value={format.count(total.outputTokens ?? 0)}
                />
            </div>
            <Section
                title={t("dashboard.topProjects")}
                action={<More to={`/costs?by=repo&days=${days}`}>{t("dashboard.viewCosts")}</More>}
            >
                {!top.length && <Nothing>{t("costs.empty")}</Nothing>}
                {top.slice(0, 8).map((row, index) => (
                    <div key={row.key ?? ""} className="space-y-1">
                        <div className="flex items-baseline gap-2">
                            <span className="w-5 text-muted-foreground tabular-nums">
                                {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium">{row.key}</span>
                            <span className="tabular-nums">{format.cost(row.costUsd ?? 0)}</span>
                        </div>
                        <Bar value={row.costUsd ?? 0} max={topCost} />
                    </div>
                ))}
            </Section>
            <Section title={t("dashboard.trends")}>
                <div className="grid gap-3 md:grid-cols-3">
                    <Trend
                        title={t("fields.cost")}
                        rows={daily.data.groups}
                        days={days}
                        value={(row) => row.costUsd ?? 0}
                        show={format.cost}
                        className="bg-brand"
                    />
                    <Trend
                        title={t("dashboard.tokens")}
                        rows={daily.data.groups}
                        days={days}
                        value={(row) => (freshInput(row) ?? 0) + (row.outputTokens ?? 0)}
                        show={format.count}
                        className="bg-info"
                    />
                    <Trend
                        title={t("costs.jobs")}
                        rows={daily.data.groups}
                        days={days}
                        value={(row) => row.jobs}
                        show={format.count}
                        className="bg-constructive"
                    />
                </div>
            </Section>
            <Section title={t("dashboard.agents")}>
                {!agents.data.groups.length ? (
                    <EmptyState
                        icon={<BotIcon />}
                        title={t("costs.emptyTitle")}
                        description={t("costs.empty")}
                    />
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead>{t("fields.agent")}</TableHead>
                                <TableHead className={right}>{t("costs.jobs")}</TableHead>
                                <TableHead className={right}>{t("fields.duration")}</TableHead>
                                <TableHead className={right}>{t("fields.cost")}</TableHead>
                                <TableHead className={right}>{t("dashboard.perJob")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {agents.data.groups.map((row) => {
                                const priced = row.jobs - row.unpriced;
                                return (
                                    <TableRow key={row.key ?? ""}>
                                        <TableCell className="font-medium">
                                            {row.key ?? "–"}
                                        </TableCell>
                                        <TableCell className={right}>
                                            {format.count(row.jobs)}
                                        </TableCell>
                                        <TableCell className={right}>
                                            {format.duration(row.durationMs)}
                                        </TableCell>
                                        <TableCell className={right}>
                                            {format.cost(priced ? row.costUsd : null)}
                                        </TableCell>
                                        <TableCell className={right}>
                                            {format.cost(
                                                priced ? (row.costUsd ?? 0) / priced : null,
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </Section>
        </div>
    );
}

function Automations({ jobs, days }: { jobs: Job[]; days: number }) {
    const t = useTranslations("web");
    const format = useFormat();
    const automations = useAutomations();
    const workflows = useWorkflows();
    if (automations.isError)
        return <ErrorState error={automations.error} onRetry={() => automations.refetch()} />;
    if (!automations.data)
        return (
            <Loading>
                <SectionSkeleton>
                    <SkeletonText lines={1} />
                    <TableSkeleton columns={8} rows={4} toolbar={false} className={SECTION_TABLE} />
                </SectionSkeleton>
            </Loading>
        );
    // A workflow automation's project is its workflow's.
    const projectOf = (a: Automation) =>
        a.repo ?? workflows.data?.find((w) => w.id === a.workflow)?.repo ?? a.workflow;
    const since = Date.now() - days * DAY;
    const started = jobs.filter((job) => job.automation && Date.parse(job.createdAt) >= since);
    const rowOf = (automation: Automation) => {
        const of = started.filter((job) => job.automation === automation.id);
        const count = (statuses: RunStatus[]) =>
            of.filter((job) => statuses.includes(job.status)).length;
        const priced = of.filter((job) => job.costUsd !== null);
        return {
            automation,
            jobs: of.length,
            done: count(["done"]),
            failed: count(["failed"]),
            active: count(ACTIVE),
            cost: priced.length
                ? priced.reduce((total, job) => total + (job.costUsd ?? 0), 0)
                : null,
        };
    };

    return (
        <Section
            title={t("dashboard.outcomes")}
            action={
                <Muted>
                    {t("dashboard.enabledCount", {
                        count: automations.data.filter((a) => a.enabled).length,
                    })}
                </Muted>
            }
        >
            <Muted>{t("dashboard.outcomesHint")}</Muted>
            {!automations.data.length ? (
                <Nothing>{t("dashboard.noAutomations")}</Nothing>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent">
                            <TableHead>{t("dashboard.automation")}</TableHead>
                            <TableHead className={right}>{t("costs.jobs")}</TableHead>
                            <TableHead className={right}>{t("dashboard.done")}</TableHead>
                            <TableHead className={right}>{t("dashboard.failed")}</TableHead>
                            <TableHead className={right}>{t("dashboard.active")}</TableHead>
                            <TableHead className={right}>{t("dashboard.lastRun")}</TableHead>
                            <TableHead className={right}>{t("dashboard.nextRun")}</TableHead>
                            <TableHead className={right}>{t("fields.cost")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {automations.data.map(rowOf).map((row) => (
                            <TableRow key={row.automation.id}>
                                <TableCell>
                                    <Link
                                        to={`/project/${projectOf(row.automation)}/automations/${row.automation.id}`}
                                        className="font-medium hover:underline"
                                    >
                                        {row.automation.name}
                                    </Link>
                                    <p className="text-xs text-muted-foreground">
                                        {projectOf(row.automation)} ·{" "}
                                        <code>{row.automation.cron}</code> ·{" "}
                                        {row.automation.enabled
                                            ? t("dashboard.on")
                                            : t("dashboard.off")}
                                    </p>
                                </TableCell>
                                <TableCell className={right}>{row.jobs}</TableCell>
                                <TableCell className={right}>{row.done}</TableCell>
                                <TableCell className={right}>{row.failed}</TableCell>
                                <TableCell className={right}>{row.active}</TableCell>
                                <TableCell className={right}>
                                    {row.automation.lastRunAt
                                        ? format.relative(row.automation.lastRunAt)
                                        : "–"}
                                </TableCell>
                                <TableCell className={right}>
                                    {row.automation.nextRunAt
                                        ? format.relative(row.automation.nextRunAt)
                                        : "–"}
                                </TableCell>
                                <TableCell className={right}>{format.cost(row.cost)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </Section>
    );
}

function SetupStep({
    done,
    title,
    detail,
    children,
}: {
    done: boolean;
    title: string;
    detail?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            {done ? (
                <CheckCircle2Icon className="size-5 shrink-0 text-emerald-600" />
            ) : (
                <CircleIcon className="size-5 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{title}</p>
                {detail && <div className="text-muted-foreground text-sm">{detail}</div>}
            </div>
            {!done && children}
        </li>
    );
}

// Shown until an agent is signed in and a project exists; GitHub is optional.
function GettingStarted() {
    const t = useTranslations("web");
    const agents = useAgents();
    const repos = useRepos();
    // A login OLIMP cannot check (null) counts as signed in.
    const signedIn = (agents.data ?? []).filter(
        (agent) => agent.bin && agent.logins.some((login) => login.loggedIn !== false),
    );
    const projects = repos.data?.length ?? 0;
    const shown = Boolean(agents.data && repos.data) && !(signedIn.length && projects);
    const github = useGithubStatus(shown);
    if (!shown) return null;
    return (
        <Section title={t("dashboard.setup.title")} className="mb-4">
            <ol className="divide-y">
                <SetupStep
                    done={signedIn.length > 0}
                    title={t("dashboard.setup.agent")}
                    detail={
                        signedIn.length
                            ? t("dashboard.setup.agentDone", {
                                  agents: signedIn.map((agent) => agent.label).join(", "),
                              })
                            : t("dashboard.setup.agentHint")
                    }
                >
                    <Button asChild variant="outline" size="sm">
                        <Link to="/settings/general/agents">
                            {t("dashboard.setup.agentAction")}
                        </Link>
                    </Button>
                </SetupStep>
                <SetupStep
                    done={projects > 0}
                    title={t("dashboard.setup.project")}
                    detail={t("dashboard.setup.projectHint")}
                >
                    <AddRepoMenu />
                </SetupStep>
                <SetupStep
                    done={github.data?.loggedIn === true}
                    title={t("dashboard.setup.github")}
                    detail={
                        github.data?.login
                            ? t("dashboard.setup.githubDone", { login: github.data.login })
                            : t("dashboard.setup.githubHint")
                    }
                >
                    <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
                        gh auth login
                    </code>
                    <CopyButton value="gh auth login" label={t("dashboard.setup.copy")} />
                </SetupStep>
            </ol>
        </Section>
    );
}

export function DashboardPage() {
    const t = useTranslations("web");
    const [params, setParams] = useSearchParams();
    const view: View = VIEWS.includes(params.get("view") as View)
        ? (params.get("view") as View)
        : "overview";
    const days = PERIODS.includes(Number(params.get("days"))) ? Number(params.get("days")) : 7;
    const { failed, jobs } = useJobs();
    const set = (name: string, value: string, fallback: string) =>
        setParams(
            (current) => {
                const next = new URLSearchParams(current);
                if (value === fallback) next.delete(name);
                else next.set(name, value);
                return next;
            },
            { replace: true },
        );

    return (
        <>
            <PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />
            <GettingStarted />
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <Tabs value={view} onValueChange={(value) => set("view", value, "overview")}>
                    <TabsList>
                        {VIEWS.map((name) => (
                            <TabsTrigger key={name} value={name}>
                                {t(`dashboard.views.${name}`)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <PeriodSelect days={days} onChange={(next) => set("days", String(next), "7")} />
            </div>
            {view === "usage" ? (
                <Usage days={days} />
            ) : failed ? (
                <ErrorState error={failed.error} onRetry={() => failed.refetch()} />
            ) : !jobs ? (
                <OverviewSkeleton />
            ) : view === "automations" ? (
                <Automations jobs={jobs} days={days} />
            ) : (
                <Overview jobs={jobs} days={days} />
            )}
        </>
    );
}
