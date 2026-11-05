import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderGit2Icon, FolderIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { AddRepoMenu } from "@/components/add-repo";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { api, repoPath } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFormat } from "@/lib/format";
import { keys, useRepos } from "@/lib/queries";
import type { Repo } from "@/lib/types";
import { SettingCard } from "@/pages/settings/setting-card";

function ProjectRow({ repo, admin }: { repo: Repo; admin: boolean }) {
    const t = useTranslations("web");
    const format = useFormat();
    const client = useQueryClient();
    const [confirming, setConfirming] = useState(false);
    const remove = useMutation({
        mutationFn: () => api<Repo>(`/api/repos/${repoPath(repo.id)}`, { method: "DELETE" }),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.repos }),
    });
    const settings = `/project/${repo.id}/settings/general`;
    if (confirming)
        return (
            <TableRow className="bg-destructive/5 hover:bg-destructive/5">
                <TableCell colSpan={4} className="whitespace-normal">
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                            <p>{t("repo.confirmRemove", { repo: repo.id })}</p>
                            <code className="block break-all font-mono text-xs text-muted-foreground">
                                {repo.folder}
                            </code>
                        </div>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="max-w-full"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate()}
                        >
                            <Trash2Icon />
                            <span className="truncate">{t("repo.remove", { repo: repo.id })}</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                            {t("common.cancel")}
                        </Button>
                    </div>
                    <FormError error={remove.error} />
                </TableCell>
            </TableRow>
        );
    return (
        <TableRow>
            <TableCell className="max-w-64">
                <div className="flex items-center gap-3">
                    {repo.git ? (
                        <FolderGit2Icon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                        <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                        <Link to={settings} className="block truncate font-medium hover:underline">
                            {repo.id}
                        </Link>
                        <p
                            className="truncate font-mono text-xs text-muted-foreground"
                            title={repo.folder}
                        >
                            {repo.folder}
                        </p>
                    </div>
                </div>
            </TableCell>
            <TableCell>
                <div className="flex flex-wrap gap-1.5">
                    <Badge variant={repo.git ? "constructive" : "secondary"}>
                        {t(repo.git ? "repo.statusGit" : "repo.statusFolder")}
                    </Badge>
                    {repo.git && repo.defaultBranch && (
                        <Badge variant="outline" className="font-mono">
                            {repo.defaultBranch}
                        </Badge>
                    )}
                    <Badge variant="outline" className={repo.github ? "font-mono" : undefined}>
                        {repo.github ?? t("repos.local")}
                    </Badge>
                    {repo.issueLabel && (
                        <Badge variant="info">
                            {t("repos.issuesOn", { label: repo.issueLabel })}
                        </Badge>
                    )}
                </div>
            </TableCell>
            <TableCell className="text-muted-foreground" title={format.dateTime(repo.addedAt)}>
                {format.relative(repo.addedAt)}
            </TableCell>
            <TableCell className="text-right">
                <Button asChild variant="ghost" size="icon" aria-label={t("repos.settings")}>
                    <Link to={settings}>
                        <SettingsIcon />
                    </Link>
                </Button>
                {admin && (
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("repo.remove", { repo: repo.id })}
                        onClick={() => setConfirming(true)}
                    >
                        <Trash2Icon />
                    </Button>
                )}
            </TableCell>
        </TableRow>
    );
}

function ProjectTable({ children }: { children: ReactNode }) {
    const t = useTranslations("web");
    return (
        <div className="rounded-xl border">
            <Table>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        <TableHead>{t("repo.name")}</TableHead>
                        <TableHead>{t("repo.status")}</TableHead>
                        <TableHead>{t("repo.added")}</TableHead>
                        <TableHead className="text-right">{t("repos.actions")}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>{children}</TableBody>
            </Table>
        </div>
    );
}

function ProjectList() {
    const t = useTranslations("web");
    const repos = useRepos();
    const me = useMe();
    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="space-y-1.5">
                    <CardTitle>{t("settings.registered")}</CardTitle>
                    <CardDescription>{t("settings.registeredHint")}</CardDescription>
                </div>
                <AddRepoMenu />
            </CardHeader>
            <CardContent>
                {repos.isPending ? (
                    <Loading>
                        <ProjectTable>
                            {times(3).map((row) => (
                                <TableRow key={row} className="hover:bg-transparent">
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Skeleton className="size-4" />
                                            <div className="space-y-1.5">
                                                <Skeleton className="h-4 w-32" />
                                                <Skeleton className="h-3 w-44" />
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex gap-1.5">
                                            <Skeleton className="h-5 w-12" />
                                            <Skeleton className="h-5 w-16" />
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Skeleton className="h-4 w-20" />
                                    </TableCell>
                                    <TableCell>
                                        <Skeleton className="ml-auto size-9 rounded-4xl" />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </ProjectTable>
                    </Loading>
                ) : repos.isError ? (
                    <ErrorState error={repos.error} onRetry={() => repos.refetch()} />
                ) : !repos.data.length ? (
                    <EmptyState
                        icon={<FolderGit2Icon />}
                        title={t("repos.emptyTitle")}
                        description={t("repos.empty")}
                    />
                ) : (
                    <ProjectTable>
                        {repos.data.map((repo) => (
                            <ProjectRow
                                key={repo.id}
                                repo={repo}
                                admin={!me || me.role === "admin"}
                            />
                        ))}
                    </ProjectTable>
                )}
            </CardContent>
        </Card>
    );
}

export function Projects() {
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <SettingCard name="browseRoot" />
            <SettingCard name="projectsDir" />
            <ProjectList />
        </div>
    );
}
