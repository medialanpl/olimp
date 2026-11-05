import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    FlaskConicalIcon,
    PencilIcon,
    PlusIcon,
    SearchIcon,
    SparklesIcon,
    Trash2Icon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { ExternalLink } from "@/components/external-link";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, repoPath } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { NEW_TASK } from "@/lib/nav";
import { keys, useSkillSources, useSkills, useSkillText } from "@/lib/queries";
import { OWN } from "@/lib/skill-ref";
import type { SkillHit } from "@/lib/types";

function useSourceWrite() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({
            repo,
            branch,
            remove,
        }: {
            repo: string;
            branch?: string;
            remove?: boolean;
        }) =>
            remove
                ? api(`/api/skill-sources/${repoPath(repo)}`, { method: "DELETE" })
                : api("/api/skill-sources", { method: "POST", body: { repo, branch } }),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.skillSources });
            void client.invalidateQueries({ queryKey: keys.skills });
        },
    });
}

// The skills repositories tasks choose skills from; OLIMP fetches them on GitHub with its gh login.
export function Skills() {
    const t = useTranslations("web");
    const format = useFormat();
    const sources = useSkillSources();
    const skills = useSkills();
    const write = useSourceWrite();
    const [repo, setRepo] = useState("");
    const [branch, setBranch] = useState("");
    const add = (event: FormEvent) => {
        event.preventDefault();
        if (repo.trim())
            write.mutate(
                { repo: repo.trim(), branch: branch.trim() },
                {
                    onSuccess: () => {
                        setRepo("");
                        setBranch("");
                    },
                },
            );
    };
    const count = (id: string) => skills.data?.filter((s) => s.source === id).length;
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const [searched, setSearched] = useState("");
    const search = useQuery({
        queryKey: ["skill-search", searched],
        queryFn: () => api<SkillHit[]>(`/api/skill-search?${new URLSearchParams({ q: searched })}`),
        enabled: searched.length >= 2,
        staleTime: 5 * 60_000,
    });
    const find = (event: FormEvent) => {
        event.preventDefault();
        setSearched(query.trim());
    };
    // Trying a skill registers its repository first, then opens a new task with the skill picked.
    const tryHit = (hit: SkillHit) => {
        const open = () => navigate(`${NEW_TASK}?${new URLSearchParams({ skill: hit.id })}`);
        if (sources.data?.some((s) => s.id === hit.source)) open();
        else write.mutate({ repo: hit.source }, { onSuccess: open });
    };
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.skillSearch")}</CardTitle>
                    <CardDescription>{t("settings.skillSearchHint")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form onSubmit={find} className="flex flex-wrap gap-2">
                        <Input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("settings.skillSearchPlaceholder")}
                            aria-label={t("settings.skillSearch")}
                            className="min-w-0 flex-1"
                        />
                        <Button type="submit" variant="outline" disabled={query.trim().length < 2}>
                            <SearchIcon />
                            {t("settings.skillSearchButton")}
                        </Button>
                    </form>
                    {!searched ? null : search.isPending ? (
                        <RowsSkeleton>
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-8 w-20 rounded-4xl" />
                        </RowsSkeleton>
                    ) : search.isError ? (
                        <ErrorState error={search.error} onRetry={() => search.refetch()} />
                    ) : !search.data.length ? (
                        <p className="text-sm text-muted-foreground">
                            {t("settings.skillSearchEmpty", { query: searched })}
                        </p>
                    ) : (
                        <ul className="divide-y rounded-lg border">
                            {search.data.map((hit) => (
                                <li key={hit.id} className="flex items-center gap-3 p-3">
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <ExternalLink
                                            href={`https://skills.sh/${hit.source}/${hit.name}`}
                                            className="truncate text-sm font-medium"
                                        >
                                            {hit.name}
                                        </ExternalLink>
                                        <p className="truncate font-mono text-xs text-muted-foreground">
                                            {hit.source}
                                        </p>
                                    </div>
                                    <Badge variant="secondary">
                                        {t("settings.skillInstalls", {
                                            count: format.count(hit.installs),
                                        })}
                                    </Badge>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={write.isPending}
                                        onClick={() => tryHit(hit)}
                                    >
                                        <FlaskConicalIcon />
                                        {t("settings.trySkill")}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
            <OwnSkills />
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.skillSources")}</CardTitle>
                    <CardDescription>{t("settings.skillSourcesHint")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form onSubmit={add} className="flex flex-wrap gap-2">
                        <Input
                            value={repo}
                            onChange={(e) => setRepo(e.target.value)}
                            placeholder="owner/skills"
                            aria-label={t("settings.skillSourceRepo")}
                            spellCheck={false}
                            className="min-w-0 flex-1 font-mono"
                        />
                        <Input
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            placeholder="main"
                            aria-label={t("settings.skillSourceBranch")}
                            spellCheck={false}
                            className="w-32 font-mono"
                        />
                        <Button type="submit" disabled={write.isPending || !repo.trim()}>
                            <PlusIcon />
                            {t("settings.addSource")}
                        </Button>
                    </form>
                    <FormError error={write.error} />
                    {sources.isPending ? (
                        <RowsSkeleton>
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="size-9 rounded-4xl" />
                        </RowsSkeleton>
                    ) : sources.isError ? (
                        <ErrorState error={sources.error} onRetry={() => sources.refetch()} />
                    ) : !sources.data.length ? (
                        <EmptyState
                            icon={<SparklesIcon />}
                            title={t("settings.noSourcesTitle")}
                            description={t("settings.noSources")}
                        />
                    ) : (
                        <ul className="divide-y rounded-lg border">
                            {sources.data.map((source) => (
                                <li key={source.id} className="flex items-center gap-3 p-3">
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <p className="truncate font-mono text-sm font-medium">
                                            {source.id}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {t("settings.sourceAdded", {
                                                branch: source.defaultBranch,
                                                when: format.relative(source.addedAt),
                                            })}
                                        </p>
                                    </div>
                                    {skills.data && (
                                        <Badge variant="secondary">
                                            {t("settings.skillCount", {
                                                count: count(source.id) ?? 0,
                                            })}
                                        </Badge>
                                    )}
                                    <Button
                                        variant="destructive"
                                        size="icon"
                                        aria-label={t("settings.removeSource", { repo: source.id })}
                                        disabled={write.isPending}
                                        onClick={() =>
                                            write.mutate({ repo: source.id, remove: true })
                                        }
                                    >
                                        <Trash2Icon />
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

// A list row of this page: a name and a line under it, then the row's own badges and buttons.
function RowsSkeleton({ children }: { children: ReactNode }) {
    return (
        <Loading>
            <ul className="divide-y rounded-lg border">
                {times(3).map((row) => (
                    <li key={row} className="flex items-center gap-3 p-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-3 w-56 max-w-full" />
                        </div>
                        {children}
                    </li>
                ))}
            </ul>
        </Loading>
    );
}
const skillTemplate = (name: string) => `---\nname: ${name}\ndescription: \n---\n\n# ${name}\n\n`;

function useOwnSkillWrite() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({
            name,
            content,
            method,
        }: {
            name: string;
            content?: string;
            method: string;
        }) =>
            method === "POST"
                ? api("/api/own-skills", { method, body: { name, content } })
                : api(`/api/own-skills/${name}`, {
                      method,
                      body: content === undefined ? undefined : { content },
                  }),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.skills }),
    });
}

// The account's own skills live in its agents' HOME (~/.claude/skills), usable in every project.
function OwnSkills() {
    const t = useTranslations("web");
    const skills = useSkills();
    const [editing, setEditing] = useState<{ name: string | null } | null>(null);
    const own = skills.data?.filter((s) => s.source === OWN) ?? [];
    const close = () => setEditing(null);
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("settings.ownSkills")}</CardTitle>
                <CardDescription>{t("settings.ownSkillsHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Button variant="outline" onClick={() => setEditing({ name: null })}>
                    <PlusIcon />
                    {t("settings.newSkill")}
                </Button>
                {skills.isPending ? (
                    <RowsSkeleton>
                        <Skeleton className="size-9 rounded-4xl" />
                        <Skeleton className="size-9 rounded-4xl" />
                    </RowsSkeleton>
                ) : skills.isError ? (
                    <ErrorState error={skills.error} onRetry={() => skills.refetch()} />
                ) : (
                    own.length > 0 && (
                        <ul className="divide-y rounded-lg border">
                            {own.map((skill) => (
                                <OwnSkillRow
                                    key={skill.id}
                                    name={skill.name}
                                    description={skill.description}
                                    onEdit={() => setEditing({ name: skill.name })}
                                />
                            ))}
                        </ul>
                    )
                )}
                <Dialog open={editing !== null} onOpenChange={(open) => !open && close()}>
                    <DialogContent className="sm:max-w-3xl">
                        {editing?.name ? (
                            <EditOwnSkill name={editing.name} onDone={close} />
                        ) : (
                            editing && <OwnSkillForm name={null} initial="" onDone={close} />
                        )}
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}

function OwnSkillRow({
    name,
    description,
    onEdit,
}: {
    name: string;
    description: string;
    onEdit: () => void;
}) {
    const t = useTranslations("web");
    const write = useOwnSkillWrite();
    const [confirming, setConfirming] = useState(false);
    if (confirming)
        return (
            <li className="flex flex-wrap items-center gap-3 bg-destructive/5 p-3 text-sm">
                <p className="flex-1">{t("settings.confirmDeleteSkill", { name })}</p>
                <Button
                    variant="destructive"
                    size="sm"
                    disabled={write.isPending}
                    onClick={() => write.mutate({ name, method: "DELETE" })}
                >
                    <Trash2Icon />
                    {t("settings.deleteSkill")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    {t("common.cancel")}
                </Button>
                <FormError error={write.error} />
            </li>
        );
    return (
        <li className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate font-mono text-sm font-medium">{name}</p>
                {description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
                )}
            </div>
            <Button
                variant="ghost"
                size="icon"
                aria-label={t("settings.editSkill", { name })}
                onClick={onEdit}
            >
                <PencilIcon />
            </Button>
            <Button
                variant="destructive"
                size="icon"
                aria-label={t("settings.deleteSkillNamed", { name })}
                onClick={() => setConfirming(true)}
            >
                <Trash2Icon />
            </Button>
        </li>
    );
}

function OwnSkillFormSkeleton({ name }: { name: string }) {
    const t = useTranslations("web");
    return (
        <Loading className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
                <DialogTitle>{t("settings.editSkill", { name })}</DialogTitle>
                <DialogDescription>{t("settings.skillEditorHint")}</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-80 w-full" />
            </DialogBody>
            <DialogFooter>
                <Skeleton className="h-9 w-20 rounded-4xl" />
                <Skeleton className="h-9 w-28 rounded-4xl" />
            </DialogFooter>
        </Loading>
    );
}

function EditOwnSkill({ name, onDone }: { name: string; onDone: () => void }) {
    const text = useSkillText(`${OWN}/${name}`, null);
    if (text.isPending) return <OwnSkillFormSkeleton name={name} />;
    if (text.isError) return <ErrorState error={text.error} onRetry={() => text.refetch()} />;
    return <OwnSkillForm name={name} initial={text.data.content} onDone={onDone} />;
}

// `name` null creates a skill; otherwise its SKILL.md is replaced.
function OwnSkillForm({
    name,
    initial,
    onDone,
}: {
    name: string | null;
    initial: string;
    onDone: () => void;
}) {
    const t = useTranslations("web");
    const write = useOwnSkillWrite();
    const [newName, setNewName] = useState("");
    const [content, setContent] = useState(initial);
    const save = (event: FormEvent) => {
        event.preventDefault();
        write.mutate(
            name
                ? { name, content, method: "PUT" }
                : { name: newName.trim(), content, method: "POST" },
            { onSuccess: onDone },
        );
    };
    return (
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
                <DialogTitle>
                    {name ? t("settings.editSkill", { name }) : t("settings.newSkill")}
                </DialogTitle>
                <DialogDescription>{t("settings.skillEditorHint")}</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-3">
                {!name && (
                    <div className="space-y-2">
                        <Label htmlFor="own-skill-name">{t("settings.skillName")}</Label>
                        <Input
                            id="own-skill-name"
                            value={newName}
                            onChange={(e) => {
                                const next = e.target.value;
                                if (content === skillTemplate(newName.trim()) || !content)
                                    setContent(skillTemplate(next.trim()));
                                setNewName(next);
                            }}
                            placeholder="my-skill"
                            spellCheck={false}
                            className="font-mono"
                        />
                    </div>
                )}
                <div className="space-y-2">
                    <Label htmlFor="own-skill-content">SKILL.md</Label>
                    <Textarea
                        id="own-skill-content"
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        spellCheck={false}
                        className="min-h-80 font-mono text-xs"
                    />
                </div>
                <FormError error={write.error} />
            </DialogBody>
            <DialogFooter>
                <DialogClose asChild>
                    <Button type="button" variant="ghost">
                        {t("common.cancel")}
                    </Button>
                </DialogClose>
                <Button
                    type="submit"
                    disabled={write.isPending || !content.trim() || (!name && !newName.trim())}
                >
                    {t("settings.saveSkill")}
                </Button>
            </DialogFooter>
        </form>
    );
}
