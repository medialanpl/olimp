import { useTranslations } from "use-intl";
import { Markdown } from "@/components/markdown";
import { Loading } from "@/components/page";
import { SkeletonText } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkillText } from "@/lib/queries";
import { PROJECT } from "@/lib/skill-ref";
import type { Skill } from "@/lib/types";

const withoutFrontmatter = (text: string) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");

// A skill's SKILL.md without its frontmatter; a project's own skill is read from its checkout.
export function SkillText({ skill, repo }: { skill: Skill; repo: string | null }) {
    const t = useTranslations("web");
    const text = useSkillText(skill.id, skill.source === PROJECT ? repo : null);
    if (text.isPending)
        return (
            <Loading className="space-y-4">
                <Skeleton className="h-6 w-40" />
                <SkeletonText lines={5} />
            </Loading>
        );
    if (text.isError) return <p className="text-muted-foreground">{t("common.error")}</p>;
    return <Markdown>{withoutFrontmatter(text.data.content)}</Markdown>;
}
