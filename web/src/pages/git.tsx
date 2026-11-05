import { type QueryKey, useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
    ChevronDownIcon,
    CircleDotIcon,
    FileDiffIcon,
    FolderIcon,
    FolderTreeIcon,
    GitBranchIcon,
    GitCommitHorizontalIcon,
    GitPullRequestDraftIcon,
    GitPullRequestIcon,
    PlusIcon,
    RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslations } from "use-intl";
import { ChangesBody, ChangesSkeleton } from "@/components/changes-view";
import { EmptyState } from "@/components/empty-state";
import { ExternalLink } from "@/components/external-link";
import { GithubItems } from "@/components/github-items";
import { InitGit } from "@/components/init-git";
import { JobTab, useJobTab } from "@/components/job-page";
import { ErrorState, FormError, Loading, PageHeader, UNDERLINE_TABS } from "@/components/page";
import { times } from "@/components/skeletons";
import { CommitsView, FilesView } from "@/components/task-repo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import {
    type GitSource,
    keys,
    useBranches,
    useCreateBranch,
    useFetchRepo,
    useGithubItems,
    useRepo,
    useRepoChanges,
    useSetBaseBranch,
} from "@/lib/queries";
import type { GithubItem, Repo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/pages/project/shared";

const LOCAL_TABS = ["changes", "commits", "branches", "files"] as const;
const ALL_TABS = [...LOCAL_TABS, "prs", "issues"] as const;

// Everything the page shows, to refresh at once: the folder, branches, history and GitHub.
const gitKeys = (repo: string): QueryKey[] => [
    keys.repoChanges(repo),
    keys.branches(repo),
    ["commits", `/api/repos/${repo}`],
    ["files", `/api/repos/${repo}`],
    ["github", repo],
];

export function GitPage() {
    const t = useTranslations("web");
    const { id = "" } = useParams();
    const repo = useRepo(id);
    const admin = useIsAdmin();
    const client = useQueryClient();
    const fetchRepo = useFetchRepo(id);
    const loading = useIsFetching({
        predicate: (query) =>
            gitKeys(id).some((key) => key.every((part, i) => query.queryKey[i] === part)),
    });
    const fetching = fetchRepo.isPending || loading > 0;
    const reload = () => {
        for (const queryKey of gitKeys(id)) void client.invalidateQueries({ queryKey });
    };
    return (
        <>
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        {t("nav.git")}
                        {repo.data && (
                            <Badge variant="outline" className="font-mono">
                                <GitBranchIcon />
                                {repo.data.defaultBranch}
                            </Badge>
                        )}
                    </span>
                }
                description={
                    repo.data?.github ? (
                        <ExternalLink href={`https://github.com/${repo.data.github}`}>
                            {repo.data.github}
                        </ExternalLink>
                    ) : (
                        id
                    )
                }
                actions={
                    repo.data?.git && (
                        <Button
                            variant="outline"
                            disabled={fetching}
                            onClick={() =>
                                repo.data?.github
                                    ? fetchRepo.mutate(undefined, { onSettled: reload })
                                    : reload()
                            }
                        >
                            <RefreshCwIcon className={cn(fetching && "animate-spin")} />
                            {t("git.refresh")}
                        </Button>
                    )
                }
            />
            <div className="mb-4 empty:hidden">
                <FormError error={fetchRepo.error} />
            </div>
            {repo.isPending ? (
                <Loading>
                    <GitSkeleton />
                </Loading>
            ) : repo.isError ? (
                <ErrorState error={repo.error} onRetry={() => repo.refetch()} />
            ) : !repo.data.git ? (
                <EmptyState
                    icon={<FolderIcon />}
                    title={t("git.noGitTitle")}
                    description={t("git.noGit")}
                >
                    {admin && repo.data.path && <InitGit repo={repo.data} size="default" />}
                </EmptyState>
            ) : (
                <GitTabs repo={repo.data} />
            )}
        </>
    );
}

// GitTabs on its first tab, the changes.
function GitSkeleton() {
    return (
        <div className="space-y-4">
            <div className="flex gap-5 border-b pb-2.5">
                {times(4).map((tab) => (
                    <Skeleton key={tab} className="h-5 w-20" />
                ))}
            </div>
            <ChangesSkeleton />
        </div>
    );
}

function GitTabs({ repo }: { repo: Repo }) {
    const t = useTranslations("web");
    const github = !!repo.github;
    const [tab, setTab] = useJobTab(github ? ALL_TABS : LOCAL_TABS);
    const [picked, setPicked] = useState<string | null>(null);
    const branch = picked ?? repo.defaultBranch;
    const source: GitSource = { path: `/api/repos/${repo.id}`, branch };
    const changes = useRepoChanges(repo.id);
    const prs = useGithubItems(repo.id, "prs", github);
    const issues = useGithubItems(repo.id, "issues", github);
    const browse = (name: string) => {
        setPicked(name);
        setTab("commits");
    };
    const picker = <BranchPicker repo={repo} value={branch} onChange={setPicked} />;
    return (
        <Tabs value={tab} onValueChange={setTab}>
            <div className="border-b">
                <TabsList className={cn(UNDERLINE_TABS, "scroll-fade-x")}>
                    <JobTab value="changes" count={changes.data?.files.length}>
                        <FileDiffIcon />
                        {t("git.changes")}
                    </JobTab>
                    <JobTab value="commits">
                        <GitCommitHorizontalIcon />
                        {t("git.commits")}
                    </JobTab>
                    <JobTab value="branches">
                        <GitBranchIcon />
                        {t("git.branches")}
                    </JobTab>
                    <JobTab value="files">
                        <FolderTreeIcon />
                        {t("git.files")}
                    </JobTab>
                    {github && (
                        <>
                            <span aria-hidden className="mb-1.5 h-4 w-px shrink-0 bg-border" />
                            <JobTab value="prs" count={prs.data?.length}>
                                <GitPullRequestIcon />
                                {t("github.prs")}
                            </JobTab>
                            <JobTab value="issues" count={issues.data?.length}>
                                <CircleDotIcon />
                                {t("github.issues")}
                            </JobTab>
                        </>
                    )}
                </TabsList>
            </div>
            <TabsContent value="changes">
                <ChangesBody changes={changes} working />
            </TabsContent>
            <TabsContent value="commits" className="space-y-3">
                {picker}
                <CommitsView key={branch} source={source} github={repo.github} />
            </TabsContent>
            <TabsContent value="branches">
                <BranchList
                    repo={repo}
                    checkedOut={changes.data?.branch ?? null}
                    prs={prs.data ?? []}
                    onBrowse={browse}
                />
            </TabsContent>
            <TabsContent value="files" className="space-y-3">
                {picker}
                <FilesView
                    key={branch}
                    source={source}
                    changed={branch === changes.data?.branch ? changes.data.files : undefined}
                />
            </TabsContent>
            {github && (
                <>
                    <TabsContent value="prs">
                        <GithubItems repo={repo} kind="prs" />
                    </TabsContent>
                    <TabsContent value="issues">
                        <GithubItems repo={repo} kind="issues" />
                    </TabsContent>
                </>
            )}
        </Tabs>
    );
}

function BranchPicker({
    repo,
    value,
    onChange,
}: {
    repo: Repo;
    value: string;
    onChange: (branch: string) => void;
}) {
    const t = useTranslations("web");
    const branches = useBranches(repo.id);
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" aria-label={t("git.branch")}>
                    <GitBranchIcon />
                    <span className="max-w-48 truncate font-mono">{value}</span>
                    <ChevronDownIcon className="text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-0">
                <Command defaultValue={value}>
                    <CommandInput placeholder={t("git.searchBranches")} />
                    <CommandList>
                        <CommandEmpty>{t("search.empty")}</CommandEmpty>
                        <CommandGroup>
                            {(branches.data?.branches ?? [value]).map((name) => (
                                <CommandItem
                                    key={name}
                                    value={name}
                                    data-checked={name === value}
                                    onSelect={() => {
                                        onChange(name);
                                        setOpen(false);
                                    }}
                                >
                                    <GitBranchIcon />
                                    <span className="min-w-0 flex-1 truncate font-mono">
                                        {name}
                                    </span>
                                    {name === repo.defaultBranch && (
                                        <span className="text-xs text-muted-foreground">
                                            {t("git.base")}
                                        </span>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function BranchesSkeleton() {
    return (
        <div className="divide-y rounded-xl border bg-card">
            {times(4).map((row) => (
                <div key={row} className="flex items-center gap-2 px-4 py-2.5">
                    <Skeleton className="size-4 shrink-0" />
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="ml-auto h-8 w-24 rounded-4xl" />
                </div>
            ))}
        </div>
    );
}

function BranchList({
    repo,
    checkedOut,
    prs,
    onBrowse,
}: {
    repo: Repo;
    checkedOut: string | null;
    prs: GithubItem[];
    onBrowse: (branch: string) => void;
}) {
    const t = useTranslations("web");
    const branches = useBranches(repo.id);
    const set = useSetBaseBranch();
    if (branches.isPending)
        return (
            <Loading>
                <BranchesSkeleton />
            </Loading>
        );
    if (branches.isError)
        return <ErrorState error={branches.error} onRetry={() => branches.refetch()} />;
    return (
        <div className="space-y-2">
            <FormError error={set.error} />
            <ul className="divide-y rounded-xl border bg-card">
                {branches.data.branches.map((name) => (
                    <li key={name} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                        <button
                            type="button"
                            onClick={() => onBrowse(name)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                        >
                            <GitBranchIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-mono text-sm">{name}</span>
                        </button>
                        {name === checkedOut && (
                            <Badge variant="secondary">{t("git.checkedOut")}</Badge>
                        )}
                        {prs
                            .filter((pr) => pr.branch === name)
                            .map((pr) => (
                                <Badge key={pr.number} variant="outline" asChild>
                                    <Link
                                        to={{ search: `?tab=prs&pr=${pr.number}` }}
                                        title={t("git.openPr", { number: pr.number })}
                                    >
                                        {pr.draft ? (
                                            <GitPullRequestDraftIcon />
                                        ) : (
                                            <GitPullRequestIcon />
                                        )}
                                        #{pr.number}
                                    </Link>
                                </Badge>
                            ))}
                        {name === repo.defaultBranch ? (
                            <Badge variant="outline">{t("git.base")}</Badge>
                        ) : (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={set.isPending}
                                onClick={() => set.mutate({ repo: repo.id, branch: name })}
                            >
                                {t("git.setBase")}
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
            <NewBranch repo={repo.id} />
            <p className="text-xs text-muted-foreground">{t("git.branchesHint")}</p>
        </div>
    );
}

function NewBranch({ repo }: { repo: string }) {
    const t = useTranslations("web");
    const create = useCreateBranch(repo);
    const [name, setName] = useState("");
    return (
        <>
            <form
                className="flex w-full gap-2 sm:max-w-md"
                onSubmit={(event) => {
                    event.preventDefault();
                    create.mutate(name.trim(), { onSuccess: () => setName("") });
                }}
            >
                <Input
                    value={name}
                    placeholder={t("git.newBranch")}
                    aria-label={t("git.newBranch")}
                    className="font-mono"
                    onChange={(event) => setName(event.target.value)}
                />
                <Button type="submit" variant="outline" disabled={!name.trim() || create.isPending}>
                    {create.isPending ? <Spinner /> : <PlusIcon />}
                    {t("git.createBranch")}
                </Button>
            </form>
            <FormError error={create.error} />
        </>
    );
}
