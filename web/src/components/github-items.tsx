import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    ArrowLeftIcon,
    BotIcon,
    CheckIcon,
    CircleDotIcon,
    GitMergeIcon,
    GitPullRequestDraftIcon,
    GitPullRequestIcon,
    InfoIcon,
    LoaderIcon,
    MessageSquareIcon,
    RefreshCwIcon,
    SearchIcon,
    TriangleAlertIcon,
    XIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { ExternalLink } from "@/components/external-link";
import { FacetedFilter } from "@/components/faceted-filter";
import { Markdown } from "@/components/markdown";
import { ErrorState, FormError, Loading } from "@/components/page";
import { SkeletonText, times } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, repoPath } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { NEW_TASK } from "@/lib/nav";
import { type GithubKind, keys, useGithubItem, useGithubItems } from "@/lib/queries";
import type { GithubDetail, GithubItem, MergeMethod, Repo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/pages/project/shared";

// GitHub's own label color, tinted so the name stays readable in both themes.
function LabelChip({ name, color }: { name: string; color: string }) {
    const hex = /^[0-9a-f]{6}$/i.test(color) ? `#${color}` : null;
    return (
        <span
            className="inline-flex h-5 max-w-40 items-center gap-1 rounded-full border px-2 text-[0.7rem] font-medium"
            style={hex ? { borderColor: `${hex}99`, backgroundColor: `${hex}22` } : undefined}
        >
            <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-muted-foreground"
                style={hex ? { backgroundColor: hex } : undefined}
            />
            <span className="truncate">{name}</span>
        </span>
    );
}

function Labels({ item }: { item: GithubItem }) {
    if (!item.labels.length) return null;
    return (
        <div className="flex flex-wrap gap-1">
            {item.labels.map((label) => (
                <LabelChip key={label.name} {...label} />
            ))}
        </div>
    );
}

function KindIcon({ kind, item }: { kind: GithubKind; item: GithubItem }) {
    if (kind === "issues") return <CircleDotIcon className="text-constructive" />;
    return item.draft ? (
        <GitPullRequestDraftIcon className="text-muted-foreground" />
    ) : (
        <GitPullRequestIcon className="text-constructive" />
    );
}

function Row({
    kind,
    item,
    selected,
    onSelect,
}: {
    kind: GithubKind;
    item: GithubItem;
    selected: boolean;
    onSelect: () => void;
}) {
    const format = useFormat();
    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-current={selected || undefined}
                className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
                    selected && "bg-muted",
                )}
            >
                <KindIcon kind={kind} item={item} />
                <span className="min-w-0 flex-1 space-y-1">
                    <span className="line-clamp-2 text-sm font-medium">{item.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="font-mono">#{item.number}</span>
                        <span>{item.author}</span>
                        <span>{format.relative(item.createdAt)}</span>
                        {item.comments > 0 && (
                            <span className="inline-flex items-center gap-0.5">
                                <MessageSquareIcon className="size-3" />
                                {item.comments}
                            </span>
                        )}
                        {item.additions !== null && (
                            <span className="font-mono tabular-nums">
                                <span className="text-constructive">+{item.additions}</span>{" "}
                                <span className="text-destructive">−{item.deletions}</span>
                            </span>
                        )}
                    </span>
                    <Labels item={item} />
                </span>
            </button>
        </li>
    );
}

const STATUSES = ["clean", "has_hooks", "unstable", "blocked", "behind", "dirty", "draft"];

function MergePanel({ repo, item }: { repo: Repo; item: GithubDetail }) {
    const t = useTranslations("web");
    const client = useQueryClient();
    const isAdmin = useIsAdmin();
    const merge = item.merge;
    const [method, setMethod] = useState<MergeMethod | null>(null);
    const chosen = method ?? merge?.methods[0] ?? null;
    const run = useMutation({
        mutationFn: () =>
            api<GithubDetail>(`/api/repos/${repoPath(repo.id)}/github/prs/${item.number}/merge`, {
                method: "POST",
                body: { method: chosen, sha: merge?.headSha },
            }),
        onSuccess: (detail) => {
            client.setQueryData(keys.githubItem(repo.id, "prs", item.number), detail);
            void client.invalidateQueries({ queryKey: keys.github(repo.id, "prs") });
        },
        // A refusal usually means the pull request moved on: show where it is now.
        onError: () =>
            client.invalidateQueries({ queryKey: keys.githubItem(repo.id, "prs", item.number) }),
    });
    if (!merge) return null;
    if (item.state !== "open")
        return (
            <Card size="sm">
                <CardContent className="flex items-center gap-2 text-sm font-medium">
                    <GitMergeIcon className="size-4 text-violet-500" />
                    {t(item.state === "merged" ? "github.merged" : "github.closed")}
                </CardContent>
            </Card>
        );
    const status = item.draft
        ? "draft"
        : STATUSES.includes(merge.status)
          ? merge.status
          : "unknown";
    const label = repo.settings.autoMergeLabel;
    const automatic = !!label && item.labels.some((l) => l.name === label);
    return (
        <Card size="sm" className={cn(merge.ready ? "ring-constructive/40" : "ring-amber-500/40")}>
            <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                    {merge.ready ? (
                        <CheckIcon className="mt-0.5 size-4 shrink-0 text-constructive" />
                    ) : (
                        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    )}
                    <div className="min-w-0 flex-1">
                        <p className="font-medium">
                            {t(merge.ready ? "github.readyToMerge" : "github.mergeBlocked")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {t(`github.status.${status as "clean"}`)}
                        </p>
                        <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">
                            {item.branch} → {merge.base} ({merge.headSha.slice(0, 8)})
                        </p>
                    </div>
                </div>
                {merge.checks.length ? (
                    <ul className="space-y-1">
                        {merge.checks.map((check) => (
                            <li
                                key={`${check.name}-${check.url}`}
                                className="flex items-center gap-2 text-sm [&>svg]:size-3.5 [&>svg]:shrink-0"
                            >
                                {check.state === "passing" ? (
                                    <CheckIcon className="text-constructive" />
                                ) : check.state === "failing" ? (
                                    <XIcon className="text-destructive" />
                                ) : (
                                    <LoaderIcon className="animate-spin text-amber-500 motion-reduce:animate-none" />
                                )}
                                {check.url ? (
                                    <a
                                        href={check.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="truncate hover:underline"
                                    >
                                        {check.name}
                                    </a>
                                ) : (
                                    <span className="truncate">{check.name}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-muted-foreground">{t("github.noChecks")}</p>
                )}
                {merge.review && (
                    <p className="text-xs text-muted-foreground">
                        {t(`github.review.${merge.review as "approved"}`)}
                    </p>
                )}
                {automatic && (
                    <Alert variant="info" role="note" className="px-3 py-2">
                        <InfoIcon />
                        <AlertDescription className="text-xs">
                            {t(merge.auto ? "github.autoNow" : "github.autoWaits", { label })}
                        </AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={chosen ?? undefined}
                        onValueChange={(value) => setMethod(value as MergeMethod)}
                        disabled={!merge.methods.length}
                    >
                        <SelectTrigger className="w-52" aria-label={t("github.method")}>
                            <SelectValue placeholder={t("github.noMethods")} />
                        </SelectTrigger>
                        <SelectContent>
                            {merge.methods.map((m) => (
                                <SelectItem key={m} value={m}>
                                    {t(`github.methods.${m}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        disabled={!merge.ready || !chosen || !isAdmin || run.isPending}
                        onClick={() => run.mutate()}
                    >
                        <GitMergeIcon />
                        {chosen ? t(`github.methods.${chosen}`) : t("github.merge")}
                    </Button>
                    {!isAdmin && (
                        <span className="text-xs text-muted-foreground">
                            {t("github.adminOnly")}
                        </span>
                    )}
                </div>
                <FormError error={run.error} />
            </CardContent>
        </Card>
    );
}

function DetailSkeleton() {
    return (
        <div className="space-y-4">
            <div className="flex h-8 items-center">
                <Skeleton className="h-4 w-64 max-w-full" />
            </div>
            <Skeleton className="h-6 w-3/4" />
            <div className="rounded-xl border bg-card p-4">
                <SkeletonText lines={5} />
            </div>
        </div>
    );
}

function Detail({
    repo,
    kind,
    number,
    onBack,
}: {
    repo: Repo;
    kind: GithubKind;
    number: number;
    onBack: () => void;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const query = useGithubItem(repo.id, kind, number);
    if (query.isPending)
        return (
            <Loading>
                <DetailSkeleton />
            </Loading>
        );
    if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
    const item = query.data;
    const prompt = t(kind === "prs" ? "github.promptPr" : "github.promptIssue", {
        number: item.number,
        title: item.title,
        url: item.url,
    });
    return (
        <article className="space-y-4">
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onBack}>
                    <ArrowLeftIcon />
                    <span className="sr-only">{t("github.back")}</span>
                </Button>
                <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono">#{item.number}</span>
                    <span>{t(kind === "prs" ? "github.pr" : "github.issue")}</span>
                    <span>{t("github.openedBy", { author: item.author })}</span>
                    <span>{format.relative(item.createdAt)}</span>
                    {item.additions !== null && (
                        <span className="font-mono">
                            <span className="text-constructive">+{item.additions}</span>{" "}
                            <span className="text-destructive">−{item.deletions}</span>
                        </span>
                    )}
                    <ExternalLink href={item.url} className="text-xs">
                        {t("github.openOnGithub")}
                    </ExternalLink>
                </p>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("git.refresh")}
                    title={t("git.refresh")}
                    disabled={query.isFetching}
                    onClick={() => query.refetch()}
                >
                    <RefreshCwIcon className={cn(query.isFetching && "animate-spin")} />
                </Button>
            </div>
            <h2 className="text-lg font-semibold text-balance">{item.title}</h2>
            <Labels item={item} />
            <div className="rounded-xl border bg-card p-4">
                {item.body.trim() ? (
                    <Markdown>{item.body}</Markdown>
                ) : (
                    <p className="text-sm text-muted-foreground">{t("github.noBody")}</p>
                )}
            </div>
            {item.conversation.length > 0 && (
                <section className="space-y-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {t("github.comments", { count: item.conversation.length })}
                    </h3>
                    <ul className="space-y-2">
                        {item.conversation.map((comment) => (
                            <li
                                key={`${comment.author}-${comment.createdAt}`}
                                className="rounded-xl border p-3"
                            >
                                <p className="mb-1.5 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">
                                        {comment.author}
                                    </span>{" "}
                                    {format.relative(comment.createdAt)}
                                </p>
                                <Markdown>{comment.body}</Markdown>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
            {/* A new head starts the panel over, without the last attempt's error. */}
            <MergePanel key={item.merge?.headSha} repo={repo} item={item} />
            <Button asChild variant="outline">
                <Link
                    to={`${NEW_TASK}?repo=${encodeURIComponent(repo.id)}&prompt=${encodeURIComponent(prompt)}`}
                >
                    <BotIcon />
                    {t("github.handToAgent")}
                </Link>
            </Button>
        </article>
    );
}

// A project's open pull requests or issues: a list with search and labels, and the picked one beside
// it. The pick rides in ?pr= or ?issue=, so each tab keeps its own.
function ItemsSkeleton() {
    return (
        <div className="space-y-0.5 rounded-xl border bg-card p-1">
            {times(6).map((row) => (
                <div key={row} className="flex items-start gap-2.5 px-3 py-2.5">
                    <Skeleton className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function GithubItems({ repo, kind }: { repo: Repo; kind: GithubKind }) {
    const t = useTranslations("web");
    const [params, setParams] = useSearchParams();
    const param = kind === "prs" ? "pr" : "issue";
    const selected = Number(params.get(param)) || null;
    const list = useGithubItems(repo.id, kind);
    const [query, setQuery] = useState("");
    const [labels, setLabels] = useState<string[]>([]);
    const select = (number: number | null) =>
        setParams(
            (current) => {
                const out = new URLSearchParams(current);
                if (number === null) out.delete(param);
                else out.set(param, String(number));
                return out;
            },
            { replace: true },
        );
    const all = list.data ?? [];
    const needle = query.trim().toLowerCase();
    const shown = all.filter(
        (item) =>
            (!labels.length || item.labels.some((l) => labels.includes(l.name))) &&
            (!needle ||
                `#${item.number} ${item.title} ${item.author}`.toLowerCase().includes(needle)),
    );
    const counts = new Map<string, number>();
    for (const item of all)
        for (const label of item.labels) counts.set(label.name, (counts.get(label.name) ?? 0) + 1);

    return (
        <div className="grid gap-6 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)] lg:items-start">
            <section className={cn("space-y-3", selected && "hidden lg:block")}>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t("github.search")}
                            aria-label={t("github.search")}
                            className="h-8 pl-8"
                        />
                    </div>
                    <FacetedFilter
                        title={t("github.labels")}
                        options={[...counts].map(([name, count]) => ({
                            value: name,
                            label: name,
                            count,
                        }))}
                        selected={labels}
                        onSelectedChange={setLabels}
                        labels={{ empty: t("github.noLabels"), clear: t("github.clear") }}
                    />
                </div>
                {list.isPending ? (
                    <Loading>
                        <ItemsSkeleton />
                    </Loading>
                ) : list.isError ? (
                    <ErrorState error={list.error} onRetry={() => list.refetch()} />
                ) : !shown.length ? (
                    <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {all.length
                            ? t("github.noMatch")
                            : t(kind === "prs" ? "github.noPrs" : "github.noIssues")}
                    </p>
                ) : (
                    <ul className="space-y-0.5 rounded-xl border bg-card p-1">
                        {shown.map((item) => (
                            <Row
                                key={item.number}
                                kind={kind}
                                item={item}
                                selected={item.number === selected}
                                onSelect={() => select(item.number)}
                            />
                        ))}
                    </ul>
                )}
            </section>
            <section className={cn(!selected && "hidden lg:block")}>
                {selected ? (
                    <Detail
                        key={selected}
                        repo={repo}
                        kind={kind}
                        number={selected}
                        onBack={() => select(null)}
                    />
                ) : (
                    <EmptyState
                        icon={kind === "prs" ? <GitPullRequestIcon /> : <CircleDotIcon />}
                        title={t("github.pickTitle")}
                        description={t("github.pick")}
                    />
                )}
            </section>
        </div>
    );
}
