import { SaveIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { ErrorState, FormError, Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/lib/auth";
import { useInstructions, useSaveInstructions } from "@/lib/queries";

function Editor({ initial }: { initial: string }) {
    const t = useTranslations("web");
    const save = useSaveInstructions();
    const me = useMe();
    const readOnly = me !== null && me.role !== "admin";
    const [text, setText] = useState(initial);
    const [saved, setSaved] = useState(false);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate(text, { onSuccess: () => setSaved(true) });
    };
    return (
        <form onSubmit={submit} className="space-y-3">
            <Textarea
                value={text}
                rows={10}
                readOnly={readOnly}
                aria-label={t("settings.instructionsPrompt")}
                placeholder={t("settings.instructionsPlaceholder")}
                onChange={(event) => {
                    setSaved(false);
                    setText(event.target.value);
                }}
            />
            <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={readOnly || save.isPending}>
                    <SaveIcon />
                    {t("common.save")}
                </Button>
                <span className="text-sm text-muted-foreground">
                    {saved
                        ? t("settings.saved")
                        : readOnly
                          ? t("settings.instructionsAdminOnly")
                          : t("settings.instructionsSaveHint")}
                </span>
            </div>
            <FormError error={save.error} />
        </form>
    );
}

export function Instructions() {
    const t = useTranslations("web");
    const instructions = useInstructions();
    if (instructions.isError)
        return <ErrorState error={instructions.error} onRetry={() => instructions.refetch()} />;
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.instructionsPrompt")}</CardTitle>
                    <CardDescription>{t("settings.instructionsPromptHint")}</CardDescription>
                </CardHeader>
                <CardContent>
                    {instructions.isPending ? (
                        <Loading className="space-y-3">
                            <Skeleton className="h-56 w-full" />
                            <Skeleton className="h-9 w-24 rounded-4xl" />
                        </Loading>
                    ) : (
                        <Editor initial={instructions.data.instructions} />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
