import { ConstructionIcon } from "lucide-react";
import type { ComponentType } from "react";
import { useParams } from "react-router";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page";
import { SETTINGS } from "@/lib/nav";
import { NotFoundPage } from "@/pages/not-found";
import { Accounts } from "@/pages/settings/accounts";
import { AgentAccounts } from "@/pages/settings/agents";
import { Appearance } from "@/pages/settings/appearance";
import { Instructions } from "@/pages/settings/instructions";
import { Keyboard } from "@/pages/settings/keyboard";
import { Mail } from "@/pages/settings/mail";
import { Notifications } from "@/pages/settings/notifications";
import { Projects } from "@/pages/settings/projects";
import { Resources } from "@/pages/settings/resources";
import { Skills } from "@/pages/settings/skills";
import { Templates } from "@/pages/settings/templates";

const PAGES: Partial<Record<(typeof SETTINGS)[number]["key"], ComponentType>> = {
    appearance: Appearance,
    notifications: Notifications,
    keyboard: Keyboard,
    templates: Templates,
    instructions: Instructions,
    resources: Resources,
    skills: Skills,
    agents: AgentAccounts,
    accounts: Accounts,
    mail: Mail,
    projects: Projects,
};

export function SettingsPage() {
    const t = useTranslations("web");
    const { section = "" } = useParams();
    const setting = SETTINGS.find(({ key }) => key === section);
    if (!setting) return <NotFoundPage />;
    const Page = PAGES[setting.key];
    return (
        <>
            <PageHeader
                title={t(`settings.${setting.key}`)}
                description={t(`settings.${setting.key}Hint`)}
            />
            {Page ? (
                <Page />
            ) : (
                <EmptyState
                    icon={<ConstructionIcon />}
                    title={t("common.soonTitle")}
                    description={t("common.soon")}
                />
            )}
        </>
    );
}
