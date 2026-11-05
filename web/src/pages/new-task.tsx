import { useMutation } from "@tanstack/react-query";
import {
    ChevronDownIcon,
    CopyIcon,
    FolderGit2Icon,
    FolderIcon,
    FolderPlusIcon,
    FolderTreeIcon,
    GitBranchIcon,
    GitBranchPlusIcon,
    PlugIcon,
    SparklesIcon,
    SplitIcon,
    WorkflowIcon,
    XIcon,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { AddRepoMenu } from "@/components/add-repo";
import { AgentMark, agentLabel } from "@/components/agent-mark";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, FormError, Loading } from "@/components/page";
import { PromptBox, PromptChip } from "@/components/prompt-box";
import { times } from "@/components/skeletons";
import { SkillPicker } from "@/components/skill-picker";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    DropdownMenuCheckboxItem,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useAttachments } from "@/lib/attachments";
import { lastRepo, rememberRepo } from "@/lib/nav";
import {
    useAgentDefaults,
    useBranches,
    useInstalled,
    useIntegrations,
    useModels,
    useRepos,
    useSetBaseBranch,
} from "@/lib/queries";
import { PROJECT, skillOf } from "@/lib/skill-ref";
import type { AgentName, Repo, RunSummary, Skill, Task } from "@/lib/types";

const TITLE_MAX = 200;
const SUGGESTIONS = ["fixTest", "summarizeCommits", "updateReadme"] as const;

// The first line names the task; the whole prompt is its body.
export function titleOf(text: string): string {
    const line = text.trim().split("\n")[0]?.trim() ?? "";
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

const ProjectIcon = ({ repo }: { repo: Repo }) => (repo.git ? <FolderGit2Icon /> : <FolderIcon />);

function ProjectChip({
    repos,
    value,
    onChange,
}: {
    repos: Repo[];
    value: Repo | undefined;
    onChange: (id: string) => void;
}) {
    const t = useTranslations("web");
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <PromptChip empty={!value} aria-label={t("prompt.project")}>
                    {value ? <ProjectIcon repo={value} /> : <FolderIcon />}
                    <span>{value?.id ?? t("prompt.pickProject")}</span>
                    <ChevronDownIcon />
                </PromptChip>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
                {/* Opens on the chosen project, so Enter keeps it instead of taking the first. */}
                <Command defaultValue={value?.id}>
                    <CommandInput placeholder={t("prompt.searchProjects")} />
                    <CommandList>
                        <CommandEmpty>{t("search.empty")}</CommandEmpty>
                        <CommandGroup>
                            {repos.map((repo) => (
                                <CommandItem
                                    key={repo.id}
                                    value={repo.id}
                                    data-checked={repo.id === value?.id}
                                    onSelect={() => {
                                        onChange(repo.id);
                                        setOpen(false);
                                    }}
                                >
                                    <ProjectIcon repo={repo} />
                                    <span className="min-w-0 flex-1 truncate">{repo.id}</span>
                                    {repo.git && repo.defaultBranch && (
                                        <span className="max-w-24 truncate font-mono text-xs text-muted-foreground">
                                            {repo.defaultBranch}
                                        </span>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

export type ModelChoice = { agent: AgentName; model: string | null };

const choiceKey = (c: ModelChoice) => `${c.agent}:${c.model ?? "auto"}`;

// The model is picked, not the agent: a Codex model runs the task with Codex.
// "auto" is no model at all, so the agent's CLI takes its own default.
export function ModelChip({
    value,
    onChange,
}: {
    value: ModelChoice;
    onChange: (choice: ModelChoice) => void;
}) {
    const t = useTranslations("web");
    const models = useModels();
    const [open, setOpen] = useState(false);
    const installed = useInstalled();
    const current = models.data?.find((m) => m.agent === value.agent && m.value === value.model);
    const item = (choice: ModelChoice, label: string, description: string) => (
        <CommandItem
            key={choiceKey(choice)}
            value={choiceKey(choice)}
            keywords={[label]}
            data-checked={choiceKey(choice) === choiceKey(value)}
            onSelect={() => {
                onChange(choice);
                setOpen(false);
            }}
        >
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{label}</span>
                {description && (
                    <span className="truncate text-xs text-muted-foreground">{description}</span>
                )}
            </div>
        </CommandItem>
    );
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <PromptChip aria-label={t("prompt.model")}>
                    <AgentMark agent={value.agent} />
                    <span>{value.model ? (current?.label ?? value.model) : t("prompt.auto")}</span>
                    <ChevronDownIcon />
                </PromptChip>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-0">
                <Command defaultValue={choiceKey(value)}>
                    <CommandList className="max-h-96">
                        {models.isPending && (
                            <Loading className="space-y-4 p-3">
                                {times(3).map((row) => (
                                    <div key={row} className="space-y-1.5">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-48" />
                                    </div>
                                ))}
                            </Loading>
                        )}
                        {models.isError && (
                            <p className="px-3 pt-3 text-xs text-destructive">
                                {t("prompt.modelsError")}
                            </p>
                        )}
                        {installed.map((agent) => (
                            <CommandGroup key={agent} heading={agentLabel(agent)}>
                                {item(
                                    { agent, model: null },
                                    t("prompt.auto"),
                                    t("prompt.autoHint"),
                                )}
                                {models.data
                                    ?.filter((m) => m.agent === agent)
                                    .map((m) =>
                                        item({ agent, model: m.value }, m.label, m.description),
                                    )}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

// A setting chosen behind "+", shown so it is not forgotten; × puts it back to the default.
function ActiveChip({
    icon,
    label,
    removeLabel,
    onRemove,
}: {
    icon: ReactNode;
    label: string;
    removeLabel: string;
    onRemove: () => void;
}) {
    return (
        <PromptChip onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
            {icon}
            <span>{label}</span>
            <XIcon />
        </PromptChip>
    );
}

export interface DispatchSettings {
    maxSubtasks: number;
    inFlight: number;
    agent: AgentName | null;
    model: string | null;
    budgetUsd: number | null;
}

const SUBTASKS_MAX = 50;
const IN_FLIGHT_MAX = 4;
const DISPATCH_DEFAULT: DispatchSettings = {
    maxSubtasks: SUBTASKS_MAX,
    inFlight: IN_FLIGHT_MAX,
    agent: null,
    model: null,
    budgetUsd: null,
};
// Radix Select has no empty value, so "as the parent" is this one.
const PARENT = "parent";

function Choice({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: string;
    options: [string, string][];
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-3 text-sm">
            <span>{label}</span>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger size="sm" className="w-40" aria-label={label}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map(([option, text]) => (
                        <SelectItem key={option} value={option}>
                            {text}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

// Dispatch: the agent splits the task into subtasks, each in its own worktree from the
// task's branch, and one more step of the thread merges them. Shown once switched on in "+".
function DispatchChip({
    value,
    parent,
    onChange,
}: {
    value: DispatchSettings;
    parent: AgentName;
    onChange: (value: DispatchSettings | null) => void;
}) {
    const t = useTranslations("web");
    const models = useModels();
    const installed = useInstalled();
    const runner = value.agent ?? parent;
    const set = (patch: Partial<DispatchSettings>) => onChange({ ...value, ...patch });
    const counts = (list: number[]) => list.map((n): [string, string] => [String(n), String(n)]);
    return (
        <Popover>
            <PopoverTrigger asChild>
                <PromptChip
                    aria-label={t("prompt.dispatch")}
                    className="border-brand/50 text-brand"
                >
                    <SplitIcon />
                    <span>{t("prompt.dispatch")}</span>
                    <ChevronDownIcon />
                </PromptChip>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-88 space-y-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                        <p className="text-sm font-medium">{t("prompt.dispatch")}</p>
                        <p className="text-xs text-muted-foreground">{t("prompt.dispatchHint")}</p>
                    </div>
                    <Switch
                        checked
                        onCheckedChange={() => onChange(null)}
                        aria-label={t("prompt.dispatchOff")}
                    />
                </div>
                <Separator />
                <Choice
                    label={t("prompt.dispatch_maxSubtasks")}
                    value={String(value.maxSubtasks)}
                    options={[
                        [String(SUBTASKS_MAX), t("prompt.dispatch_unlimited")],
                        ...counts([2, 3, 5, 10, 20]),
                    ]}
                    onChange={(n) => set({ maxSubtasks: Number(n) })}
                />
                <Choice
                    label={t("prompt.dispatch_inFlight")}
                    value={String(value.inFlight)}
                    options={counts([1, 2, 3, 4])}
                    onChange={(n) => set({ inFlight: Number(n) })}
                />
                <Choice
                    label={t("prompt.dispatch_agent")}
                    value={value.agent ?? PARENT}
                    options={[
                        [PARENT, t("prompt.dispatch_parent")],
                        ...installed.map((agent): [string, string] => [agent, agentLabel(agent)]),
                    ]}
                    onChange={(agent) =>
                        set({ agent: agent === PARENT ? null : (agent as AgentName), model: null })
                    }
                />
                <Choice
                    label={t("prompt.dispatch_model")}
                    value={value.model ?? PARENT}
                    options={[
                        [PARENT, t("prompt.dispatch_parent")],
                        ...(models.data ?? [])
                            .filter((m) => m.agent === runner)
                            .map((m): [string, string] => [m.value, m.label]),
                    ]}
                    onChange={(model) => set({ model: model === PARENT ? null : model })}
                />
                <Label className="flex items-center justify-between gap-3 font-normal">
                    {t("prompt.dispatch_budget")}
                    <Input
                        type="number"
                        min={0.01}
                        max={1000}
                        step={0.5}
                        inputMode="decimal"
                        placeholder={t("prompt.dispatch_noBudget")}
                        defaultValue={value.budgetUsd ?? ""}
                        className="h-8 w-40 shrink-0"
                        onChange={(event) => {
                            const usd = Number(event.target.value);
                            set({ budgetUsd: usd > 0 && usd <= 1000 ? usd : null });
                        }}
                    />
                </Label>
                <p className="text-xs text-muted-foreground">{t("prompt.dispatchNote")}</p>
            </PopoverContent>
        </Popover>
    );
}

// A new branch: its name typed in place, empty for OLIMP's own olimp/<task id>.
function BranchChip({
    value,
    onChange,
    onRemove,
}: {
    value: string;
    onChange: (name: string) => void;
    onRemove: () => void;
}) {
    const t = useTranslations("web");
    return (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-background pr-1 pl-2.5 text-xs [&_svg]:size-3.5 [&_svg]:shrink-0">
            <GitBranchPlusIcon />
            <input
                aria-label={t("prompt.branchName")}
                value={value}
                placeholder={t("prompt.branchAuto")}
                onChange={(event) => onChange(event.target.value)}
                className="w-32 bg-transparent font-mono outline-none placeholder:text-muted-foreground"
            />
            <button
                type="button"
                aria-label={t("prompt.noNewBranch")}
                title={t("prompt.noNewBranch")}
                onClick={onRemove}
                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
                <XIcon />
            </button>
        </span>
    );
}

// The kit's chevron also pushes right; beside a value it follows the value instead.
const VALUE_TRIGGER = "[&>svg:last-child]:ml-0";

// ×N: the same prompt in separate worktrees, then the diff that stays is picked.
function VariantsMenu({
    value,
    onChange,
    disabled,
}: {
    value: number;
    onChange: (count: number) => void;
    disabled: boolean;
}) {
    const t = useTranslations("web");
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={disabled} className={VALUE_TRIGGER}>
                <CopyIcon />
                {t("prompt.variants")}
                <span className="ml-auto text-xs text-muted-foreground">×{value}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                    value={String(value)}
                    onValueChange={(count) => onChange(Number(count))}
                >
                    {[1, 2, 3].map((count) => (
                        <DropdownMenuRadioItem key={count} value={String(count)}>
                            ×{count}
                            <span className="text-xs text-muted-foreground">
                                {t(count === 1 ? "prompt.oneVariant" : "prompt.manyVariants")}
                            </span>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

// The project's base: changing it moves where every new task starts and its PR goes.
function BaseMenu({ repo, onChanged }: { repo: Repo; onChanged: (branch: string) => void }) {
    const t = useTranslations("web");
    const branches = useBranches(repo.id);
    const set = useSetBaseBranch();
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger className={VALUE_TRIGGER}>
                <GitBranchIcon />
                {t("prompt.base")}
                <span className="ml-auto max-w-24 truncate font-mono text-xs text-muted-foreground">
                    {repo.defaultBranch}
                </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-64 overflow-y-auto">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {t("prompt.baseHint")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                    value={repo.defaultBranch}
                    onValueChange={(branch) =>
                        set.mutate(
                            { repo: repo.id, branch },
                            { onSuccess: () => onChanged(branch) },
                        )
                    }
                >
                    {branches.data?.branches.map((branch) => (
                        <DropdownMenuRadioItem key={branch} value={branch} className="font-mono">
                            <span className="truncate">{branch}</span>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

// Integrations the project offers; each one the task may use.
function IntegrationsMenu({
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
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <PlugIcon />
                {t("fields.integrations")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
                {integrations.data.map((integration) => (
                    <DropdownMenuCheckboxItem
                        key={integration.name}
                        checked={value.includes(integration.name)}
                        // Several are often chosen at once.
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
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}

// The heading over the PromptBox with its row of chips.
function NewTaskSkeleton() {
    return (
        <div className="mx-auto w-full max-w-3xl space-y-6">
            <div className="flex flex-col items-center gap-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-72 max-w-full" />
            </div>
            <div className="rounded-3xl border bg-card shadow-sm">
                <div className="h-14 px-4 pt-3.5">
                    <Skeleton className="h-4 w-2/3" />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 pb-2.5">
                    {times(3).map((chip) => (
                        <Skeleton key={chip} className="h-7 w-24 rounded-full" />
                    ))}
                    <Skeleton className="ml-auto size-8 rounded-full" />
                </div>
            </div>
        </div>
    );
}

export function NewTaskPage() {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const repos = useRepos();
    const [picked, setPicked] = useState<string | null>(params.get("repo") ?? lastRepo());
    // A page that hands something to an agent passes its prompt along.
    const [text, setText] = useState(params.get("prompt") ?? "");
    // null follows the project's agent, so the API picks it and its model too.
    const [ownChoice, setChoice] = useState<ModelChoice | null>(null);
    const defaults = useAgentDefaults();
    const [variants, setVariants] = useState(1);
    const [dispatch, setDispatch] = useState<DispatchSettings | null>(null);
    // null follows the project's "Where tasks work".
    const [ownWorktree, setWorktree] = useState<boolean | null>(null);
    // The new branch's name in the checkout, "" for OLIMP's own; null keeps the checked-out branch.
    const [newBranch, setNewBranch] = useState<string | null>(null);
    const attachments = useAttachments();
    // undefined follows the project's default skill.
    const [ownSkill, setSkill] = useState<Skill | null | undefined>(
        () => skillOf(params.get("skill")) ?? undefined,
    );
    const [workflow, setWorkflow] = useState<{ id: string; name: string } | null>(null);
    const [skillOpen, setSkillOpen] = useState(false);
    const pickAfterMenu = useRef(false);
    const [chosen, setChosen] = useState<string[]>([]);
    const [note, setNote] = useState<string | null>(null);
    const repo =
        repos.data?.find((entry) => entry.id === picked) ??
        (repos.data?.length === 1 ? repos.data[0] : undefined);
    const choice = ownChoice ?? {
        agent: repo?.agents.agent ?? defaults.data?.agent ?? "claude",
        model: null,
    };
    const worktree = ownWorktree ?? repo?.settings.workspace !== "checkout";
    const inCheckout = !!repo?.git && !worktree;
    const skill = ownSkill !== undefined ? ownSkill : skillOf(repo?.settings.defaultSkill ?? null);
    const create = useMutation({
        mutationFn: (prompt: string) =>
            api<Task | { group: string; tasks: Task[] }>("/api/tasks", {
                method: "POST",
                body: {
                    repo: repo?.id,
                    title: titleOf(prompt) || titleOf(attachments.items[0]?.name ?? ""),
                    body: prompt.trim(),
                    ...(ownChoice ? { agent: ownChoice.agent } : {}),
                    integrations: chosen,
                    attachments: attachments.ids,
                    ...(choice.model ? { model: choice.model } : {}),
                    ...(skill ? { skill: skill.id } : {}),
                    ...(variants > 1 && repo?.git && !dispatch ? { variants } : {}),
                    ...(dispatch && repo?.git ? { dispatch } : {}),
                    ...(inCheckout
                        ? {
                              worktree: false,
                              ...(newBranch !== null ? { newBranch: true } : {}),
                              ...(newBranch?.trim() ? { branch: newBranch.trim() } : {}),
                          }
                        : {}),
                },
            }),
        onSuccess: (created) => {
            const first = "group" in created ? created.tasks[0] : created;
            if (first) rememberRepo(first.repo);
            attachments.clear();
            navigate(
                "group" in created ? `/tasks/compare/${created.group}` : `/tasks/${first?.id}`,
            );
        },
    });
    const start = useMutation({
        mutationFn: (prompt: string) =>
            api<RunSummary>(`/api/workflows/${workflow?.id}/run`, {
                method: "POST",
                body: { input: prompt.trim() },
            }),
        onSuccess: (run) => navigate(`/tasks/${run.id}`),
    });

    if (repos.isPending)
        return (
            <Loading className="flex min-h-0 flex-1 flex-col px-4 pt-[12svh] pb-8">
                <NewTaskSkeleton />
            </Loading>
        );
    if (repos.isError)
        return (
            <div className="p-4 md:p-6">
                <ErrorState error={repos.error} onRetry={() => repos.refetch()} />
            </div>
        );
    if (!repos.data.length)
        return (
            <div className="flex flex-1 flex-col p-4 md:p-6">
                <EmptyState
                    icon={<FolderPlusIcon />}
                    title={t("newTask.noReposTitle")}
                    description={t("newTask.noRepos")}
                >
                    <AddRepoMenu />
                </EmptyState>
            </div>
        );

    // A workflow takes only the prompt: its steps bring their own agents, skills and options.
    const asTask = !workflow;
    const where = !repo
        ? t("newTask.description")
        : !repo.git
          ? t("newTask.inFolder")
          : inCheckout && asTask
            ? t(newBranch !== null ? "newTask.onNewBranch" : "newTask.inCheckout")
            : repo.github
              ? t("newTask.inWorktree")
              : t("newTask.localBranch");
    const canVary = !!repo?.git && !dispatch && asTask && worktree;
    const pending = create.isPending || start.isPending;

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-[12svh] pb-8">
            <div className="mx-auto w-full max-w-3xl space-y-6">
                <header className="space-y-1.5 text-center">
                    <h1 className="text-2xl font-semibold tracking-tight">{t("newTask.title")}</h1>
                    <p className="text-sm text-muted-foreground">{where}</p>
                </header>
                <Popover open={skillOpen} onOpenChange={setSkillOpen}>
                    <PopoverAnchor asChild>
                        <div>
                            <PromptBox
                                value={text}
                                onChange={setText}
                                onSubmit={(prompt) => {
                                    if (!repo) return;
                                    if (workflow) start.mutate(prompt);
                                    else create.mutate(prompt);
                                }}
                                onSlash={() => setSkillOpen(true)}
                                attachments={attachments}
                                onMenuClosed={() => {
                                    if (!pickAfterMenu.current) return false;
                                    pickAfterMenu.current = false;
                                    setSkillOpen(true);
                                    return true;
                                }}
                                menu={
                                    <>
                                        <DropdownMenuItem
                                            onSelect={() => (pickAfterMenu.current = true)}
                                        >
                                            <SparklesIcon />
                                            {t("prompt.skillOrWorkflow")}
                                            <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">
                                                {workflow?.name ?? skill?.name ?? "/"}
                                            </span>
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <VariantsMenu
                                            value={canVary ? variants : 1}
                                            onChange={setVariants}
                                            disabled={!canVary}
                                        />
                                        <DropdownMenuCheckboxItem
                                            checked={!!dispatch}
                                            disabled={!repo?.git || !asTask || !worktree}
                                            onCheckedChange={(on) => {
                                                setDispatch(on ? DISPATCH_DEFAULT : null);
                                                if (on) setVariants(1);
                                            }}
                                        >
                                            <SplitIcon />
                                            {t("prompt.dispatch")}
                                        </DropdownMenuCheckboxItem>
                                        {repo?.git && asTask && (
                                            <>
                                                {/* Variants and dispatch need a worktree per task. */}
                                                <DropdownMenuCheckboxItem
                                                    checked={worktree}
                                                    disabled={!!dispatch || variants > 1}
                                                    onCheckedChange={(on) => {
                                                        setWorktree(on);
                                                        if (on) setNewBranch(null);
                                                    }}
                                                >
                                                    <FolderTreeIcon />
                                                    {t("prompt.worktree")}
                                                </DropdownMenuCheckboxItem>
                                                <DropdownMenuCheckboxItem
                                                    checked={newBranch !== null}
                                                    disabled={worktree}
                                                    onCheckedChange={(on) =>
                                                        setNewBranch(on ? "" : null)
                                                    }
                                                >
                                                    <GitBranchPlusIcon />
                                                    {t("prompt.newBranch")}
                                                </DropdownMenuCheckboxItem>
                                            </>
                                        )}
                                        {repo?.git && (
                                            <BaseMenu
                                                repo={repo}
                                                onChanged={(branch) =>
                                                    setNote(t("prompt.baseChanged", { branch }))
                                                }
                                            />
                                        )}
                                        {repo && asTask && (
                                            <IntegrationsMenu
                                                repo={repo.id}
                                                value={chosen}
                                                onChange={setChosen}
                                            />
                                        )}
                                        <DropdownMenuSeparator />
                                    </>
                                }
                                label={t("newTask.body")}
                                placeholder={t("newTask.placeholder")}
                                pending={pending}
                                canSend={
                                    !!repo &&
                                    (!!titleOf(text) || (asTask && attachments.ids.length > 0))
                                }
                                autoFocus
                                toolbar={
                                    <>
                                        <ProjectChip
                                            repos={repos.data}
                                            value={repo}
                                            onChange={(id) => {
                                                setPicked(id);
                                                setChosen([]);
                                                setWorkflow(null);
                                                // The new project's default replaces one of the old project's own.
                                                if (!ownSkill || ownSkill.source === PROJECT)
                                                    setSkill(undefined);
                                            }}
                                        />
                                        {asTask && (
                                            <ModelChip value={choice} onChange={setChoice} />
                                        )}
                                        {skill && (
                                            <ActiveChip
                                                icon={<SparklesIcon />}
                                                label={skill.name}
                                                removeLabel={t("prompt.removeSkill", {
                                                    skill: skill.name,
                                                })}
                                                onRemove={() => setSkill(null)}
                                            />
                                        )}
                                        {workflow && (
                                            <ActiveChip
                                                icon={<WorkflowIcon />}
                                                label={workflow.name}
                                                removeLabel={t("prompt.removeWorkflow", {
                                                    workflow: workflow.name,
                                                })}
                                                onRemove={() => setWorkflow(null)}
                                            />
                                        )}
                                        {inCheckout && asTask && (
                                            <ActiveChip
                                                icon={<FolderIcon />}
                                                label={t("prompt.inCheckout")}
                                                removeLabel={t("prompt.backToWorktree")}
                                                onRemove={() => {
                                                    setWorktree(true);
                                                    setNewBranch(null);
                                                }}
                                            />
                                        )}
                                        {inCheckout && asTask && newBranch !== null && (
                                            <BranchChip
                                                value={newBranch}
                                                onChange={setNewBranch}
                                                onRemove={() => setNewBranch(null)}
                                            />
                                        )}
                                        {canVary && variants > 1 && (
                                            <ActiveChip
                                                icon={<CopyIcon />}
                                                label={`×${variants}`}
                                                removeLabel={t("prompt.resetVariants")}
                                                onRemove={() => setVariants(1)}
                                            />
                                        )}
                                        {repo?.git && asTask && dispatch && (
                                            <DispatchChip
                                                value={dispatch}
                                                parent={choice.agent}
                                                onChange={setDispatch}
                                            />
                                        )}
                                        {asTask && chosen.length > 0 && (
                                            <ActiveChip
                                                icon={<PlugIcon />}
                                                label={t("prompt.integrations", {
                                                    count: chosen.length,
                                                })}
                                                removeLabel={t("prompt.resetIntegrations")}
                                                onRemove={() => setChosen([])}
                                            />
                                        )}
                                    </>
                                }
                            />
                        </div>
                    </PopoverAnchor>
                    <PopoverContent
                        align="start"
                        className="w-(--radix-popover-trigger-width) max-w-md p-0"
                    >
                        <SkillPicker
                            repo={repo?.id ?? null}
                            skill={skill?.id ?? null}
                            workflow={workflow?.id ?? null}
                            onSkill={(next) => {
                                setSkill(next);
                                setWorkflow(null);
                                setSkillOpen(false);
                            }}
                            onWorkflow={(next) => {
                                setWorkflow(next);
                                setSkill(null);
                                setSkillOpen(false);
                            }}
                        />
                    </PopoverContent>
                </Popover>
                <FormError error={create.error ?? start.error} />
                <div className="flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setText(t(`newTask.suggestions.${key}`))}
                            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                            <SparklesIcon className="size-3.5" />
                            {t(`newTask.suggestions.${key}`)}
                        </button>
                    ))}
                </div>
                {note && <p className="text-center text-xs text-muted-foreground">{note}</p>}
            </div>
        </div>
    );
}
