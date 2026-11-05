import { PencilIcon, PlusIcon, SaveIcon, SendIcon, WebhookIcon } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, FormError } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useFormat } from "@/lib/format";
import { useRepoWrite, useWebhooks } from "@/lib/queries";
import type { Repo, WebhookEvent, WebhookFormat, WebhookView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AdminOnly, ConfirmDelete, Section, useIsAdmin } from "@/pages/project/shared";

const FORMATS: WebhookFormat[] = ["slack", "discord", "ntfy", "json"];
const EVENTS: WebhookEvent[] = ["done", "failed", "cancelled", "waiting"];

// A Slack, Discord or ntfy.sh address picks its format.
function formatOf(url: string): WebhookFormat | null {
    try {
        const host = new URL(url).hostname;
        if (host === "hooks.slack.com") return "slack";
        if (["discord.com", "discordapp.com"].includes(host)) return "discord";
        if (host === "ntfy.sh") return "ntfy";
    } catch {}
    return null;
}

// Adds a receiver, or with `hook` changes one: an empty address keeps the one it has.
function WebhookForm({
    repo,
    hook,
    onDone,
}: {
    repo: string;
    hook?: WebhookView;
    onDone?: () => void;
}) {
    const t = useTranslations("web");
    const id = useId();
    const write = useRepoWrite(repo);
    const [name, setName] = useState(hook?.name ?? "");
    const [url, setUrl] = useState("");
    const [token, setToken] = useState("");
    const [dropToken, setDropToken] = useState(false);
    const [format, setFormat] = useState<WebhookFormat>(hook?.format ?? "slack");
    const [events, setEvents] = useState<WebhookEvent[]>(hook?.events ?? ["done", "failed"]);
    const [automations, setAutomations] = useState(hook?.automations ?? true);
    const toggle = (event: WebhookEvent, on: boolean) =>
        setEvents(on ? [...events, event] : events.filter((e) => e !== event));
    const ntfy = format === "ntfy";
    const fields = {
        name,
        format,
        events,
        automations,
        ...(url ? { url } : {}),
        ...(ntfy && (token || dropToken) ? { token: dropToken ? "" : token } : {}),
    };
    const submit = (e: FormEvent) => {
        e.preventDefault();
        write.mutate(
            hook
                ? { method: "PATCH", path: `webhooks/${hook.id}`, body: fields }
                : { method: "POST", path: "webhooks", body: fields },
            {
                onSuccess: () => {
                    setName("");
                    setUrl("");
                    setToken("");
                    onDone?.();
                },
            },
        );
    };
    const urlOk = url ? url.startsWith("https://") : !!hook;
    return (
        <form onSubmit={submit} autoComplete="off" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor={`${id}-name`}>{t("repo.webhookName")}</Label>
                    <Input
                        id={`${id}-name`}
                        value={name}
                        maxLength={100}
                        placeholder={t("repo.webhookNamePlaceholder")}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`${id}-format`}>{t("repo.webhookFormat")}</Label>
                    <Select value={format} onValueChange={(v) => setFormat(v as WebhookFormat)}>
                        <SelectTrigger id={`${id}-format`} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FORMATS.map((f) => (
                                <SelectItem key={f} value={f}>
                                    {t(`repo.format.${f}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor={`${id}-url`}>{t("repo.webhookUrl")}</Label>
                <Input
                    id={`${id}-url`}
                    type="url"
                    value={url}
                    maxLength={2000}
                    spellCheck={false}
                    placeholder={
                        hook
                            ? t("repo.keepAddress", { host: hook.host })
                            : ntfy
                              ? "https://ntfy.sh/…"
                              : "https://hooks.slack.com/services/…"
                    }
                    className="font-mono"
                    onChange={(e) => {
                        setUrl(e.target.value);
                        const known = formatOf(e.target.value);
                        if (known) setFormat(known);
                    }}
                />
                <p className="text-xs text-muted-foreground">
                    {t(ntfy ? "repo.ntfyUrlHint" : "repo.webhookUrlHint")}
                </p>
            </div>
            {ntfy && (
                <div className="space-y-2">
                    <Label htmlFor={`${id}-token`}>{t("repo.ntfyToken")}</Label>
                    <Input
                        id={`${id}-token`}
                        type="password"
                        value={token}
                        maxLength={4000}
                        autoComplete="new-password"
                        disabled={dropToken}
                        placeholder={hook?.hasToken ? t("repo.keepToken") : "tk_…"}
                        className="font-mono"
                        onChange={(e) => setToken(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t("repo.ntfyTokenHint")}</p>
                    {hook?.hasToken && (
                        <Label className="font-normal">
                            <Checkbox
                                checked={dropToken}
                                onCheckedChange={(on) => setDropToken(on === true)}
                            />
                            {t("repo.removeToken")}
                        </Label>
                    )}
                </div>
            )}
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("repo.webhookEvents")}</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                    {EVENTS.map((event) => (
                        <Label key={event} className="font-normal">
                            <Checkbox
                                checked={events.includes(event)}
                                onCheckedChange={(on) => toggle(event, on === true)}
                            />
                            {t(`repo.event.${event}`)}
                        </Label>
                    ))}
                </div>
            </fieldset>
            <Label className="font-normal">
                <Switch checked={automations} onCheckedChange={setAutomations} />
                {t("repo.webhookAutomations")}
            </Label>
            <FormError error={write.error} />
            <div className="flex flex-wrap gap-2">
                <Button
                    type="submit"
                    disabled={write.isPending || !name.trim() || !urlOk || !events.length}
                >
                    {hook ? <SaveIcon /> : <PlusIcon />}
                    {hook ? t("common.save") : t("repo.addWebhook")}
                </Button>
                {onDone && (
                    <Button type="button" variant="ghost" onClick={onDone}>
                        {t("common.cancel")}
                    </Button>
                )}
            </div>
        </form>
    );
}

function Receiver({ repo, hook }: { repo: string; hook: WebhookView }) {
    const t = useTranslations("web");
    const format = useFormat();
    const write = useRepoWrite(repo);
    const [editing, setEditing] = useState(false);
    const last = hook.last;
    return (
        <li className="space-y-3 p-4">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                        {hook.name}
                        <Badge variant="outline">{t(`repo.format.${hook.format}`)}</Badge>
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{hook.host}</p>
                    <div className="flex flex-wrap gap-1 pt-1">
                        {hook.events.map((event) => (
                            <Badge key={event} variant="secondary">
                                {t(`repo.event.${event}`)}
                            </Badge>
                        ))}
                        {!hook.automations && (
                            <Badge variant="outline">{t("repo.noAutomations")}</Badge>
                        )}
                    </div>
                </div>
                <Label className="font-normal text-muted-foreground">
                    <Switch
                        checked={hook.enabled}
                        disabled={write.isPending}
                        aria-label={t("repo.webhookEnabled", { name: hook.name })}
                        onCheckedChange={(enabled) =>
                            write.mutate({
                                method: "PATCH",
                                path: `webhooks/${hook.id}`,
                                body: { enabled },
                            })
                        }
                    />
                    {hook.enabled ? t("repo.on") : t("repo.paused")}
                </Label>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <span
                        className={cn(
                            "size-2 shrink-0 rounded-full",
                            !last
                                ? "bg-muted-foreground/40"
                                : last.ok
                                  ? "bg-constructive"
                                  : "bg-destructive",
                        )}
                    />
                    <span className="truncate text-muted-foreground">
                        {!last
                            ? t("repo.noDelivery")
                            : last.ok
                              ? t("repo.delivered", { when: format.relative(last.at) })
                              : t("repo.deliveryFailed", {
                                    when: format.relative(last.at),
                                    reason: last.status
                                        ? `HTTP ${last.status}`
                                        : (last.error ?? ""),
                                })}
                    </span>
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={write.isPending}
                    onClick={() =>
                        write.mutate({ method: "POST", path: `webhooks/${hook.id}/test` })
                    }
                >
                    <SendIcon />
                    {t("repo.sendTest")}
                </Button>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("repo.editWebhook", { name: hook.name })}
                    title={t("repo.editWebhook", { name: hook.name })}
                    onClick={() => setEditing(true)}
                >
                    <PencilIcon />
                </Button>
                <ConfirmDelete
                    size="icon-sm"
                    label={t("repo.deleteWebhook", { name: hook.name })}
                    question={t("repo.confirmDeleteWebhook", { name: hook.name })}
                    pending={write.isPending}
                    onConfirm={() =>
                        write.mutate({ method: "DELETE", path: `webhooks/${hook.id}` })
                    }
                />
            </div>
            <FormError error={write.error} />
            <Dialog open={editing} onOpenChange={setEditing}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("repo.editWebhook", { name: hook.name })}</DialogTitle>
                        <DialogDescription>{t("repo.editWebhookHint")}</DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        {editing && (
                            <WebhookForm repo={repo} hook={hook} onDone={() => setEditing(false)} />
                        )}
                    </DialogBody>
                </DialogContent>
            </Dialog>
        </li>
    );
}

export function Webhooks({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const admin = useIsAdmin();
    const hooks = useWebhooks(repo.id, admin);
    if (!admin) return <AdminOnly />;
    return (
        <>
            <Section title={t("repo.receiversTitle")} description={t("repo.receiversHint")}>
                {hooks.isPending ? (
                    <Skeleton className="h-24 w-full" />
                ) : hooks.isError ? (
                    <ErrorState error={hooks.error} onRetry={() => hooks.refetch()} />
                ) : !hooks.data.length ? (
                    <EmptyState
                        icon={<WebhookIcon />}
                        title={t("repo.noWebhooksTitle")}
                        description={t("repo.noWebhooks")}
                        className="p-6"
                    />
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {hooks.data.map((hook) => (
                            <Receiver key={hook.id} repo={repo.id} hook={hook} />
                        ))}
                    </ul>
                )}
            </Section>
            <Section title={t("repo.addWebhookTitle")} description={t("repo.addWebhookHint")}>
                <WebhookForm repo={repo.id} />
            </Section>
        </>
    );
}
