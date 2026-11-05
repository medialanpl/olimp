import { ArrowUpRightIcon, CopyIcon, FileCogIcon, FilePlusIcon, SaveIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { AGENT_NAMES, AgentMark, agentLabel } from "@/components/agent-mark";
import { CodeEditor } from "@/components/code-editor";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAgentConfig, useAgentConfigFile, useAgents, useRepoWrite } from "@/lib/queries";
import type {
    AgentConfigListing,
    AgentName,
    ConfigContent,
    ConfigView,
    GitState,
    Repo,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Section, useIsAdmin } from "@/pages/project/shared";

const KINDS = ["settings", "mcp", "memory"] as const;

const GIT_LOOK: Record<GitState, "constructive" | "info" | "secondary" | "outline"> = {
    committed: "constructive",
    modified: "info",
    untracked: "info",
    ignored: "secondary",
};

function Editor({ repo, file, git }: { repo: Repo; file: ConfigContent; git: GitState | null }) {
    const t = useTranslations("web");
    const admin = useIsAdmin();
    const write = useRepoWrite(repo.id);
    const [text, setText] = useState(file.content);
    const readOnly = file.scope !== "user" && !admin;
    const changed = text !== file.content;
    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-sm" title={file.path}>
                    {file.scope === "user" ? `~/${file.path}` : file.path}
                </code>
                <Badge variant="outline">{t(`repo.scope.${file.scope}`)}</Badge>
                <Badge variant="secondary">{file.format.toUpperCase()}</Badge>
                {git && <Badge variant={GIT_LOOK[git]}>{t(`repo.git.${git}`)}</Badge>}
                {file.docs && (
                    <Button asChild variant="ghost" size="sm">
                        <a href={file.docs} target="_blank" rel="noreferrer noopener">
                            {t("repo.docs")}
                            <ArrowUpRightIcon />
                        </a>
                    </Button>
                )}
            </div>
            <p className="text-xs text-muted-foreground">
                {t(
                    file.scope === "user"
                        ? "repo.userFileHint"
                        : file.scope === "project"
                          ? "repo.projectFileHint"
                          : file.seeded
                            ? "repo.localSeededHint"
                            : "repo.localFileHint",
                )}
            </p>
            <CodeEditor
                value={text}
                path={file.path}
                readOnly={readOnly}
                aria-label={file.path}
                placeholder={file.exists ? undefined : t("repo.newFile")}
                className="max-h-[70vh] min-h-80 overflow-y-auto"
                onChange={setText}
            />
            <div className="flex flex-wrap items-center gap-3">
                <Button
                    disabled={readOnly || write.isPending || !changed}
                    onClick={() =>
                        write.mutate({
                            method: "PUT",
                            path: `agent-config/${file.id}`,
                            body: { content: text },
                        })
                    }
                >
                    {file.exists ? <SaveIcon /> : <FilePlusIcon />}
                    {file.exists ? t("common.save") : t("repo.createFile")}
                </Button>
                <span className="text-sm text-muted-foreground">
                    {readOnly
                        ? t("repo.projectFileAdminOnly")
                        : write.isSuccess && !changed
                          ? t("repo.saved")
                          : null}
                </span>
            </div>
            <FormError error={write.error} />
        </div>
    );
}

function EditorSkeleton() {
    return (
        <Loading className="space-y-3">
            <div className="flex items-center gap-2">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-12" />
            </div>
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-80 w-full" />
            <Skeleton className="h-9 w-24 rounded-4xl" />
        </Loading>
    );
}

function OpenFile({ repo, id, git }: { repo: Repo; id: string; git: GitState | null }) {
    const file = useAgentConfigFile(repo.id, id);
    if (file.isPending) return <EditorSkeleton />;
    if (file.isError) return <ErrorState error={file.error} onRetry={() => file.refetch()} />;
    return <Editor key={file.data.id} repo={repo} file={file.data} git={git} />;
}

// A local file belongs out of git; one git does not ignore would be committed, so that shows.
const healthy = (file: ConfigView) => file.scope === "local" && file.git === "ignored";

// Claude keeps these in its own state file, so OLIMP shows their names and leaves them be.
function ClaudeServers({ servers }: { servers: AgentConfigListing["mcpServers"] }) {
    const t = useTranslations("web");
    const scopes = [
        ["user", servers.user],
        ["local", servers.local],
    ] as const;
    return (
        <div className="space-y-1.5 px-2 pt-1">
            <p className="text-xs font-medium">{t("repo.mcpScopesTitle")}</p>
            <p className="text-[0.7rem] text-muted-foreground">{t("repo.mcpScopesHint")}</p>
            {servers.user.length + servers.local.length ? (
                scopes.map(
                    ([scope, names]) =>
                        names.length > 0 && (
                            <div key={scope} className="flex flex-wrap items-center gap-1">
                                <span className="text-[0.7rem] text-muted-foreground">
                                    {t(`repo.scope.${scope}`)}:
                                </span>
                                {names.map((name) => (
                                    <Badge key={name} variant="outline" className="font-mono">
                                        {name}
                                    </Badge>
                                ))}
                            </div>
                        ),
                )
            ) : (
                <p className="text-[0.7rem] text-muted-foreground">{t("repo.mcpNone")}</p>
            )}
            {servers.local.length > 0 && (
                <p className="text-[0.7rem] text-muted-foreground">{t("repo.mcpLocalNote")}</p>
            )}
        </div>
    );
}

function FileList({
    files,
    selected,
    onSelect,
    servers,
}: {
    files: ConfigView[];
    selected: string | null;
    onSelect: (id: string) => void;
    servers: AgentConfigListing["mcpServers"] | null;
}) {
    const t = useTranslations("web");
    return (
        <nav className="space-y-4" aria-label={t("projectSettings.agentConfig")}>
            {KINDS.map((kind) => {
                const group = files.filter((file) => file.kind === kind);
                if (!group.length) return null;
                return (
                    <div key={kind} className="space-y-1">
                        <p className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            {t(`repo.kind.${kind}`)}
                        </p>
                        <ul className="space-y-0.5">
                            {group.map((file) => (
                                <li key={file.id}>
                                    <button
                                        type="button"
                                        aria-current={file.id === selected}
                                        disabled={file.blocked}
                                        title={file.blocked ? t("repo.blocked") : undefined}
                                        onClick={() => onSelect(file.id)}
                                        className={cn(
                                            "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-hidden hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                                            file.id === selected && "bg-muted font-medium",
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "size-1.5 shrink-0 rounded-full",
                                                file.exists
                                                    ? "bg-constructive"
                                                    : "bg-muted-foreground/30",
                                            )}
                                            title={t(file.exists ? "repo.exists" : "repo.missing")}
                                        />
                                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                            {file.scope === "user" ? `~/${file.path}` : file.path}
                                        </span>
                                        {file.seeded && (
                                            <CopyIcon
                                                aria-label={t("repo.seeded")}
                                                className="size-3 shrink-0 text-muted-foreground"
                                            >
                                                <title>{t("repo.seededHint")}</title>
                                            </CopyIcon>
                                        )}
                                        <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                                            {!file.exists
                                                ? t("repo.absent")
                                                : file.git &&
                                                    file.git !== "committed" &&
                                                    !healthy(file)
                                                  ? t(`repo.git.${file.git}`)
                                                  : t(`repo.scope.${file.scope}`)}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {kind === "mcp" && servers && <ClaudeServers servers={servers} />}
                    </div>
                );
            })}
        </nav>
    );
}

function AgentConfigSkeleton() {
    const t = useTranslations("web");
    return (
        <Section title={t("repo.configTitle")} description={t("repo.configHint")}>
            <Loading className="space-y-4">
                <Skeleton className="h-9 w-80 max-w-full" />
                <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <div className="space-y-1">
                        <Skeleton className="mx-2 h-3 w-20" />
                        {times(4).map((file) => (
                            <div key={file} className="flex items-center gap-2 px-2 py-1.5">
                                <Skeleton className="size-1.5" />
                                <Skeleton className="h-4 flex-1" />
                                <Skeleton className="h-3 w-10" />
                            </div>
                        ))}
                    </div>
                    <Skeleton className="min-h-60 rounded-lg" />
                </div>
            </Loading>
        </Section>
    );
}

// Per agent, its own settings, MCP and memory files, in the project and in HOME.
export function AgentConfig({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const listing = useAgentConfig(repo.id);
    const installed = useAgents();
    const [agent, setAgent] = useState<AgentName>("claude");
    const [selected, setSelected] = useState<string | null>(null);
    if (listing.isPending) return <AgentConfigSkeleton />;
    if (listing.isError)
        return <ErrorState error={listing.error} onRetry={() => listing.refetch()} />;
    const agents = AGENT_NAMES.filter((a) =>
        listing.data.files.some((file) => file.agents.includes(a)),
    );
    const files = listing.data.files.filter((file) => file.agents.includes(agent));
    // Unknown until the agents list arrives, so nothing is flagged meanwhile.
    const missing = (a: AgentName) =>
        installed.data?.some((info) => info.agent === a && !info.bin) ?? false;
    const open = files.some((file) => file.id === selected) ? selected : null;
    return (
        <Section title={t("repo.configTitle")} description={t("repo.configHint")}>
            <div className="space-y-4">
                <Tabs
                    activationMode="manual"
                    value={agent}
                    onValueChange={(value) => {
                        setAgent(value as AgentName);
                        setSelected(null);
                    }}
                >
                    <TabsList aria-label={t("repo.configAgent")}>
                        {agents.map((a) => (
                            <TabsTrigger key={a} value={a}>
                                <AgentMark agent={a} />
                                {agentLabel(a)}
                                {missing(a) && (
                                    <Badge variant="outline" className="font-normal">
                                        {t("repo.notInstalled")}
                                    </Badge>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
                {missing(agent) && (
                    <p className="text-sm text-muted-foreground">
                        {t("repo.agentMissingHint", { agent: agentLabel(agent) })}
                    </p>
                )}
                <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                    <FileList
                        files={files}
                        selected={open}
                        onSelect={setSelected}
                        servers={agent === "claude" ? listing.data.mcpServers : null}
                    />
                    {open ? (
                        <OpenFile
                            key={open}
                            repo={repo}
                            id={open}
                            git={files.find((file) => file.id === open)?.git ?? null}
                        />
                    ) : (
                        <div className="flex min-h-60 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                            <FileCogIcon className="size-6" />
                            {t("repo.pickFile")}
                        </div>
                    )}
                </div>
            </div>
        </Section>
    );
}
