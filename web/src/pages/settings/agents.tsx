import { useMutation } from "@tanstack/react-query";
import {
    ChevronDownIcon,
    InfoIcon,
    PlugZapIcon,
    PlusIcon,
    RefreshCwIcon,
    Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { AgentMark } from "@/components/agent-mark";
import { ErrorState, FormError, Loading, UNDERLINE_TAB, UNDERLINE_TABS } from "@/components/page";
import { times } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useMe } from "@/lib/auth";
import {
    useAgentDefaults,
    useAgentLogin,
    useAgents,
    useModels,
    useSaveAgentDefaults,
} from "@/lib/queries";
import type { AgentDefaults, AgentInfo, AgentName } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
    AddAccountDialog,
    CommandBox,
    ConnectDialog,
    loginCommand,
} from "@/pages/settings/agent-login";

const AUTO = "auto";

type Login = AgentInfo["logins"][number];
type Models = AgentDefaults["models"];

export function withAgentValue(models: Models, agent: AgentName, model: string | null): Models {
    const { [agent]: _, ...rest } = models;
    return model ? { ...rest, [agent]: model } : rest;
}

// The model select of one agent: its saved model is kept even when the CLI no longer lists it.
export function ModelSelect({
    agent,
    value,
    disabled,
    onChange,
    autoLabel,
}: {
    agent: AgentName;
    value: string | null;
    disabled?: boolean;
    onChange: (model: string | null) => void;
    autoLabel?: string;
}) {
    const t = useTranslations("web");
    const models = useModels();
    const agents = useAgents();
    const installed = agents.data?.some((a) => a.agent === agent && a.bin) ?? false;
    const listed = models.data?.filter((m) => m.agent === agent) ?? [];
    const options =
        value && !listed.some((m) => m.value === value)
            ? [...listed, { agent, value, label: value, description: "" }]
            : listed;
    return (
        <Select
            value={value ?? AUTO}
            disabled={disabled}
            onValueChange={(model) => onChange(model === AUTO ? null : model)}
        >
            <SelectTrigger aria-label={t("settings.modelOf", { agent })} className="w-full">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={AUTO}>{autoLabel ?? t("settings.autoModel")}</SelectItem>
                {installed && models.isSuccess && !listed.length && (
                    <SelectItem value="none" disabled>
                        {t("settings.modelsUnavailable")}
                    </SelectItem>
                )}
                {options.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                        {m.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function Defaults({ agents, defaults }: { agents: AgentInfo[]; defaults: AgentDefaults }) {
    const t = useTranslations("web");
    const me = useMe();
    const save = useSaveAgentDefaults();
    const readOnly = me !== null && me.role !== "admin";
    const set = (change: Partial<AgentDefaults>) => save.mutate({ ...defaults, ...change });
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("settings.defaultsTitle")}</CardTitle>
                <CardDescription>
                    {t(readOnly ? "settings.defaultsAdminOnly" : "settings.defaultsHint")}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <Tabs
                    activationMode="manual"
                    value={defaults.agent}
                    onValueChange={(agent) => set({ agent: agent as AgentName })}
                >
                    <TabsList aria-label={t("settings.defaultAgent")} className="flex-wrap">
                        {agents.map(({ agent, bin }) => (
                            <TabsTrigger
                                key={agent}
                                value={agent}
                                disabled={readOnly || save.isPending}
                                title={bin ? undefined : t("settings.notInstalled")}
                                className={cn("flex-none font-mono", !bin && "opacity-50")}
                            >
                                {agent}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                <div className="space-y-3">
                    <p className="text-sm font-medium">{t("settings.defaultModels")}</p>
                    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                        {agents.map(({ agent, bin }) => (
                            <div key={agent} className="min-w-0 space-y-1.5">
                                <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <AgentMark agent={agent} className="size-3.5" />
                                    <span className="font-mono">{agent}</span>
                                    {!bin && (
                                        <span className="text-muted-foreground/70">
                                            · {t("settings.notInstalled")}
                                        </span>
                                    )}
                                </dt>
                                <dd>
                                    <ModelSelect
                                        agent={agent}
                                        value={defaults.models[agent] ?? null}
                                        disabled={readOnly || save.isPending}
                                        onChange={(model) =>
                                            set({
                                                models: withAgentValue(
                                                    defaults.models,
                                                    agent,
                                                    model,
                                                ),
                                            })
                                        }
                                    />
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
                <FormError error={save.error} />
            </CardContent>
        </Card>
    );
}

function Rows({ children }: { children: ReactNode }) {
    return <dl className="divide-y rounded-xl border text-sm">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[8rem_1fr] gap-4 px-4 py-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 truncate">{children}</dd>
        </div>
    );
}

type State = "yes" | "no" | "unknown" | "missing";

const STATE = {
    yes: { dot: "bg-constructive", key: "settings.loggedIn" },
    no: { dot: "bg-warning", key: "settings.notLoggedIn" },
    unknown: { dot: "bg-muted-foreground/50", key: "settings.cannotVerify" },
    missing: { dot: "bg-muted-foreground/30", key: "settings.notInstalled" },
} as const;

const stateOf = (info: AgentInfo, login: Login | undefined): State =>
    !info.bin
        ? "missing"
        : login?.loggedIn === true
          ? "yes"
          : login?.loggedIn === false
            ? "no"
            : "unknown";

const Dot = ({ state }: { state: State }) => (
    <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", STATE[state].dot)} />
);

function Note({ children }: { children: ReactNode }) {
    return (
        <Alert variant="info" role="note">
            <InfoIcon />
            <AlertDescription>{children}</AlertDescription>
        </Alert>
    );
}

function LoginCard({ info, login }: { info: AgentInfo; login: Login }) {
    const t = useTranslations("web");
    const me = useMe();
    const agents = useAgents();
    const remove = useAgentLogin();
    const dropToken = useMutation({
        mutationFn: () =>
            api(`/api/agents/${info.agent}/logins/${login.name}/token`, { method: "DELETE" }),
        onSuccess: () => void agents.refetch(),
    });
    const [details, setDetails] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [removing, setRemoving] = useState(false);
    const command = loginCommand(info, login, me !== null);
    const state = stateOf(info, login);
    const commandLabel = t(me ? "settings.loginWithToken" : "settings.loginOnMachine");
    return (
        <Card className="gap-0 overflow-hidden py-0">
            <div className="flex items-center gap-3 p-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <AgentMark agent={info.agent} className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                        <span className="truncate">
                            {login.discovered ? t("settings.defaultLogin") : login.name}
                        </span>
                        {(login.discovered || login.linked) && (
                            <Badge variant="secondary" className="font-normal">
                                {t(login.discovered ? "settings.discovered" : "settings.linked")}
                            </Badge>
                        )}
                    </p>
                    {login.token ? (
                        <p className="truncate text-sm text-muted-foreground">
                            {t("settings.viaToken")}
                        </p>
                    ) : (
                        <p
                            className="truncate font-mono text-xs text-muted-foreground"
                            title={login.dir}
                        >
                            {login.dir}
                        </p>
                    )}
                </div>
                <Badge variant="outline" className="h-6 gap-1.5 px-2.5">
                    <Dot state={state} />
                    {t(STATE[state].key)}
                </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-t bg-muted/30 px-3 py-2">
                {info.bin && (login.loggedIn !== true || info.token) && (
                    <Button
                        size="sm"
                        variant={login.loggedIn === true ? "outline" : "default"}
                        onClick={() => setConnecting(true)}
                    >
                        <PlugZapIcon />
                        {t(login.loggedIn === true ? "settings.reconnect" : "settings.connect")}
                    </Button>
                )}
                {login.token && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={dropToken.isPending}
                        onClick={() => dropToken.mutate()}
                    >
                        <Trash2Icon />
                        {t("settings.removeToken")}
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label={t("settings.checkAgain")}
                    title={t("settings.checkAgain")}
                    disabled={agents.isFetching}
                    onClick={() => agents.refetch()}
                >
                    <RefreshCwIcon
                        className={cn(
                            agents.isFetching && "animate-spin motion-reduce:animate-none",
                        )}
                    />
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={details}
                    onClick={() => setDetails(!details)}
                >
                    {t(details ? "settings.hideDetails" : "settings.showDetails")}
                    <ChevronDownIcon
                        className={cn("transition-transform", details && "rotate-180")}
                    />
                </Button>
            </div>
            {(details || dropToken.error) && (
                <CardContent className="space-y-4 border-t p-4">
                    <FormError error={dropToken.error} />
                    {details && (
                        <div className="space-y-4">
                            <Rows>
                                <Row label={t("settings.agentBinary")}>
                                    <span className="font-mono" title={info.bin ?? undefined}>
                                        {info.bin ?? "–"}
                                    </span>
                                </Row>
                                <Row label={t("settings.configFolder")}>
                                    <span className="font-mono" title={login.dir}>
                                        {login.dir}
                                    </span>
                                </Row>
                                {!login.discovered && (
                                    <Row label={t("settings.configVariable")}>
                                        <span className="font-mono">{info.configEnv}</span>
                                    </Row>
                                )}
                            </Rows>
                            {info.bin && <CommandBox label={commandLabel} command={command} />}
                            {!login.discovered &&
                                (removing ? (
                                    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-destructive/5 p-3 text-sm">
                                        <p className="min-w-0 flex-1">
                                            {t(
                                                login.linked
                                                    ? "settings.confirmRemoveLinked"
                                                    : "settings.confirmRemoveOwn",
                                                { login: login.name },
                                            )}
                                        </p>
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            disabled={remove.isPending}
                                            onClick={() =>
                                                remove.mutate({
                                                    agent: info.agent,
                                                    name: login.name,
                                                    remove: true,
                                                })
                                            }
                                        >
                                            <Trash2Icon />
                                            {t("settings.removeLogin", { login: login.name })}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setRemoving(false)}
                                        >
                                            {t("common.cancel")}
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-destructive"
                                        onClick={() => setRemoving(true)}
                                    >
                                        <Trash2Icon />
                                        {t("settings.removeLogin", { login: login.name })}
                                    </Button>
                                ))}
                            <FormError error={remove.error} />
                        </div>
                    )}
                </CardContent>
            )}
            <ConnectDialog
                info={info}
                login={login}
                open={connecting}
                onOpenChange={setConnecting}
            />
        </Card>
    );
}

function AgentTab({ info, agents }: { info: AgentInfo; agents: AgentInfo[] }) {
    const t = useTranslations("web");
    const [adding, setAdding] = useState(false);
    const extra = info.logins.length - 1;
    return (
        <div className="space-y-6">
            <Rows>
                <Row label={t("settings.installed")}>
                    {t(info.bin ? "settings.yes" : "settings.no")}
                </Row>
                {info.bin && (
                    <Row label={t("settings.agentVersion")}>
                        <span className="font-mono">{info.version ?? "–"}</span>
                    </Row>
                )}
                <Row label={t("settings.agentLogins")}>
                    {extra
                        ? t("settings.accountsCount", { count: info.logins.length, added: extra })
                        : t("settings.accountsDiscovered")}
                </Row>
            </Rows>
            {!info.bin && (
                <CommandBox
                    label={t("settings.installHint", { agent: info.label })}
                    command={info.install}
                />
            )}
            <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">{t("settings.logins")}</h2>
                    {info.configEnv && (
                        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                            <PlusIcon />
                            {t("settings.addAccount")}
                        </Button>
                    )}
                </div>
                <AddAccountDialog
                    agents={agents}
                    initial={info.agent}
                    open={adding}
                    onOpenChange={setAdding}
                />
                {info.logins.map((login) => (
                    <LoginCard key={login.name} info={info} login={login} />
                ))}
                {!info.configEnv && <Note>{t("settings.singleLogin", { agent: info.label })}</Note>}
                {!info.mcp && <Note>{t("settings.noMcp", { agent: info.label })}</Note>}
            </section>
        </div>
    );
}

function AgentsSkeleton() {
    const t = useTranslations("web");
    return (
        <Loading className="mx-auto grid max-w-3xl min-w-0 grid-cols-1 gap-6">
            <p className="text-sm text-muted-foreground">{t("settings.agentsIntro")}</p>
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.defaultsTitle")}</CardTitle>
                    <Skeleton className="h-4 w-72 max-w-full" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-9 w-96 max-w-full" />
                    <div className="space-y-3">
                        <p className="text-sm font-medium">{t("settings.defaultModels")}</p>
                        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                            {times(4).map((agent) => (
                                <div key={agent} className="space-y-1.5">
                                    <Skeleton className="h-4 w-20" />
                                    <Skeleton className="h-9 w-full rounded-3xl" />
                                </div>
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>
            <div className="space-y-6">
                <div className="flex gap-5 pb-2">
                    {times(4).map((tab) => (
                        <Skeleton key={tab} className="h-5 w-20" />
                    ))}
                </div>
                <Rows>
                    {times(3).map((row) => (
                        <div key={row} className="grid grid-cols-[8rem_1fr] gap-4 px-4 py-3">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-32" />
                        </div>
                    ))}
                </Rows>
                <Card className="gap-0 py-0">
                    <div className="flex items-center gap-3 p-4">
                        <Skeleton className="size-10 rounded-xl" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-3 w-56" />
                        </div>
                    </div>
                </Card>
            </div>
        </Loading>
    );
}

// Whether each CLI is installed, its logins, and what projects run by default.
export function AgentAccounts() {
    const t = useTranslations("web");
    const agents = useAgents();
    const defaults = useAgentDefaults();
    if (agents.isPending || defaults.isPending) return <AgentsSkeleton />;
    if (agents.isError) return <ErrorState error={agents.error} onRetry={() => agents.refetch()} />;
    if (defaults.isError)
        return <ErrorState error={defaults.error} onRetry={() => defaults.refetch()} />;
    return (
        <div className="grid max-w-3xl min-w-0 grid-cols-1 gap-6 mx-auto">
            <p className="text-sm text-muted-foreground">{t("settings.agentsIntro")}</p>
            <Defaults agents={agents.data} defaults={defaults.data} />
            <Tabs defaultValue={agents.data[0]?.agent}>
                <TabsList className={cn(UNDERLINE_TABS, "scroll-fade-x")}>
                    {agents.data.map((info) => {
                        const state = stateOf(info, info.logins[0]);
                        return (
                            <TabsTrigger
                                key={info.agent}
                                value={info.agent}
                                title={t(STATE[state].key)}
                                className={cn(UNDERLINE_TAB, !info.bin && "opacity-60")}
                            >
                                <Dot state={state} />
                                {info.label}
                            </TabsTrigger>
                        );
                    })}
                </TabsList>
                {agents.data.map((info) => (
                    <TabsContent key={info.agent} value={info.agent}>
                        <AgentTab info={info} agents={agents.data} />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}
