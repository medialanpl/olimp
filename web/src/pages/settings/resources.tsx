import {
    ActivityIcon,
    CpuIcon,
    LayersIcon,
    MemoryStickIcon,
    MonitorIcon,
    ServerIcon,
    TimerIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { OlimpMark } from "@/components/logo";
import { ErrorState, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/lib/format";
import { useMachine, useSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SettingSection } from "@/pages/settings/setting-card";

const ROW =
    "grid grid-cols-[10rem_9rem_1fr] items-center gap-3 text-sm max-sm:grid-cols-[7rem_1fr]";

function RowLabel({ icon, label }: { icon: ReactNode; label: string }) {
    return (
        <span className="flex items-center gap-2 text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
            {icon}
            {label}
        </span>
    );
}

function Meter({
    icon,
    label,
    value,
    share,
}: {
    icon: ReactNode;
    label: string;
    value: string;
    share: number;
}) {
    return (
        <div className={ROW}>
            <RowLabel icon={icon} label={label} />
            <span className="font-medium tabular-nums">{value}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted max-sm:col-span-2">
                <span
                    className={cn(
                        "block h-full rounded-full transition-[width]",
                        share > 0.85
                            ? "bg-destructive"
                            : share > 0.6
                              ? "bg-warning"
                              : "bg-constructive",
                    )}
                    style={{ width: `${Math.max(1, Math.round(share * 100))}%` }}
                />
            </span>
        </div>
    );
}

function Detail({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className={ROW}>
            <RowLabel icon={icon} label={label} />
            <span className="min-w-0 truncate font-medium sm:col-span-2" title={value}>
                {value}
            </span>
        </div>
    );
}

function DetailSkeleton() {
    return (
        <div className={ROW}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-48 max-w-full sm:col-span-2" />
        </div>
    );
}

function MachineSkeleton() {
    return (
        <Loading className="space-y-3">
            {times(3).map((meter) => (
                <div key={meter} className={ROW}>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-1.5 max-sm:col-span-2" />
                </div>
            ))}
            <DetailSkeleton />
            <div className="space-y-3 border-t pt-3">
                {times(3).map((detail) => (
                    <DetailSkeleton key={detail} />
                ))}
            </div>
        </Loading>
    );
}

// The live machine card: CPU, memory and load of the host OLIMP runs on.
function MachineCard() {
    const t = useTranslations("web");
    const format = useFormat();
    const machine = useMachine();
    const parallel = useSettings().data?.values.maxParallel;
    const m = machine.data;
    return (
        <Card className="gap-4">
            <CardHeader className="flex flex-row items-center gap-2">
                <span
                    className={cn(
                        "size-2 rounded-full",
                        machine.isError ? "bg-destructive" : "bg-constructive",
                    )}
                />
                <CardTitle>{t("settings.machine")}</CardTitle>
                <span className="text-xs text-muted-foreground">{t("header.live")}</span>
                {machine.dataUpdatedAt > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                        {t("settings.updatedAt", {
                            time: format.time(new Date(machine.dataUpdatedAt).toISOString()),
                        })}
                    </span>
                )}
            </CardHeader>
            <CardContent className="space-y-3">
                {m ? (
                    <>
                        <Meter
                            icon={<CpuIcon />}
                            label={t("settings.cpu")}
                            value={`${m.cpu}%`}
                            share={m.cpu / 100}
                        />
                        <Meter
                            icon={<MemoryStickIcon />}
                            label={t("settings.memory")}
                            value={`${format.bytes(m.memory.used)} / ${format.bytes(m.memory.total)}`}
                            share={m.memory.used / m.memory.total}
                        />
                        {parallel !== undefined && (
                            <Meter
                                icon={<LayersIcon />}
                                label={t("settings.jobs")}
                                value={`${m.olimp.running} / ${parallel}`}
                                share={m.olimp.running / parallel}
                            />
                        )}
                        <div className={ROW}>
                            <RowLabel icon={<ActivityIcon />} label={t("settings.load")} />
                            <span className="flex flex-wrap items-center gap-2 font-medium tabular-nums sm:col-span-2">
                                {m.load.map((l) => l.toFixed(2)).join(" · ")}
                                <Badge variant="outline">
                                    {t("settings.cores", { count: m.cores })}
                                </Badge>
                            </span>
                        </div>
                        <div className="space-y-3 border-t pt-3">
                            <Detail
                                icon={<ServerIcon />}
                                label={t("settings.host")}
                                value={`${m.user}@${m.hostname}`}
                            />
                            <Detail
                                icon={<MonitorIcon />}
                                label={t("settings.system")}
                                value={m.os}
                            />
                            <Detail
                                icon={<OlimpMark />}
                                label={t("settings.olimpProcess")}
                                value={t("settings.olimpUsage", {
                                    memory: format.bytes(m.olimp.memory),
                                    uptime: format.duration(m.olimp.uptime * 1000),
                                })}
                            />
                        </div>
                    </>
                ) : machine.isError ? (
                    <ErrorState error={machine.error} onRetry={() => machine.refetch()} />
                ) : (
                    <MachineSkeleton />
                )}
            </CardContent>
        </Card>
    );
}

export function Resources() {
    const t = useTranslations("web");
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <MachineCard />
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.queue")}</CardTitle>
                    <CardDescription>{t("settings.queueHint")}</CardDescription>
                </CardHeader>
                <CardContent className="divide-y">
                    <SettingSection name="maxParallel" icon={<LayersIcon />} />
                    <SettingSection name="taskTimeoutMin" icon={<TimerIcon />} />
                </CardContent>
            </Card>
        </div>
    );
}
