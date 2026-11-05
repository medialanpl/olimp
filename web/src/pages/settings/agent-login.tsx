import { useMutation } from "@tanstack/react-query";
import { CheckCircle2Icon, FolderSearchIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { AgentMark } from "@/components/agent-mark";
import { CopyButton } from "@/components/copy-button";
import { FolderBrowser } from "@/components/folder-browser";
import { FormError, Loading } from "@/components/page";
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
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useAgentLogin, useAgents } from "@/lib/queries";
import type { AgentInfo, AgentLogin, AgentName } from "@/lib/types";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;

export function loginCommand(info: AgentInfo, login: AgentLogin, accounts: boolean): string {
    const second = login.discovered ? "" : ` ${login.name}`;
    if (accounts) return `pnpm agent-login ${info.agent}${second}`;
    const command = [info.agent, ...info.loginArgs].join(" ");
    return login.discovered ? command : `${info.configEnv}=${login.dir} ${command}`;
}

export function CommandBox({ label, command }: { label?: ReactNode; command: string }) {
    const t = useTranslations("web");
    return (
        <div className="space-y-1.5">
            {label && <p className="text-sm text-muted-foreground">{label}</p>}
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3">
                <code className="min-w-0 flex-1 py-1 font-mono text-sm break-all">{command}</code>
                <CopyButton value={command} label={t("settings.copyCommand")} />
            </div>
        </div>
    );
}

function Step({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) {
    return (
        <li className="flex gap-3">
            <span
                className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    done && "border-constructive bg-constructive text-background",
                )}
            >
                {done ? <CheckCircle2Icon className="size-4" /> : n}
            </span>
            <div className="min-w-0 flex-1 space-y-2 pt-0.5">{children}</div>
        </li>
    );
}

function ConnectStepsSkeleton() {
    return (
        <Loading>
            <ol className="space-y-5">
                <Step n={1}>
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                </Step>
                <Step n={2}>
                    <Skeleton className="h-4 w-56 max-w-full" />
                </Step>
            </ol>
        </Loading>
    );
}

// Connect, without a terminal of OLIMP's own: the command to run, then OLIMP checks the
// login every few seconds until it is there.
function ConnectSteps({ agent, name }: { agent: AgentName; name: string }) {
    const t = useTranslations("web");
    const me = useMe();
    const agents = useAgents();
    const info = agents.data?.find((a) => a.agent === agent);
    const login = info?.logins.find((l) => l.name === name);
    const connected = login?.loggedIn === true;
    const waiting = login?.loggedIn === false;
    useEffect(() => {
        if (!waiting) return;
        const timer = setInterval(() => void agents.refetch(), POLL_MS);
        return () => clearInterval(timer);
    }, [waiting, agents.refetch]);
    if (!info || !login) return <ConnectStepsSkeleton />;
    return (
        <ol className="space-y-5">
            <Step n={1} done={connected}>
                {info.token && (
                    <>
                        <PasteToken
                            agent={agent}
                            name={name}
                            onSaved={() => void agents.refetch()}
                        />
                        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            {t("settings.tokenOr")}
                        </p>
                    </>
                )}
                <p className="text-sm font-medium">
                    {t(me ? "settings.loginWithToken" : "settings.loginOnMachine")}
                </p>
                <CommandBox command={loginCommand(info, login, me !== null)} />
                <p className="text-xs text-muted-foreground">
                    {t("settings.connectFinish", { agent: info.label })}
                </p>
            </Step>
            <Step n={2} done={connected}>
                {connected ? (
                    <p className="text-sm font-medium text-constructive">
                        {t("settings.connected", { login: name })}
                    </p>
                ) : waiting ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="size-4" />
                        {t("settings.waitingForLogin")}
                    </p>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {t("settings.cannotVerifyHint")}
                    </p>
                )}
            </Step>
        </ol>
    );
}

// Without a terminal on the OLIMP machine: a long-lived token made anywhere the user is logged in.
function PasteToken({
    agent,
    name,
    onSaved,
}: {
    agent: AgentName;
    name: string;
    onSaved: () => void;
}) {
    const t = useTranslations("web");
    const [token, setToken] = useState("");
    const save = useMutation({
        mutationFn: () =>
            api(`/api/agents/${agent}/logins/${name}/token`, {
                method: "PUT",
                body: { token: token.trim() },
            }),
        onSuccess: () => {
            setToken("");
            onSaved();
        },
    });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate();
    };
    return (
        <form onSubmit={submit} className="space-y-2">
            <Label htmlFor="agent-token" className="text-sm font-medium">
                {t("settings.tokenPaste")}
            </Label>
            <CommandBox label={t("settings.tokenRun")} command="claude setup-token" />
            <div className="flex gap-2">
                <Input
                    id="agent-token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={token}
                    placeholder="sk-ant-oat01-…"
                    onChange={(e) => setToken(e.target.value)}
                    className="font-mono"
                />
                <Button type="submit" disabled={save.isPending || token.trim().length < 20}>
                    {t("common.save")}
                </Button>
            </div>
            <FormError error={save.error} />
        </form>
    );
}

export function ConnectDialog({
    info,
    login,
    open,
    onOpenChange,
}: {
    info: AgentInfo;
    login: AgentLogin;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations("web");
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <AgentMark agent={info.agent} />
                        {t("settings.connectTitle", { agent: info.label })}
                    </DialogTitle>
                    <DialogDescription className="font-mono text-xs">{login.dir}</DialogDescription>
                </DialogHeader>
                <DialogBody>
                    {open && <ConnectSteps agent={info.agent} name={login.name} />}
                </DialogBody>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t("common.close")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// A login name from a folder's name, as the API makes it: ".claude-work" is "claude-work".
const slugOf = (path: string) =>
    (path.split("/").filter(Boolean).at(-1) ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);

function AddForm({
    agents,
    initial,
    onAdded,
    onCancel,
}: {
    agents: AgentInfo[];
    initial: AgentName;
    onAdded: (agent: AgentName, name: string) => void;
    onCancel: () => void;
}) {
    const t = useTranslations("web");
    const me = useMe();
    const add = useAgentLogin();
    const choices = agents.filter((a) => a.configEnv);
    const [agent, setAgent] = useState<AgentName>(
        choices.some((a) => a.agent === initial) ? initial : (choices[0]?.agent ?? initial),
    );
    const [name, setName] = useState("");
    const [folder, setFolder] = useState("");
    const [browsing, setBrowsing] = useState(false);
    const custom = me === null;
    const fallback = custom && folder.trim() ? slugOf(folder.trim()) : "";
    const submit = (event: FormEvent) => {
        event.preventDefault();
        add.mutate(
            { agent, name: name.trim(), folder: custom ? folder.trim() : undefined },
            { onSuccess: (login) => onAdded(agent, (login as AgentLogin).name) },
        );
    };
    const pick = (path: string) => {
        setFolder(path);
        setBrowsing(false);
    };
    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
                <DialogTitle>{t("settings.addAccountTitle")}</DialogTitle>
                <DialogDescription>
                    {t(custom ? "settings.addAccountHint" : "settings.addAccountHintAccounts")}
                </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                    <div className="space-y-2">
                        <Label htmlFor="login-agent">{t("settings.loginAgent")}</Label>
                        <Select value={agent} onValueChange={(v) => setAgent(v as AgentName)}>
                            <SelectTrigger id="login-agent" className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {choices.map((a) => (
                                    <SelectItem key={a.agent} value={a.agent}>
                                        <AgentMark agent={a.agent} />
                                        {a.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="login-name">{t("settings.loginName")}</Label>
                        <Input
                            id="login-name"
                            value={name}
                            maxLength={32}
                            spellCheck={false}
                            autoFocus
                            placeholder={fallback || "work"}
                            className="font-mono"
                            onChange={(e) => setName(e.target.value.toLowerCase())}
                        />
                    </div>
                </div>
                {custom && (
                    <div className="space-y-2">
                        <Label htmlFor="login-folder">{t("settings.configFolder")}</Label>
                        <div className="flex gap-2">
                            <Input
                                id="login-folder"
                                value={folder}
                                spellCheck={false}
                                placeholder={`~/.${agent}-second`}
                                className="font-mono"
                                onChange={(e) => setFolder(e.target.value)}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                aria-expanded={browsing}
                                onClick={() => setBrowsing(!browsing)}
                            >
                                <FolderSearchIcon />
                                {t("settings.browse")}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">{t("settings.folderHint")}</p>
                        {/* Dot folders too: an agent's config folder is one. */}
                        {browsing && <FolderBrowser hidden onPick={pick} />}
                    </div>
                )}
                <FormError error={add.error} />
            </DialogBody>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={add.isPending || !(name.trim() || fallback)}>
                    {add.isPending && <Spinner />}
                    {t("settings.addAccount")}
                </Button>
            </DialogFooter>
        </form>
    );
}

// The agent, a name and the config folder; then straight on to Connect.
export function AddAccountDialog({
    agents,
    initial,
    open,
    onOpenChange,
}: {
    agents: AgentInfo[];
    initial: AgentName;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useTranslations("web");
    const [added, setAdded] = useState<{ agent: AgentName; name: string } | null>(null);
    const info = agents.find((a) => a.agent === added?.agent);
    const close = (next: boolean) => {
        onOpenChange(next);
        if (!next) setAdded(null);
    };
    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent>
                {added ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                {info && <AgentMark agent={info.agent} />}
                                {t("settings.accountAdded", { login: added.name })}
                            </DialogTitle>
                            <DialogDescription>{t("settings.accountAddedHint")}</DialogDescription>
                        </DialogHeader>
                        <DialogBody>
                            <ConnectSteps agent={added.agent} name={added.name} />
                        </DialogBody>
                        <DialogFooter>
                            <Button onClick={() => close(false)}>{t("settings.done")}</Button>
                        </DialogFooter>
                    </>
                ) : (
                    open && (
                        <AddForm
                            agents={agents}
                            initial={initial}
                            onAdded={(agent, name) => setAdded({ agent, name })}
                            onCancel={() => close(false)}
                        />
                    )
                )}
            </DialogContent>
        </Dialog>
    );
}
