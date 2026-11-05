import {
    ArrowDownIcon,
    ArrowUpIcon,
    FolderTreeIcon,
    PlusIcon,
    RecycleIcon,
    SaveIcon,
    TerminalIcon,
    Trash2Icon,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { CodeEditor } from "@/components/code-editor";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/lib/format";
import { useRepoWrite, useWorktrees } from "@/lib/queries";
import type { Repo, WorktreeScripts, WorktreeView } from "@/lib/types";
import { ConfirmDelete, Section, useIsAdmin } from "@/pages/project/shared";

const KEEP_MAX = 50;

function Keep({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo.id);
    const [draft, setDraft] = useState(String(repo.settings.keepWorktrees));
    const value = Number(draft);
    const valid = draft.trim() !== "" && Number.isInteger(value) && value >= 0 && value <= KEEP_MAX;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        write.mutate({ method: "PATCH", path: "settings", body: { keepWorktrees: value } });
    };
    return (
        <form onSubmit={submit} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    type="number"
                    min={0}
                    max={KEEP_MAX}
                    value={draft}
                    aria-label={t("repo.keepTitle")}
                    aria-invalid={!valid}
                    className="w-28"
                    onChange={(e) => setDraft(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">{t("repo.worktreesUnit")}</span>
                <Button
                    type="submit"
                    variant="outline"
                    disabled={!valid || write.isPending || value === repo.settings.keepWorktrees}
                >
                    <SaveIcon />
                    {t("common.save")}
                </Button>
            </div>
            <p className="text-xs text-muted-foreground">
                {!valid
                    ? t("repo.keepInvalid", { max: KEEP_MAX })
                    : value === 0
                      ? t("repo.keepNone")
                      : t("repo.keepSome", { count: value })}
            </p>
            <FormError error={write.error} />
        </form>
    );
}

const PHASES = ["afterCreate", "beforeRemove"] as const;
type Phase = (typeof PHASES)[number];
const VARIABLES = [
    "OLIMP_PROJECT_PATH",
    "OLIMP_WORKTREE_PATH",
    "OLIMP_JOB_ID",
    "OLIMP_BRANCH",
] as const;
const EXAMPLE: Record<Phase, string> = {
    afterCreate: "pnpm install --frozen-lockfile\ncp .env.example .env",
    beforeRemove: 'docker compose --project-name "$OLIMP_JOB_ID" down --volumes',
};
const TIMEOUT_MAX_MIN = 1440;

interface Draft {
    key: string;
    name: string;
    command: string;
    // Minutes as typed; "" is the default.
    timeout: string;
}

const draftsOf = (scripts: WorktreeScripts) =>
    Object.fromEntries(
        PHASES.map((phase) => [
            phase,
            scripts[phase].map((s) => ({
                key: crypto.randomUUID(),
                name: s.name,
                command: s.command,
                timeout: s.timeoutSeconds ? String(s.timeoutSeconds / 60) : "",
            })),
        ]),
    ) as Record<Phase, Draft[]>;

const scriptsOf = (drafts: Record<Phase, Draft[]>): WorktreeScripts =>
    Object.fromEntries(
        PHASES.map((phase) => [
            phase,
            drafts[phase].map((d) => ({
                name: d.name.trim(),
                command: d.command,
                timeoutSeconds: d.timeout.trim() ? Math.round(Number(d.timeout) * 60) : null,
            })),
        ]),
    ) as WorktreeScripts;

const timeoutValid = (text: string) => {
    const minutes = Number(text);
    return !text.trim() || (minutes * 60 >= 1 && minutes <= TIMEOUT_MAX_MIN);
};

function ScriptCard({
    phase,
    index,
    count,
    draft,
    disabled,
    onChange,
    onMove,
    onRemove,
}: {
    phase: Phase;
    index: number;
    count: number;
    draft: Draft;
    disabled: boolean;
    onChange: (change: Partial<Draft>) => void;
    onMove: (by: number) => void;
    onRemove: () => void;
}) {
    const t = useTranslations("web");
    const field = useRef<HTMLTextAreaElement>(null);
    const id = `${phase}-${draft.key}`;
    // At the cursor, quoted, as a Bash variable is safely used.
    const insert = (name: string) => {
        const el = field.current;
        const from = el?.selectionStart ?? draft.command.length;
        const to = el?.selectionEnd ?? from;
        const token = `"$${name}"`;
        onChange({ command: draft.command.slice(0, from) + token + draft.command.slice(to) });
        requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(from + token.length, from + token.length);
        });
    };
    return (
        <fieldset className="space-y-3 rounded-xl border bg-muted/20 px-4 pt-2 pb-4">
            <legend className="px-1 text-sm font-medium">
                {t("repo.scripts.number", { number: index + 1 })}
                {draft.name.trim() && (
                    <span className="font-normal text-muted-foreground">
                        {" "}
                        · {draft.name.trim()}
                    </span>
                )}
            </legend>
            <div className="space-y-1.5">
                <Label htmlFor={`${id}-name`}>{t("repo.scripts.name")}</Label>
                <Input
                    id={`${id}-name`}
                    value={draft.name}
                    maxLength={120}
                    disabled={disabled}
                    placeholder={t(`repo.scripts.${phase}.namePlaceholder`)}
                    onChange={(e) => onChange({ name: e.target.value })}
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor={`${id}-command`}>{t("repo.scripts.command")}</Label>
                <CodeEditor
                    ref={field}
                    id={`${id}-command`}
                    path="script.sh"
                    value={draft.command}
                    disabled={disabled}
                    aria-invalid={draft.command !== "" && !draft.command.trim()}
                    placeholder={EXAMPLE[phase]}
                    className="min-h-24"
                    onChange={(command) => onChange({ command })}
                />
            </div>
            <details className="group rounded-lg border bg-background/40 px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium select-none">
                    {t("repo.scripts.variables")}
                </summary>
                <ul className="mt-2 space-y-2">
                    {VARIABLES.map((name) => (
                        <li key={name} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <code className="font-mono text-xs">${name}</code>
                            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                                {t(`repo.scripts.vars.${name}`)}
                            </span>
                            <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                disabled={disabled}
                                // The field keeps its focus and cursor, so typing goes on there.
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => insert(name)}
                            >
                                {t("repo.scripts.insert")}
                            </Button>
                        </li>
                    ))}
                </ul>
            </details>
            <details
                className="rounded-lg border bg-background/40 px-3 py-2 text-sm"
                open={draft.timeout !== "" || undefined}
            >
                <summary className="cursor-pointer font-medium select-none">
                    {t("repo.scripts.timeout")}
                </summary>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                        type="number"
                        min={1}
                        max={TIMEOUT_MAX_MIN}
                        value={draft.timeout}
                        placeholder="30"
                        disabled={disabled}
                        aria-label={t("repo.scripts.timeout")}
                        aria-invalid={!timeoutValid(draft.timeout)}
                        className="w-24"
                        onChange={(e) => onChange({ timeout: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">
                        {t("repo.scripts.timeoutHint", { max: TIMEOUT_MAX_MIN })}
                    </span>
                </div>
            </details>
            {!disabled && (
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index === 0}
                        onClick={() => onMove(-1)}
                    >
                        <ArrowUpIcon />
                        {t("repo.scripts.up")}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={index === count - 1}
                        onClick={() => onMove(1)}
                    >
                        <ArrowDownIcon />
                        {t("repo.scripts.down")}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={onRemove}
                    >
                        <Trash2Icon />
                        {t("repo.scripts.remove")}
                    </Button>
                </div>
            )}
        </fieldset>
    );
}

// Bash around each job's worktree: preparing it before the agent and cleaning up before it goes.
function Scripts({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const admin = useIsAdmin();
    const write = useRepoWrite(repo.id);
    const saved = repo.settings.worktreeScripts;
    const [drafts, setDrafts] = useState(() => draftsOf(saved));
    const scripts = scriptsOf(drafts);
    const changed = JSON.stringify(scripts) !== JSON.stringify(scriptsOf(draftsOf(saved)));
    const valid = PHASES.every((phase) =>
        drafts[phase].every((d) => d.command.trim() && timeoutValid(d.timeout)),
    );
    const update = (phase: Phase, list: Draft[]) => setDrafts((d) => ({ ...d, [phase]: list }));
    const submit = (event: FormEvent) => {
        event.preventDefault();
        write.mutate({ method: "PATCH", path: "settings", body: { worktreeScripts: scripts } });
    };
    return (
        <form onSubmit={submit} className="space-y-6">
            <Alert variant="info" role="note">
                <TerminalIcon />
                <AlertDescription className="space-y-1.5">
                    <p>{t("repo.scripts.consent")}</p>
                    <p>{t("repo.scripts.runtime")}</p>
                    <p>{t("repo.scripts.environment")}</p>
                </AlertDescription>
            </Alert>
            {PHASES.map((phase) => {
                const list = drafts[phase];
                return (
                    <section key={phase} className="space-y-3">
                        <div className="space-y-1">
                            <h3 className="font-medium">{t(`repo.scripts.${phase}.title`)}</h3>
                            <p className="text-sm text-muted-foreground">
                                {t(`repo.scripts.${phase}.hint`)}
                            </p>
                        </div>
                        {list.length ? (
                            list.map((draft, index) => (
                                <ScriptCard
                                    key={draft.key}
                                    phase={phase}
                                    index={index}
                                    count={list.length}
                                    draft={draft}
                                    disabled={!admin}
                                    onChange={(change) =>
                                        update(
                                            phase,
                                            list.map((d) =>
                                                d.key === draft.key ? { ...d, ...change } : d,
                                            ),
                                        )
                                    }
                                    onMove={(by) => {
                                        const next = [...list];
                                        next.splice(index, 1);
                                        next.splice(index + by, 0, draft);
                                        update(phase, next);
                                    }}
                                    onRemove={() =>
                                        update(
                                            phase,
                                            list.filter((d) => d.key !== draft.key),
                                        )
                                    }
                                />
                            ))
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                {t("repo.scripts.none")}
                            </p>
                        )}
                        {admin && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    update(phase, [
                                        ...list,
                                        {
                                            key: crypto.randomUUID(),
                                            name: "",
                                            command: "",
                                            timeout: "",
                                        },
                                    ])
                                }
                            >
                                <PlusIcon />
                                {t(`repo.scripts.${phase}.add`)}
                            </Button>
                        )}
                    </section>
                );
            })}
            {admin ? (
                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                    <Button type="submit" disabled={!changed || !valid || write.isPending}>
                        <SaveIcon />
                        {t("common.save")}
                    </Button>
                    {changed && (
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                                setDrafts(draftsOf(saved));
                                write.reset();
                            }}
                        >
                            {t("repo.scripts.discard")}
                        </Button>
                    )}
                    <span className="text-sm text-muted-foreground">
                        {!valid
                            ? t("repo.scripts.invalid", { max: TIMEOUT_MAX_MIN })
                            : changed
                              ? t("repo.scripts.unsaved")
                              : write.isSuccess
                                ? t("repo.saved")
                                : ""}
                    </span>
                </div>
            ) : (
                <p className="text-sm text-muted-foreground">{t("repo.scripts.adminOnly")}</p>
            )}
            <FormError error={write.error} />
        </form>
    );
}

function Tree({ repo, tree }: { repo: string; tree: WorktreeView }) {
    const t = useTranslations("web");
    const format = useFormat();
    const admin = useIsAdmin();
    const remove = useRepoWrite(repo);
    const job = tree.job;
    return (
        <li className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                    {job ? (
                        <Link
                            to={`/tasks/${tree.id}`}
                            className="block truncate font-medium hover:underline"
                        >
                            {job.title}
                        </Link>
                    ) : (
                        <span className="font-mono text-sm">{tree.id}</span>
                    )}
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        {tree.branch && <span className="font-mono">{tree.branch}</span>}
                        {tree.modifiedAt && (
                            <span>
                                {t("repo.changedAt", { when: format.relative(tree.modifiedAt) })}
                            </span>
                        )}
                        {tree.bytes !== null && <span>{format.bytes(tree.bytes)}</span>}
                    </p>
                </div>
                {tree.active ? (
                    <Badge variant="progress">{t("repo.inUse")}</Badge>
                ) : job ? (
                    <StatusBadge status={job.status} />
                ) : (
                    <Badge variant="secondary">{t("repo.orphan")}</Badge>
                )}
                {!tree.modifiedAt && <Badge variant="destructive">{t("repo.folderGone")}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-0.5 pl-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs" title={tree.path}>
                        {tree.path}
                    </code>
                    <CopyButton value={tree.path} label={t("repo.copyFolder")} />
                </div>
                {admin && !tree.active && (
                    <ConfirmDelete
                        label={t("repo.removeWorktree")}
                        question={t("repo.confirmRemoveWorktree")}
                        pending={remove.isPending}
                        onConfirm={() =>
                            remove.mutate({ method: "DELETE", path: `worktrees/${tree.id}` })
                        }
                    />
                )}
            </div>
            <FormError error={remove.error} />
        </li>
    );
}

function OnDiskSkeleton() {
    return (
        <Loading className="space-y-3">
            <ul className="divide-y rounded-lg border">
                {times(2).map((tree) => (
                    <li key={tree} className="space-y-2 p-3">
                        <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <Skeleton className="h-4 w-56 max-w-full" />
                                <Skeleton className="h-3 w-40" />
                            </div>
                            <Skeleton className="h-5 w-16" />
                        </div>
                        <Skeleton className="h-8 w-full rounded-md" />
                    </li>
                ))}
            </ul>
            <Skeleton className="h-4 w-64 max-w-full" />
        </Loading>
    );
}

function OnDisk({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const format = useFormat();
    const trees = useWorktrees(repo.id);
    const admin = useIsAdmin();
    const reclaim = useRepoWrite(repo.id);
    if (trees.isPending) return <OnDiskSkeleton />;
    if (trees.isError) return <ErrorState error={trees.error} onRetry={() => trees.refetch()} />;
    if (!trees.data.length)
        return (
            <EmptyState
                icon={<FolderTreeIcon />}
                title={t("repo.noWorktreesTitle")}
                description={t("repo.noWorktrees")}
                className="p-6"
            />
        );
    const total = trees.data.reduce((sum, tree) => sum + (tree.bytes ?? 0), 0);
    const keep = repo.settings.keepWorktrees;
    return (
        <div className="space-y-3">
            <ul className="divide-y rounded-lg border">
                {trees.data.map((tree) => (
                    <Tree key={tree.path} repo={repo.id} tree={tree} />
                ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {t("repo.onDiskSummary", {
                        count: trees.data.length,
                        size: format.bytes(total),
                    })}
                    {" · "}
                    {keep ? t("repo.keepingSome", { count: keep }) : t("repo.keepingNone")}
                </p>
                {admin && (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={reclaim.isPending || trees.data.every((tree) => tree.active)}
                        onClick={() =>
                            reclaim.mutate({ method: "POST", path: "worktrees/reclaim" })
                        }
                    >
                        <RecycleIcon />
                        {t("repo.reclaimNow")}
                    </Button>
                )}
            </div>
            {reclaim.isSuccess && (
                <p className="text-sm text-muted-foreground">
                    {t("repo.reclaimed", { count: (reclaim.data as unknown[]).length })}
                </p>
            )}
            <FormError error={reclaim.error} />
        </div>
    );
}

// How many finished worktrees stay, and the ones on disk now.
export function Worktrees({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    if (!repo.git)
        return (
            <EmptyState
                icon={<FolderTreeIcon />}
                title={t("repo.noGitWorktreesTitle")}
                description={t("repo.inPlaceOnly")}
            />
        );
    return (
        <>
            <Section title={t("repo.scripts.title")} description={t("repo.scripts.hint")}>
                <Scripts repo={repo} />
            </Section>
            <Section title={t("repo.keepTitle")} description={t("repo.keepHint")}>
                <Keep repo={repo} />
            </Section>
            <Section title={t("repo.onDiskTitle")} description={t("repo.onDiskHint")}>
                <OnDisk repo={repo} />
            </Section>
        </>
    );
}
