import {
    ArrowLeftIcon,
    ChevronRightIcon,
    CircleDotIcon,
    CloudIcon,
    CodeIcon,
    EyeIcon,
    FileDiffIcon,
    FileIcon,
    FolderIcon,
    GitBranchIcon,
    GitCommitHorizontalIcon,
    SearchIcon,
    TagIcon,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { CopyButton } from "@/components/copy-button";
import { Delta, DiffSkeleton, DiffView, FileSkeleton } from "@/components/diff";
import { EmptyState } from "@/components/empty-state";
import { ExternalLink } from "@/components/external-link";
import { Markdown } from "@/components/markdown";
import { ErrorState, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { commitGraph, type GraphEdge, type GraphRow } from "@/lib/commit-graph";
import { useFormat } from "@/lib/format";
import { useHighlight } from "@/lib/highlight";
import { type GitSource, useCommit, useCommits, useFile, useFiles } from "@/lib/queries";
import type { ChangedFile, Commit } from "@/lib/types";
import { cn } from "@/lib/utils";

function NotPushed() {
    const t = useTranslations("web");
    return (
        <EmptyState
            icon={<GitBranchIcon />}
            title={t("changes.notPushedTitle")}
            description={t("changes.notPushed")}
        />
    );
}

const ROW = 28;
const LANE = 12;
const BEND = 5;
const LANE_COLORS = ["#0ea5e9", "#f59e0b", "#a855f7", "#10b981", "#ef4444", "#ec4899", "#6366f1"];
const laneColor = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length] as string;
const laneX = (lane: number) => lane * LANE + LANE / 2;

// Only a GitHub project's authors are looked up there, so a local project's emails stay local.
function AuthorAvatar({ commit, github }: { commit: Commit; github: string | null }) {
    return (
        <Avatar className="size-5">
            {github && commit.email && (
                <AvatarImage
                    src={`https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(commit.email)}&s=40`}
                    alt=""
                />
            )}
            <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground uppercase">
                {commit.author.slice(0, 1)}
            </AvatarFallback>
        </Avatar>
    );
}

// Branches as GitLens pills: a local branch and its origin twin share one pill with a cloud, the
// checked-out one is marked, tags come after.
function RefPills({ refs, color }: { refs: string[]; color: string }) {
    const head = refs[refs.indexOf("HEAD") + 1];
    const branches = refs.filter((ref) => ref !== "HEAD" && ref !== "origin/HEAD");
    const tags = branches.filter((ref) => ref.startsWith("tag: ")).map((ref) => ref.slice(5));
    const names = branches.filter((ref) => !ref.startsWith("tag: "));
    const local = names.filter((ref) => !ref.startsWith("origin/"));
    const pills = [
        ...local.map((name) => ({ name, remote: names.includes(`origin/${name}`) })),
        ...names
            .filter((ref) => ref.startsWith("origin/") && !local.includes(ref.slice(7)))
            .map((name) => ({ name, remote: true })),
    ];
    if (!pills.length && !tags.length) return null;
    return (
        <span className="flex shrink-0 items-center gap-1">
            {pills.map(({ name, remote }) => (
                <span
                    key={name}
                    className="inline-flex h-5 max-w-40 items-center gap-1 rounded-full border px-2 font-mono text-xs"
                    style={{
                        borderColor: color,
                        color,
                        background: `color-mix(in oklch, ${color} 14%, transparent)`,
                    }}
                >
                    {name === head && <CircleDotIcon className="size-3 shrink-0" />}
                    <span className="truncate">{name}</span>
                    {remote && <CloudIcon className="size-3 shrink-0" />}
                </span>
            ))}
            {tags.map((tag) => (
                <Badge key={tag} variant="outline" className="h-5 max-w-32 font-mono">
                    <TagIcon />
                    <span className="truncate">{tag}</span>
                </Badge>
            ))}
        </span>
    );
}

function CommitDetail({
    source,
    sha,
    github,
    listed,
    onOpen,
    onBack,
}: {
    source: GitSource;
    sha: string;
    github: string | null;
    listed: Set<string>;
    onOpen: (sha: string) => void;
    onBack: () => void;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const commit = useCommit(source, sha);
    const back = (
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
            <ArrowLeftIcon />
            {t("task.commits.back")}
        </Button>
    );
    if (commit.isPending)
        return (
            <div className="space-y-4">
                {back}
                <Loading>
                    <CommitSkeleton />
                </Loading>
            </div>
        );
    if (commit.isError)
        return (
            <div className="space-y-3">
                {back}
                <ErrorState error={commit.error} onRetry={() => commit.refetch()} />
            </div>
        );
    const data = commit.data;
    const sum = (key: "added" | "deleted") =>
        data.files.reduce((total, file) => total + (file[key] ?? 0), 0);
    return (
        <div className="space-y-4">
            {back}
            <section className="overflow-hidden rounded-xl border bg-card">
                <header className="space-y-2 border-b bg-muted/40 px-4 py-3">
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                        <h2 className="min-w-0 flex-1 font-medium text-balance">{data.title}</h2>
                        <RefPills refs={data.refs} color={laneColor(0)} />
                        {github && (
                            <ExternalLink
                                href={`https://github.com/${github}/commit/${data.sha}`}
                                className="text-sm"
                            >
                                {t("task.commits.github")}
                            </ExternalLink>
                        )}
                    </div>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5 text-foreground">
                            <AuthorAvatar commit={data} github={github} />
                            {data.author}
                        </span>
                        ·
                        <span title={format.dateTime(data.date)}>{format.relative(data.date)}</span>
                        ·
                        <span className="inline-flex items-center gap-1 font-mono">
                            {data.sha.slice(0, 8)}
                            <CopyButton value={data.sha} label={t("task.commits.copySha")} />
                        </span>
                        ·<Delta added={sum("added")} deleted={sum("deleted")} />
                        {data.parents.length > 0 && (
                            <>
                                ·<span>{t("task.commits.parents")}</span>
                                {data.parents.map((parent) =>
                                    listed.has(parent) ? (
                                        <button
                                            key={parent}
                                            type="button"
                                            onClick={() => onOpen(parent)}
                                            className="font-mono text-foreground underline underline-offset-2"
                                        >
                                            {parent.slice(0, 8)}
                                        </button>
                                    ) : (
                                        <span key={parent} className="font-mono">
                                            {parent.slice(0, 8)}
                                        </span>
                                    ),
                                )}
                            </>
                        )}
                    </p>
                </header>
                {data.body && <Markdown className="px-4 py-3">{data.body}</Markdown>}
            </section>
            <DiffView diff={data.diff} files={data.files} />
        </div>
    );
}

function CommitSkeleton() {
    return (
        <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border bg-card">
                <div className="space-y-2 border-b bg-muted/40 px-4 py-3">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                </div>
            </div>
            <DiffSkeleton />
        </div>
    );
}

function CommitsSkeleton() {
    return (
        <div className="overflow-hidden rounded-xl border bg-card py-1">
            {times(8).map((row) => (
                <div key={row} className="flex h-7 items-center gap-3 pr-4 pl-2">
                    <Skeleton className="ml-1 size-2.5 shrink-0 rounded-full" />
                    <Skeleton className="h-3.5 max-w-sm flex-1" />
                    <Skeleton className="ml-auto h-3 w-16" />
                </div>
            ))}
        </div>
    );
}

// An edge into the commit runs down its lane and turns along the row into the dot; one out of it
// runs along the row and turns down into its lane, as VS Code's graph rounds them.
function edgePath(edge: GraphEdge, half: "top" | "bottom") {
    const mid = ROW / 2;
    const [from, to] = [laneX(edge.from), laneX(edge.to)];
    if (from === to) return half === "top" ? `M${from} 0V${mid}` : `M${from} ${mid}V${ROW}`;
    const toward = Math.sign(to - from);
    return half === "top"
        ? `M${from} 0V${mid - BEND}Q${from} ${mid} ${from + toward * BEND} ${mid}H${to}`
        : `M${from} ${mid}H${to - toward * BEND}Q${to} ${mid} ${to} ${mid + BEND}V${ROW}`;
}

function GraphCell({ row, lanes, commit }: { row: GraphRow; lanes: number; commit: Commit }) {
    const mid = ROW / 2;
    const color = laneColor(row.lane);
    const line = (edge: GraphEdge, d: string, key: string) => (
        <path key={key} d={d} stroke={laneColor(edge.lane)} strokeWidth={2} fill="none" />
    );
    return (
        <svg width={lanes * LANE} height={ROW} className="block shrink-0" aria-hidden="true">
            {row.top.map((edge) =>
                // A lane passing by spans the whole row.
                edge.from === edge.to && edge.to !== row.lane
                    ? line(edge, `M${laneX(edge.from)} 0V${ROW}`, `t${edge.from}`)
                    : line(edge, edgePath(edge, "top"), `t${edge.from}`),
            )}
            {row.bottom
                .filter((edge) => edge.from === row.lane)
                .map((edge) => line(edge, edgePath(edge, "bottom"), `b${edge.to}`))}
            {commit.refs.includes("HEAD") ? (
                <circle
                    cx={laneX(row.lane)}
                    cy={mid}
                    r={4.5}
                    fill="var(--card)"
                    stroke={color}
                    strokeWidth={2}
                />
            ) : commit.parents.length > 1 ? (
                <>
                    <circle
                        cx={laneX(row.lane)}
                        cy={mid}
                        r={4.5}
                        fill="var(--card)"
                        stroke={color}
                        strokeWidth={2}
                    />
                    <circle cx={laneX(row.lane)} cy={mid} r={1.75} fill={color} />
                </>
            ) : (
                <circle cx={laneX(row.lane)} cy={mid} r={4} fill={color} />
            )}
        </svg>
    );
}

// The commits a task's branch adds, or a project branch's history, newest first and drawn as a
// graph like GitLens; one opens with its message and diff.
export function CommitsView({ source, github }: { source: GitSource; github: string | null }) {
    const t = useTranslations("web");
    const format = useFormat();
    const commits = useCommits(source);
    const [open, setOpen] = useState<string | null>(null);
    const graph = useMemo(() => commitGraph(commits.data?.commits ?? []), [commits.data]);
    const listed = useMemo(
        () => new Set(commits.data?.commits.map((commit) => commit.sha)),
        [commits.data],
    );
    if (open)
        return (
            <CommitDetail
                key={open}
                source={source}
                sha={open}
                github={github}
                listed={listed}
                onOpen={setOpen}
                onBack={() => setOpen(null)}
            />
        );
    if (commits.isPending)
        return (
            <Loading>
                <CommitsSkeleton />
            </Loading>
        );
    if (commits.isError)
        return <ErrorState error={commits.error} onRetry={() => commits.refetch()} />;
    const data = commits.data;
    if (!data.head) return <NotPushed />;
    if (!data.commits.length)
        return (
            <EmptyState
                icon={<GitCommitHorizontalIcon />}
                title={t("task.commits.emptyTitle")}
                description={t("task.commits.empty")}
            />
        );
    const lanes = Math.max(1, ...graph.map((row) => row.width));
    return (
        <div className="space-y-2">
            <ul className="overflow-hidden rounded-xl border bg-card py-1">
                {data.commits.map((commit, i) => {
                    const row = graph[i] as GraphRow;
                    return (
                        <li key={commit.sha}>
                            <button
                                type="button"
                                onClick={() => setOpen(commit.sha)}
                                className="flex h-7 w-full items-center gap-3 pr-4 pl-2 text-left hover:bg-muted/60"
                            >
                                <GraphCell row={row} lanes={lanes} commit={commit} />
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                    <span
                                        className={cn(
                                            "truncate text-sm",
                                            commit.refs.includes("HEAD") && "font-semibold",
                                        )}
                                    >
                                        {commit.title}
                                    </span>
                                    {commit.body && (
                                        <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground md:inline">
                                            {commit.body.split("\n", 1)[0]}
                                        </span>
                                    )}
                                    <span className="ml-auto hidden sm:flex">
                                        <RefPills refs={commit.refs} color={laneColor(row.lane)} />
                                    </span>
                                </span>
                                <span className="hidden w-40 shrink-0 items-center gap-1.5 text-xs text-muted-foreground lg:flex">
                                    <AuthorAvatar commit={commit} github={github} />
                                    <span className="truncate">{commit.author}</span>
                                </span>
                                <span
                                    className="w-24 shrink-0 text-right text-xs text-muted-foreground"
                                    title={format.dateTime(commit.date)}
                                >
                                    {format.relative(commit.date)}
                                </span>
                                <span className="hidden w-16 shrink-0 font-mono text-xs text-muted-foreground sm:inline">
                                    {commit.sha.slice(0, 7)}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {data.truncated && (
                <p className="text-xs text-muted-foreground">{t("task.commits.truncated")}</p>
            )}
        </div>
    );
}

interface Dir {
    dirs: Map<string, Dir>;
    files: string[];
}

function treeOf(paths: string[]): Dir {
    const root: Dir = { dirs: new Map(), files: [] };
    for (const path of paths) {
        const parts = path.split("/");
        let dir = root;
        for (const part of parts.slice(0, -1)) {
            let next = dir.dirs.get(part);
            if (!next) {
                next = { dirs: new Map(), files: [] };
                dir.dirs.set(part, next);
            }
            dir = next;
        }
        dir.files.push(path);
    }
    return root;
}

function FileEntry({
    path,
    label,
    selected,
    changed,
    onSelect,
}: {
    path: string;
    label: string;
    selected: boolean;
    changed: boolean;
    onSelect: (path: string) => void;
}) {
    const Icon = changed ? FileDiffIcon : FileIcon;
    return (
        <li>
            <button
                type="button"
                title={path}
                onClick={() => onSelect(path)}
                className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/60",
                    selected && "bg-muted font-medium",
                )}
            >
                <Icon
                    className={cn(
                        "size-3.5 shrink-0",
                        changed ? "text-constructive" : "text-muted-foreground",
                    )}
                />
                <span className="truncate font-mono text-xs">{label}</span>
            </button>
        </li>
    );
}

function TreeLevel({
    dir,
    prefix,
    selected,
    changed,
    onSelect,
}: {
    dir: Dir;
    prefix: string;
    selected: string | null;
    changed: Set<string>;
    onSelect: (path: string) => void;
}) {
    return (
        <ul className="space-y-0.5">
            {[...dir.dirs].map(([name, sub]) => (
                <TreeDir
                    key={name}
                    name={name}
                    dir={sub}
                    prefix={`${prefix}${name}/`}
                    selected={selected}
                    changed={changed}
                    onSelect={onSelect}
                />
            ))}
            {dir.files.map((path) => (
                <FileEntry
                    key={path}
                    path={path}
                    label={path.slice(prefix.length)}
                    selected={path === selected}
                    changed={changed.has(path)}
                    onSelect={onSelect}
                />
            ))}
        </ul>
    );
}

function TreeDir({
    name,
    dir,
    prefix,
    selected,
    changed,
    onSelect,
}: {
    name: string;
    dir: Dir;
    prefix: string;
    selected: string | null;
    changed: Set<string>;
    onSelect: (path: string) => void;
}) {
    // Folders with a changed file start open.
    const [open, setOpen] = useState(() => [...changed].some((path) => path.startsWith(prefix)));
    return (
        <li>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-muted/60"
            >
                <ChevronRightIcon
                    className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
                />
                <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{name}</span>
            </button>
            {open && (
                <div className="ml-3 border-l pl-1">
                    <TreeLevel
                        dir={dir}
                        prefix={prefix}
                        selected={selected}
                        changed={changed}
                        onSelect={onSelect}
                    />
                </div>
            )}
        </li>
    );
}

const MARKDOWN = /\.(md|mdx|markdown)$/i;
const SVG = /\.svg$/i;

function FileContent({ source, path }: { source: GitSource; path: string }) {
    const t = useTranslations("web");
    const file = useFile(source, path);
    const [raw, setRaw] = useState(false);
    if (file.isPending)
        return (
            <Loading>
                <FileSkeleton />
            </Loading>
        );
    if (file.isError) return <ErrorState error={file.error} onRetry={() => file.refetch()} />;
    const data = file.data;
    const markdown = !data.binary && MARKDOWN.test(data.path);
    const svg = !data.binary && !data.truncated && SVG.test(data.path);
    return (
        <section className="overflow-hidden rounded-xl border bg-card">
            <header className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
                    {data.path}
                </span>
                {(markdown || svg) && (
                    <Button variant="ghost" size="sm" onClick={() => setRaw(!raw)}>
                        {raw ? <EyeIcon /> : <CodeIcon />}
                        {raw ? t("task.files.preview") : t("task.files.source")}
                    </Button>
                )}
                <span className="text-xs text-muted-foreground">
                    {t("task.files.size", { size: data.size })}
                </span>
                {!data.binary && <CopyButton value={data.content} label={t("task.files.copy")} />}
            </header>
            {data.image ? (
                <ImagePreview
                    src={`data:${data.image};base64,${data.content}`}
                    alt={data.path}
                    className="mx-auto max-h-[70vh] max-w-full"
                />
            ) : data.binary ? (
                <p className="p-4 text-sm text-muted-foreground">{t("task.files.binary")}</p>
            ) : markdown && !raw ? (
                <Markdown className="p-4 md:p-6">{data.content}</Markdown>
            ) : svg && !raw ? (
                // An <img> runs none of the file's scripts and loads nothing it links to.
                <ImagePreview
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.content)}`}
                    alt={data.path}
                    className="h-64 w-full object-contain"
                />
            ) : (
                <CodeLines code={data.content} path={data.path} />
            )}
            {data.truncated && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                    {t("task.files.truncated", { size: data.content.length })}
                </p>
            )}
        </section>
    );
}

// On a checkerboard, so black and white marks show in both themes.
function ImagePreview({ src, alt, className }: { src: string; alt: string; className: string }) {
    return (
        <div className="bg-[repeating-conic-gradient(#e5e5e5_0_25%,#fff_0_50%)] bg-size-[16px_16px] p-6">
            <img src={src} alt={alt} className={className} />
        </div>
    );
}

function CodeLines({ code, path }: { code: string; path: string }) {
    const text = code.replace(/\n$/, "");
    const tokens = useHighlight(text, path);
    const lines = text.split("\n");
    return (
        <div className="scroll-fade-x overflow-x-auto">
            <table className="shiki-code w-full border-collapse font-mono text-xs leading-5">
                <tbody>
                    {lines.map((line, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a file's lines are fixed text that never reorders
                        <tr key={i}>
                            <td className="w-12 select-none px-2 text-right align-top text-muted-foreground/70">
                                {i + 1}
                            </td>
                            <td className="whitespace-pre pr-4">
                                {tokens?.[i]?.map((token, j) => (
                                    // biome-ignore lint/suspicious/noArrayIndexKey: tokens of a fixed line
                                    <span key={j} style={token.htmlStyle as CSSProperties}>
                                        {token.content}
                                    </span>
                                )) ??
                                    (line || " ")}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function FilesSkeleton() {
    return (
        <div className="flex flex-col gap-4 md:flex-row">
            <div className="space-y-3 md:w-72 md:shrink-0">
                <Skeleton className="h-9 w-full rounded-3xl" />
                <div className="space-y-2.5 px-2">
                    {times(8).map((row) => (
                        <Skeleton key={row} className="h-4 w-3/4" />
                    ))}
                </div>
            </div>
            <Skeleton className="h-48 min-w-0 flex-1 rounded-xl" />
        </div>
    );
}

// The tree at the head of a branch, the `changed` files marked, one open beside it.
export function FilesView({
    source,
    changed: marked,
}: {
    source: GitSource;
    changed?: ChangedFile[];
}) {
    const t = useTranslations("web");
    const files = useFiles(source);
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const changed = useMemo(() => new Set(marked?.map((file) => file.path)), [marked]);
    const tree = useMemo(() => treeOf(files.data?.files ?? []), [files.data]);
    if (files.isPending)
        return (
            <Loading>
                <FilesSkeleton />
            </Loading>
        );
    if (files.isError) return <ErrorState error={files.error} onRetry={() => files.refetch()} />;
    if (!files.data.head) return <NotPushed />;
    const needle = query.trim().toLowerCase();
    const matches = needle
        ? files.data.files.filter((path) => path.toLowerCase().includes(needle))
        : [];
    return (
        <div className="flex flex-col gap-4 md:flex-row">
            <aside className="space-y-2 md:w-72 md:shrink-0">
                <div className="relative">
                    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t("task.files.search")}
                        aria-label={t("task.files.search")}
                        className="pl-8"
                    />
                </div>
                <div className="max-h-[60svh] overflow-y-auto md:max-h-[calc(100svh-18rem)]">
                    {needle ? (
                        <ul className="space-y-0.5">
                            {matches.map((path) => (
                                <FileEntry
                                    key={path}
                                    path={path}
                                    label={path}
                                    selected={path === selected}
                                    changed={changed.has(path)}
                                    onSelect={setSelected}
                                />
                            ))}
                            {!matches.length && (
                                <li className="px-2 py-1 text-xs text-muted-foreground">
                                    {t("task.files.noMatch")}
                                </li>
                            )}
                        </ul>
                    ) : (
                        <TreeLevel
                            dir={tree}
                            prefix=""
                            selected={selected}
                            changed={changed}
                            onSelect={setSelected}
                        />
                    )}
                </div>
                {files.data.truncated && (
                    <p className="text-xs text-muted-foreground">{t("task.files.listTruncated")}</p>
                )}
            </aside>
            <div className="min-w-0 flex-1">
                {selected ? (
                    <FileContent source={source} path={selected} />
                ) : (
                    <EmptyState
                        icon={<FileIcon />}
                        title={t("task.files.pickTitle")}
                        description={t("task.files.pick")}
                    />
                )}
            </div>
        </div>
    );
}
