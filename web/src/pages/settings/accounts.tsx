import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    MailIcon,
    MoreHorizontalIcon,
    ShieldOffIcon,
    Trash2Icon,
    UserPlusIcon,
    UserRoundIcon,
    UsersIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useFormat } from "@/lib/format";
import { passwordReady } from "@/lib/password";
import { keys, useSettings, useUsers } from "@/lib/queries";
import type { User } from "@/lib/types";
import { PasswordFields } from "@/pages/password";
import { Account } from "@/pages/settings/account";

const ROLES = ["admin", "member"] as const;

// Without accounts OLIMP trusts this machine. The first account is an admin with a password; from
// then on the panel and the API need a sign-in.
function EnableAccounts() {
    const t = useTranslations("web");
    const { refresh } = useAuth();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [again, setAgain] = useState("");
    const create = useMutation({
        mutationFn: () => api("/api/users", { method: "POST", body: { name, email, password } }),
        onSuccess: () => void refresh(),
    });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        create.mutate();
    };
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("accounts.enable")}</CardTitle>
                <CardDescription>{t("accounts.enableHint")}</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={submit} className="space-y-4 sm:max-w-sm">
                    <div className="space-y-2">
                        <Label htmlFor="admin-name">{t("account.name")}</Label>
                        <Input
                            id="admin-name"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="admin-email">{t("login.email")}</Label>
                        <Input
                            id="admin-email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <PasswordFields
                        value={password}
                        onChange={setPassword}
                        again={again}
                        onAgain={setAgain}
                    />
                    <FormError error={create.error} />
                    <Button
                        type="submit"
                        disabled={
                            create.isPending || !name || !email || !passwordReady(password, again)
                        }
                    >
                        <UserPlusIcon />
                        {t("accounts.createAdmin")}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}

function useAccountWrite() {
    const client = useQueryClient();
    return useMutation({
        mutationFn: ({ path, method, body }: { path: string; method: string; body?: object }) =>
            api<{ sent?: string }>(path, { method, body }),
        onSuccess: () => void client.invalidateQueries({ queryKey: keys.users }),
    });
}

function Invite({ mail }: { mail: boolean }) {
    const t = useTranslations("web");
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [role, setRole] = useState<(typeof ROLES)[number]>("member");
    const invite = useAccountWrite();
    const submit = (event: FormEvent) => {
        event.preventDefault();
        invite.mutate(
            { path: "/api/users", method: "POST", body: { name, email, role } },
            {
                onSuccess: () => {
                    setName("");
                    setEmail("");
                },
            },
        );
    };
    return (
        <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_9rem_auto] sm:items-end">
                <div className="space-y-2">
                    <Label htmlFor="invite-name">{t("account.name")}</Label>
                    <Input
                        id="invite-name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="invite-email">{t("login.email")}</Label>
                    <Input
                        id="invite-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="invite-role">{t("accounts.role")}</Label>
                    <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                        <SelectTrigger id="invite-role" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {ROLES.map((r) => (
                                <SelectItem key={r} value={r}>
                                    {t(`header.role.${r}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button type="submit" disabled={!mail || invite.isPending || !name || !email}>
                    <UserPlusIcon />
                    {t("accounts.invite")}
                </Button>
            </div>
            <FormError error={invite.error} />
            {invite.isSuccess && (
                <p className="text-sm text-constructive">{t("accounts.invited")}</p>
            )}
            {!mail && (
                <p className="text-xs text-muted-foreground">{t("accounts.inviteNeedsMail")}</p>
            )}
        </form>
    );
}

function AccountRow({ user, self, mail }: { user: User; self: boolean; mail: boolean }) {
    const t = useTranslations("web");
    const format = useFormat();
    const write = useAccountWrite();
    const [confirming, setConfirming] = useState(false);
    const path = `/api/users/${user.id}`;
    if (confirming)
        return (
            <li className="flex flex-wrap items-center gap-3 bg-destructive/5 p-3 text-sm">
                <p className="flex-1">{t("accounts.confirmDelete", { name: user.name })}</p>
                <Button
                    variant="destructive"
                    size="sm"
                    disabled={write.isPending}
                    onClick={() => write.mutate({ path, method: "DELETE" })}
                >
                    <Trash2Icon />
                    {t("accounts.delete")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    {t("common.cancel")}
                </Button>
                <FormError error={write.error} />
            </li>
        );
    return (
        <li className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                    {user.name}
                    {self && (
                        <Badge variant="info" className="ml-2">
                            {t("accounts.you")}
                        </Badge>
                    )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                    {user.email ?? t("accounts.tokenOnly")} ·{" "}
                    {user.lastLoginAt
                        ? t("accounts.lastLogin", { when: format.relative(user.lastLoginAt) })
                        : t("accounts.neverLoggedIn")}
                </p>
                <FormError error={write.error} />
            </div>
            <Badge variant="outline">{t(user.totp ? "account.viaApp" : "account.viaEmail")}</Badge>
            <Select
                value={user.role}
                onValueChange={(role) => write.mutate({ path, method: "PATCH", body: { role } })}
            >
                <SelectTrigger aria-label={t("accounts.role")} className="w-36">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                            {t(`header.role.${r}`)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("accounts.actions", { name: user.name })}
                    >
                        <MoreHorizontalIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {user.email && mail && (
                        <DropdownMenuItem
                            onSelect={() => write.mutate({ path: `${path}/link`, method: "POST" })}
                        >
                            <MailIcon />
                            {t("accounts.sendLink")}
                        </DropdownMenuItem>
                    )}
                    {user.totp && (
                        <DropdownMenuItem
                            onSelect={() =>
                                write.mutate({ path: `${path}/two-factor`, method: "DELETE" })
                            }
                        >
                            <ShieldOffIcon />
                            {t("accounts.resetTwoFactor")}
                        </DropdownMenuItem>
                    )}
                    {!self && (
                        <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setConfirming(true)}
                        >
                            <Trash2Icon />
                            {t("accounts.delete")}
                        </DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {write.data?.sent && (
                <p className="w-full text-xs text-constructive">
                    {t(`accounts.sent.${write.data.sent as "invite" | "reset"}`)}
                </p>
            )}
        </li>
    );
}

function AccountRowsSkeleton() {
    return (
        <Loading>
            <ul className="divide-y rounded-lg border">
                {times(3).map((row) => (
                    <li key={row} className="flex items-center gap-3 p-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-56 max-w-full" />
                        </div>
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-9 w-36 rounded-3xl" />
                        <Skeleton className="size-9 rounded-4xl" />
                    </li>
                ))}
            </ul>
        </Loading>
    );
}

function AccountList({ me }: { me: User }) {
    const t = useTranslations("web");
    const users = useUsers(true);
    const mail = useSettings().data?.mail ?? false;
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("accounts.list")}</CardTitle>
                <CardDescription>{t("accounts.listHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <Invite mail={mail} />
                {users.isPending ? (
                    <AccountRowsSkeleton />
                ) : users.isError ? (
                    <ErrorState error={users.error} onRetry={() => users.refetch()} />
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {users.data.map((user) => (
                            <AccountRow
                                key={user.id}
                                user={user}
                                self={user.id === me.id}
                                mail={mail}
                            />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

// One tab for both: everyone's own account, and for an admin also everyone else's.
export function Accounts() {
    const t = useTranslations("web");
    const { session } = useAuth();
    const me = useMe();
    if (session.status === "open")
        return (
            <div className="grid max-w-3xl gap-6 mx-auto">
                <EnableAccounts />
            </div>
        );
    if (me?.role !== "admin") return <Account />;
    return (
        <Tabs defaultValue="own" className="max-w-3xl gap-6">
            <TabsList>
                <TabsTrigger value="own">
                    <UserRoundIcon />
                    {t("accounts.own")}
                </TabsTrigger>
                <TabsTrigger value="all">
                    <UsersIcon />
                    {t("accounts.list")}
                </TabsTrigger>
            </TabsList>
            <TabsContent value="own">
                <Account />
            </TabsContent>
            <TabsContent value="all">
                <AccountList me={me} />
            </TabsContent>
        </Tabs>
    );
}
