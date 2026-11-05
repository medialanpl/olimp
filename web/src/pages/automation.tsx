import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeftIcon,
    ChevronDownIcon,
    ClockIcon,
    LayoutTemplateIcon,
    NotebookPenIcon,
    PlayIcon,
    PlugIcon,
    SparklesIcon,
    WorkflowIcon,
    XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useFormatter, useNow, useTranslations } from "use-intl";
import { AgentMark, agentLabel } from "@/components/agent-mark";
import {
    ErrorState,
    FormError,
    Loading,
    PageHeader,
    UNDERLINE_TAB,
    UNDERLINE_TABS,
} from "@/components/page";
import { PromptChip, useTemplates } from "@/components/prompt-box";
import {
    CardSkeleton,
    FieldSkeleton,
    PageHeaderSkeleton,
    SkeletonText,
    times,
} from "@/components/skeletons";
import { SkillPicker } from "@/components/skill-picker";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/format";
import {
    keys,
    useAgentDefaults,
    useAutomations,
    useInstalled,
    useIntegrations,
    useRepo,
    useRuns,
    useTasks,
    useWorkflows,
} from "@/lib/queries";
import {
    cronOf,
    EVERY_HOURS,
    PRESETS,
    type Preset,
    type Schedule,
    scheduleOf,
    upcoming,
} from "@/lib/schedule";
import { skillOf } from "@/lib/skill-ref";
import type { AgentName, Automation, RunStatus, Workflow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NotFoundPage } from "@/pages/not-found";
import { ConfirmDelete, Section } from "@/pages/project/shared";
import { isCron } from "../../../src/cron.ts";

export const TEMPLATES = [
    { id: "dependencies", cron: "0 4 * * *" },
    { id: "changelog", cron: "0 16 * * 5" },
    { id: "flaky", cron: "0 2 * * 2" },
    { id: "security", cron: "0 6 * * *" },
    { id: "docs", cron: "0 9 * * 1" },
    { id: "deadCode", cron: "0 3 * * 0" },
] as const;
type TemplateId = (typeof TEMPLATES)[number]["id"];

// Monday first, as the week view shows it; the values stay cron's (0 is Sunday).
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
export const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export interface Draft {
    name: string;
    schedule: Schedule;
    enabled: boolean;
    body: string;
    // null follows the project's agent; only a new automation has it, the API stores the agent.
    agent: AgentName | null;
    skill: string | null;
    workflow: { id: string; name: string } | null;
    integrations: string[];
}

export const blankDraft = (): Draft => ({
    name: "",
    schedule: scheduleOf("0 4 * * *"),
    enabled: true,
    body: "",
    agent: null,
    skill: null,
    workflow: null,
    integrations: [],
});

export const draftOf = (a: Automation, workflows: Workflow[]): Draft => ({
    name: a.name,
    schedule: scheduleOf(a.cron),
    enabled: a.enabled,
    body: a.body ?? "",
    agent: a.agent,
    skill: a.skill,
    workflow: a.workflow
        ? { id: a.workflow, name: workflows.find((w) => w.id === a.workflow)?.name ?? a.workflow }
        : null,
    integrations: a.integrations ?? [],
});

// The task's title is the automation's name, so its tasks are told apart in the lists. A built-in
// automation keeps the name OLIMP gave it.
const payloadOf = (repo: string, d: Draft, builtin: boolean) => {
    const name = builtin ? {} : { name: d.name.trim() };
    const common = { ...name, cron: cronOf(d.schedule), enabled: d.enabled };
    if (d.workflow) return { ...common, workflow: d.workflow.id };
    return {
        ...common,
        workflow: null,
        repo,
        ...(builtin ? {} : { title: d.name.trim() }),
        body: d.body.trim(),
        skill: d.skill,
        integrations: d.integrations,
        ...(d.agent ? { agent: d.agent } : {}),
    };
};

// An automation of the project: its task's, or its workflow's.
export const ofRepo = (a: Automation, repo: string, workflows: Workflow[]) =>
    a.repo === repo || workflows.some((w) => w.id === a.workflow && w.repo === repo);

export interface AutomationJob {
    id: string;
    href: string;
    automation: string;
    status: RunStatus;
    createdAt: string;
    durationMs: number | null;
}

// shortcut: only the latest 100 tasks and 100 runs the API lists, add an automation's own history to the API when one runs more often.
export function useAutomationJobs(): AutomationJob[] {
    const tasks = useTasks();
    const runs = useRuns();
    return useMemo(() => {
        const of = (
            job: Omit<AutomationJob, "href" | "automation"> & { automation: string | null },
        ) => ({
            id: job.id,
            href: `/tasks/${job.id}`,
            automation: job.automation ?? "",
            status: job.status,
            createdAt: job.createdAt,
            durationMs: job.durationMs,
        });
        return [...(tasks.data ?? []).map(of), ...(runs.data ?? []).map(of)]
            .filter((job) => job.automation)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }, [tasks.data, runs.data]);
}

export function useDescribe() {
    const t = useTranslations("web");
    const format = useFormatter();
    // 4 January 2026 is a Sunday, so day d of cron's week is 4 + d.
    const weekday = (day: number) =>
        format.dateTime(new Date(2026, 0, 4 + day), { weekday: "short" });
    const clock = (hour: number, minute: number) =>
        format.dateTime(new Date(2026, 0, 4, hour, minute), { hour: "2-digit", minute: "2-digit" });
    return {
        weekday,
        clock,
        when: (at: Date) =>
            format.dateTime(at, {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
            }),
        schedule: (cron: string) => {
            const s = scheduleOf(cron);
            const time = clock(s.hour, s.minute);
            if (s.preset === "daily") return t("automations.at.daily", { time });
            if (s.preset === "weekdays") return t("automations.at.weekdays", { time });
            if (s.preset === "weekly")
                return t("automations.at.weekly", {
                    days: WEEK.filter((d) => s.days.includes(d))
                        .map(weekday)
                        .join(", "),
                    time,
                });
            if (s.preset === "hours")
                return t("automations.at.hours", {
                    count: s.every,
                    minute: String(s.minute).padStart(2, "0"),
                });
            return cron;
        },
    };
}

export function useRunNow() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api(`/api/automations/${id}/run`, { method: "POST" }),
        onSuccess: () => {
            for (const key of [keys.automations, keys.tasks, keys.runs])
                void client.invalidateQueries({ queryKey: key });
        },
    });
}

function TemplateCard({
    title,
    cron,
    description,
    extra,
    onUse,
}: {
    title: string;
    cron: string;
    description: string;
    extra?: string;
    onUse: () => void;
}) {
    const t = useTranslations("web");
    const describe = useDescribe();
    return (
        <div className="flex flex-col gap-1.5 rounded-xl border bg-background/40 p-3">
            <p className="flex items-center gap-2 font-medium">
                <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{title}</span>
                {extra && (
                    <Badge variant="outline" className="ml-auto font-mono">
                        {extra}
                    </Badge>
                )}
            </p>
            <p className="font-mono text-xs text-muted-foreground">{describe.schedule(cron)}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
            <Button size="sm" variant="outline" className="mt-auto w-fit" onClick={onUse}>
                {t("automations.useTemplate")}
            </Button>
        </div>
    );
}

function Templates({ repo, onUse }: { repo: string; onUse: (draft: Partial<Draft>) => void }) {
    const t = useTranslations("web");
    const automations = useAutomations();
    // A workflow belongs to its project, so only task automations carry over.
    const others = (automations.data ?? []).filter((a) => a.repo && a.repo !== repo);
    return (
        <Card>
            <CardContent>
                <Tabs defaultValue="builtIn" className="gap-4">
                    <TabsList className={UNDERLINE_TABS}>
                        <TabsTrigger value="builtIn" className={UNDERLINE_TAB}>
                            {t("automations.builtIn")}
                        </TabsTrigger>
                        {others.length > 0 && (
                            <TabsTrigger value="projects" className={UNDERLINE_TAB}>
                                {t("automations.fromProjects")}
                            </TabsTrigger>
                        )}
                    </TabsList>
                    <TabsContent value="builtIn" className="grid gap-3 sm:grid-cols-2">
                        {TEMPLATES.map(({ id, cron }) => (
                            <TemplateCard
                                key={id}
                                title={t(`automations.templates.${id as TemplateId}.name`)}
                                cron={cron}
                                description={t(
                                    `automations.templates.${id as TemplateId}.description`,
                                )}
                                onUse={() =>
                                    onUse({
                                        name: t(`automations.templates.${id as TemplateId}.name`),
                                        schedule: scheduleOf(cron),
                                        body: t(`automations.templates.${id as TemplateId}.prompt`),
                                        workflow: null,
                                    })
                                }
                            />
                        ))}
                    </TabsContent>
                    <TabsContent value="projects" className="grid gap-3 sm:grid-cols-2">
                        {others.map((a) => (
                            <TemplateCard
                                key={a.id}
                                title={a.name}
                                cron={a.cron}
                                description={a.body ?? ""}
                                extra={a.repo ?? undefined}
                                onUse={() =>
                                    onUse({
                                        name: a.name,
                                        schedule: scheduleOf(a.cron),
                                        body: a.body ?? "",
                                        agent: a.agent,
                                        skill: a.skill,
                                        workflow: null,
                                    })
                                }
                            />
                        ))}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

const PICKED =
    "data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

function When({ value, onChange }: { value: Schedule; onChange: (s: Schedule) => void }) {
    const t = useTranslations("web");
    const describe = useDescribe();
    const cron = cronOf(value);
    const time = (
        <Input
            type="time"
            aria-label={t("automations.time")}
            value={`${String(value.hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`}
            onChange={(e) => {
                const [hour, minute] = e.target.value.split(":").map(Number);
                if (e.target.value) onChange({ ...value, hour: hour ?? 0, minute: minute ?? 0 });
            }}
            className="w-32 font-mono"
        />
    );
    const row = "flex flex-wrap items-center gap-2 text-sm text-muted-foreground";
    return (
        <div className="space-y-4">
            <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                aria-label={t("automations.when")}
                value={value.preset}
                onValueChange={(preset) =>
                    preset &&
                    onChange({
                        ...value,
                        preset: preset as Preset,
                        cron: preset === "custom" ? cron : value.cron,
                    })
                }
                className="flex-wrap"
            >
                {PRESETS.map((preset) => (
                    <ToggleGroupItem key={preset} value={preset} className={PICKED}>
                        {t(`automations.presets.${preset}`)}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
            {value.preset === "weekly" && (
                <div className={row}>
                    <span>{t("automations.onDays")}</span>
                    <ToggleGroup
                        type="multiple"
                        variant="outline"
                        size="sm"
                        spacing={1}
                        aria-label={t("automations.onDays")}
                        value={value.days.map(String)}
                        onValueChange={(days) =>
                            days.length && onChange({ ...value, days: days.map(Number) })
                        }
                        className="flex-wrap"
                    >
                        {WEEK.map((day) => (
                            <ToggleGroupItem
                                key={day}
                                value={String(day)}
                                className={cn("min-w-11", PICKED)}
                            >
                                {describe.weekday(day)}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                </div>
            )}
            {value.preset === "hours" ? (
                <div className={row}>
                    <span>{t("automations.every")}</span>
                    <Select
                        value={String(value.every)}
                        onValueChange={(every) => onChange({ ...value, every: Number(every) })}
                    >
                        <SelectTrigger className="w-24" aria-label={t("automations.every")}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {EVERY_HOURS.map((every) => (
                                <SelectItem key={every} value={String(every)}>
                                    {t("automations.hoursShort", { count: every })}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span>{t("automations.atMinute")}</span>
                    <Input
                        type="number"
                        min={0}
                        max={59}
                        aria-label={t("automations.atMinute")}
                        value={value.minute}
                        onChange={(e) => {
                            const minute = Number(e.target.value);
                            if (Number.isInteger(minute) && minute >= 0 && minute < 60)
                                onChange({ ...value, minute });
                        }}
                        className="w-20 font-mono"
                    />
                </div>
            ) : value.preset === "custom" ? (
                <div className="space-y-1.5">
                    <Input
                        aria-label={t("automations.cron")}
                        value={value.cron}
                        onChange={(e) => onChange({ ...value, cron: e.target.value })}
                        aria-invalid={!isCron(cron)}
                        spellCheck={false}
                        className="max-w-xs font-mono"
                    />
                    <p
                        className={
                            isCron(cron)
                                ? "text-xs text-muted-foreground"
                                : "text-xs text-destructive"
                        }
                    >
                        {isCron(cron) ? t("automations.cronHint") : t("automations.invalidCron")}
                    </p>
                </div>
            ) : (
                <div className={row}>
                    <span>{t("automations.atTime")}</span>
                    {time}
                </div>
            )}
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t("automations.cron")}
                <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground">
                    {cron}
                </code>
                <span>· {zone}</span>
            </p>
        </div>
    );
}

const PROJECT_AGENT = "project";

function AgentChip({
    repo,
    value,
    allowDefault,
    onChange,
}: {
    repo: string;
    value: AgentName | null;
    allowDefault: boolean;
    onChange: (agent: AgentName | null) => void;
}) {
    const t = useTranslations("web");
    const installed = useInstalled();
    const project = useRepo(repo);
    const defaults = useAgentDefaults();
    const fallback = project.data?.agents.agent ?? defaults.data?.agent ?? "claude";
    const shown = value ?? fallback;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <PromptChip aria-label={t("fields.agent")}>
                    <AgentMark agent={shown} />
                    <span>
                        {value
                            ? agentLabel(value)
                            : t("automations.projectAgent", { agent: agentLabel(shown) })}
                    </span>
                    <ChevronDownIcon />
                </PromptChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuRadioGroup
                    value={value ?? PROJECT_AGENT}
                    onValueChange={(agent) =>
                        onChange(agent === PROJECT_AGENT ? null : (agent as AgentName))
                    }
                >
                    {allowDefault && (
                        <>
                            <DropdownMenuRadioItem value={PROJECT_AGENT}>
                                {t("automations.projectAgent", { agent: agentLabel(fallback) })}
                            </DropdownMenuRadioItem>
                            <DropdownMenuSeparator />
                        </>
                    )}
                    {[...new Set([...installed, ...(value ? [value] : [])])].map((agent) => (
                        <DropdownMenuRadioItem key={agent} value={agent}>
                            <AgentMark agent={agent} />
                            {agentLabel(agent)}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function IntegrationsChip({
    repo,
    value,
    onChange,
}: {
    repo: string;
    value: string[];
    onChange: (names: string[]) => void;
}) {
    const t = useTranslations("web");
    const integrations = useIntegrations(repo);
    if (!integrations.data?.length) return null;
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <PromptChip empty={!value.length} aria-label={t("fields.integrations")}>
                    <PlugIcon />
                    <span>
                        {value.length
                            ? t("prompt.integrations", { count: value.length })
                            : t("fields.integrations")}
                    </span>
                    <ChevronDownIcon />
                </PromptChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                {integrations.data.map((integration) => (
                    <DropdownMenuCheckboxItem
                        key={integration.name}
                        checked={value.includes(integration.name)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(on) =>
                            onChange(
                                on
                                    ? [...value, integration.name]
                                    : value.filter((name) => name !== integration.name),
                            )
                        }
                    >
                        <span className="font-mono">{integration.name}</span>
                        <span className="text-xs text-muted-foreground">{integration.kind}</span>
                    </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function WhatToRun({
    repo,
    draft,
    isNew,
    builtin,
    set,
}: {
    repo: string;
    draft: Draft;
    isNew: boolean;
    builtin: boolean;
    set: (change: Partial<Draft>) => void;
}) {
    const t = useTranslations("web");
    const templates = useTemplates();
    const [picking, setPicking] = useState(false);
    const skill = skillOf(draft.skill);
    const append = (text: string) =>
        set({ body: draft.body.trim() ? `${draft.body.trimEnd()}\n\n${text}` : text });
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
                <Popover open={picking} onOpenChange={setPicking}>
                    <PopoverTrigger asChild>
                        <PromptChip
                            empty={!skill && !draft.workflow}
                            aria-label={t("prompt.skillOrWorkflow")}
                        >
                            {draft.workflow ? <WorkflowIcon /> : <SparklesIcon />}
                            <span>
                                {draft.workflow?.name ?? skill?.name ?? t("prompt.skillOrWorkflow")}
                            </span>
                            <ChevronDownIcon />
                        </PromptChip>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-96 p-0">
                        <SkillPicker
                            repo={repo}
                            skill={draft.skill}
                            workflow={draft.workflow?.id ?? null}
                            onSkill={(picked) => {
                                set({ skill: picked?.id ?? null, workflow: null });
                                setPicking(false);
                            }}
                            onWorkflow={
                                builtin
                                    ? undefined
                                    : (workflow) => {
                                          set({ workflow, skill: null });
                                          setPicking(false);
                                      }
                            }
                        />
                    </PopoverContent>
                </Popover>
                {(skill || draft.workflow) && (
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={t("automations.clearSkill")}
                        title={t("automations.clearSkill")}
                        onClick={() => set({ skill: null, workflow: null })}
                    >
                        <XIcon />
                    </Button>
                )}
                {!draft.workflow && (
                    <>
                        <AgentChip
                            repo={repo}
                            value={draft.agent}
                            allowDefault={isNew}
                            onChange={(agent) => set({ agent })}
                        />
                        <IntegrationsChip
                            repo={repo}
                            value={draft.integrations}
                            onChange={(integrations) => set({ integrations })}
                        />
                    </>
                )}
            </div>
            {draft.workflow ? (
                <Alert variant="info" role="note">
                    <WorkflowIcon />
                    <AlertDescription>
                        {t("automations.runsWorkflow", { workflow: draft.workflow.name })}
                    </AlertDescription>
                </Alert>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <NotebookPenIcon className="size-3.5" />
                            {t("automations.promptTemplates")}
                        </span>
                        {templates.map((template) => (
                            <Button
                                key={template.id}
                                size="xs"
                                variant="outline"
                                title={template.text}
                                onClick={() => append(template.text)}
                            >
                                {template.label}
                            </Button>
                        ))}
                    </div>
                    <Textarea
                        aria-label={t("automations.prompt")}
                        placeholder={t("automations.promptPlaceholder")}
                        value={draft.body}
                        onChange={(e) => set({ body: e.target.value })}
                        maxLength={20_000}
                        className="min-h-32"
                    />
                    <p className="text-xs text-muted-foreground">{t("automations.runsTask")}</p>
                </>
            )}
        </div>
    );
}

function NextRuns({ cron, enabled }: { cron: string; enabled: boolean }) {
    const t = useTranslations("web");
    const format = useFormat();
    const describe = useDescribe();
    const now = useNow({ updateInterval: 60_000 });
    const runs = useMemo(() => upcoming(cron, now, 5), [cron, now]);
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("automations.nextFive")}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {!enabled && (
                    <p className="text-xs text-muted-foreground">{t("automations.wouldRun")}</p>
                )}
                {runs.length ? (
                    <ul className={enabled ? "space-y-1.5" : "space-y-1.5 opacity-60"}>
                        {runs.map((at) => (
                            <li
                                key={at.getTime()}
                                className="flex items-baseline justify-between gap-3"
                            >
                                <span className="font-mono text-sm font-medium tabular-nums">
                                    {describe.when(at)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {format.relative(at.toISOString())}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {isCron(cron) ? t("automations.noUpcoming") : t("automations.invalidCron")}
                    </p>
                )}
                <p className="pt-1 text-xs text-muted-foreground">{zone}</p>
            </CardContent>
        </Card>
    );
}

function History({ automation }: { automation: Automation }) {
    const t = useTranslations("web");
    const format = useFormat();
    const jobs = useAutomationJobs().filter((job) => job.automation === automation.id);
    const run = useRunNow();
    return (
        <Card size="sm">
            <CardHeader className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("automations.recentRuns")}
                </CardTitle>
                <Button
                    size="xs"
                    variant="outline"
                    disabled={run.isPending}
                    onClick={() => run.mutate(automation.id)}
                >
                    <PlayIcon />
                    {t("automations.runNow")}
                </Button>
            </CardHeader>
            <CardContent className="space-y-2">
                <FormError error={run.error} />
                {jobs.length ? (
                    <ul className="space-y-1">
                        {jobs.slice(0, 8).map((job) => (
                            <li key={job.id}>
                                <Link
                                    to={job.href}
                                    className="-mx-1.5 flex items-center justify-between gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
                                >
                                    <StatusBadge status={job.status} />
                                    <span className="text-xs text-muted-foreground">
                                        {format.relative(job.createdAt)}
                                    </span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">{t("automations.noRuns")}</p>
                )}
            </CardContent>
        </Card>
    );
}

// The editor: its sections in the main column, the next runs beside them.
function EditorSkeleton() {
    return (
        <Loading>
            <PageHeaderSkeleton actions={2} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
                <div className="space-y-4">
                    <CardSkeleton description={false}>
                        <Skeleton className="h-9 max-w-md rounded-3xl" />
                    </CardSkeleton>
                    <CardSkeleton description={false}>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <FieldSkeleton />
                            <FieldSkeleton />
                        </div>
                    </CardSkeleton>
                    <CardSkeleton description={false}>
                        <Skeleton className="h-32 w-full" />
                    </CardSkeleton>
                    <CardSkeleton description={false}>
                        <Skeleton className="h-5 w-48" />
                    </CardSkeleton>
                </div>
                <Card size="sm">
                    <CardHeader>
                        <Skeleton className="h-3 w-24" />
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                        {times(5).map((run) => (
                            <SkeletonText key={run} lines={1} />
                        ))}
                    </CardContent>
                </Card>
            </div>
        </Loading>
    );
}

function Editor({
    repo,
    initial,
    saved,
}: {
    repo: string;
    initial: Draft;
    saved: Automation | null;
}) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const client = useQueryClient();
    const [draft, setDraft] = useState(initial);
    // Only a blank automation starts with the templates; a template or a copy is already chosen.
    const [templates, setTemplates] = useState(!saved && !initial.name);
    const set = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));
    const list = `/project/${repo}/automations`;
    const cron = cronOf(draft.schedule);
    const ready = !!draft.name.trim() && isCron(cron) && (!!draft.workflow || !!draft.body.trim());
    const done = () => {
        void client.invalidateQueries({ queryKey: keys.automations });
        navigate(list);
    };
    const save = useMutation({
        mutationFn: () =>
            api(saved ? `/api/automations/${saved.id}` : "/api/automations", {
                method: saved ? "PATCH" : "POST",
                body: payloadOf(repo, draft, !!saved?.builtin),
            }),
        onSuccess: done,
    });
    const remove = useMutation({
        mutationFn: () => api(`/api/automations/${saved?.id}`, { method: "DELETE" }),
        onSuccess: done,
    });
    return (
        <>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        <Button asChild size="icon-sm" variant="ghost" className="-ml-2">
                            <Link to={list} aria-label={t("automations.back")}>
                                <ArrowLeftIcon />
                            </Link>
                        </Button>
                        {saved ? saved.name : t("automations.newTitle")}
                    </span>
                }
                description={repo}
                actions={
                    <>
                        {!saved && (
                            <Button variant="ghost" onClick={() => setTemplates(!templates)}>
                                <LayoutTemplateIcon />
                                {templates
                                    ? t("automations.hideTemplates")
                                    : t("automations.showTemplates")}
                            </Button>
                        )}
                        <Button variant="outline" asChild>
                            <Link to={list}>{t("common.cancel")}</Link>
                        </Button>
                        <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
                            {draft.enabled
                                ? saved
                                    ? t("common.save")
                                    : t("automations.create")
                                : t("automations.savePaused")}
                        </Button>
                    </>
                }
            />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
                <div className="space-y-4">
                    {templates && <Templates repo={repo} onUse={set} />}
                    <Section title={t("automations.name")}>
                        <Input
                            aria-label={t("automations.name")}
                            value={draft.name}
                            placeholder={t("automations.templates.dependencies.name")}
                            onChange={(e) => set({ name: e.target.value })}
                            maxLength={200}
                            disabled={!!saved?.builtin}
                            className="max-w-md"
                        />
                        {saved?.builtin && (
                            <p className="mt-2 max-w-prose text-xs text-muted-foreground">
                                {t(`automations.builtin.${saved.builtin}.hint`)}{" "}
                                {t("automations.builtin.fixed")}
                            </p>
                        )}
                    </Section>
                    <Section title={t("automations.when")}>
                        <When value={draft.schedule} onChange={(schedule) => set({ schedule })} />
                    </Section>
                    <Section title={t("automations.whatToRun")}>
                        <WhatToRun
                            repo={repo}
                            draft={draft}
                            isNew={!saved}
                            builtin={!!saved?.builtin}
                            set={set}
                        />
                    </Section>
                    <Section title={t("automations.enable")}>
                        <Label className="flex w-fit items-center gap-3">
                            <Switch
                                checked={draft.enabled}
                                onCheckedChange={(enabled) => set({ enabled })}
                            />
                            <span>{t("automations.enabledLabel")}</span>
                        </Label>
                        <p className="mt-2 text-xs text-muted-foreground">
                            {t("automations.enabledHint")}
                        </p>
                    </Section>
                    <FormError error={save.error} />
                </div>
                <aside className="space-y-4 lg:sticky lg:top-(--sticky-top,0px)">
                    <NextRuns cron={cron} enabled={draft.enabled} />
                    {saved && <History automation={saved} />}
                    {saved && !saved.builtin && (
                        <div className="space-y-2">
                            <ConfirmDelete
                                label={t("automations.delete")}
                                question={t("automations.deleteTitle", { name: saved.name })}
                                pending={remove.isPending}
                                onConfirm={() => remove.mutate()}
                            />
                            <FormError error={remove.error} />
                        </div>
                    )}
                </aside>
            </div>
        </>
    );
}

export function AutomationPage() {
    const { id = "", automation = "" } = useParams();
    const location = useLocation();
    const automations = useAutomations();
    const workflows = useWorkflows();
    if (automation === "new") {
        const handed = (location.state as { draft?: Draft } | null)?.draft;
        return (
            <Editor key={location.key} repo={id} initial={handed ?? blankDraft()} saved={null} />
        );
    }
    const failed = [automations, workflows].find((query) => query.isError);
    if (failed) return <ErrorState error={failed.error} onRetry={() => failed.refetch()} />;
    if (!automations.data || !workflows.data) return <EditorSkeleton />;
    const saved = automations.data.find((a) => a.id === automation);
    if (!saved || !ofRepo(saved, id, workflows.data)) return <NotFoundPage />;
    return (
        <Editor key={saved.id} repo={id} initial={draftOf(saved, workflows.data)} saved={saved} />
    );
}
