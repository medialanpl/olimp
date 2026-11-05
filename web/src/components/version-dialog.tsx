import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { FormError } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useFormat } from "@/lib/format";
import { keys, useSettings, useVersion } from "@/lib/queries";
import type { Version } from "@/lib/types";

const RESTART_WAIT_MS = 120_000;

// The new process answers /health once it listens; then the page loads the new panel.
async function waitForRestart(): Promise<void> {
    const until = Date.now() + RESTART_WAIT_MS;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    while (Date.now() < until) {
        const ok = await fetch("/health", { cache: "no-store" }).then(
            (res) => res.ok,
            () => false,
        );
        if (ok) return window.location.reload();
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("OLIMP did not come back: see olimp.log in its home folder");
}

// The version window: where OLIMP runs from, whether origin has newer commits, update.
export function VersionDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const client = useQueryClient();
    const version = useVersion();
    const home = useSettings().data?.home;
    const me = useMe();
    const admin = !me || me.role === "admin";
    const [restarting, setRestarting] = useState(false);
    const check = useMutation({
        mutationFn: () => api<Version["update"]>("/api/version/check", { method: "POST" }),
        onSuccess: (update) =>
            client.setQueryData<Version>(keys.version, (old) => (old ? { ...old, update } : old)),
    });
    const update = useMutation({
        mutationFn: async () => {
            await api("/api/version/update", { method: "POST" });
            setRestarting(true);
            await waitForRestart();
        },
        onError: () => setRestarting(false),
    });
    const v = version.data;
    const git = v?.git;
    const behind = v?.update?.behind ?? 0;
    return (
        <Dialog open={open} onOpenChange={(next) => !update.isPending && onOpenChange(next)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>OLIMP v{v?.version ?? "…"}</DialogTitle>
                    <DialogDescription>{t("version.hint")}</DialogDescription>
                </DialogHeader>
                <DialogBody className="space-y-4 text-sm">
                    {git ? (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                            <dt className="text-muted-foreground">{t("version.channel")}</dt>
                            <dd className="flex items-center gap-2">
                                <Badge variant="outline" className="font-mono">
                                    origin/{git.branch}
                                </Badge>
                            </dd>
                            <dt className="text-muted-foreground">{t("version.commit")}</dt>
                            <dd>
                                <span className="font-mono">{git.commit}</span>
                                <span className="text-muted-foreground">
                                    {" "}
                                    · {format.dateTime(git.date)}
                                </span>
                                {git.dirty && (
                                    <Badge variant="info" className="ml-2">
                                        {t("version.dirty")}
                                    </Badge>
                                )}
                            </dd>
                            <dt className="text-muted-foreground">{t("version.folder")}</dt>
                            <dd className="truncate font-mono text-xs leading-5">{v.root}</dd>
                        </dl>
                    ) : (
                        v && <p className="text-muted-foreground">{t("version.notGit")}</p>
                    )}
                    {git && (
                        <div className="rounded-lg border bg-muted/40 p-3">
                            {!v.update ? (
                                <p className="text-muted-foreground">{t("version.notChecked")}</p>
                            ) : v.update.error ? (
                                <p className="text-destructive">
                                    {t("version.checkFailed", { error: v.update.error })}
                                </p>
                            ) : behind > 0 ? (
                                <div className="space-y-1">
                                    <p className="font-medium">
                                        {t("version.behind", { count: behind })}
                                    </p>
                                    {v.update.latest && (
                                        <p className="truncate text-muted-foreground">
                                            <span className="font-mono">
                                                {v.update.latest.commit}
                                            </span>{" "}
                                            {v.update.latest.subject}
                                        </p>
                                    )}
                                </div>
                            ) : (
                                <p className="font-medium">{t("version.upToDate")}</p>
                            )}
                            {v.update && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {t("version.checkedAt", {
                                        time: format.time(v.update.checkedAt),
                                    })}
                                    {v.update.ahead > 0 &&
                                        ` · ${t("version.ahead", { count: v.update.ahead })}`}
                                </p>
                            )}
                        </div>
                    )}
                    {restarting && (
                        <p className="flex items-center gap-2 text-muted-foreground">
                            <LoaderCircleIcon className="size-4 animate-spin" />
                            {t("version.restarting")}
                        </p>
                    )}
                    <FormError error={check.error ?? update.error} />
                    {git && admin && (
                        <p className="text-xs text-muted-foreground">
                            {t("version.updateHint", { log: `${home ?? "OLIMP_HOME"}/olimp.log` })}
                        </p>
                    )}
                </DialogBody>
                {git && admin && (
                    <DialogFooter>
                        <Button
                            variant="outline"
                            disabled={check.isPending || update.isPending}
                            onClick={() => check.mutate()}
                        >
                            <RefreshCwIcon
                                className={check.isPending ? "animate-spin" : undefined}
                            />
                            {t("version.check")}
                        </Button>
                        <Button
                            disabled={behind === 0 || git.dirty || update.isPending}
                            onClick={() => update.mutate()}
                        >
                            <DownloadIcon />
                            {t("version.update")}
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
