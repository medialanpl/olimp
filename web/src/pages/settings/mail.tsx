import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailWarningIcon, RotateCcwIcon, SaveIcon, SendIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { ErrorState, FormError, Loading } from "@/components/page";
import { SiteBanner } from "@/components/site-banner";
import { FieldSkeleton } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { keys } from "@/lib/queries";
import type { MailView } from "@/lib/types";

const FROM_EXAMPLE = "OLIMP <olimp@example.com>";

function ServerForm({ view }: { view: MailView }) {
    const t = useTranslations("web");
    const client = useQueryClient();
    const server = view.server;
    const [host, setHost] = useState(server?.host ?? "");
    const [port, setPort] = useState(String(server?.port ?? 587));
    const [secure, setSecure] = useState(server?.secure ?? false);
    const [user, setUser] = useState(server?.user ?? "");
    const [password, setPassword] = useState("");
    const [from, setFrom] = useState(server?.from ?? "");
    const write = useMutation({
        mutationFn: (body?: object) =>
            api<MailView>("/api/mail", { method: body ? "PUT" : "DELETE", body }),
        onSuccess: (next) => {
            client.setQueryData(keys.mail, next);
            void client.invalidateQueries({ queryKey: keys.settings });
        },
    });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        // An empty password field keeps the one in force.
        write.mutate({
            host,
            port: Number(port),
            secure,
            user,
            from,
            ...(password && { password }),
        });
    };
    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                <div className="space-y-2">
                    <Label htmlFor="mail-host">{t("mail.host")}</Label>
                    <Input
                        id="mail-host"
                        required
                        placeholder="smtp.example.com"
                        spellCheck={false}
                        className="font-mono"
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="mail-port">{t("mail.port")}</Label>
                    <Input
                        id="mail-port"
                        type="number"
                        required
                        min={1}
                        max={65535}
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                    />
                </div>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl border p-3">
                <div className="space-y-1">
                    <Label htmlFor="mail-secure">{t("mail.secure")}</Label>
                    <p className="text-xs text-muted-foreground">{t("mail.secureHint")}</p>
                </div>
                <Switch
                    id="mail-secure"
                    checked={secure}
                    onCheckedChange={(on) => {
                        setSecure(on);
                        if (port === "587" && on) setPort("465");
                        if (port === "465" && !on) setPort("587");
                    }}
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="mail-user">{t("mail.user")}</Label>
                    <Input
                        id="mail-user"
                        autoComplete="off"
                        spellCheck={false}
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="mail-password">{t("mail.password")}</Label>
                    <Input
                        id="mail-password"
                        type="password"
                        autoComplete="new-password"
                        placeholder={server?.password ? t("mail.passwordKept") : ""}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="mail-from">{t("mail.from")}</Label>
                <Input
                    id="mail-from"
                    required
                    placeholder={FROM_EXAMPLE}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                    {t("mail.fromHint", { example: FROM_EXAMPLE })}
                </p>
            </div>
            <FormError error={write.error} />
            <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={write.isPending || !host || !from}>
                    <SaveIcon />
                    {t("common.save")}
                </Button>
                {view.saved && (
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={write.isPending}
                        onClick={() => write.mutate(undefined)}
                    >
                        <RotateCcwIcon />
                        {t("mail.useEnvironment")}
                    </Button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                {view.saved ? t("mail.savedHere") : t("mail.fromEnvironment")}
            </p>
        </form>
    );
}

function TestMail() {
    const t = useTranslations("web");
    const me = useMe();
    const [to, setTo] = useState(me?.email ?? "");
    const test = useMutation({
        mutationFn: () => api<{ to: string }>("/api/mail/test", { method: "POST", body: { to } }),
    });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        test.mutate();
    };
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("mail.test")}</CardTitle>
                <CardDescription>{t("mail.testHint")}</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                        <Input
                            type="email"
                            required
                            aria-label={t("login.email")}
                            className="min-w-0 flex-1 sm:max-w-sm"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                        />
                        <Button type="submit" variant="outline" disabled={test.isPending || !to}>
                            <SendIcon />
                            {t("mail.send")}
                        </Button>
                    </div>
                    <FormError error={test.error} />
                    {test.data && (
                        <p className="text-sm text-constructive">
                            {t("mail.testSent", { to: test.data.to })}
                        </p>
                    )}
                </form>
            </CardContent>
        </Card>
    );
}

function MailSkeleton() {
    return (
        <Loading className="mx-auto grid max-w-3xl gap-6">
            <Card>
                <CardHeader className="gap-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-80 max-w-full" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                        <FieldSkeleton />
                        <FieldSkeleton />
                    </div>
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <FieldSkeleton />
                        <FieldSkeleton />
                    </div>
                    <FieldSkeleton />
                    <Skeleton className="h-9 w-24 rounded-4xl" />
                </CardContent>
            </Card>
        </Loading>
    );
}

// E-mail carries invitations, password resets and the sign-in codes of accounts without the app.
export function Mail() {
    const t = useTranslations("web");
    const mail = useQuery({ queryKey: keys.mail, queryFn: () => api<MailView>("/api/mail") });
    if (mail.isPending) return <MailSkeleton />;
    if (mail.isError) return <ErrorState error={mail.error} onRetry={() => mail.refetch()} />;
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            {!mail.data.ready && (
                <SiteBanner
                    tone="warning"
                    icon={<MailWarningIcon />}
                    title={t("mail.off")}
                    description={t("mail.offHint")}
                />
            )}
            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <div className="space-y-1.5">
                        <CardTitle>{t("mail.server")}</CardTitle>
                        <CardDescription>{t("mail.serverHint")}</CardDescription>
                    </div>
                    {mail.data.ready && <Badge variant="constructive">{t("mail.ready")}</Badge>}
                </CardHeader>
                <CardContent>
                    {/* A save starts the form again from what the server kept. */}
                    <ServerForm key={JSON.stringify(mail.data)} view={mail.data} />
                </CardContent>
            </Card>
            {mail.data.ready && <TestMail />}
        </div>
    );
}
