import type { ComponentType } from "react";
import { useParams } from "react-router";
import { useTranslations } from "use-intl";
import { ErrorState, Loading, PageHeader } from "@/components/page";
import { CardSkeleton, FieldSkeleton } from "@/components/skeletons";
import { REPO_SETTINGS, type RepoSetting } from "@/lib/nav";
import { useRepo } from "@/lib/queries";
import type { Repo } from "@/lib/types";
import { NotFoundPage } from "@/pages/not-found";
import { AgentConfig } from "@/pages/project/agent-config";
import { Agents } from "@/pages/project/agents";
import { General } from "@/pages/project/general";
import { Instructions } from "@/pages/project/instructions";
import { Integrations } from "@/pages/project/integrations";
import { Secrets } from "@/pages/project/secrets";
import { Tasks } from "@/pages/project/tasks";
import { Webhooks } from "@/pages/project/webhooks";
import { Worktrees } from "@/pages/project/worktrees";

const SECTIONS: Record<RepoSetting, ComponentType<{ repo: Repo }>> = {
    general: General,
    secrets: Secrets,
    webhooks: Webhooks,
    integrations: Integrations,
    agents: Agents,
    instructions: Instructions,
    tasks: Tasks,
    agentConfig: AgentConfig,
    worktrees: Worktrees,
};

export function RepoSettingsPage() {
    const t = useTranslations("web");
    const { id = "", section = "" } = useParams();
    const repo = useRepo(id);
    const setting = REPO_SETTINGS.find(({ path }) => path === section);
    if (!setting) return <NotFoundPage />;
    const Section = SECTIONS[setting.key];
    return (
        <>
            <PageHeader
                title={
                    <>
                        <span className="text-muted-foreground">{id} / </span>
                        {t(`projectSettings.${setting.key}`)}
                    </>
                }
                description={t(`projectSettings.${setting.key}Hint`)}
            />
            {repo.isPending ? (
                <Loading className="mx-auto grid max-w-3xl gap-6">
                    <CardSkeleton>
                        <div className="space-y-4">
                            <FieldSkeleton />
                            <FieldSkeleton />
                        </div>
                    </CardSkeleton>
                    <CardSkeleton />
                </Loading>
            ) : repo.isError ? (
                <ErrorState error={repo.error} onRetry={() => repo.refetch()} />
            ) : (
                <div
                    className={
                        setting.key === "agentConfig"
                            ? "grid  gap-6 mx-auto"
                            : "grid max-w-3xl gap-6 mx-auto"
                    }
                >
                    <Section repo={repo.data} />
                </div>
            )}
        </>
    );
}
