import { RotateCcwIcon, SaveIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { ErrorState, FormError, Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSaveSettings, useSettings } from "@/lib/queries";
import type { SettingName, SettingsView } from "@/lib/types";
import { cn } from "@/lib/utils";

const NUMBERS = { maxParallel: [1, 16], taskTimeoutMin: [1, 1440] } as const;

function SettingForm({ name, view }: { name: SettingName; view: SettingsView }) {
    const t = useTranslations("web");
    const save = useSaveSettings();
    const value = view.values[name];
    const [draft, setDraft] = useState(String(value));
    const range = name === "maxParallel" || name === "taskTimeoutMin" ? NUMBERS[name] : null;
    const saved = view.saved.includes(name);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate({ [name]: range ? Number(draft) : draft.trim() });
    };
    return (
        <form onSubmit={submit} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    id={`setting-${name}`}
                    aria-label={t(`settings.${name}`)}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    {...(range
                        ? { type: "number", min: range[0], max: range[1], className: "w-28" }
                        : { className: "min-w-0 flex-1 font-mono sm:max-w-md" })}
                />
                {name === "taskTimeoutMin" && (
                    <span className="text-sm text-muted-foreground">{t("settings.minutes")}</span>
                )}
                <Button
                    type="submit"
                    variant="outline"
                    disabled={save.isPending || draft.trim() === String(value)}
                >
                    <SaveIcon />
                    {t("common.save")}
                </Button>
                {saved && (
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={save.isPending}
                        onClick={() => save.mutate({ [name]: null })}
                    >
                        <RotateCcwIcon />
                        {t("settings.useDefault")}
                    </Button>
                )}
            </div>
            <FormError error={save.error} />
            <p className="text-xs text-muted-foreground">
                {saved
                    ? t("settings.savedOverride", { value: String(view.defaults[name]) })
                    : t("settings.fromEnvironment")}
            </p>
        </form>
    );
}

function SettingBody({ name }: { name: SettingName }) {
    const settings = useSettings();
    if (settings.data)
        // A saved value starts the form again from what the server kept.
        return (
            <SettingForm
                key={String(settings.data.values[name])}
                name={name}
                view={settings.data}
            />
        );
    if (settings.isError)
        return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />;
    return (
        <Loading className="space-y-2">
            <div className="flex items-center gap-2">
                <Skeleton
                    className={cn(
                        "h-9 rounded-3xl",
                        name in NUMBERS ? "w-28" : "flex-1 sm:max-w-md",
                    )}
                />
                <Skeleton className="h-9 w-24 rounded-4xl" />
            </div>
            <Skeleton className="h-3 w-48" />
        </Loading>
    );
}

// One setting saved in OLIMP's database: the value in force, Save, and back to the
// default from the environment.
export function SettingCard({ name }: { name: SettingName }) {
    const t = useTranslations("web");
    return (
        <Card>
            <CardHeader>
                <CardTitle>{t(`settings.${name}`)}</CardTitle>
                <CardDescription>{t(`settings.${name}Hint`)}</CardDescription>
            </CardHeader>
            <CardContent>
                <SettingBody name={name} />
            </CardContent>
        </Card>
    );
}

// The same setting as one of several in a card.
export function SettingSection({ name, icon }: { name: SettingName; icon: ReactNode }) {
    const t = useTranslations("web");
    return (
        <section className="flex gap-4 py-5 first:pt-2 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground [&_svg]:size-4">
                {icon}
            </span>
            <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-1">
                    <Label htmlFor={`setting-${name}`}>{t(`settings.${name}`)}</Label>
                    <p className="text-sm text-muted-foreground">{t(`settings.${name}Hint`)}</p>
                </div>
                <SettingBody name={name} />
            </div>
        </section>
    );
}
