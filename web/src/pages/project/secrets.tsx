import { KeyRoundIcon, PlugIcon, PlusIcon, SaveIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/lib/format";
import { useIntegrations, useRepoWrite, useSecrets } from "@/lib/queries";
import type { Repo } from "@/lib/types";
import { AdminOnly, ConfirmDelete, Section, useIsAdmin } from "@/pages/project/shared";

const NAME = /^[A-Za-z_]\w{0,63}$/;

function AddSecret({ repo, names, initial }: { repo: string; names: string[]; initial: string }) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo);
    const [name, setName] = useState(initial);
    const [value, setValue] = useState("");
    const replacing = names.includes(name);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        write.mutate(
            { method: "PUT", path: `secrets/${name}`, body: { value } },
            {
                onSuccess: () => {
                    setName("");
                    setValue("");
                },
            },
        );
    };
    return (
        <form onSubmit={submit} autoComplete="off" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr]">
                <div className="space-y-2">
                    <Label htmlFor="secret-name">{t("repo.secretName")}</Label>
                    <Input
                        id="secret-name"
                        value={name}
                        maxLength={64}
                        spellCheck={false}
                        placeholder="SENTRY_TOKEN"
                        className="font-mono"
                        aria-invalid={name !== "" && !NAME.test(name)}
                        onChange={(e) => setName(e.target.value.trim())}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="secret-value">{t("repo.secretValue")}</Label>
                    <Input
                        id="secret-value"
                        autoFocus={initial !== ""}
                        type="password"
                        value={value}
                        maxLength={4000}
                        autoComplete="new-password"
                        onChange={(e) => setValue(e.target.value)}
                    />
                </div>
            </div>
            <p className="text-sm text-muted-foreground">
                {replacing
                    ? t("repo.secretReplaces", { name })
                    : t("repo.secretUse", { reference: `\${${name || "NAME"}}` })}
            </p>
            <FormError error={write.error} />
            <Button type="submit" disabled={write.isPending || !NAME.test(name) || !value}>
                <SaveIcon />
                {replacing ? t("repo.replaceSecret") : t("repo.addSecret")}
            </Button>
        </form>
    );
}

function SecretsSkeleton() {
    return (
        <Loading>
            <ul className="divide-y rounded-lg border">
                {times(3).map((secret) => (
                    <li key={secret} className="flex items-center gap-x-3 px-3 py-2">
                        <Skeleton className="size-4" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-3 w-48 max-w-full" />
                        </div>
                        <Skeleton className="h-3 w-20" />
                        <Skeleton className="size-8 rounded-4xl" />
                    </li>
                ))}
            </ul>
        </Loading>
    );
}

// Values never come back: a secret is listed by name and replaced by saving again.
export function Secrets({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const format = useFormat();
    const admin = useIsAdmin();
    const secrets = useSecrets(repo.id, admin);
    const integrations = useIntegrations(repo.id);
    const remove = useRepoWrite(repo.id);
    const [prefill, setPrefill] = useState("");
    if (!admin) return <AdminOnly />;
    // Each reference nothing fills, with the integrations that need it.
    const missing = new Map<string, string[]>();
    for (const integration of integrations.data ?? [])
        for (const name of integration.missing)
            missing.set(name, [...(missing.get(name) ?? []), integration.name]);
    return (
        <>
            <Section
                title={t("repo.secretsTitle")}
                description={t("repo.secretsHint", { reference: `\${NAME}` })}
                action={
                    <Button asChild variant="outline" size="sm">
                        <Link to={`/project/${repo.id}/settings/integrations`}>
                            <PlugIcon />
                            {t("projectSettings.integrations")}
                        </Link>
                    </Button>
                }
            >
                {secrets.isPending ? (
                    <SecretsSkeleton />
                ) : secrets.isError ? (
                    <ErrorState error={secrets.error} onRetry={() => secrets.refetch()} />
                ) : !secrets.data.length ? (
                    <EmptyState
                        icon={<KeyRoundIcon />}
                        title={t("repo.noSecretsTitle")}
                        description={t("repo.noSecrets")}
                        className="p-6"
                    />
                ) : (
                    <ul className="divide-y rounded-lg border">
                        {secrets.data.map((secret) => (
                            <li
                                key={secret.name}
                                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                            >
                                <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
                                <div className="min-w-0 flex-1">
                                    <code className="block truncate font-mono text-sm">
                                        {secret.name}
                                    </code>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {secret.usedBy.length
                                            ? t("repo.usedBy", { names: secret.usedBy.join(", ") })
                                            : t("repo.unused")}
                                    </p>
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {t("repo.updated", { when: format.relative(secret.updatedAt) })}
                                </span>
                                <ConfirmDelete
                                    size="icon-sm"
                                    label={t("repo.deleteSecret", { name: secret.name })}
                                    question={t("repo.confirmDeleteSecret", { name: secret.name })}
                                    pending={remove.isPending}
                                    onConfirm={() =>
                                        remove.mutate({
                                            method: "DELETE",
                                            path: `secrets/${secret.name}`,
                                        })
                                    }
                                />
                            </li>
                        ))}
                    </ul>
                )}
                <FormError error={remove.error} />
            </Section>
            {missing.size > 0 && (
                <Section
                    title={t("repo.missingTitle")}
                    description={t("repo.missingHint")}
                    className="border-warning/40"
                >
                    <ul className="divide-y rounded-lg border">
                        {[...missing].map(([name, users]) => (
                            <li key={name} className="flex flex-wrap items-center gap-3 px-3 py-2">
                                <TriangleAlertIcon className="size-4 shrink-0 text-warning" />
                                <div className="min-w-0 flex-1">
                                    <code className="block truncate font-mono text-sm">{name}</code>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {t("repo.neededBy", { names: users.join(", ") })}
                                    </p>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPrefill(name)}
                                >
                                    <PlusIcon />
                                    {t("repo.setSecret")}
                                </Button>
                            </li>
                        ))}
                    </ul>
                </Section>
            )}
            <Section title={t("repo.addSecretTitle")} description={t("repo.addSecretHint")}>
                <AddSecret
                    key={prefill}
                    repo={repo.id}
                    initial={prefill}
                    names={secrets.data?.map((s) => s.name) ?? []}
                />
            </Section>
        </>
    );
}
