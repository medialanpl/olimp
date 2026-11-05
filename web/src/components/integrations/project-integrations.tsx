import { PlugIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { ConnectedIntegrations } from "@/components/integrations/connected-integrations";
import { IntegrationCatalog } from "@/components/integrations/integration-catalog";
import { IntegrationForm, SecretsLink } from "@/components/integrations/integration-form";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { type Preset, presetOf } from "@/lib/integration-catalog";
import { useIntegrations, useRepoWrite } from "@/lib/queries";
import type { IntegrationView } from "@/lib/types";

type Editing = { integration: IntegrationView | null; preset?: Preset };

function Block({
    title,
    description,
    children,
}: {
    title: string;
    description: ReactNode;
    children: ReactNode;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

function ConnectedSkeleton() {
    return (
        <Loading>
            <ul className="divide-y rounded-xl border px-4">
                {times(2).map((integration) => (
                    <li key={integration} className="flex items-center gap-4 py-4">
                        <Skeleton className="size-9 rounded-lg" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex items-center gap-2">
                                <Skeleton className="h-5 w-28" />
                                <Skeleton className="h-5 w-14" />
                            </div>
                            <Skeleton className="h-3 w-64 max-w-full" />
                        </div>
                        <Skeleton className="size-8 rounded-4xl" />
                    </li>
                ))}
            </ul>
        </Loading>
    );
}

// The MCP servers a task, automation or workflow step of this project may choose, and the catalog
// to add more; `newTab` keeps links to other pages from leaving the workflow editor.
export function ProjectIntegrations({ repo, newTab }: { repo: string; newTab?: boolean }) {
    const t = useTranslations("web");
    const integrations = useIntegrations(repo);
    const remove = useRepoWrite(repo);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [removing, setRemoving] = useState<IntegrationView | null>(null);
    const [confirming, setConfirming] = useState(false);
    const edit = (integration: IntegrationView) =>
        setEditing({ integration, preset: presetOf(integration.name) });
    const confirmRemove = (integration: IntegrationView) => {
        remove.reset();
        setRemoving(integration);
        setConfirming(true);
    };
    return (
        <div className="grid gap-6">
            <Block
                title={t("integrations.connectedTitle")}
                description={t("repo.integrationsHint")}
            >
                {integrations.isPending ? (
                    <ConnectedSkeleton />
                ) : integrations.isError ? (
                    <ErrorState error={integrations.error} onRetry={() => integrations.refetch()} />
                ) : !integrations.data.length ? (
                    <EmptyState
                        icon={<PlugIcon />}
                        title={t("repo.noIntegrationsTitle")}
                        description={t("repo.noIntegrations")}
                        className="p-6"
                    />
                ) : (
                    <ConnectedIntegrations
                        integrations={integrations.data}
                        onEdit={edit}
                        onRemove={confirmRemove}
                    />
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                    {t("repo.integrationsSecrets")} <SecretsLink repo={repo} newTab={newTab} />
                </p>
            </Block>
            <Block
                title={t("integrations.catalogTitle")}
                description={t("integrations.catalogHint")}
            >
                <IntegrationCatalog
                    integrations={integrations.data ?? []}
                    onConnect={(preset) => setEditing({ integration: null, preset })}
                    onEdit={edit}
                    onCustom={() => setEditing({ integration: null })}
                />
            </Block>
            <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
                <DialogContent>
                    {editing !== null && (
                        <IntegrationForm
                            key={editing.integration?.name ?? editing.preset?.id ?? "custom"}
                            repo={repo}
                            editing={editing.integration}
                            preset={editing.preset}
                            newTab={newTab}
                            onDone={() => setEditing(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={confirming} onOpenChange={setConfirming}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("repo.deleteIntegration", { name: removing?.name ?? "" })}
                        </DialogTitle>
                        <DialogDescription>
                            {t("repo.confirmDeleteIntegration", { name: removing?.name ?? "" })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormError error={remove.error} />
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirming(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={remove.isPending}
                            onClick={() =>
                                removing &&
                                remove.mutate(
                                    { method: "DELETE", path: `integrations/${removing.name}` },
                                    { onSuccess: () => setConfirming(false) },
                                )
                            }
                        >
                            <Trash2Icon />
                            {t("integrations.remove")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
