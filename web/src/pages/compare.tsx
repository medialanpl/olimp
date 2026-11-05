import { ArrowUpRightIcon, CheckIcon, CrownIcon } from "lucide-react";
import { Link, useParams } from "react-router";
import { useTranslations } from "use-intl";
import { AgentMark } from "@/components/agent-mark";
import { Delta } from "@/components/diff";
import { Markdown } from "@/components/markdown";
import { ErrorState, Fact, FormError, PageHeader } from "@/components/page";
import { CompareSkeleton } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { isActive } from "@/components/task-chat";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/lib/format";
import { useChanges, usePickVariant, useVariants } from "@/lib/queries";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

function Variant({
    task,
    picked,
    canPick,
    onPick,
    picking,
}: {
    task: Task;
    picked: string | null;
    canPick: boolean;
    onPick: () => void;
    picking: boolean;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const changes = useChanges("task", task.id, !isActive(task));
    const winner = picked === task.id;
    const dropped = picked !== null && !winner;
    return (
        <Card
            className={cn(
                "flex flex-col",
                winner && "ring-2 ring-constructive",
                dropped && "opacity-60",
            )}
        >
            <CardHeader className="gap-2">
                <div className="flex items-center gap-2">
                    <span className="flex size-7 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                        {task.variant}
                    </span>
                    <CardTitle className="min-w-0 flex-1 truncate text-sm">
                        {t(`compare.approach.${(task.variant ?? "A") as "A" | "B" | "C"}`)}
                    </CardTitle>
                    {winner ? (
                        <Badge variant="constructive">
                            <CrownIcon />
                            {t("compare.kept")}
                        </Badge>
                    ) : dropped ? (
                        <Badge variant="outline">{t("compare.dropped")}</Badge>
                    ) : (
                        <StatusBadge status={task.status} />
                    )}
                </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-4">
                <dl className="grid grid-cols-2 gap-3">
                    <Fact label={t("fields.duration")}>{format.duration(task.durationMs)}</Fact>
                    <Fact label={t("fields.cost")}>{format.cost(task.costUsd)}</Fact>
                    <Fact label={t("fields.lines")}>
                        {task.linesAdded === null ? (
                            "–"
                        ) : (
                            <Delta added={task.linesAdded} deleted={task.linesDeleted} />
                        )}
                    </Fact>
                    <Fact label={t("compare.files")}>
                        {format.count(changes.data?.files.length)}
                    </Fact>
                </dl>
                <div className="relative max-h-72 overflow-hidden">
                    {task.error ? (
                        <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
                            {task.error}
                        </p>
                    ) : task.log.trim() ? (
                        <Markdown>{task.log}</Markdown>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            {isActive(task) ? t("task.chat.working") : t("task.noAnswer")}
                        </p>
                    )}
                    {task.log.length > 600 && (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-card to-transparent" />
                    )}
                </div>
            </CardContent>
            <CardFooter className="gap-2">
                <Button asChild variant="outline" size="sm">
                    <Link to={`/tasks/${task.id}`}>
                        {t("compare.open")}
                        <ArrowUpRightIcon />
                    </Link>
                </Button>
                {picked === null && (
                    <Button
                        size="sm"
                        className="ml-auto"
                        disabled={!canPick || picking || task.status !== "done"}
                        onClick={onPick}
                    >
                        <CheckIcon />
                        {t("compare.pick")}
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}

// The compare page: the variants of one prompt side by side, and the one diff that stays.
export function ComparePage() {
    const t = useTranslations("web");
    const { group = "" } = useParams();
    const variants = useVariants(group);
    const pick = usePickVariant(group);
    if (variants.isPending) return <CompareSkeleton />;
    if (variants.isError)
        return <ErrorState error={variants.error} onRetry={() => variants.refetch()} />;
    const tasks = variants.data.tasks;
    const kept = tasks.filter((task) => !task.archivedAt);
    // Picking archives every other variant, so one left out of several is the winner.
    const picked = tasks.length > 1 && kept.length === 1 ? (kept[0]?.id ?? null) : null;
    const running = tasks.some(isActive);
    const first = tasks[0];
    return (
        <>
            <PageHeader
                title={first?.title ?? t("compare.title")}
                description={
                    picked
                        ? t("compare.pickedHint")
                        : running
                          ? t("compare.runningHint", { count: tasks.length })
                          : t("compare.hint", { count: tasks.length })
                }
            >
                {first && (
                    <p className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
                        <AgentMark agent={first.agent} className="size-3.5" />
                        {first.repo}
                        {first.model && ` · ${first.model}`}
                    </p>
                )}
            </PageHeader>
            <FormError error={pick.error} />
            {!!pick.data?.errors?.length && (
                <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                        <p>{t("compare.closeFailed")}</p>
                        <ul className="mt-1 list-disc pl-5 font-mono text-xs">
                            {pick.data.errors.map((error) => (
                                <li key={error}>{error}</li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}
            <div
                className={cn(
                    "grid gap-4",
                    tasks.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3",
                )}
            >
                {tasks.map((task) => (
                    <Variant
                        key={task.id}
                        task={task}
                        picked={picked}
                        canPick={!running}
                        picking={pick.isPending}
                        onPick={() => pick.mutate(task.id)}
                    />
                ))}
            </div>
        </>
    );
}
