import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "use-intl";
import { IntegrationStatus } from "@/components/integrations/integration-catalog";
import { IntegrationLogo } from "@/components/integrations/integration-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { presetOf } from "@/lib/integration-catalog";
import type { Integration, IntegrationView } from "@/lib/types";

const summary = (integration: Integration) =>
    integration.kind === "stdio"
        ? [integration.command, ...integration.args].join(" ")
        : integration.url;

export function ConnectedIntegrations({
    integrations,
    onEdit,
    onRemove,
}: {
    integrations: IntegrationView[];
    onEdit: (integration: IntegrationView) => void;
    onRemove: (integration: IntegrationView) => void;
}) {
    const t = useTranslations("web");
    return (
        <ul className="divide-y rounded-xl border px-4">
            {integrations.map((integration) => {
                const preset = presetOf(integration.name);
                return (
                    <li key={integration.name} className="flex items-center gap-4 py-4">
                        <IntegrationLogo preset={preset} size="sm" />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 font-medium">
                                <h3 className={preset ? undefined : "font-mono text-sm"}>
                                    {preset?.name ?? integration.name}
                                </h3>
                                <Badge variant="outline">
                                    {t(
                                        integration.kind === "stdio"
                                            ? "repo.kindStdio"
                                            : "repo.kindHttp",
                                    )}
                                </Badge>
                                <IntegrationStatus integration={integration} />
                            </div>
                            <p
                                className="truncate font-mono text-xs text-muted-foreground"
                                title={summary(integration)}
                            >
                                {summary(integration)}
                            </p>
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm">
                                    <MoreHorizontalIcon />
                                    <span className="sr-only">
                                        {t("integrations.actions", { name: integration.name })}
                                    </span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => onEdit(integration)}>
                                    <PencilIcon />
                                    {t("integrations.edit")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    variant="destructive"
                                    onSelect={() => onRemove(integration)}
                                >
                                    <Trash2Icon />
                                    {t("integrations.remove")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </li>
                );
            })}
        </ul>
    );
}
