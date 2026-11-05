import { ArrowUpRightIcon, SaveIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { FormError, Loading } from "@/components/page";
import { SkeletonText } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useInstructions, useRepoWrite } from "@/lib/queries";
import type { Repo } from "@/lib/types";
import { Section } from "@/pages/project/shared";
import { Templates } from "@/pages/settings/templates";

function Editor({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo.id);
    const [text, setText] = useState(repo.settings.instructions);
    const changed = text.trim() !== repo.settings.instructions;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        write.mutate({ method: "PATCH", path: "settings", body: { instructions: text } });
    };
    return (
        <form onSubmit={submit} className="space-y-3">
            <Textarea
                value={text}
                rows={10}
                aria-label={t("repo.promptTitle")}
                placeholder={t("repo.promptPlaceholder")}
                onChange={(event) => setText(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={write.isPending || !changed}>
                    <SaveIcon />
                    {t("common.save")}
                </Button>
                <span className="text-sm text-muted-foreground">
                    {write.isSuccess && !changed ? t("repo.saved") : t("repo.promptSaveHint")}
                </span>
            </div>
            <FormError error={write.error} />
        </form>
    );
}

// The global prompt comes first: the project's is read after it and wins where they conflict.
function Global() {
    const t = useTranslations("web");
    const global = useInstructions();
    return (
        <Section
            title={t("repo.globalPromptTitle")}
            description={t("repo.globalPromptHint")}
            action={
                <Button asChild variant="outline" size="sm">
                    <Link to="/settings/general/instructions">
                        {t("repo.editGlobal")}
                        <ArrowUpRightIcon />
                    </Link>
                </Button>
            }
        >
            {global.isPending ? (
                <Loading className="rounded-lg border bg-muted/40 p-3">
                    <SkeletonText />
                </Loading>
            ) : global.data?.instructions ? (
                <pre className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-3 font-sans text-sm whitespace-pre-wrap text-muted-foreground scroll-fade">
                    {global.data.instructions}
                </pre>
            ) : (
                <p className="text-sm text-muted-foreground">{t("repo.noGlobalPrompt")}</p>
            )}
        </Section>
    );
}

export function Instructions({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    return (
        <>
            <Section title={t("repo.promptTitle")} description={t("repo.promptHint")}>
                <Editor repo={repo} />
            </Section>
            <Global />
            <Templates note={t("repo.templatesShared")} />
        </>
    );
}
