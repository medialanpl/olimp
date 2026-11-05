import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    KeyRoundIcon,
    LogOutIcon,
    PlusIcon,
    SaveIcon,
    ShieldIcon,
    Trash2Icon,
    UserRoundIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { FormError } from "@/components/page";
import { BackupCodes, TotpSetup } from "@/components/totp-setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useFormat } from "@/lib/format";
import { passwordReady } from "@/lib/password";
import type { Me } from "@/lib/types";
import { PasswordFields } from "@/pages/password";

function Section({
    title,
    description,
    badge,
    children,
}: {
    title: string;
    description: string;
    badge?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="space-y-1.5">
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </div>
                {badge}
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

function PasswordInput({
    id,
    value,
    onChange,
    autoFocus,
}: {
    id: string;
    value: string;
    onChange: (v: string) => void;
    autoFocus?: boolean;
}) {
    const t = useTranslations("web");
    return (
        <div className="space-y-2">
            <Label htmlFor={id}>{t("account.currentPassword")}</Label>
            <Input
                id={id}
                type="password"
                autoComplete="current-password"
                autoFocus={autoFocus}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="sm:max-w-xs"
            />
        </div>
    );
}

function Profile({ me }: { me: Me }) {
    const t = useTranslations("web");
    const { refresh } = useAuth();
    const [name, setName] = useState(me.name);
    const [email, setEmail] = useState(me.email ?? "");
    const [password, setPassword] = useState("");
    const save = useMutation({
        mutationFn: () =>
            api("/api/me", {
                method: "PATCH",
                body: { name, ...(email !== (me.email ?? "") && { email, password }) },
            }),
        onSuccess: () => void refresh(),
    });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate();
    };
    return (
        <Section title={t("account.profile")} description={t("account.profileHint")}>
            <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="name">{t("account.name")}</Label>
                        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">{t("login.email")}</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                </div>
                {email !== (me.email ?? "") && (
                    <PasswordInput id="profile-password" value={password} onChange={setPassword} />
                )}
                <FormError error={save.error} />
                <Button type="submit" disabled={save.isPending}>
                    <SaveIcon />
                    {t("common.save")}
                </Button>
            </form>
        </Section>
    );
}

function ChangePassword() {
    const t = useTranslations("web");
    const [current, setCurrent] = useState("");
    const [password, setPassword] = useState("");
    const [again, setAgain] = useState("");
    const change = useMutation({
        mutationFn: () => api("/api/me/password", { method: "PUT", body: { current, password } }),
        onSuccess: () => {
            setCurrent("");
            setPassword("");
            setAgain("");
        },
    });
    return (
        <Section title={t("account.password")} description={t("account.passwordHint")}>
            <form
                onSubmit={(event) => {
                    event.preventDefault();
                    change.mutate();
                }}
                className="space-y-4 sm:max-w-sm"
            >
                <PasswordInput id="current-password" value={current} onChange={setCurrent} />
                <PasswordFields
                    value={password}
                    onChange={setPassword}
                    again={again}
                    onAgain={setAgain}
                />
                <FormError error={change.error} />
                {change.isSuccess && (
                    <p className="text-sm text-constructive">{t("account.passwordChanged")}</p>
                )}
                <Button
                    type="submit"
                    disabled={change.isPending || !current || !passwordReady(password, again)}
                >
                    <KeyRoundIcon />
                    {t("account.changePassword")}
                </Button>
            </form>
        </Section>
    );
}

type Action = "setup" | "codes" | "remove";

// Mandatory: the app, or codes by e-mail when OLIMP can send them.
function TwoFactor({ me }: { me: Me }) {
    const t = useTranslations("web");
    const { refresh } = useAuth();
    const [action, setAction] = useState<Action | null>(null);
    const [password, setPassword] = useState("");
    const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
    const [codes, setCodes] = useState<string[] | null>(null);
    const run = useMutation({
        mutationFn: async (chosen: Action) => {
            if (chosen === "setup")
                setSetup(
                    await api("/api/me/two-factor/setup", { method: "POST", body: { password } }),
                );
            if (chosen === "codes")
                setCodes(
                    (
                        await api<{ backupCodes: string[] }>("/api/me/backup-codes", {
                            method: "POST",
                            body: { password },
                        })
                    ).backupCodes,
                );
            if (chosen === "remove") {
                await api("/api/me/two-factor", { method: "DELETE", body: { password } });
                await refresh();
            }
            setPassword("");
        },
    });
    const done = () => {
        setAction(null);
        setSetup(null);
        setCodes(null);
        void refresh();
    };
    return (
        <Section
            title={t("account.twoFactor")}
            description={t(me.totp ? "account.twoFactorApp" : "account.twoFactorEmail")}
            badge={
                <Badge variant="constructive">
                    {t(me.totp ? "account.viaApp" : "account.viaEmail")}
                </Badge>
            }
        >
            {setup ? (
                <TotpSetup
                    setup={setup}
                    enable={async (code) =>
                        (
                            await api<{ backupCodes: string[] }>("/api/me/two-factor/enable", {
                                method: "POST",
                                body: { secret: setup.secret, code },
                            })
                        ).backupCodes
                    }
                    onDone={done}
                />
            ) : codes ? (
                <div className="space-y-4">
                    <BackupCodes codes={codes} />
                    <Button onClick={done}>{t("account.codesSaved")}</Button>
                </div>
            ) : action ? (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        run.mutate(action);
                    }}
                    className="space-y-3"
                >
                    <PasswordInput
                        id="two-factor-password"
                        value={password}
                        onChange={setPassword}
                    />
                    <FormError error={run.error} />
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="submit"
                            variant={action === "remove" ? "destructive" : "default"}
                            disabled={run.isPending || !password}
                        >
                            {t(`account.confirm.${action}`)}
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setAction(null)}>
                            {t("common.cancel")}
                        </Button>
                    </div>
                </form>
            ) : (
                <div className="flex flex-wrap gap-2">
                    {!me.totp && (
                        <Button onClick={() => setAction("setup")}>
                            <ShieldIcon />
                            {t("account.setUpApp")}
                        </Button>
                    )}
                    {me.totp && (
                        <Button variant="outline" onClick={() => setAction("codes")}>
                            <KeyRoundIcon />
                            {t("account.newCodes")}
                        </Button>
                    )}
                    {me.totp && me.mail && (
                        <Button variant="outline" onClick={() => setAction("remove")}>
                            <Trash2Icon />
                            {t("account.removeApp")}
                        </Button>
                    )}
                </div>
            )}
        </Section>
    );
}

interface SessionRow {
    id: string;
    createdAt: string;
    seenAt: string;
    ip: string | null;
    userAgent: string | null;
    current: boolean;
}

// A short name of the browser and system from the user agent, enough to tell sessions apart.
const device = (agent: string | null) => {
    if (!agent) return "–";
    const browser = /(Edg|Firefox|Chrome|Safari)\//.exec(agent)?.[1]?.replace("Edg", "Edge") ?? "";
    const system =
        /(Windows|Android|iPhone|iPad|Mac OS X|Linux)/
            .exec(agent)?.[1]
            ?.replace("Mac OS X", "macOS") ?? "";
    return [browser, system].filter(Boolean).join(" · ") || agent.slice(0, 40);
};

function Sessions() {
    const t = useTranslations("web");
    const format = useFormat();
    const client = useQueryClient();
    const sessions = useQuery({
        queryKey: ["sessions"],
        queryFn: () => api<SessionRow[]>("/api/me/sessions"),
    });
    const end = useMutation({
        mutationFn: (id: string | null) =>
            api(id ? `/api/me/sessions/${id}` : "/api/me/sessions", { method: "DELETE" }),
        onSuccess: () => void client.invalidateQueries({ queryKey: ["sessions"] }),
    });
    return (
        <Section title={t("account.sessions")} description={t("account.sessionsHint")}>
            <ul className="divide-y rounded-lg border">
                {sessions.data?.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 p-3 text-sm">
                        <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                                {device(s.userAgent)}
                                {s.current && (
                                    <Badge variant="info" className="ml-2">
                                        {t("account.thisSession")}
                                    </Badge>
                                )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {t("account.sessionSeen", {
                                    ip: s.ip ?? "–",
                                    when: format.relative(s.seenAt),
                                })}
                            </p>
                        </div>
                        {!s.current && (
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("account.endSession")}
                                disabled={end.isPending}
                                onClick={() => end.mutate(s.id)}
                            >
                                <LogOutIcon />
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
            {(sessions.data?.length ?? 0) > 1 && (
                <Button
                    variant="outline"
                    className="mt-3"
                    disabled={end.isPending}
                    onClick={() => end.mutate(null)}
                >
                    <LogOutIcon />
                    {t("account.endOthers")}
                </Button>
            )}
        </Section>
    );
}

function Tokens({ me }: { me: Me }) {
    const t = useTranslations("web");
    const format = useFormat();
    const { refresh } = useAuth();
    const revoke = useMutation({
        mutationFn: (id: string) => api(`/api/tokens/${id}`, { method: "DELETE" }),
        onSuccess: () => void refresh(),
    });
    // The value comes back once; only its hash stays.
    const create = useMutation({
        mutationFn: () =>
            api<{ token: string }>(`/api/users/${me.id}/tokens`, { method: "POST", body: {} }),
        onSuccess: () => void refresh(),
    });
    return (
        <Section title={t("account.tokens")} description={t("account.tokensHint")}>
            {me.role === "admin" && (
                <div className="mb-3 space-y-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={create.isPending}
                        onClick={() => create.mutate()}
                    >
                        <PlusIcon />
                        {t("account.createToken")}
                    </Button>
                    {create.data && (
                        <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3">
                            <div className="flex items-center gap-2">
                                <code className="min-w-0 flex-1 truncate font-mono text-sm">
                                    {create.data.token}
                                </code>
                                <CopyButton
                                    value={create.data.token}
                                    label={t("account.copyToken")}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {t("account.tokenOnce")}
                            </p>
                        </div>
                    )}
                    <FormError error={create.error} />
                </div>
            )}
            {me.tokens.length ? (
                <ul className="divide-y rounded-lg border">
                    {me.tokens.map((token) => (
                        <li key={token.id} className="flex items-center gap-3 p-3 text-sm">
                            <span className="flex-1 font-mono">{token.id}</span>
                            <span className="text-xs text-muted-foreground">
                                {format.relative(token.createdAt)}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("account.revoke")}
                                disabled={revoke.isPending}
                                onClick={() => revoke.mutate(token.id)}
                            >
                                <Trash2Icon />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-sm text-muted-foreground">{t("account.noTokens")}</p>
            )}
        </Section>
    );
}

// Corivo's account settings: profile, password, second factor, sessions; and OLIMP's API tokens.
export function Account() {
    const t = useTranslations("web");
    const me = useMe();
    if (!me)
        return (
            <EmptyState
                icon={<UserRoundIcon />}
                title={t("account.noAccountsTitle")}
                description={t("account.noAccounts")}
            />
        );
    return (
        <div className="grid gap-6">
            <Profile key={`${me.name}:${me.email}`} me={me} />
            <ChangePassword />
            <TwoFactor me={me} />
            <Sessions />
            <Tokens me={me} />
        </div>
    );
}
