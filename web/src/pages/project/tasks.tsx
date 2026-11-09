import {
    CircleDotIcon,
    FolderInputIcon,
    GitBranchIcon,
    GitMergeIcon,
    GitPullRequestDraftIcon,
    MessageSquareCodeIcon,
    SaveIcon,
    SparklesIcon,
    TagIcon,
    TagsIcon,
    UsersIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { FormError } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableSelectGroup } from "@/components/ui/searchable-select";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useBranches, useRepoWrite, useSetBaseBranch, useSkills } from "@/lib/queries";
import type { Repo } from "@/lib/types";
import { Section, useIsAdmin } from "@/pages/project/shared";

const DEFAULT = "default";
const NONE = "none";

// One setting of several in a card, as SettingSection in the general settings.
function Row({
    icon,
    id,
    title,
    hint,
    children,
}: {
    icon: ReactNode;
    id: string;
    title: string;
    hint: string;
    children: ReactNode;
}) {
    return (
        <section className="flex gap-4 py-5 first:pt-0 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground [&_svg]:size-4">
                {icon}
            </span>
            <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-1">
                    <Label htmlFor={id}>{title}</Label>
                    <p className="text-sm text-muted-foreground">{hint}</p>
                </div>
                {children}
            </div>
        </section>
    );
}

function Workspace({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo.id);
    if (!repo.git) return <p className="text-sm text-muted-foreground">{t("repo.inPlaceOnly")}</p>;
    return (
        <>
            <Select
                value={repo.settings.workspace ?? DEFAULT}
                disabled={write.isPending}
                onValueChange={(value) =>
                    write.mutate({
                        method: "PATCH",
                        path: "settings",
                        body: { workspace: value === DEFAULT ? null : value },
                    })
                }
            >
                <SelectTrigger id="workspace" className="w-full sm:max-w-md">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={DEFAULT}>{t("repo.workspaceDefault")}</SelectItem>
                    <SelectItem value="worktree">{t("repo.workspaceWorktree")}</SelectItem>
                    <SelectItem value="checkout">{t("repo.workspaceCheckout")}</SelectItem>
                </SelectContent>
            </Select>
            <FormError error={write.error} />
        </>
    );
}

function BaseBranch({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const branches = useBranches(repo.git ? repo.id : null);
    const save = useSetBaseBranch();
    if (!repo.git)
        return <p className="text-sm text-muted-foreground">{t("repo.noGitBranches")}</p>;
    if (!branches.data) return <Skeleton className="h-9 w-full sm:max-w-md" />;
    return (
        <>
            <Select
                value={repo.defaultBranch}
                disabled={save.isPending}
                onValueChange={(branch) => save.mutate({ repo: repo.id, branch })}
            >
                <SelectTrigger id="base-branch" className="w-full font-mono sm:max-w-md">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {branches.data.branches.map((branch) => (
                        <SelectItem key={branch} value={branch} className="font-mono">
                            {branch}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <FormError error={save.error} />
        </>
    );
}

// A setting that is on or off, saved at once.
export function Toggle({
    repo,
    field,
    label,
}: {
    repo: Repo;
    field: "teamSkills" | "draftPr" | "typeLabel" | "prReview" | "memory";
    label: string;
}) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo.id);
    const on = repo.settings[field];
    return (
        <>
            <Label className="font-normal text-muted-foreground">
                <Switch
                    id={field}
                    checked={on}
                    disabled={write.isPending}
                    aria-label={label}
                    onCheckedChange={(value) =>
                        write.mutate({
                            method: "PATCH",
                            path: "settings",
                            body: { [field]: value },
                        })
                    }
                />
                {on ? t("repo.on") : t("repo.off")}
            </Label>
            <FormError error={write.error} />
        </>
    );
}

// Comma separated, as gh takes them; GitHub labels never hold a comma.
const labelsOf = (text: string) => [
    ...new Set(
        text
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
    ),
];

function PrLabels({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo.id);
    const [value, setValue] = useState(repo.settings.prLabels.join(", "));
    const labels = labelsOf(value);
    const changed = labels.join(",") !== repo.settings.prLabels.join(",");
    return (
        <>
            <form
                className="flex w-full gap-2 sm:max-w-md"
                onSubmit={(event) => {
                    event.preventDefault();
                    write.mutate({ method: "PATCH", path: "settings", body: { prLabels: labels } });
                }}
            >
                <Input
                    id="prLabels"
                    value={value}
                    placeholder="olimp, agent"
                    onChange={(event) => setValue(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={!changed || write.isPending}>
                    {t("common.save")}
                </Button>
            </form>
            <FormError error={write.error} />
        </>
    );
}

function AutoMerge({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const isAdmin = useIsAdmin();
    const write = useRepoWrite(repo.id);
    const current = repo.settings.autoMergeLabel;
    const [value, setValue] = useState(current ?? "");
    const save = (label: string | null) =>
        write.mutate({ method: "PATCH", path: "settings", body: { autoMergeLabel: label } });
    return (
        <>
            <form
                className="flex w-full flex-wrap gap-2 sm:max-w-md"
                onSubmit={(event) => {
                    event.preventDefault();
                    save(value.trim());
                }}
            >
                <Input
                    id="autoMergeLabel"
                    value={value}
                    placeholder="risk:low"
                    disabled={!isAdmin}
                    onChange={(event) => setValue(event.target.value)}
                    className="min-w-40 flex-1"
                />
                <Button
                    type="submit"
                    variant="outline"
                    disabled={
                        !isAdmin || !value.trim() || value.trim() === current || write.isPending
                    }
                >
                    {t("common.save")}
                </Button>
                {current && (
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={!isAdmin || write.isPending}
                        onClick={() => {
                            setValue("");
                            save(null);
                        }}
                    >
                        {t("repo.autoMergeOff")}
                    </Button>
                )}
            </form>
            <p className="text-xs text-muted-foreground">
                {current ? t("repo.autoMergeOn", { label: current }) : t("repo.autoMergeNone")}
                {!isAdmin && ` ${t("repo.autoMergeAdmin")}`}
            </p>
            <FormError error={write.error} />
        </>
    );
}

function DefaultSkill({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const skills = useSkills(repo.id);
    const write = useRepoWrite(repo.id);
    const value = repo.settings.defaultSkill ?? NONE;
    if (!skills.data) return <Skeleton className="h-9 w-full sm:max-w-md" />;
    // The project's own first, then each source, as the composer lists them.
    const sources = [...new Set(skills.data.map((s) => s.source))];
    const groups: SearchableSelectGroup[] = [
        { label: "", options: [{ value: NONE, label: t("repo.noDefaultSkill") }] },
        ...sources.map((source) => ({
            label: source === "." ? t("repo.thisProject") : source,
            options: skills.data
                .filter((s) => s.source === source)
                .map((s) => ({ value: s.id, label: s.name, keywords: s.description })),
        })),
    ];
    // A default whose skill is gone stays shown, so it can be cleared.
    if (value !== NONE && !skills.data.some((s) => s.id === value))
        groups.splice(1, 0, { label: "", options: [{ value, label: value }] });
    return (
        <>
            <SearchableSelect
                id="default-skill"
                groups={groups}
                value={value}
                disabled={write.isPending}
                searchPlaceholder={t("repo.searchSkills")}
                className="sm:max-w-md"
                renderValue={(option) =>
                    option.value === NONE ? (
                        <span className="text-muted-foreground">{option.label}</span>
                    ) : (
                        <>
                            <SparklesIcon className="text-muted-foreground" />
                            {option.label}
                        </>
                    )
                }
                onValueChange={(skill) =>
                    write.mutate({
                        method: "PATCH",
                        path: "settings",
                        body: { defaultSkill: skill === NONE ? null : skill },
                    })
                }
            />
            <FormError error={write.error} />
        </>
    );
}

function Commands({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const [text, setText] = useState(repo.commands.join("\n"));
    const write = useRepoWrite(repo.id);
    const commands = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const changed = commands.join("\n") !== repo.commands.join("\n");
    const submit = (event: FormEvent) => {
        event.preventDefault();
        write.mutate(
            commands.length
                ? { method: "PUT", path: "commands", body: { commands } }
                : { method: "DELETE", path: "commands" },
        );
    };
    return (
        <Section title={t("repo.commandsTitle")} description={t("repo.commandsHint")}>
            <form onSubmit={submit} className="space-y-3">
                <Label htmlFor="commands" className="sr-only">
                    {t("repo.commandsTitle")}
                </Label>
                <Textarea
                    id="commands"
                    value={text}
                    spellCheck={false}
                    placeholder={"pnpm typecheck\npnpm lint\npnpm run test"}
                    className="font-mono"
                    onChange={(e) => setText(e.target.value)}
                />
                <FormError error={write.error} />
                <div className="flex flex-wrap items-center gap-3">
                    <Button type="submit" disabled={write.isPending || !changed}>
                        <SaveIcon />
                        {t("common.save")}
                    </Button>
                    <span className="text-sm text-muted-foreground">
                        {write.isSuccess && !changed
                            ? t("repo.saved")
                            : t("repo.commandsCount", { count: commands.length })}
                    </span>
                </div>
            </form>
        </Section>
    );
}

function Issues({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const [label, setLabel] = useState(repo.issueLabel ?? "olimp");
    const write = useRepoWrite(repo.id);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (label.trim())
            write.mutate({ method: "PUT", path: "issues", body: { label: label.trim() } });
    };
    return (
        <Section
            title={t("repo.issuesTitle")}
            description={t("repo.issuesHint")}
            action={
                <Badge variant={repo.issueLabel ? "constructive" : "secondary"}>
                    <CircleDotIcon />
                    {repo.issueLabel ? t("repo.on") : t("repo.off")}
                </Badge>
            }
        >
            {repo.github ? (
                <form onSubmit={submit} className="space-y-3">
                    <div className="space-y-2">
                        <Label htmlFor="issue-label">{t("repo.label")}</Label>
                        <Input
                            id="issue-label"
                            value={label}
                            maxLength={50}
                            className="sm:max-w-xs"
                            onChange={(e) => setLabel(e.target.value)}
                        />
                    </div>
                    <FormError error={write.error} />
                    <div className="flex flex-wrap gap-2">
                        <Button type="submit" disabled={write.isPending || !label.trim()}>
                            <SaveIcon />
                            {repo.issueLabel ? t("common.save") : t("repo.enable")}
                        </Button>
                        {repo.issueLabel && (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={write.isPending}
                                onClick={() => write.mutate({ method: "DELETE", path: "issues" })}
                            >
                                {t("repo.disable")}
                            </Button>
                        )}
                    </div>
                </form>
            ) : (
                <p className="text-sm text-muted-foreground">{t("repo.issuesGithubOnly")}</p>
            )}
        </Section>
    );
}

// The task settings: where tasks work and from which branch, the checks
// agents run, and GitHub issues as a task source.
export function Tasks({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    return (
        <>
            <Section title={t("repo.whereTitle")} description={t("repo.whereHint")}>
                <div className="divide-y">
                    <Row
                        icon={<FolderInputIcon />}
                        id="workspace"
                        title={t("repo.workspaceTitle")}
                        hint={t("repo.workspaceHint")}
                    >
                        <Workspace repo={repo} />
                    </Row>
                    <Row
                        icon={<GitBranchIcon />}
                        id="base-branch"
                        title={t("repo.baseTitle")}
                        hint={t("repo.baseHint")}
                    >
                        <BaseBranch repo={repo} />
                    </Row>
                </div>
            </Section>
            <Section title={t("repo.composerTitle")} description={t("repo.composerHint")}>
                <div className="divide-y">
                    <Row
                        icon={<SparklesIcon />}
                        id="default-skill"
                        title={t("repo.defaultSkillTitle")}
                        hint={t("repo.defaultSkillHint")}
                    >
                        <DefaultSkill repo={repo} />
                    </Row>
                    <Row
                        icon={<UsersIcon />}
                        id="teamSkills"
                        title={t("repo.teamSkillsTitle")}
                        hint={t("repo.teamSkillsHint")}
                    >
                        <Toggle repo={repo} field="teamSkills" label={t("repo.teamSkillsTitle")} />
                    </Row>
                </div>
            </Section>
            <Section title={t("repo.pullRequestsTitle")} description={t("repo.pullRequestsHint")}>
                <div className="divide-y">
                    <Row
                        icon={<GitPullRequestDraftIcon />}
                        id="draftPr"
                        title={t("repo.draftPrTitle")}
                        hint={t("repo.draftPrHint")}
                    >
                        {repo.github ? (
                            <Toggle repo={repo} field="draftPr" label={t("repo.draftPrTitle")} />
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {t("repo.noPullRequests")}
                            </p>
                        )}
                    </Row>
                    {repo.github && (
                        <>
                            <Row
                                icon={<TagsIcon />}
                                id="prLabels"
                                title={t("repo.prLabelsTitle")}
                                hint={t("repo.prLabelsHint")}
                            >
                                <PrLabels repo={repo} />
                            </Row>
                            <Row
                                icon={<TagIcon />}
                                id="typeLabel"
                                title={t("repo.typeLabelTitle")}
                                hint={t("repo.typeLabelHint")}
                            >
                                <Toggle
                                    repo={repo}
                                    field="typeLabel"
                                    label={t("repo.typeLabelTitle")}
                                />
                            </Row>
                            <Row
                                icon={<MessageSquareCodeIcon />}
                                id="prReview"
                                title={t("repo.prReviewTitle")}
                                hint={t("repo.prReviewHint")}
                            >
                                <Toggle
                                    repo={repo}
                                    field="prReview"
                                    label={t("repo.prReviewTitle")}
                                />
                            </Row>
                            <Row
                                icon={<GitMergeIcon />}
                                id="autoMergeLabel"
                                title={t("repo.autoMergeTitle")}
                                hint={t("repo.autoMergeHint")}
                            >
                                <AutoMerge repo={repo} />
                            </Row>
                        </>
                    )}
                </div>
            </Section>
            <Commands repo={repo} />
            <Issues key={repo.issueLabel} repo={repo} />
        </>
    );
}
