import { PlusIcon, RotateCcwIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type PromptTemplate, usePromptTemplates, useSavePromptTemplates } from "@/lib/queries";

const BUILT_IN = ["addTests", "explain", "minimal", "docs", "edgeCases"] as const;

function Editor({ initial, builtIn }: { initial: PromptTemplate[]; builtIn: boolean }) {
    const t = useTranslations("web");
    const save = useSavePromptTemplates();
    const [templates, setTemplates] = useState(initial);
    const [saved, setSaved] = useState(false);
    const change = (index: number, patch: Partial<PromptTemplate>) => {
        setSaved(false);
        setTemplates((list) =>
            list.map((template, i) => (i === index ? { ...template, ...patch } : template)),
        );
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate(templates, { onSuccess: () => setSaved(true) });
    };
    return (
        <form onSubmit={submit} className="space-y-4">
            <ul className="space-y-3">
                {templates.map((template, index) => (
                    <li key={template.id} className="space-y-2 rounded-xl border p-3">
                        <div className="flex items-center gap-2">
                            <Input
                                value={template.label}
                                maxLength={80}
                                required
                                aria-label={t("settings.templateLabel")}
                                placeholder={t("settings.templateLabel")}
                                onChange={(event) => change(index, { label: event.target.value })}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("settings.templateRemove", { label: template.label })}
                                onClick={() => {
                                    setSaved(false);
                                    setTemplates((list) => list.filter((_, i) => i !== index));
                                }}
                            >
                                <Trash2Icon />
                            </Button>
                        </div>
                        <Textarea
                            value={template.text}
                            maxLength={4000}
                            required
                            rows={3}
                            aria-label={t("settings.templateText")}
                            placeholder={t("settings.templateText")}
                            onChange={(event) => change(index, { text: event.target.value })}
                        />
                    </li>
                ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    disabled={templates.length >= 50}
                    onClick={() => {
                        setSaved(false);
                        setTemplates((list) => [
                            ...list,
                            { id: `t${Date.now().toString(36)}`, label: "", text: "" },
                        ]);
                    }}
                >
                    <PlusIcon />
                    {t("settings.templateAdd")}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                    <SaveIcon />
                    {t("common.save")}
                </Button>
                {!builtIn && (
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={save.isPending}
                        onClick={() => save.mutate(null)}
                    >
                        <RotateCcwIcon />
                        {t("settings.templatesReset")}
                    </Button>
                )}
                {saved && (
                    <span className="text-sm text-muted-foreground">{t("settings.saved")}</span>
                )}
            </div>
            <FormError error={save.error} />
        </form>
    );
}

function TemplatesSkeleton() {
    const t = useTranslations("web");
    return (
        <Loading className="mx-auto grid max-w-3xl gap-6">
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.templates")}</CardTitle>
                    <Skeleton className="h-4 w-80 max-w-full" />
                </CardHeader>
                <CardContent className="space-y-4">
                    <ul className="space-y-3">
                        {times(3).map((item) => (
                            <li key={item} className="space-y-2 rounded-xl border p-3">
                                <div className="flex items-center gap-2">
                                    <Skeleton className="h-9 flex-1 rounded-3xl" />
                                    <Skeleton className="size-8 rounded-4xl" />
                                </div>
                                <Skeleton className="h-20 w-full" />
                            </li>
                        ))}
                    </ul>
                    <div className="flex gap-2">
                        <Skeleton className="h-9 w-32 rounded-4xl" />
                        <Skeleton className="h-9 w-24 rounded-4xl" />
                    </div>
                </CardContent>
            </Card>
        </Loading>
    );
}

// The composer's templates: the built-in ones until the first save, shown in a project's
// instructions too, with a `note` that they are shared.
export function Templates({ note }: { note?: string }) {
    const t = useTranslations("web");
    const saved = usePromptTemplates();
    if (saved.isPending) return <TemplatesSkeleton />;
    if (saved.isError) return <ErrorState error={saved.error} onRetry={() => saved.refetch()} />;
    const builtIn = saved.data === null;
    const initial =
        saved.data ??
        BUILT_IN.map((id) => ({
            id,
            label: t(`prompt.builtIn.${id}.label`),
            text: t(`prompt.builtIn.${id}.text`),
        }));
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.templates")}</CardTitle>
                    <CardDescription>
                        {builtIn ? t("settings.templatesBuiltIn") : t("settings.templatesHint")}
                        {note && <span className="mt-1 block">{note}</span>}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Editor
                        key={builtIn ? "built-in" : "saved"}
                        initial={initial}
                        builtIn={builtIn}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
