import {
    ArrowUpRightIcon,
    CloudIcon,
    FolderGit2Icon,
    PlusIcon,
    RefreshCwIcon,
    SearchIcon,
    StarIcon,
    StarOffIcon,
    UserIcon,
    UsersIcon,
    WorkflowIcon,
    ZapIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { ExternalLink } from "@/components/external-link";
import { ErrorState, FormError, Loading } from "@/components/page";
import { SkeletonText, times } from "@/components/skeletons";
import { SkillText } from "@/components/skill-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { NEW_TASK } from "@/lib/nav";
import {
    useAutomations,
    useRefreshSkills,
    useRepo,
    useRepoWrite,
    useSkills,
    useWorkflows,
} from "@/lib/queries";
import { OWN, PROJECT, SYNCED, skillGroup } from "@/lib/skill-ref";
import type { Repo, Skill } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALL = "all";
const MANAGE = "/settings/general/skills";

const ITEM =
    "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

const KIND = {
    project: { variant: "constructive", Icon: FolderGit2Icon },
    team: { variant: "info", Icon: UsersIcon },
    own: { variant: "progress", Icon: UserIcon },
    synced: { variant: "secondary", Icon: CloudIcon },
} as const;

const kindOf = ({ source }: Skill): keyof typeof KIND =>
    source === PROJECT ? "project" : source === OWN ? "own" : source === SYNCED ? "synced" : "team";

function KindBadge({ skill }: { skill: Skill }) {
    const t = useTranslations("web");
    const kind = kindOf(skill);
    const { variant, Icon } = KIND[kind];
    return (
        <Badge variant={variant}>
            <Icon aria-hidden="true" />
            {t(`skills.kind.${kind}`)}
        </Badge>
    );
}

interface Section {
    key: string;
    title: string;
    skills: Skill[];
    empty?: { text: string; link?: string; label?: string };
}

function ListSkeleton() {
    return (
        <Loading className="space-y-3">
            {times(2).map((group) => (
                <div key={group} className="space-y-1">
                    <Skeleton className="mx-2 mt-1 mb-2 h-3 w-24" />
                    {times(group ? 4 : 2).map((row) => (
                        <div key={row} className="space-y-1.5 px-2.5 py-2">
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-3 w-full" />
                        </div>
                    ))}
                </div>
            ))}
        </Loading>
    );
}

// A skill as SkillDetail draws it: the card, then the content.
function DetailSkeleton() {
    return (
        <Loading className="space-y-6">
            <div className="space-y-3 rounded-xl border bg-card p-5">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-3 w-72 max-w-full" />
                <SkeletonText lines={2} />
            </div>
            <div className="space-y-3">
                <Skeleton className="h-6 w-40" />
                <SkeletonText lines={5} />
            </div>
        </Loading>
    );
}

export function ProjectSkillsPage() {
    const t = useTranslations("web");
    const { id = "" } = useParams();
    const repo = useRepo(id);
    const skills = useSkills(id);
    const refresh = useRefreshSkills();
    const [params] = useSearchParams();
    const [query, setQuery] = useState("");
    const [shown, setShown] = useState(ALL);
    const sections = repo.data && skills.data ? sectionsOf(repo.data, skills.data, t) : [];
    const needle = query.trim().toLowerCase();
    const visible = sections
        .filter((s) => shown === ALL || s.key === shown)
        .map((s) => ({
            ...s,
            skills: s.skills.filter((skill) =>
                [skill.id, skill.description].some((v) => v.toLowerCase().includes(needle)),
            ),
        }));
    const all = sections.flatMap((s) => s.skills);
    const fallback = all.find((s) => s.id === repo.data?.settings.defaultSkill) ?? all[0];
    const selected = all.find((s) => s.id === params.get("skill")) ?? fallback ?? null;
    const error = repo.error ?? skills.error;
    return (
        // `relative` keeps the list's absolute `sr-only` labels from stretching the window's scroll.
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
            <nav
                aria-label={t("nav.skills")}
                className="flex shrink-0 flex-col border-b bg-card lg:w-80 lg:border-r lg:border-b-0 xl:w-96"
            >
                <div className="space-y-3 border-b p-3">
                    <div className="flex items-center justify-between gap-2 pl-1">
                        <h1 className="text-lg font-semibold tracking-tight">{t("nav.skills")}</h1>
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={refresh.isPending}
                            onClick={() => refresh.mutate()}
                            title={t("skills.refreshHint")}
                        >
                            {refresh.isPending ? <Spinner /> : <RefreshCwIcon />}
                            {t("skills.refresh")}
                        </Button>
                    </div>
                    <InputGroup>
                        <InputGroupAddon>
                            <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("skills.filter")}
                            aria-label={t("skills.filter")}
                        />
                    </InputGroup>
                    <Select value={shown} onValueChange={setShown}>
                        <SelectTrigger className="w-full" aria-label={t("skills.source")}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ALL}>
                                {t("skills.allSources", { count: all.length })}
                            </SelectItem>
                            {sections.map((s) => (
                                <SelectItem key={s.key} value={s.key}>
                                    {s.title} ({s.skills.length})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <FormError error={refresh.error} />
                </div>
                <div className="scroll-fade relative max-h-72 min-h-0 space-y-3 overflow-y-auto p-1.5 lg:max-h-none lg:flex-1">
                    {error ? (
                        <ErrorState
                            error={error}
                            onRetry={() => {
                                void repo.refetch();
                                void skills.refetch();
                            }}
                        />
                    ) : !repo.data || !skills.data ? (
                        <ListSkeleton />
                    ) : needle && !visible.some((s) => s.skills.length) ? (
                        <p className="px-2 py-1 text-sm text-muted-foreground">
                            {t("skills.noMatch", { query: query.trim() })}
                        </p>
                    ) : (
                        visible.map((section) => (
                            <SkillList
                                key={section.key}
                                section={section}
                                filtered={Boolean(needle)}
                                current={selected?.id ?? null}
                                defaultSkill={repo.data?.settings.defaultSkill ?? null}
                            />
                        ))
                    )}
                </div>
            </nav>
            <div className="scroll-fade min-w-0 flex-1 lg:overflow-y-auto">
                <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
                    {error ? null : !repo.data || !skills.data ? (
                        <DetailSkeleton />
                    ) : (
                        <>
                            <MissingDefault repo={repo.data} skills={all} />
                            {selected ? (
                                <SkillDetail key={selected.id} skill={selected} repo={repo.data} />
                            ) : (
                                <p className="text-sm text-muted-foreground">{t("skills.none")}</p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// The project's own skills, one section per team source, then the account's.
function sectionsOf(
    repo: Repo,
    skills: Skill[],
    t: ReturnType<typeof useTranslations<"web">>,
): Section[] {
    const of = (group: string) => skills.filter((s) => skillGroup(s) === group);
    const team = of("team");
    const sources = [...new Set(team.map((s) => s.source))];
    return [
        {
            key: "project",
            title: t("skills.project"),
            skills: of("project"),
            empty: { text: t("skills.projectEmpty") },
        },
        ...(!repo.settings.teamSkills
            ? [
                  {
                      key: "team",
                      title: t("skills.team"),
                      skills: [],
                      empty: {
                          text: t("skills.teamOff"),
                          link: `/project/${repo.id}/settings/tasks`,
                          label: t("skills.projectSettings"),
                      },
                  },
              ]
            : sources.length
              ? sources.map((source) => ({
                    key: source,
                    title: source,
                    skills: team.filter((s) => s.source === source),
                }))
              : [
                    {
                        key: "team",
                        title: t("skills.team"),
                        skills: [],
                        empty: {
                            text: t("skills.teamEmpty"),
                            link: MANAGE,
                            label: t("skills.manage"),
                        },
                    },
                ]),
        {
            key: "own",
            title: t("skills.own"),
            skills: of("own"),
            empty: { text: t("skills.ownEmpty"), link: MANAGE, label: t("skills.manage") },
        },
    ];
}

function SkillList({
    section,
    filtered,
    current,
    defaultSkill,
}: {
    section: Section;
    filtered: boolean;
    current: string | null;
    defaultSkill: string | null;
}) {
    const t = useTranslations("web");
    if (!section.skills.length && (filtered || !section.empty)) return null;
    return (
        <div className="space-y-1">
            <h2 className="flex items-center justify-between gap-2 px-2 pt-1 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <span className="truncate">{section.title}</span>
                <span className="tabular-nums">{section.skills.length}</span>
            </h2>
            {!section.skills.length && section.empty ? (
                <p className="px-2 pb-1 text-xs text-muted-foreground">
                    {section.empty.text}{" "}
                    {section.empty.link && (
                        <Link to={section.empty.link} className="font-medium underline">
                            {section.empty.label}
                        </Link>
                    )}
                </p>
            ) : (
                <ul className="space-y-0.5">
                    {section.skills.map((skill) => (
                        <li key={skill.id}>
                            <Link
                                to={`?${new URLSearchParams({ skill: skill.id })}`}
                                replace
                                aria-current={skill.id === current ? "page" : undefined}
                                className={cn(ITEM, skill.id === current && "bg-muted")}
                            >
                                <span className="flex items-center gap-2">
                                    <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
                                        {skill.name}
                                    </span>
                                    {skill.id === defaultSkill && (
                                        <>
                                            <StarIcon
                                                aria-hidden="true"
                                                className="size-3.5 shrink-0 fill-current text-amber-500"
                                            />
                                            <span className="sr-only">{t("skills.default")}</span>
                                        </>
                                    )}
                                    <KindBadge skill={skill} />
                                </span>
                                {skill.description && (
                                    <span className="line-clamp-2 text-xs text-muted-foreground">
                                        {skill.description}
                                    </span>
                                )}
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function MissingDefault({ repo, skills }: { repo: Repo; skills: Skill[] }) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo.id);
    const current = repo.settings.defaultSkill;
    if (!current || skills.some((s) => s.id === current)) return null;
    return (
        <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                {t("skills.missingDefault", { skill: current })}
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={write.isPending}
                    onClick={() =>
                        write.mutate({
                            method: "PATCH",
                            path: "settings",
                            body: { defaultSkill: null },
                        })
                    }
                >
                    <StarOffIcon />
                    {t("skills.clearDefault")}
                </Button>
            </p>
            <FormError error={write.error} />
        </div>
    );
}

function SkillDetail({ skill, repo }: { skill: Skill; repo: Repo }) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo.id);
    const group = skillGroup(skill);
    const isDefault = skill.id === repo.settings.defaultSkill;
    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate font-mono text-lg">{skill.name}</span>
                        <KindBadge skill={skill} />
                        {isDefault && (
                            <Badge variant="secondary">
                                <StarIcon />
                                {t("skills.default")}
                            </Badge>
                        )}
                    </CardTitle>
                    <p className="font-mono text-xs break-all text-muted-foreground">
                        {skill.id}
                        {group === "team" && (
                            <>
                                {" · "}
                                <ExternalLink href={`https://github.com/${skill.source}`}>
                                    {skill.source}
                                </ExternalLink>
                            </>
                        )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {t(`skills.kindHint.${kindOf(skill)}`)}
                    </p>
                    <CardAction className="flex flex-wrap gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={write.isPending}
                            onClick={() =>
                                write.mutate({
                                    method: "PATCH",
                                    path: "settings",
                                    body: { defaultSkill: isDefault ? null : skill.id },
                                })
                            }
                        >
                            {isDefault ? <StarOffIcon /> : <StarIcon />}
                            {isDefault ? t("skills.clearDefault") : t("skills.setDefault")}
                        </Button>
                        <Button asChild variant="outline" size="sm">
                            <Link
                                to={`${NEW_TASK}?${new URLSearchParams({ repo: repo.id, skill: skill.id })}`}
                                aria-label={t("skills.newTaskWith", { name: skill.name })}
                            >
                                <PlusIcon />
                                {t("skills.newTask")}
                            </Link>
                        </Button>
                    </CardAction>
                </CardHeader>
                <CardContent className="space-y-4">
                    <FormError error={write.error} />
                    {skill.description && (
                        <p className="text-sm text-muted-foreground">{skill.description}</p>
                    )}
                    <UsedBy skill={skill} repo={repo.id} />
                    {group !== "project" && (
                        <Button asChild variant="link" size="sm" className="px-0">
                            <Link to={MANAGE}>
                                {t("skills.manage")}
                                <ArrowUpRightIcon />
                            </Link>
                        </Button>
                    )}
                </CardContent>
            </Card>
            <section className="space-y-3">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {t("skills.content")}
                </h2>
                <SkillText skill={skill} repo={repo.id} />
            </section>
        </>
    );
}

// The project's workflows with an agent step and its automations that follow the skill.
function UsedBy({ skill, repo }: { skill: Skill; repo: string }) {
    const t = useTranslations("web");
    const workflows = useWorkflows();
    const automations = useAutomations();
    const users = [
        ...(workflows.data ?? [])
            .filter(
                (w) =>
                    w.repo === repo &&
                    w.definition.nodes.some((n) => n.type === "agent" && n.skill === skill.id),
            )
            .map((w) => ({ id: w.id, name: w.name, to: `/workflows/${w.id}`, Icon: WorkflowIcon })),
        ...(automations.data ?? [])
            .filter((a) => a.repo === repo && a.skill === skill.id)
            .map((a) => ({
                id: a.id,
                name: a.name,
                to: `/project/${repo}/automations/${a.id}`,
                Icon: ZapIcon,
            })),
    ];
    return (
        <div className="space-y-2 border-t pt-4">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t("skills.usedBy")}
            </h3>
            {workflows.isPending || automations.isPending ? (
                <Loading>
                    <Skeleton className="h-4 w-48" />
                </Loading>
            ) : users.length ? (
                <ul className="flex flex-wrap gap-2">
                    {users.map(({ id, name, to, Icon }) => (
                        <li key={id}>
                            <Button asChild variant="outline" size="sm">
                                <Link to={to}>
                                    <Icon />
                                    {name}
                                </Link>
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground">{t("skills.unused")}</p>
            )}
        </div>
    );
}
