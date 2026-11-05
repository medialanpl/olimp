import { CoinsIcon } from "lucide-react";
import { useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { useAuthorName } from "@/components/author";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, Loading, PageHeader, Stat } from "@/components/page";
import { StatSkeleton, TableSkeleton, times } from "@/components/skeletons";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { InputTokens } from "@/components/usage";
import { useFormat } from "@/lib/format";
import { useCosts } from "@/lib/queries";
import type { CostGroup } from "@/lib/types";

const GROUPS: CostGroup[] = ["day", "repo", "agent", "author"];
const PERIODS = [7, 30, 90, 365];

export function CostsPage() {
    const t = useTranslations("web");
    const format = useFormat();
    const author = useAuthorName();
    const [params, setParams] = useSearchParams();
    const by = GROUPS.includes(params.get("by") as CostGroup)
        ? (params.get("by") as CostGroup)
        : "day";
    const days = PERIODS.includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
    const costs = useCosts(by, days);
    const set = (name: string, value: string) =>
        setParams((current) => {
            const next = new URLSearchParams(current);
            next.set(name, value);
            return next;
        });

    return (
        <>
            <PageHeader title={t("costs.title")} description={t("costs.description")} />
            <div className="mb-6 grid grid-cols-2 gap-2 sm:flex">
                <Select value={by} onValueChange={(v) => set("by", v)}>
                    <SelectTrigger className="w-full sm:w-48" aria-label={t("costs.by")}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {GROUPS.map((group) => (
                            <SelectItem key={group} value={group}>
                                {t(`costs.group.${group}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={String(days)} onValueChange={(v) => set("days", v)}>
                    <SelectTrigger className="w-full sm:w-48" aria-label={t("costs.period")}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {PERIODS.map((period) => (
                            <SelectItem key={period} value={String(period)}>
                                {t("costs.lastDays", { days: period })}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {costs.isPending ? (
                <Loading className="space-y-6">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {times(4).map((stat) => (
                            <StatSkeleton key={stat} />
                        ))}
                    </div>
                    <TableSkeleton columns={7} toolbar={false} className="rounded-xl bg-card" />
                </Loading>
            ) : costs.isError ? (
                <ErrorState error={costs.error} onRetry={() => costs.refetch()} />
            ) : (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <Stat
                            label={t("costs.total")}
                            value={format.cost(costs.data.total.costUsd ?? 0)}
                            hint={
                                costs.data.total.unpriced
                                    ? t("costs.unpriced", { count: costs.data.total.unpriced })
                                    : undefined
                            }
                        />
                        <Stat label={t("costs.jobs")} value={format.count(costs.data.total.jobs)} />
                        <Stat
                            label={t("fields.tokens")}
                            value={
                                <>
                                    <InputTokens usage={costs.data.total} /> /{" "}
                                    {format.count(costs.data.total.outputTokens)}
                                </>
                            }
                        />
                        <Stat
                            label={t("fields.duration")}
                            value={format.duration(costs.data.total.durationMs)}
                        />
                    </div>
                    {!costs.data.groups.length ? (
                        <EmptyState
                            icon={<CoinsIcon />}
                            title={t("costs.emptyTitle")}
                            description={t("costs.empty")}
                        />
                    ) : (
                        <div className="rounded-xl border bg-card">
                            <Table>
                                <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead>{t(`costs.group.${by}`)}</TableHead>
                                        <TableHead className="text-right">
                                            {t("costs.jobs")}
                                        </TableHead>
                                        <TableHead className="text-right">
                                            {t("fields.cost")}
                                        </TableHead>
                                        <TableHead className="text-right">
                                            {t("fields.turns")}
                                        </TableHead>
                                        <TableHead className="text-right">
                                            {t("fields.inputTokens")}
                                        </TableHead>
                                        <TableHead className="text-right">
                                            {t("fields.outputTokens")}
                                        </TableHead>
                                        <TableHead className="text-right">
                                            {t("fields.duration")}
                                        </TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {costs.data.groups.map((row) => (
                                        <TableRow key={row.key ?? ""}>
                                            <TableCell className="font-medium">
                                                {row.name ?? row.key ?? author(null)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {row.jobs}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.cost(row.costUsd)}
                                                {row.unpriced > 0 && (
                                                    <span className="text-muted-foreground">
                                                        {" "}
                                                        *
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.count(row.turns)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                <InputTokens usage={row} />
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.count(row.outputTokens)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {format.duration(row.durationMs)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            {costs.data.total.unpriced > 0 && (
                                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                                    {t("costs.unpricedNote")}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </>
    );
}
