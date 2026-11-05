import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowUpRightIcon, FileDiffIcon, GitBranchIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Delta, DiffSkeleton, DiffView } from "@/components/diff";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, Loading } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { type JobKind, useChanges } from "@/lib/queries";
import type { Changes } from "@/lib/types";

// The branch of a task or run against the default branch, as OLIMP's clone has them.
export function ChangesView({
    kind,
    id,
    prUrl,
}: {
    kind: JobKind;
    id: string;
    prUrl: string | null;
}) {
    return <ChangesBody changes={useChanges(kind, id)} prUrl={prUrl} />;
}

export function ChangesSkeleton() {
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-40 rounded-md" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
            </div>
            <DiffSkeleton />
        </div>
    );
}

// `working` is a project folder's uncommitted work rather than a pushed branch.
export function ChangesBody({
    changes,
    prUrl = null,
    working = false,
}: {
    changes: UseQueryResult<Changes>;
    prUrl?: string | null;
    working?: boolean;
}) {
    const t = useTranslations("web");
    if (changes.isPending)
        return (
            <Loading>
                <ChangesSkeleton />
            </Loading>
        );
    if (changes.isError)
        return <ErrorState error={changes.error} onRetry={() => changes.refetch()} />;
    const data = changes.data;
    const sum = (key: "added" | "deleted") =>
        data.files.reduce((total, file) => total + (file[key] ?? 0), 0);
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs">
                    <GitBranchIcon className="size-3.5 text-muted-foreground" />
                    {data.branch ?? "–"}
                </span>
                {data.files.length > 0 && (
                    <span className="inline-flex items-center gap-2">
                        {t("changes.files", { count: data.files.length })}
                        <Delta added={sum("added")} deleted={sum("deleted")} />
                    </span>
                )}
                <span className="text-muted-foreground">
                    {working ? t("changes.uncommitted") : t("changes.base", { base: data.base })}
                </span>
                {prUrl && (
                    <a
                        href={prUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 font-medium text-info hover:underline"
                    >
                        {t("fields.pr")}
                        <ArrowUpRightIcon className="size-3.5" />
                    </a>
                )}
            </div>
            {!data.head ? (
                <EmptyState
                    icon={<GitBranchIcon />}
                    title={t("changes.notPushedTitle")}
                    description={t("changes.notPushed")}
                />
            ) : !data.files.length ? (
                <EmptyState
                    icon={<FileDiffIcon />}
                    title={t(working ? "changes.cleanTitle" : "changes.noFilesTitle")}
                    description={t(working ? "changes.clean" : "changes.noFiles")}
                />
            ) : (
                <>
                    <DiffView diff={data.diff} files={data.files} />
                    {(data.filesTruncated || data.diffTruncated) && (
                        <p className="text-xs text-muted-foreground">
                            {data.filesTruncated
                                ? t("changes.filesTruncated")
                                : t("changes.diffTruncated", { size: data.diff.length })}
                        </p>
                    )}
                </>
            )}
        </div>
    );
}
