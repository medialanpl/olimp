import { ArrowLeftIcon, BanIcon, EyeIcon, WorkflowIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { SkillText } from "@/components/skill-text";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { useSkills, useWorkflows } from "@/lib/queries";
import { skillGroup } from "@/lib/skill-ref";
import type { Skill } from "@/lib/types";

// A group of skills in the command list: the heading, then a name and description per row.
function SkillsSkeleton() {
    return (
        <div className="p-1">
            <Skeleton className="mx-2 my-2 h-3 w-16" />
            {times(4).map((row) => (
                <div key={row} className="flex items-center gap-2 px-2 py-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 flex-1" />
                </div>
            ))}
        </div>
    );
}

function SkillPreview({
    skill,
    repo,
    onBack,
    onUse,
}: {
    skill: Skill;
    repo: string | null;
    onBack: () => void;
    onUse: () => void;
}) {
    const t = useTranslations("web");
    return (
        <div className="flex max-h-96 flex-col">
            <div className="flex items-center gap-2 border-b p-2">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onBack}
                    aria-label={t("prompt.back")}
                >
                    <ArrowLeftIcon />
                </Button>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>
                <Button size="sm" onClick={onUse}>
                    {t("prompt.useSkill")}
                </Button>
            </div>
            <div className="min-h-0 overflow-y-auto p-3 text-sm">
                <SkillText skill={skill} repo={repo} />
            </div>
        </div>
    );
}

// "/": no skill, the project's own skills, the global ones (both with a preview), and the
// project's workflows, which run with the prompt as their request.
export function SkillPicker({
    repo,
    skill,
    workflow,
    onSkill,
    onWorkflow,
}: {
    repo: string | null;
    skill: string | null;
    workflow: string | null;
    onSkill: (skill: Skill | null) => void;
    // Without it the picker offers skills only.
    onWorkflow?: (workflow: { id: string; name: string }) => void;
}) {
    const t = useTranslations("web");
    const skills = useSkills(repo ?? undefined);
    const workflows = useWorkflows();
    const [preview, setPreview] = useState<Skill | null>(null);
    if (preview)
        return (
            <SkillPreview
                skill={preview}
                repo={repo}
                onBack={() => setPreview(null)}
                onUse={() => onSkill(preview)}
            />
        );
    const inGroup = (group: ReturnType<typeof skillGroup>) =>
        skills.data?.filter((s) => skillGroup(s) === group) ?? [];
    const [project, team, own] = [inGroup("project"), inGroup("team"), inGroup("own")];
    const flows = workflows.data?.filter((w) => w.repo === repo) ?? [];
    const entry = (s: Skill) => (
        <CommandItem
            key={s.id}
            value={s.id}
            keywords={[s.name, s.description]}
            data-checked={s.id === skill}
            onSelect={() => onSkill(s)}
            className="py-1"
            title={s.description || undefined}
        >
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                <span className="text-sm font-medium text-foreground">{s.name}</span>
                {s.description && ` ${s.description}`}
            </p>
            <button
                type="button"
                aria-label={t("prompt.previewSkill", { skill: s.name })}
                title={t("prompt.previewSkill", { skill: s.name })}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    setPreview(s);
                }}
            >
                <EyeIcon className="size-3.5" />
            </button>
        </CommandItem>
    );
    return (
        <Command defaultValue={workflow ? `workflow:${workflow}` : (skill ?? "none")}>
            <CommandInput autoFocus placeholder={t("prompt.searchSkills")} />
            <CommandList className="max-h-96">
                <CommandEmpty>
                    {skills.isError ? t("common.error") : t("prompt.noSkills")}
                </CommandEmpty>
                <CommandGroup>
                    <CommandItem
                        value="none"
                        keywords={[t("prompt.noSkill")]}
                        data-checked={!skill && !workflow}
                        onSelect={() => onSkill(null)}
                    >
                        <BanIcon />
                        <span className="flex-1">{t("prompt.noSkill")}</span>
                    </CommandItem>
                </CommandGroup>
                {skills.isPending && (
                    <Loading>
                        <SkillsSkeleton />
                    </Loading>
                )}
                {project.length > 0 && (
                    <CommandGroup heading={t("skills.project")}>{project.map(entry)}</CommandGroup>
                )}
                {team.length > 0 && (
                    <CommandGroup heading={t("skills.team")}>{team.map(entry)}</CommandGroup>
                )}
                {own.length > 0 && (
                    <CommandGroup heading={t("skills.own")}>{own.map(entry)}</CommandGroup>
                )}
                {onWorkflow && flows.length > 0 && (
                    <CommandGroup heading={t("prompt.workflows")}>
                        {flows.map((w) => (
                            <CommandItem
                                key={w.id}
                                value={`workflow:${w.id}`}
                                keywords={[w.name]}
                                data-checked={w.id === workflow}
                                onSelect={() => onWorkflow({ id: w.id, name: w.name })}
                            >
                                <WorkflowIcon />
                                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                )}
            </CommandList>
        </Command>
    );
}
