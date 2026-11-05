import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2Icon, WebhookIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { CopyButton } from "@/components/copy-button";
import { InitGit } from "@/components/init-git";
import { FormError, Loading } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, repoPath } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { keys, useRepos, useRepoWrite, useWebhooks } from "@/lib/queries";
import type { Repo } from "@/lib/types";
import { Section, useIsAdmin } from "@/pages/project/shared";
import { Toggle } from "@/pages/project/tasks";

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate">{children}</dd>
        </>
    );
}

// Where the project lives, its entry, and leaving OLIMP without touching the disk.
export function General({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const format = useFormat();
    const admin = useIsAdmin();
    return (
        <>
            <Section title={t("repo.folderTitle")} description={t("repo.folderHint")}>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm" title={repo.folder}>
                        {repo.folder}
                    </code>
                    <CopyButton value={repo.folder} label={t("repo.copyFolder")} />
                </div>
            </Section>
            <Section title={t("repo.projectTitle")} description={t("repo.projectHint")}>
                <dl className="grid grid-cols-[minmax(0,8rem)_1fr] gap-x-4 gap-y-2 text-sm">
                    <Row label={t("repo.name")}>
                        <span className="font-medium">{repo.id}</span>
                    </Row>
                    <Row label={t("repo.status")}>
                        <span className="flex flex-wrap items-center gap-2">
                            <Badge variant={repo.git ? "constructive" : "secondary"}>
                                {t(repo.git ? "repo.statusGit" : "repo.statusFolder")}
                            </Badge>
                            {!repo.git && admin && repo.path && <InitGit repo={repo} />}
                        </span>
                    </Row>
                    <Row label={t("repo.defaultBranch")}>
                        <span className="font-mono">{repo.defaultBranch || "–"}</span>
                    </Row>
                    <Row label="GitHub">
                        {repo.github ? (
                            <a
                                href={`https://github.com/${repo.github}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="font-mono hover:underline"
                            >
                                {repo.github}
                            </a>
                        ) : (
                            <span className="text-muted-foreground">{t("repo.noGithub")}</span>
                        )}
                    </Row>
                    <Row label={t("repo.added")}>
                        {format.dateTime(repo.addedAt)}
                        <span className="text-muted-foreground">
                            {" · "}
                            {t(repo.path ? "repo.ownFolder" : "repo.clone")}
                        </span>
                    </Row>
                </dl>
            </Section>
            <KnowledgeBase repo={repo} />
            {admin && <WebhooksSummary repo={repo.id} />}
            {admin && <RemoveProject repo={repo} />}
        </>
    );
}

// Off, agents know the project from its own files; on, they ask its memory and its areas'.
function KnowledgeBase({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const repos = useRepos();
    const write = useRepoWrite(repo.id);
    const others = (repos.data ?? []).filter((r) => r.id !== repo.id);
    const toggle = (area: string, on: boolean) =>
        write.mutate({
            method: "PATCH",
            path: "settings",
            body: {
                areas: on
                    ? [...repo.settings.areas, area]
                    : repo.settings.areas.filter((a) => a !== area),
            },
        });
    return (
        <Section title={t("repo.memoryTitle")} description={t("repo.memoryHint")}>
            <Toggle repo={repo} field="memory" label={t("repo.memoryTitle")} />
            {repo.settings.memory && (
                <div className="space-y-2 pt-2">
                    <p className="text-sm font-medium">{t("repo.areasTitle")}</p>
                    <p className="text-sm text-muted-foreground">{t("repo.areasHint")}</p>
                    {others.length ? (
                        <ul className="grid gap-2 sm:grid-cols-2">
                            {others.map((other) => (
                                <li key={other.id}>
                                    <Label className="font-normal">
                                        <Checkbox
                                            checked={repo.settings.areas.includes(other.id)}
                                            disabled={write.isPending}
                                            onCheckedChange={(on) => toggle(other.id, on === true)}
                                        />
                                        {other.id}
                                    </Label>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground">{t("repo.areasNone")}</p>
                    )}
                    <FormError error={write.error} />
                </div>
            )}
        </Section>
    );
}

// How the project's receivers stand, a way to them.
function WebhooksSummary({ repo }: { repo: string }) {
    const t = useTranslations("web");
    const hooks = useWebhooks(repo);
    const list = hooks.data ?? [];
    const failing = list.filter((h) => h.last && !h.last.ok).length;
    return (
        <Section
            title={t("projectSettings.webhooks")}
            description={t("projectSettings.webhooksHint")}
            action={
                <Button asChild variant="outline" size="sm">
                    <Link to={`/project/${repo}/settings/webhooks`}>
                        <WebhookIcon />
                        {t("repo.manageWebhooks")}
                    </Link>
                </Button>
            }
        >
            {hooks.isPending ? (
                <Loading>
                    <Skeleton className="h-5 w-64 max-w-full" />
                </Loading>
            ) : (
                <p className="text-sm text-muted-foreground">
                    {!list.length
                        ? t("repo.noWebhooksTitle")
                        : t("repo.webhooksSummary", {
                              active: list.filter((h) => h.enabled).length,
                              paused: list.filter((h) => !h.enabled).length,
                          })}
                    {failing > 0 && (
                        <span className="text-destructive">
                            {" · "}
                            {t("repo.webhooksFailing", { count: failing })}
                        </span>
                    )}
                </p>
            )}
        </Section>
    );
}

function RemoveProject({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const client = useQueryClient();
    const [confirming, setConfirming] = useState(false);
    const remove = useMutation({
        mutationFn: () => api<Repo>(`/api/repos/${repoPath(repo.id)}`, { method: "DELETE" }),
        onSuccess: () => {
            void client.invalidateQueries({ queryKey: keys.repos });
            navigate("/");
        },
    });
    return (
        <Section
            title={t("repo.removeTitle")}
            description={t("repo.removeHint")}
            className="border-destructive/30"
        >
            <div className="space-y-3">
                {confirming ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-destructive/5 p-3 text-sm">
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
                ) : (
                    <Button variant="destructive" onClick={() => setConfirming(true)}>
                        <Trash2Icon />
                        {t("repo.remove", { repo: repo.id })}
                    </Button>
                )}
                <FormError error={remove.error} />
            </div>
        </Section>
    );
}
