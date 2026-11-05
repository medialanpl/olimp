import { SlidersHorizontalIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { AgentMark, agentLabel } from "@/components/agent-mark";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAgentDefaults, useAgents, useRepoWrite } from "@/lib/queries";
import type { AgentName, Repo, RepoAgents } from "@/lib/types";
import { Section } from "@/pages/project/shared";
import { ModelSelect, withAgentValue } from "@/pages/settings/agents";

const DEFAULT = "default";
// Hover only brightens the text: the muted ground marks the choice.
const ROW =
    "h-9 w-full justify-start gap-2.5 rounded-lg px-3 text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-muted data-[state=on]:text-foreground";

function AgentsSkeleton() {
    const t = useTranslations("web");
    return (
        <Loading className="grid gap-6">
            <Section title={t("repo.agentTitle")} description={t("repo.agentHint")}>
                <div className="w-full max-w-md space-y-0.5 rounded-xl border bg-card p-1">
                    {times(4).map((row) => (
                        <div key={row} className="flex h-9 items-center gap-2.5 px-3">
                            <Skeleton className="size-4" />
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="ml-auto h-3 w-16" />
                        </div>
                    ))}
                </div>
            </Section>
            <Section title={t("repo.runsOnTitle")} description={t("repo.runsOnHint")}>
                <ul className="divide-y rounded-lg border">
                    {times(3).map((row) => (
                        <li
                            key={row}
                            className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2 p-2 max-sm:grid-cols-2"
                        >
                            <Skeleton className="h-4 w-20 max-sm:col-span-2" />
                            <Skeleton className="h-9 rounded-3xl" />
                            <Skeleton className="h-9 rounded-3xl" />
                        </li>
                    ))}
                </ul>
            </Section>
        </Loading>
    );
}

// What this project runs on; anything left on default follows the installation's.
export function Agents({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const agents = useAgents();
    const defaults = useAgentDefaults();
    const write = useRepoWrite(repo.id);
    if (agents.isPending || defaults.isPending) return <AgentsSkeleton />;
    if (agents.isError) return <ErrorState error={agents.error} />;
    if (defaults.isError) return <ErrorState error={defaults.error} />;
    const chosen = repo.agents;
    const set = (change: Partial<RepoAgents>) =>
        write.mutate({ method: "PUT", path: "agents", body: { ...chosen, ...change } });
    return (
        <>
            <Section title={t("repo.agentTitle")} description={t("repo.agentHint")}>
                {/* The default runner: one radio list, the chosen row on a muted ground. */}
                <ToggleGroup
                    type="single"
                    orientation="vertical"
                    spacing={1}
                    aria-label={t("repo.agentTitle")}
                    value={chosen.agent ?? DEFAULT}
                    disabled={write.isPending}
                    onValueChange={(agent) =>
                        agent && set({ agent: agent === DEFAULT ? null : (agent as AgentName) })
                    }
                    className="w-full max-w-md gap-0.5 rounded-xl border bg-card p-1"
                >
                    <ToggleGroupItem value={DEFAULT} className={ROW}>
                        <SlidersHorizontalIcon className="text-muted-foreground" />
                        <span>{t("repo.agentDefault")}</span>
                        <span className="ml-auto truncate text-xs font-normal text-muted-foreground">
                            {t("repo.agentDefaultHint", { agent: agentLabel(defaults.data.agent) })}
                        </span>
                    </ToggleGroupItem>
                    {agents.data.map((info) => (
                        <ToggleGroupItem
                            key={info.agent}
                            value={info.agent}
                            disabled={!info.bin && chosen.agent !== info.agent}
                            title={info.bin ? undefined : t("repo.agentMissing")}
                            className={ROW}
                        >
                            <AgentMark agent={info.agent} />
                            <span>{agentLabel(info.agent)}</span>
                            <span className="ml-auto truncate font-mono text-xs font-normal text-muted-foreground">
                                {info.bin ? (info.version ?? "") : t("repo.notInstalled")}
                            </span>
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </Section>
            <Section title={t("repo.runsOnTitle")} description={t("repo.runsOnHint")}>
                <div className="space-y-3">
                    <div className="grid grid-cols-[7rem_1fr_1fr] gap-2 px-1 text-xs font-medium text-muted-foreground max-sm:hidden">
                        <span>{t("repo.agentColumn")}</span>
                        <span>{t("repo.modelsTitle")}</span>
                        <span>{t("repo.loginsTitle")}</span>
                    </div>
                    <ul className="divide-y rounded-lg border">
                        {agents.data.map(({ agent, logins }) => {
                            const login = chosen.logins[agent] ?? DEFAULT;
                            const names = logins.map((l) => l.name);
                            return (
                                <li
                                    key={agent}
                                    className="grid grid-cols-[7rem_1fr_1fr] items-center gap-2 p-2 max-sm:grid-cols-2"
                                >
                                    <span className="flex items-center gap-2 text-sm max-sm:col-span-2">
                                        <AgentMark agent={agent} />
                                        {agentLabel(agent)}
                                    </span>
                                    <ModelSelect
                                        agent={agent}
                                        value={chosen.models[agent] ?? null}
                                        disabled={write.isPending}
                                        autoLabel={t("repo.byDefault", {
                                            value: defaults.data.models[agent] ?? "auto",
                                        })}
                                        onChange={(model) =>
                                            set({
                                                models: withAgentValue(chosen.models, agent, model),
                                            })
                                        }
                                    />
                                    <Select
                                        value={login}
                                        disabled={write.isPending}
                                        onValueChange={(next) =>
                                            set({
                                                logins: withAgentValue(
                                                    chosen.logins,
                                                    agent,
                                                    next === DEFAULT ? null : next,
                                                ),
                                            })
                                        }
                                    >
                                        <SelectTrigger
                                            aria-label={t("repo.loginOf", { agent })}
                                            className="w-full"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {(names.includes(login)
                                                ? names
                                                : [...names, login]
                                            ).map((name) => (
                                                <SelectItem key={name} value={name}>
                                                    {name === DEFAULT
                                                        ? t("settings.defaultLogin")
                                                        : name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </li>
                            );
                        })}
                    </ul>
                    <p className="text-xs text-muted-foreground">{t("repo.loginsHint")}</p>
                    <FormError error={write.error} />
                </div>
            </Section>
        </>
    );
}
