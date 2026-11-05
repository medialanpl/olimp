import { type UseQueryResult, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    ArrowRightIcon,
    BookPlusIcon,
    CheckCircle2Icon,
    ChevronRightIcon,
    FilePlusIcon,
    FileTextIcon,
    InfoIcon,
    MessageCircleQuestionMarkIcon,
    MountainIcon,
    NetworkIcon,
    PencilIcon,
    PlusIcon,
    SaveIcon,
    SearchIcon,
    SparklesIcon,
    StickyNoteIcon,
} from "lucide-react";
import { type FormEvent, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { type Components, defaultComponents } from "streamdown";
import { useTranslations } from "use-intl";
import { CodeEditor } from "@/components/code-editor";
import { EmptyState } from "@/components/empty-state";
import { Action } from "@/components/job-page";
import { Markdown } from "@/components/markdown";
import { ErrorState, FormError, Loading, UNDERLINE_TAB, UNDERLINE_TABS } from "@/components/page";
import { PromptBox } from "@/components/prompt-box";
import { SkeletonText, times } from "@/components/skeletons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useAttachments } from "@/lib/attachments";
import { useFormat } from "@/lib/format";
import {
    keys,
    projectApi,
    useAgentDefaults,
    useAutomations,
    useMemoryGraph,
    useMemoryMap,
    useMemoryPage,
    useMemorySearch,
    useMemoryWrite,
    useNotes,
    useRepo,
    useUnwoven,
} from "@/lib/queries";
import type {
    MemoryPage,
    MemorySearch,
    MemorySection,
    MemorySummary,
    Note,
    Repo,
    Task,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { wikiLinks } from "@/lib/wiki-links";
import { ModelChip, type ModelChoice, titleOf } from "@/pages/new-task";
import { ConfirmDelete } from "@/pages/project/shared";
import {
    MEMORY_DESCRIPTION_MAX,
    MEMORY_SECTION_MAX,
    MEMORY_SLUG_MAX,
    SEARCH_MIN,
    TITLE_MAX,
} from "../../../src/limits.ts";

const KINDS = ["page", "hub"] as const;

const ITEM =
    "flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50";

function ItemSkeleton() {
    return (
        <div className="flex items-start gap-2.5 px-2.5 py-2">
            <Skeleton className="mt-0.5 size-4 shrink-0 rounded-sm" />
            <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
            </div>
        </div>
    );
}

// The hubs and the pages beside the mountain, as PageList draws them.
function PageListsSkeleton() {
    return (
        <Loading className="space-y-3">
            {times(2).map((list) => (
                <div key={list} className="space-y-1">
                    <div className="space-y-1.5 px-2 pt-1 pb-1">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                    {times(list ? 4 : 2).map((item) => (
                        <ItemSkeleton key={item} />
                    ))}
                </div>
            ))}
        </Loading>
    );
}

// A page as PageView draws it: the header, then its sections.
function PageSkeleton() {
    return (
        <Loading className="overflow-hidden rounded-xl border bg-card">
            <div className="space-y-2 border-b p-5">
                <Skeleton className="h-7 w-2/3" />
                <Skeleton className="h-4 w-full max-w-prose" />
                <Skeleton className="h-3 w-56" />
            </div>
            <div className="divide-y">
                {times(3).map((section) => (
                    <div key={section} className="space-y-2 px-5 py-4">
                        <Skeleton className="h-5 w-40" />
                        <SkeletonText lines={3} />
                    </div>
                ))}
            </div>
        </Loading>
    );
}

// three.js comes only when the mountain is drawn.
const MemoryMountain = lazy(() => import("@/components/memory-mountain"));

// The panel's router follows a link to a memory page.
const LINKS: Components = {
    a: (props) =>
        props.href?.startsWith("/project/") ? (
            <Link
                to={props.href}
                className="font-medium underline decoration-brand/60 underline-offset-2 hover:decoration-brand"
            >
                {props.children}
            </Link>
        ) : (
            <defaultComponents.a {...props} />
        ),
};

const anchor = (heading: string) => `s-${encodeURIComponent(heading)}`;

// Lowercase ASCII letters and digits joined by single hyphens, as the API wants a slug.
const slugOf = (title: string) =>
    title
        .toLowerCase()
        .replace(/ł/g, "l")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, MEMORY_SLUG_MAX)
        .replace(/-$/, "");

const sectionsPath = (repo: string, slug: string) =>
    projectApi(repo, `memory/pages/${slug}/sections`);

function SourceOf({ item }: { item: Pick<MemorySection, "task" | "run" | "node"> }) {
    const t = useTranslations("web");
    if (item.task)
        return (
            <Link to={`/tasks/${item.task}`} className="hover:underline">
                {t("memory.byTask", { id: item.task.slice(0, 6) })}
            </Link>
        );
    if (item.run)
        return (
            <Link to={`/tasks/${item.run}`} className="hover:underline">
                {t("memory.byRun", { id: item.run.slice(0, 6), node: item.node ?? "" })}
            </Link>
        );
    return <>{t("memory.byApi")}</>;
}

function SectionEditor({
    repo,
    slug,
    section,
    onDone,
}: {
    repo: string;
    slug: string;
    section: MemorySection;
    onDone: () => void;
}) {
    const t = useTranslations("web");
    const write = useMemoryWrite(repo);
    const [body, setBody] = useState(section.body);
    // The version the text was read at: the API refuses the save once the section changed since.
    const [base, setBase] = useState(section.version);
    const stale = section.version !== base && !write.isPending;
    const save = (event: FormEvent) => {
        event.preventDefault();
        write.mutate(
            {
                method: "PATCH",
                path: `${sectionsPath(repo, slug)}/${encodeURIComponent(section.heading)}`,
                body: { version: base, body },
            },
            { onSuccess: onDone },
        );
    };
    return (
        <form onSubmit={save} className="space-y-3">
            {stale && (
                <div className="space-y-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3">
                    <p className="text-sm">
                        {t("memory.changedMeanwhile", { version: section.version })}
                    </p>
                    <Markdown className="rounded-md border bg-background p-3" components={LINKS}>
                        {wikiLinks(repo, section.body)}
                    </Markdown>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            setBase(section.version);
                            write.reset();
                        }}
                    >
                        {t("memory.applyToLatest", { version: section.version })}
                    </Button>
                </div>
            )}
            <CodeEditor
                value={body}
                onChange={setBody}
                path="section.md"
                maxLength={MEMORY_SECTION_MAX}
                aria-label={t("memory.sectionText", { heading: section.heading })}
                className="min-h-32"
            />
            <FormError error={write.error} />
            <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" size="sm" disabled={write.isPending || stale || !body.trim()}>
                    <SaveIcon />
                    {t("common.save")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onDone}>
                    {t("common.cancel")}
                </Button>
                <span className="text-xs text-muted-foreground">
                    {t("memory.editingVersion", { version: base })}
                </span>
            </div>
        </form>
    );
}

function Section({
    repo,
    slug,
    section,
    notes,
}: {
    repo: string;
    slug: string;
    section: MemorySection;
    notes: Map<string, Note>;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    const { hash } = useLocation();
    const [editing, setEditing] = useState(false);
    const id = anchor(section.heading);
    return (
        <section
            id={id}
            className={cn(
                "group/section scroll-mt-4 space-y-2 px-5 py-4",
                hash === `#${id}` && "bg-muted/50",
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{section.heading}</h3>
                {!editing && (
                    <Action
                        label={t("memory.editSection", { heading: section.heading })}
                        onClick={() => setEditing(true)}
                        className="-my-1 text-muted-foreground focus-visible:opacity-100 md:opacity-0 md:group-hover/section:opacity-100"
                    >
                        <PencilIcon />
                    </Action>
                )}
            </div>
            {editing ? (
                <SectionEditor
                    repo={repo}
                    slug={slug}
                    section={section}
                    onDone={() => setEditing(false)}
                />
            ) : (
                <Markdown components={LINKS}>{wikiLinks(repo, section.body)}</Markdown>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                    {t("memory.version", { version: section.version })} ·{" "}
                    {format.relative(section.updatedAt)} · <SourceOf item={section} />
                </span>
                {section.sources.length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                        {t("memory.sources")}
                        {section.sources.map((note) => (
                            <a
                                key={note}
                                href={`#note-${note}`}
                                title={notes.get(note)?.text ?? t("memory.sourceGone")}
                            >
                                <Badge variant="outline" className="font-mono hover:bg-muted">
                                    {note.slice(0, 6)}
                                </Badge>
                            </a>
                        ))}
                    </span>
                )}
            </div>
        </section>
    );
}

function AddSection({ repo, slug }: { repo: string; slug: string }) {
    const t = useTranslations("web");
    const write = useMemoryWrite(repo);
    const [open, setOpen] = useState(false);
    const [heading, setHeading] = useState("");
    const [body, setBody] = useState("");
    const close = () => {
        setOpen(false);
        setHeading("");
        setBody("");
        write.reset();
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        write.mutate(
            { path: sectionsPath(repo, slug), body: { heading, body } },
            { onSuccess: close },
        );
    };
    if (!open)
        return (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <PlusIcon />
                {t("memory.addSection")}
            </Button>
        );
    return (
        <form onSubmit={submit} className="space-y-3 py-2">
            <div className="space-y-2">
                <Label htmlFor="section-heading">{t("memory.heading")}</Label>
                <Input
                    id="section-heading"
                    required
                    autoFocus
                    maxLength={TITLE_MAX}
                    value={heading}
                    onChange={(e) => setHeading(e.target.value)}
                />
            </div>
            <CodeEditor
                value={body}
                onChange={setBody}
                path="section.md"
                maxLength={MEMORY_SECTION_MAX}
                placeholder={t("memory.sectionPlaceholder")}
                aria-label={t("memory.newSectionText")}
                className="min-h-32"
            />
            <FormError error={write.error} />
            <div className="flex flex-wrap gap-2">
                <Button
                    type="submit"
                    size="sm"
                    disabled={write.isPending || !heading.trim() || !body.trim()}
                >
                    <PlusIcon />
                    {t("memory.addSection")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={close}>
                    {t("common.cancel")}
                </Button>
            </div>
        </form>
    );
}

function PageHeaderEditor({ page, onDone }: { page: MemoryPage; onDone: () => void }) {
    const t = useTranslations("web");
    const write = useMemoryWrite(page.repo);
    const [title, setTitle] = useState(page.title);
    const [description, setDescription] = useState(page.description);
    // As in SectionEditor: the API refuses the save once the page changed since this version.
    const [base, setBase] = useState(page.version);
    const stale = page.version !== base && !write.isPending;
    const save = (event: FormEvent) => {
        event.preventDefault();
        write.mutate(
            {
                method: "PATCH",
                path: projectApi(page.repo, `memory/pages/${page.slug}`),
                body: { version: base, title, description },
            },
            { onSuccess: onDone },
        );
    };
    return (
        <form onSubmit={save} className="space-y-3 rounded-xl border bg-card p-4">
            {stale && (
                <div className="space-y-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3">
                    <p className="text-sm">
                        {t("memory.pageChangedMeanwhile", { version: page.version })}
                    </p>
                    <div className="space-y-1 rounded-md border bg-background p-3">
                        <p className="font-semibold">{page.title}</p>
                        <p className="text-sm text-muted-foreground">{page.description}</p>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            setBase(page.version);
                            write.reset();
                        }}
                    >
                        {t("memory.applyToLatest", { version: page.version })}
                    </Button>
                </div>
            )}
            <div className="space-y-2">
                <Label htmlFor="edit-page-title">{t("memory.title")}</Label>
                <Input
                    id="edit-page-title"
                    required
                    autoFocus
                    maxLength={TITLE_MAX}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="edit-page-description">{t("memory.pageDescription")}</Label>
                <Input
                    id="edit-page-description"
                    required
                    maxLength={MEMORY_DESCRIPTION_MAX}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("memory.descriptionHint")}</p>
            </div>
            <FormError error={write.error} />
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="submit"
                    size="sm"
                    disabled={write.isPending || stale || !title.trim() || !description.trim()}
                >
                    <SaveIcon />
                    {t("common.save")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onDone}>
                    {t("common.cancel")}
                </Button>
                <span className="text-xs text-muted-foreground">
                    {t("memory.editingVersion", { version: base })}
                </span>
            </div>
        </form>
    );
}

function PageView({ repo, slug }: { repo: string; slug: string }) {
    const t = useTranslations("web");
    const format = useFormat();
    const page = useMemoryPage(repo, slug);
    const notes = useNotes(repo);
    const graph = useMemoryGraph(repo);
    const { hash } = useLocation();
    const [editing, setEditing] = useState(false);
    // A search hit opens the page at its section.
    useEffect(() => {
        if (page.isSuccess && hash)
            document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    }, [page.isSuccess, hash]);
    if (page.isPending) return <PageSkeleton />;
    if (page.isError) return <ErrorState error={page.error} onRetry={() => page.refetch()} />;
    const byId = new Map((notes.data ?? []).map((note) => [note.id, note]));
    const titles = new Map((graph.data?.nodes ?? []).map((n) => [n.id, n.label]));
    const hubs = (graph.data?.edges ?? [])
        .filter((e) => e.to === `page:${slug}` && e.from.startsWith("page:"))
        .map((e) => e.from.slice("page:".length));
    const cited = [...new Set(page.data.sections.flatMap((s) => s.sources))];
    const Icon = page.data.kind === "hub" ? NetworkIcon : FileTextIcon;
    return (
        <div className="space-y-4">
            <article className="overflow-hidden rounded-xl border bg-card">
                {editing ? (
                    <div className="border-b p-5">
                        <PageHeaderEditor page={page.data} onDone={() => setEditing(false)} />
                    </div>
                ) : (
                    <header className="space-y-2 border-b p-5">
                        {hubs.length > 0 && (
                            <nav
                                aria-label={t("memory.inHubs")}
                                className="-ml-1.5 flex flex-wrap items-center gap-0.5 text-xs text-muted-foreground"
                            >
                                {hubs.map((hub) => (
                                    <Link
                                        key={hub}
                                        to={`/project/${repo}/memory/${hub}`}
                                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                                    >
                                        <NetworkIcon className="size-3.5" />
                                        {titles.get(`page:${hub}`) ?? hub}
                                    </Link>
                                ))}
                                <ChevronRightIcon aria-hidden="true" className="size-3.5" />
                            </nav>
                        )}
                        <div className="flex items-start justify-between gap-3">
                            <h2 className="text-xl font-semibold tracking-tight text-balance">
                                {page.data.title}
                            </h2>
                            <Action
                                label={t("memory.editPage")}
                                onClick={() => setEditing(true)}
                                className="-my-0.5 text-muted-foreground"
                            >
                                <PencilIcon />
                            </Action>
                        </div>
                        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
                            {page.data.description}
                        </p>
                        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-xs text-muted-foreground">
                            <Icon aria-hidden="true" className="size-3.5" />
                            <span className="font-medium text-foreground">
                                {t(`memory.${page.data.kind}`)}
                            </span>
                            {page.data.kind === "page" && !hubs.length && (
                                <span>· {t("memory.noHub")}</span>
                            )}
                            <span>
                                ·{" "}
                                {t("memory.pageFacts", {
                                    sections: page.data.sections.length,
                                    sources: cited.length,
                                })}{" "}
                                · {format.relative(page.data.updatedAt)} ·{" "}
                                <SourceOf item={page.data} />
                            </span>
                        </p>
                    </header>
                )}
                {page.data.sections.length ? (
                    <div className="divide-y">
                        {page.data.sections.map((section) => (
                            <Section
                                key={section.heading}
                                repo={repo}
                                slug={slug}
                                section={section}
                                notes={byId}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="px-5 py-6 text-sm text-muted-foreground">
                        {t("memory.noSections")}
                    </p>
                )}
                <div className="border-t bg-muted/30 px-5 py-3">
                    <AddSection repo={repo} slug={slug} />
                </div>
            </article>
            {cited.length > 0 && (
                <section aria-labelledby="page-sources" className="space-y-2">
                    <h3
                        id="page-sources"
                        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                    >
                        {t("memory.pageSources")}
                    </h3>
                    <ul className="divide-y rounded-xl border bg-card">
                        {cited.map((id) => {
                            const note = byId.get(id);
                            return (
                                <li
                                    key={id}
                                    id={`note-${id}`}
                                    className="flex scroll-mt-4 gap-3 px-4 py-2.5 text-sm target:bg-muted/50"
                                >
                                    <Badge variant="outline" className="mt-0.5 shrink-0 font-mono">
                                        {id.slice(0, 6)}
                                    </Badge>
                                    <span className="min-w-0 flex-1">
                                        <span className="line-clamp-2 whitespace-pre-wrap break-words">
                                            {note?.text ?? t("memory.sourceGone")}
                                        </span>
                                        {note && (
                                            <span className="text-xs text-muted-foreground">
                                                {format.relative(note.createdAt)} ·{" "}
                                                <SourceOf item={note} />
                                            </span>
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}
        </div>
    );
}

function PageList({
    repo,
    title,
    hint,
    items,
    current,
    Icon,
}: {
    repo: string;
    title: string;
    hint: string;
    items: MemorySummary[];
    current: string | null;
    Icon: typeof FileTextIcon;
}) {
    const t = useTranslations("web");
    if (!items.length) return null;
    return (
        <div className="space-y-1">
            <h3 className="px-2 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {title}
            </h3>
            <p className="px-2 pb-1 text-xs text-muted-foreground">{hint}</p>
            <ul className="space-y-0.5">
                {items.map((item) => (
                    <li key={item.slug}>
                        <Link
                            to={`/project/${repo}/memory/${item.slug}`}
                            aria-current={item.slug === current ? "page" : undefined}
                            className={cn(ITEM, item.slug === current && "bg-muted")}
                        >
                            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                    {item.title}
                                </span>
                                <span className="line-clamp-1 text-xs text-muted-foreground">
                                    {item.description}
                                </span>
                            </span>
                            <span
                                className="mt-0.5 shrink-0 text-xs text-muted-foreground tabular-nums"
                                title={t("memory.sectionCount", { count: item.sections })}
                            >
                                <span aria-hidden="true">{item.sections}</span>
                                <span className="sr-only">
                                    {t("memory.sectionCount", { count: item.sections })}
                                </span>
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function NewPageForm({ repo, onDone }: { repo: string; onDone: () => void }) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const write = useMemoryWrite(repo);
    const [title, setTitle] = useState("");
    // Follows the title until edited.
    const [slug, setSlug] = useState<string | null>(null);
    const [description, setDescription] = useState("");
    const [kind, setKind] = useState<(typeof KINDS)[number]>("page");
    const finalSlug = slug ?? slugOf(title);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        write.mutate(
            {
                path: projectApi(repo, "memory/pages"),
                body: { slug: finalSlug, title, description, kind },
            },
            {
                onSuccess: () => {
                    navigate(`/project/${repo}/memory/${finalSlug}`);
                    onDone();
                },
            },
        );
    };
    return (
        <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="page-title">{t("memory.title")}</Label>
                <Input
                    id="page-title"
                    required
                    autoFocus
                    maxLength={TITLE_MAX}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                <div className="space-y-2">
                    <Label htmlFor="page-slug">{t("memory.slug")}</Label>
                    <Input
                        id="page-slug"
                        required
                        maxLength={MEMORY_SLUG_MAX}
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        className="font-mono"
                        value={finalSlug}
                        onChange={(e) => setSlug(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t("memory.slugHint")}</p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="page-kind">{t("memory.kind")}</Label>
                    <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                        <SelectTrigger id="page-kind" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {KINDS.map((k) => (
                                <SelectItem key={k} value={k}>
                                    {t(`memory.${k}`)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="page-description">{t("memory.pageDescription")}</Label>
                <Input
                    id="page-description"
                    required
                    maxLength={MEMORY_DESCRIPTION_MAX}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("memory.descriptionHint")}</p>
            </div>
            <FormError error={write.error} />
            <div className="flex flex-wrap gap-2">
                <Button
                    type="submit"
                    disabled={write.isPending || !title.trim() || !finalSlug || !description.trim()}
                >
                    <FilePlusIcon />
                    {t("memory.createPage")}
                </Button>
                <Button type="button" variant="ghost" onClick={onDone}>
                    {t("common.cancel")}
                </Button>
            </div>
        </form>
    );
}

function NewPage({ repo }: { repo: string }) {
    const t = useTranslations("web");
    const [open, setOpen] = useState(false);
    return (
        <>
            <Action
                label={t("memory.newPage")}
                onClick={() => setOpen(true)}
                className="text-muted-foreground"
            >
                <FilePlusIcon />
            </Action>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("memory.newPage")}</DialogTitle>
                        <DialogDescription>{t("memory.newPageHint")}</DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        {open && <NewPageForm repo={repo} onDone={() => setOpen(false)} />}
                    </DialogBody>
                </DialogContent>
            </Dialog>
        </>
    );
}

// The hits stay in the list while their pages open beside it.
const hitLink = (repo: string, hit: MemorySearch["hits"][number]) =>
    `/project/${repo}/memory/${hit.slug}${hit.heading === null ? "" : `#${anchor(hit.heading)}`}`;

// The hits stay in the list while their pages open beside it and stand out on the mountain.
function SearchResults({
    repo,
    query,
    search,
}: {
    repo: string;
    query: string;
    search: UseQueryResult<MemorySearch>;
}) {
    const t = useTranslations("web");
    const { pathname, hash } = useLocation();
    if (search.isPending)
        return (
            <Loading className="space-y-0.5">
                {times(3).map((hit) => (
                    <ItemSkeleton key={hit} />
                ))}
            </Loading>
        );
    if (search.isError) return <ErrorState error={search.error} onRetry={() => search.refetch()} />;
    const { hits, total } = search.data;
    if (!hits.length)
        return (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
                {t("memory.searchEmpty", { query })}
            </p>
        );
    return (
        <div className="space-y-1">
            {total > hits.length && (
                <p className="px-2.5 pt-1 text-xs text-muted-foreground">
                    {t("memory.searchMore", { shown: hits.length, total })}
                </p>
            )}
            <ul className="space-y-0.5">
                {hits.map((hit) => {
                    const Icon = hit.kind === "hub" ? NetworkIcon : FileTextIcon;
                    const to = hitLink(repo, hit);
                    const here = to === pathname + hash;
                    return (
                        <li key={to}>
                            <Link
                                to={to}
                                aria-current={here ? "page" : undefined}
                                className={cn(ITEM, here && "bg-muted")}
                            >
                                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium">
                                        {hit.title}
                                        {hit.heading !== null && (
                                            <span className="text-muted-foreground">
                                                {" "}
                                                › {hit.heading}
                                            </span>
                                        )}
                                    </span>
                                    <span className="line-clamp-2 text-xs text-muted-foreground">
                                        {hit.snippet}
                                    </span>
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

// The mountain beside the page, as Jarvis's graph: the open page as its ochre node and the search
// hits standing out.
function MemoryHero({
    repo,
    current,
    found,
    className,
}: {
    repo: string;
    current: string | null;
    found: string[] | null;
    className?: string;
}) {
    const t = useTranslations("web");
    const graph = useMemoryGraph(repo);
    const count = (kind: string) => graph.data?.nodes.filter((n) => n.kind === kind).length ?? 0;
    const empty = graph.isSuccess && graph.data.nodes.length < 2;
    return (
        <section className={cn("relative overflow-hidden", className)}>
            {graph.isError ? (
                <div className="absolute inset-0 grid place-items-center">
                    <ErrorState error={graph.error} onRetry={() => graph.refetch()} />
                </div>
            ) : empty ? (
                <div className="absolute inset-0 flex p-4 md:p-6">
                    <EmptyState
                        icon={<MountainIcon />}
                        title={t("memory.emptyTitle")}
                        description={t("memory.mountainEmpty")}
                    />
                </div>
            ) : (
                graph.isSuccess && (
                    <Suspense fallback={null}>
                        <MemoryMountain
                            repo={repo}
                            graph={graph.data}
                            selected={current}
                            found={found}
                            className="absolute inset-0"
                            label={t("memory.mountainLabel", {
                                hubs: count("hub"),
                                pages: count("page"),
                                notes: count("note"),
                                unwoven: graph.data.unwoven,
                            })}
                        />
                    </Suspense>
                )
            )}
        </section>
    );
}

// When the built-in weaving next looks at the notes, or that it is off.
function WeaveStatus({ repo }: { repo: string }) {
    const t = useTranslations("web");
    const format = useFormat();
    const weave = useAutomations().data?.find((a) => a.repo === repo && a.builtin === "weave");
    if (!weave) return null;
    return (
        <Link
            to={`/project/${repo}/automations/${weave.id}`}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        >
            <SparklesIcon className="size-3.5 shrink-0" />
            {weave.enabled && weave.nextRunAt
                ? t("memory.weaveNext", { when: format.relative(weave.nextRunAt) })
                : t("memory.weaveOff")}
        </Link>
    );
}

// The notes no section cites yet: what the next weaving takes.
function UnwovenNotes({ repo }: { repo: string }) {
    const t = useTranslations("web");
    const format = useFormat();
    const unwoven = useUnwoven(repo);
    const remove = useMemoryWrite(repo);
    return (
        <section
            aria-labelledby="unwoven-title"
            className="overflow-hidden rounded-xl border bg-card"
        >
            <div className="space-y-1.5 border-b p-4">
                <h2 id="unwoven-title" className="flex items-center gap-2 text-sm font-semibold">
                    <StickyNoteIcon className="size-4 text-muted-foreground" />
                    {t("memory.unwoven")}
                    <Badge variant="secondary" className="tabular-nums">
                        {unwoven.data?.total ?? 0}
                    </Badge>
                </h2>
                <p className="text-xs text-muted-foreground">{t("memory.unwovenHint")}</p>
                <WeaveStatus repo={repo} />
            </div>
            {unwoven.isPending ? (
                <Loading className="divide-y">
                    {times(2).map((note) => (
                        <div key={note} className="space-y-1.5 px-4 py-3">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-3 w-32" />
                        </div>
                    ))}
                </Loading>
            ) : unwoven.isError ? (
                <ErrorState error={unwoven.error} onRetry={() => unwoven.refetch()} />
            ) : !unwoven.data.notes.length ? (
                <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                    <CheckCircle2Icon className="size-4 shrink-0 text-constructive" />
                    {t("memory.unwovenEmpty")}
                </p>
            ) : (
                <ul className="divide-y">
                    {unwoven.data.notes.map((note) => (
                        <li key={note.id} className="group/note flex items-start gap-2 px-4 py-3">
                            <div className="min-w-0 flex-1 space-y-1">
                                <p className="whitespace-pre-wrap break-words text-sm">
                                    {note.text}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {format.relative(note.createdAt)} · <SourceOf item={note} />
                                </p>
                            </div>
                            <div className="focus-within:opacity-100 md:opacity-0 md:group-hover/note:opacity-100">
                                <ConfirmDelete
                                    size="icon-sm"
                                    label={t("memory.deleteNote")}
                                    question={t("memory.confirmDeleteNote")}
                                    pending={remove.isPending}
                                    onConfirm={() =>
                                        remove.mutate({
                                            method: "DELETE",
                                            path: `/api/notes/${note.id}`,
                                            body: {},
                                        })
                                    }
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <FormError error={remove.error} />
        </section>
    );
}

const MODES = ["ask", "remember"] as const;
// A link alone is a source OLIMP fetches; other text is a note.
const LINK = /^https?:\/\/\S+$/;

// The chat under the mountain, as in a new task: a question becomes a task whose agent answers
// from the memory; a note waits for the weaving, and each file or link becomes a source a task
// weaves in.
function MemoryComposer({
    repo,
    project,
    off,
    className,
}: {
    repo: string;
    project: Repo | undefined;
    off: boolean;
    className?: string;
}) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const client = useQueryClient();
    const defaults = useAgentDefaults();
    const attachments = useAttachments();
    const [own, setMode] = useState<(typeof MODES)[number]>("ask");
    const [text, setText] = useState("");
    // null follows the project's agent, so the API picks it and its model too.
    const [ownChoice, setChoice] = useState<ModelChoice | null>(null);
    // With the knowledge base off, the agent would have no memory to answer from.
    const mode = off ? "remember" : own;
    const choice = ownChoice ?? {
        agent: project?.agents.agent ?? defaults.data?.agent ?? "claude",
        model: null,
    };
    const sourcesPath = projectApi(repo, "memory/sources");
    const send = useMutation({
        // The task to open: the question's or the first source's; none for a note alone.
        mutationFn: async (value: string): Promise<string | null> => {
            const body = value.trim();
            if (mode === "ask") {
                const task = await api<Task>("/api/tasks", {
                    method: "POST",
                    body: {
                        repo,
                        title: titleOf(body) || titleOf(attachments.items[0]?.name ?? ""),
                        body,
                        attachments: attachments.ids,
                        ...(ownChoice ? { agent: ownChoice.agent } : {}),
                        ...(choice.model ? { model: choice.model } : {}),
                    },
                });
                return task.id;
            }
            const tasks: string[] = [];
            // A file leaves the list once added, so after a failure the rest can be sent again.
            for (const item of attachments.items) {
                if (!item.upload) continue;
                const added = await api<{ task: Task }>(sourcesPath, {
                    method: "POST",
                    body: { upload: item.upload },
                });
                attachments.remove(item.key);
                tasks.push(added.task.id);
            }
            if (LINK.test(body)) {
                const added = await api<{ task: Task }>(sourcesPath, {
                    method: "POST",
                    body: { url: body },
                });
                tasks.push(added.task.id);
            } else if (body)
                await api("/api/notes", { method: "POST", body: { repo, text: body } });
            return tasks[0] ?? null;
        },
        onSuccess: (task) => {
            setText("");
            attachments.clear();
            if (task) navigate(`/tasks/${task}`);
        },
        onSettled: () =>
            Promise.all([
                client.invalidateQueries({ queryKey: keys.memory(repo) }),
                client.invalidateQueries({ queryKey: keys.notes(repo) }),
            ]),
    });
    return (
        <div className={cn("sticky bottom-0 bg-background px-4 pt-2 pb-4 md:px-6", className)}>
            <div className="mx-auto max-w-3xl space-y-2">
                <Tabs
                    value={mode}
                    onValueChange={(value) => {
                        setMode(value as typeof own);
                        send.reset();
                    }}
                >
                    <TabsList
                        aria-label={t("memory.composerMode")}
                        className={cn(UNDERLINE_TABS, "px-3")}
                    >
                        <TabsTrigger value="ask" disabled={off} className={UNDERLINE_TAB}>
                            <MessageCircleQuestionMarkIcon />
                            {t("memory.ask")}
                        </TabsTrigger>
                        <TabsTrigger value="remember" className={UNDERLINE_TAB}>
                            <BookPlusIcon />
                            {t("memory.remember")}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
                <PromptBox
                    value={text}
                    onChange={setText}
                    onSubmit={(value) => send.mutate(value)}
                    attachments={attachments}
                    label={mode === "ask" ? t("memory.ask") : t("memory.remember")}
                    placeholder={
                        mode === "ask"
                            ? t("memory.askPlaceholder")
                            : t("memory.rememberPlaceholder")
                    }
                    pending={send.isPending}
                    canSend={!!text.trim() || attachments.ids.length > 0}
                    toolbar={mode === "ask" && <ModelChip value={choice} onChange={setChoice} />}
                />
                {send.isSuccess && send.data === null && !text && (
                    <p role="status" className="px-4 text-xs text-constructive">
                        {t("memory.noteAdded")}
                    </p>
                )}
                <FormError error={send.error} />
            </div>
        </div>
    );
}

function ViewLink({
    view,
    current,
    label,
    count,
    Icon,
}: {
    view: string;
    current: string | null;
    label: string;
    count?: number;
    Icon: typeof FileTextIcon;
}) {
    return (
        <li>
            <Link
                to={`?view=${view}`}
                aria-current={view === current ? "page" : undefined}
                className={cn(ITEM, "items-center", view === current && "bg-muted")}
            >
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-sm font-medium">{label}</span>
                {!!count && (
                    <Badge variant="secondary" className="tabular-nums">
                        {count}
                    </Badge>
                )}
            </Link>
        </li>
    );
}

// The project's memory, OLIMP's successor of Jarvis: the search, hubs and pages on the left; the
// mountain always in view with the open page beside it (below it on narrower screens), and the
// chat under the mountain.
export function ProjectMemoryPage() {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const { id = "", slug } = useParams();
    const [params] = useSearchParams();
    const map = useMemoryMap(id);
    const project = useRepo(id).data;
    const off = project?.settings.memory === false;
    const [query, setQuery] = useState("");
    const [searched, setSearched] = useState("");
    useEffect(() => {
        const timer = setTimeout(() => setSearched(query.replace(/\s+/g, " ").trim()), 250);
        return () => clearTimeout(timer);
    }, [query]);
    const searching = query.trim().length >= SEARCH_MIN && searched.length >= SEARCH_MIN;
    const search = useMemorySearch(id, searching ? searched : "");
    // The previous hits stay as placeholder data once the search is cleared.
    const hits = searching ? search.data?.hits : undefined;
    const found = useMemo(() => hits?.map((hit) => hit.slug) ?? null, [hits]);
    const all = [...(map.data?.hubs ?? []), ...(map.data?.pages ?? [])];
    // Without a page in the address: the start hub, else the first hub or page.
    const current = slug ?? all.find((p) => p.slug === "start")?.slug ?? all[0]?.slug ?? null;
    const view = params.get("view") ?? (map.isSuccess && !current ? "unwoven" : null);
    const open = view ? null : current;
    return (
        // `relative` keeps the lists' absolute `sr-only` labels from stretching the window's scroll.
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
            <nav
                aria-label={t("nav.memory")}
                className="flex shrink-0 flex-col border-b bg-card lg:w-72 lg:border-r lg:border-b-0 xl:w-80"
            >
                <div className="space-y-3 border-b p-3">
                    <div className="flex items-center justify-between gap-2 pl-1">
                        <h1 className="text-lg font-semibold tracking-tight">{t("nav.memory")}</h1>
                        <NewPage repo={id} />
                    </div>
                    <InputGroup>
                        <InputGroupAddon>
                            <SearchIcon />
                        </InputGroupAddon>
                        <InputGroupInput
                            type="search"
                            value={query}
                            maxLength={TITLE_MAX}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && hits?.[0]) navigate(hitLink(id, hits[0]));
                            }}
                            placeholder={t("memory.searchPlaceholder")}
                            aria-label={t("memory.search")}
                        />
                    </InputGroup>
                </div>
                <div className="scroll-fade relative max-h-72 min-h-0 space-y-3 overflow-y-auto p-1.5 lg:max-h-none lg:flex-1">
                    {searching ? (
                        <SearchResults repo={id} query={searched} search={search} />
                    ) : map.isPending ? (
                        <PageListsSkeleton />
                    ) : map.isError ? (
                        <ErrorState error={map.error} onRetry={() => map.refetch()} />
                    ) : (
                        <>
                            <PageList
                                repo={id}
                                title={t("memory.hubs")}
                                hint={t("memory.hubsHint")}
                                items={map.data.hubs}
                                current={open}
                                Icon={NetworkIcon}
                            />
                            <PageList
                                repo={id}
                                title={t("memory.pageList")}
                                hint={t("memory.pagesHint")}
                                items={map.data.pages}
                                current={open}
                                Icon={FileTextIcon}
                            />
                        </>
                    )}
                </div>
                <ul className="border-t p-1.5">
                    <ViewLink
                        view="unwoven"
                        current={view}
                        label={t("memory.unwoven")}
                        count={map.data?.unwoven}
                        Icon={StickyNoteIcon}
                    />
                </ul>
            </nav>
            <div className="grid min-w-0 flex-1 grid-cols-1 lg:min-h-0 lg:grid-rows-[auto_minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,min(44rem,55%))] 2xl:grid-rows-[minmax(0,1fr)_auto]">
                <MemoryHero
                    repo={id}
                    current={current}
                    found={found}
                    className="h-56 border-b lg:h-[34svh] 2xl:col-start-1 2xl:row-start-1 2xl:h-auto 2xl:border-b-0"
                />
                <div className="scroll-fade min-w-0 lg:overflow-y-auto 2xl:col-start-2 2xl:row-span-2 2xl:row-start-1 2xl:border-l">
                    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
                        {off && (
                            <Alert variant="info" role="note">
                                <InfoIcon />
                                <AlertTitle>{t("memory.offTitle")}</AlertTitle>
                                <AlertDescription>
                                    <p>{t("memory.off")}</p>
                                    <Link
                                        to={`/project/${id}/settings/general`}
                                        className="inline-flex items-center gap-1 font-medium text-info underline decoration-info/40 underline-offset-4 transition-colors hover:decoration-info"
                                    >
                                        {t("memory.turnOn")}
                                        <ArrowRightIcon aria-hidden="true" className="size-3.5" />
                                    </Link>
                                </AlertDescription>
                            </Alert>
                        )}
                        {view === "unwoven" ? (
                            <UnwovenNotes repo={id} />
                        ) : (
                            open && <PageView key={open} repo={id} slug={open} />
                        )}
                    </div>
                </div>
                <MemoryComposer
                    repo={id}
                    project={project}
                    off={off}
                    className="2xl:col-start-1 2xl:row-start-2"
                />
            </div>
        </div>
    );
}
