import {
    closestCenter,
    DndContext,
    type DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    type UniqueIdentifier,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
    ArchiveIcon,
    CheckIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    CopyIcon,
    FolderGit2Icon,
    FolderIcon,
    GitPullRequestIcon,
    GripVerticalIcon,
    LayersIcon,
    LayoutDashboardIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    PinIcon,
    PlusIcon,
    SettingsIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { AddRepoMenu } from "@/components/add-repo";
import { EmptyState } from "@/components/empty-state";
import { LanguageSelect } from "@/components/language-select";
import { OlimpLogo } from "@/components/logo";
import { SearchMenu } from "@/components/search";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuAction,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    SidebarSeparator,
    SidebarTrigger,
    useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VersionDialog } from "@/components/version-dialog";
import { useAuth, useMe } from "@/lib/auth";
import { NEW_TASK, REPO_SETTINGS, repoPages, SETTINGS, useCurrentRepo } from "@/lib/nav";
import { inOrder } from "@/lib/order";
import {
    useArchive,
    useMachine,
    usePin,
    usePins,
    useRepos,
    useSettings,
    useTasks,
    useVersion,
} from "@/lib/queries";
import { prNumber, threadsOf } from "@/lib/reads";
import { triggered } from "@/lib/shortcuts";
import type { Repo, Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import symbol from "../../../docs/brand/olimp-symbol.svg";
import symbolReversed from "../../../docs/brand/olimp-symbol-reversed.svg";

const RECENT = 4;

const DOT: Record<TaskStatus, string> = {
    queued: "bg-muted-foreground/50",
    running: "bg-warning",
    done: "bg-constructive",
    failed: "bg-destructive",
    cancelled: "bg-muted-foreground/50",
};

// The level of the menu: null is the main one, {} the settings, with `repo` the project whose own
// settings are open there.
type Drill = null | { repo?: string };

function drillOf(pathname: string): Drill {
    const repo = pathname.match(/^\/project\/([^/]+)\/settings\//)?.[1];
    if (repo) return { repo };
    return pathname.startsWith("/settings/general/") ? {} : null;
}

// shortcut: kept per browser in localStorage, move to the account when one person uses several.
function useStoredList(key: string) {
    const [list, setList] = useState<string[]>(() => {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
            return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
        } catch {
            return [];
        }
    });
    const save = (next: string[]) => {
        localStorage.setItem(key, JSON.stringify(next));
        setList(next);
    };
    return [list, save] as const;
}

// C by default opens a new task.
function useNewTaskShortcut(to: string) {
    const navigate = useNavigate();
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (triggered(e, "newTask")) navigate(to);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [navigate, to]);
}

// The lockup when the sidebar is open, the symbol when it is folded; the reversed files on dark.
function Logo() {
    return (
        <>
            <OlimpLogo className="h-12 group-data-[collapsible=icon]:hidden" />
            <img
                src={symbol}
                alt=""
                className="hidden size-9 group-data-[collapsible=icon]:block dark:group-data-[collapsible=icon]:hidden"
            />
            <img
                src={symbolReversed}
                alt=""
                className="hidden size-9 dark:group-data-[collapsible=icon]:block"
            />
        </>
    );
}

function ListLabel({ children }: { children: ReactNode }) {
    return (
        <li className="px-2 pt-2 pb-0.5 text-[0.65rem] font-medium tracking-wide text-sidebar-foreground/50 uppercase">
            {children}
        </li>
    );
}

function RecentTask({ task, pinned, close }: { task: Task; pinned: boolean; close: () => void }) {
    const t = useTranslations("web");
    const { pathname } = useLocation();
    const pin = usePin();
    const archive = useArchive();
    const finished = task.status !== "queued" && task.status !== "running";
    const action =
        "flex size-5 items-center justify-center rounded-sm text-sidebar-foreground/60 opacity-0 ring-sidebar-ring outline-hidden group-hover/task:opacity-100 group-focus-within/task:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 [@media(hover:none)]:opacity-100 [&_svg]:size-3.5";
    return (
        <SidebarMenuSubItem className="group/task">
            <Tooltip>
                <TooltipTrigger asChild className="gap-1">
                    <SidebarMenuSubButton
                        asChild
                        size="sm"
                        isActive={pathname === `/tasks/${task.id}`}
                        className="group-hover/task:pr-12 group-focus-within/task:pr-12 [@media(hover:none)]:pr-12"
                    >
                        <Link to={`/tasks/${task.id}`} onClick={close}>
                            <span
                                className={cn("size-1.5 shrink-0 rounded-full", DOT[task.status])}
                            />
                            {pinned && (
                                <PinIcon className="size-3! shrink-0 fill-current opacity-70" />
                            )}
                            <span className="truncate">{task.title}</span>
                            {task.prUrl && (
                                <span className="ml-auto flex shrink-0 items-center gap-0.5 font-mono text-[0.7rem] text-info">
                                    <GitPullRequestIcon aria-hidden="true" className="size-3" />
                                    <span className="sr-only">{t("fields.pr")}</span>
                                    {prNumber(task.prUrl) && `#${prNumber(task.prUrl)}`}
                                </span>
                            )}
                        </Link>
                    </SidebarMenuSubButton>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-80">
                    {task.title}
                </TooltipContent>
            </Tooltip>
            <span className="absolute top-1/2 right-1 flex -translate-y-1/2">
                <button
                    type="button"
                    aria-label={t(pinned ? "task.unpin" : "task.pin")}
                    title={t(pinned ? "task.unpin" : "task.pin")}
                    disabled={pin.isPending}
                    onClick={() => pin.mutate({ id: task.id, pinned: !pinned })}
                    className={cn(action, pinned && "[&_svg]:fill-current")}
                >
                    <PinIcon />
                </button>
                {finished && (
                    <button
                        type="button"
                        aria-label={t("task.archive")}
                        title={t("task.archive")}
                        disabled={archive.isPending}
                        onClick={() => archive.mutate({ id: task.id, archived: true })}
                        className={action}
                    >
                        <ArchiveIcon />
                    </button>
                )}
            </span>
        </SidebarMenuSubItem>
    );
}

function RepoItem({
    repo,
    position,
    count,
    open,
    onToggle,
    close,
}: {
    repo: Repo;
    position: number;
    count: number;
    open: boolean;
    onToggle: () => void;
    close: () => void;
}) {
    const t = useTranslations("web");
    const { pathname } = useLocation();
    const current = useCurrentRepo();
    const tasks = useTasks();
    const pins = usePins();
    const sortable = useSortable({ id: repo.id });
    const threads = threadsOf(tasks.data ?? []).filter(
        (task) => task.repo === repo.id && !task.archivedAt,
    );
    // Pinned tasks on top, in the order they were pinned, then the latest few.
    const pinned = (pins.data ?? []).flatMap((id) => threads.filter((task) => task.id === id));
    const rest = threads.filter((task) => !pinned.includes(task));
    const items = repoPages(repo.id);
    const reorder = t("nav.reorder", { repo: repo.id, position: position + 1, count });
    return (
        <SidebarMenuItem
            ref={sortable.setNodeRef}
            style={{
                transform: CSS.Translate.toString(sortable.transform),
                transition: sortable.transition,
            }}
            className={cn(sortable.isDragging && "z-10 opacity-60")}
        >
            <button
                type="button"
                ref={sortable.setActivatorNodeRef}
                {...sortable.attributes}
                {...sortable.listeners}
                aria-label={reorder}
                title={reorder}
                className="absolute top-0 -left-4 flex h-8 w-4 cursor-grab touch-none items-center justify-center rounded-sm text-sidebar-foreground/50 opacity-0 ring-sidebar-ring outline-hidden group-has-[>[data-sidebar=menu-button]:hover]/menu-item:opacity-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 active:cursor-grabbing group-data-[collapsible=icon]:hidden [@media(hover:none)]:opacity-100"
            >
                <GripVerticalIcon className="size-3" />
            </button>
            <SidebarMenuButton asChild isActive={current === repo.id} tooltip={repo.id}>
                <Link to={`/project/${repo.id}`} onClick={close} title={repo.id}>
                    {repo.git ? (
                        <FolderGit2Icon className="text-brand" />
                    ) : (
                        <FolderIcon className="text-brand" />
                    )}
                    <span className="truncate font-medium">{repo.id}</span>
                    <span className="ml-auto font-mono text-[0.7rem] text-sidebar-foreground/60">
                        {repo.defaultBranch}
                    </span>
                </Link>
            </SidebarMenuButton>
            <SidebarMenuAction
                onClick={onToggle}
                aria-expanded={open}
                aria-label={t(open ? "nav.collapse" : "nav.expand", { repo: repo.id })}
            >
                <ChevronRightIcon className={cn("transition-transform", open && "rotate-90")} />
            </SidebarMenuAction>
            {open && (
                <SidebarMenuSub>
                    {items.map(({ to, key, Icon }) => (
                        <SidebarMenuSubItem key={key}>
                            <SidebarMenuSubButton
                                asChild
                                isActive={
                                    current === repo.id &&
                                    (pathname === to.split("?")[0] ||
                                        (key !== "tasks" && pathname.startsWith(`${to}/`)))
                                }
                            >
                                <Link to={to} onClick={close}>
                                    <Icon />
                                    <span>{t(`nav.${key}`)}</span>
                                </Link>
                            </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                    ))}
                    {pinned.length > 0 && <ListLabel>{t("nav.pinned")}</ListLabel>}
                    {pinned.map((task) => (
                        <RecentTask key={task.id} task={task} pinned close={close} />
                    ))}
                    {rest.length > 0 && <ListLabel>{t("nav.recent")}</ListLabel>}
                    {rest.slice(0, RECENT).map((task) => (
                        <RecentTask key={task.id} task={task} pinned={false} close={close} />
                    ))}
                    {rest.length > RECENT && (
                        <SidebarMenuSubItem>
                            <SidebarMenuSubButton asChild size="sm">
                                <Link
                                    to={`/project/${repo.id}`}
                                    onClick={close}
                                    className="text-sidebar-foreground/70"
                                >
                                    <span>{t("nav.more")}</span>
                                </Link>
                            </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                    )}
                </SidebarMenuSub>
            )}
        </SidebarMenuItem>
    );
}

// Sortable projects: the grip drags by mouse, touch and keyboard, the others make room.
function RepoTree({ close }: { close: () => void }) {
    const t = useTranslations("web");
    const repos = useRepos();
    const [order, setOrder] = useStoredList("olimp.repoOrder");
    const [collapsed, setCollapsed] = useStoredList("olimp.repoCollapsed");
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const group = useRef<HTMLDivElement>(null);
    // A scroll-driven fade keeps its old state after the list changes height until the next scroll.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the restart is what a collapse triggers
    useLayoutEffect(() => {
        const content = group.current?.closest<HTMLElement>("[data-slot=sidebar-content]");
        if (!content) return;
        content.style.animation = "none";
        void content.offsetHeight;
        content.style.animation = "";
    }, [collapsed]);
    if (!repos.data) return null;
    if (!repos.data.length)
        return (
            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
                <SidebarGroupLabel>{t("nav.projects")}</SidebarGroupLabel>
                <EmptyState
                    icon={<FolderGit2Icon />}
                    title={t("repos.emptyTitle")}
                    description={t("repos.empty")}
                    className="p-4 [&_.empty-glass-glow]:hidden"
                >
                    <AddRepoMenu onAdded={close} />
                </EmptyState>
            </SidebarGroup>
        );
    const ids = inOrder(repos.data, order).map((repo) => repo.id);
    const ordered = inOrder(repos.data, ids);
    const place = (id: UniqueIdentifier) => ({
        repo: String(id),
        position: ids.indexOf(String(id)) + 1,
        count: ids.length,
    });
    const onDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        setOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
    };
    return (
        <SidebarGroup ref={group}>
            <SidebarGroupLabel asChild>
                <Link
                    to="/settings/general/projects"
                    onClick={close}
                    className="hover:text-sidebar-foreground"
                >
                    {t("nav.projects")}
                </Link>
            </SidebarGroupLabel>
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={onDragEnd}
                accessibility={{
                    screenReaderInstructions: { draggable: t("nav.dragHint") },
                    announcements: {
                        onDragStart: ({ active }) => t("nav.dragStart", place(active.id)),
                        onDragOver: ({ active, over }) =>
                            over
                                ? t("nav.dragOver", { ...place(over.id), repo: String(active.id) })
                                : undefined,
                        onDragEnd: ({ active, over }) =>
                            over
                                ? t("nav.dragEnd", { ...place(over.id), repo: String(active.id) })
                                : t("nav.dragCancel", { repo: String(active.id) }),
                        onDragCancel: ({ active }) =>
                            t("nav.dragCancel", { repo: String(active.id) }),
                    },
                }}
            >
                <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                    <SidebarMenu>
                        {ordered.map((repo, position) => (
                            <RepoItem
                                key={repo.id}
                                repo={repo}
                                position={position}
                                count={ordered.length}
                                open={!collapsed.includes(repo.id)}
                                onToggle={() =>
                                    setCollapsed(
                                        collapsed.includes(repo.id)
                                            ? collapsed.filter((id) => id !== repo.id)
                                            : [...collapsed, repo.id],
                                    )
                                }
                                close={close}
                            />
                        ))}
                    </SidebarMenu>
                </SortableContext>
            </DndContext>
        </SidebarGroup>
    );
}

// The installation's data folder, on a line of its own; a click copies it.
function StoredIn({ home }: { home: string }) {
    const t = useTranslations("web");
    const [copied, setCopied] = useState(false);
    const copy = () =>
        void navigator.clipboard.writeText(home).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    return (
        <div className="px-2 pt-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <p>{t("nav.storedIn")}</p>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        onClick={copy}
                        className="flex w-full min-w-0 items-center gap-1 rounded-sm text-left font-mono outline-hidden hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                    >
                        <span className="truncate">{home}</span>
                        {copied ? (
                            <CheckIcon className="size-3 shrink-0" />
                        ) : (
                            <CopyIcon className="size-3 shrink-0 opacity-60" />
                        )}
                    </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-96 break-all">
                    <p className="font-mono">{home}</p>
                    <p className="opacity-70">{t(copied ? "nav.pathCopied" : "nav.copyPath")}</p>
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

// One project under the settings: a row that folds its own sections out in place.
function ProjectSettings({
    repo,
    open,
    onToggle,
    close,
}: {
    repo: Repo;
    open: boolean;
    onToggle: () => void;
    close: () => void;
}) {
    const t = useTranslations("web");
    const { pathname } = useLocation();
    const current = pathname.startsWith(`/project/${repo.id}/settings/`);
    return (
        <SidebarMenuItem>
            <SidebarMenuButton
                onClick={onToggle}
                aria-expanded={open}
                isActive={current && !open}
                title={repo.id}
            >
                {repo.git ? (
                    <FolderGit2Icon className="text-brand" />
                ) : (
                    <FolderIcon className="text-brand" />
                )}
                <span className="truncate font-medium">{repo.id}</span>
                <ChevronRightIcon
                    className={cn("ml-auto transition-transform", open && "rotate-90")}
                />
            </SidebarMenuButton>
            {open && (
                <SidebarMenuSub aria-label={t("nav.settingsOf", { repo: repo.id })}>
                    {REPO_SETTINGS.map(({ key, path, Icon }) => {
                        const to = `/project/${repo.id}/settings/${path}`;
                        return (
                            <SidebarMenuSubItem key={key}>
                                <SidebarMenuSubButton asChild isActive={pathname === to}>
                                    <Link to={to} onClick={close}>
                                        <Icon />
                                        <span>{t(`projectSettings.${key}`)}</span>
                                    </Link>
                                </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                        );
                    })}
                </SidebarMenuSub>
            )}
        </SidebarMenuItem>
    );
}

// The settings level replaces the menu, Back in the header returns to it. The projects fold out
// under the general settings, the one whose page is open unfolded.
function SettingsNav({ repo, close }: { repo?: string; close: () => void }) {
    const t = useTranslations("web");
    const { pathname } = useLocation();
    const home = useSettings().data?.home;
    const repos = useRepos().data;
    const [open, setOpen] = useState<string[]>(repo ? [repo] : []);
    const [openFor, setOpenFor] = useState(repo);
    if (openFor !== repo) {
        setOpenFor(repo);
        if (repo && !open.includes(repo)) setOpen([...open, repo]);
    }
    const toggle = (id: string) =>
        setOpen(open.includes(id) ? open.filter((o) => o !== id) : [...open, id]);
    return (
        <>
            <SidebarGroup>
                <SidebarGroupLabel>{t("nav.generalSettings")}</SidebarGroupLabel>
                <SidebarMenu>
                    {SETTINGS.map(({ key, Icon }) => {
                        const to = `/settings/general/${key}`;
                        return (
                            <SidebarMenuItem key={key}>
                                <SidebarMenuButton
                                    asChild
                                    isActive={pathname === to}
                                    tooltip={t(`settings.${key}`)}
                                >
                                    <Link to={to} onClick={close}>
                                        <Icon />
                                        <span>{t(`settings.${key}`)}</span>
                                    </Link>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        );
                    })}
                </SidebarMenu>
                {home && <StoredIn home={home} />}
            </SidebarGroup>
            {!!repos?.length && (
                <SidebarGroup className="group-data-[collapsible=icon]:hidden">
                    <SidebarGroupLabel>{t("nav.projectSettings")}</SidebarGroupLabel>
                    <SidebarMenu>
                        {repos.map((r) => (
                            <ProjectSettings
                                key={r.id}
                                repo={r}
                                open={open.includes(r.id)}
                                onToggle={() => toggle(r.id)}
                                close={close}
                            />
                        ))}
                    </SidebarMenu>
                </SidebarGroup>
            )}
            {/* Folded to icons the projects have no room: the open one's sections stay as icons. */}
            {repo && (
                <SidebarGroup className="hidden border-t group-data-[collapsible=icon]:flex">
                    <SidebarMenu>
                        {REPO_SETTINGS.map(({ key, path, Icon }) => {
                            const to = `/project/${repo}/settings/${path}`;
                            return (
                                <SidebarMenuItem key={key}>
                                    <SidebarMenuButton
                                        asChild
                                        isActive={pathname === to}
                                        tooltip={`${repo}: ${t(`projectSettings.${key}`)}`}
                                    >
                                        <Link to={to} onClick={close}>
                                            <Icon />
                                            <span>{t(`projectSettings.${key}`)}</span>
                                        </Link>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            );
                        })}
                    </SidebarMenu>
                </SidebarGroup>
            )}
        </>
    );
}

const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("");

// Corivo's user menu: the account (without accounts, the machine OLIMP trusts), the version, the
// language and theme, signing out.
function AccountMenu({ close }: { close: () => void }) {
    const t = useTranslations("web");
    const me = useMe();
    const { signOut } = useAuth();
    const { isMobile } = useSidebar();
    const machine = useMachine(false).data;
    const version = useVersion().data;
    const [versionOpen, setVersionOpen] = useState(false);
    const name = me ? me.name : (machine?.user ?? t("header.machine"));
    const updates = (version?.update?.behind ?? 0) > 0;
    return (
        <>
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                        size="lg"
                        tooltip={name}
                        className="min-w-0 flex-1 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    >
                        <Avatar className="relative overflow-visible">
                            <AvatarFallback>
                                {me ? initials(me.name) : <MonitorIcon className="size-4" />}
                            </AvatarFallback>
                            {updates && (
                                <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-2 ring-sidebar" />
                            )}
                        </Avatar>
                        <span className="grid flex-1 text-left text-sm leading-tight">
                            <span className="truncate font-medium">{name}</span>
                            <span className="truncate text-xs text-muted-foreground">
                                {me
                                    ? t(`header.role.${me.role}`)
                                    : machine
                                      ? t("header.onMachine", { host: machine.hostname })
                                      : t("header.open")}
                            </span>
                        </span>
                        <MoreHorizontalIcon className="ml-auto" />
                    </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                    side={isMobile ? "bottom" : "top"}
                    align="start"
                    sideOffset={4}
                    collisionPadding={8}
                >
                    <DropdownMenuItem asChild className="text-muted-foreground">
                        <Link to="/settings/general/accounts" onClick={close}>
                            {me ? t("header.account") : t("header.accounts")}
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="text-muted-foreground">
                        <Link to="/settings/general/resources" onClick={close}>
                            {t("header.machineSettings")}
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setVersionOpen(true)}>
                        <span className="flex-1">
                            OLIMP {version ? `v${version.version}` : ""}
                            {version?.git && (
                                <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                                    {version.git.commit}
                                </span>
                            )}
                        </span>
                        {updates && (
                            <Badge variant="info" className="ml-2">
                                {t("header.update")}
                            </Badge>
                        )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="space-y-2 px-1 py-1.5">
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm text-muted-foreground">
                                {t("header.language")}
                            </span>
                            <LanguageSelect className="w-32" />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm text-muted-foreground">
                                {t("header.theme")}
                            </span>
                            <ThemeToggle />
                        </div>
                    </div>
                    {me && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={signOut}>
                                {t("header.signOut")}
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <VersionDialog open={versionOpen} onOpenChange={setVersionOpen} />
        </>
    );
}

export function AppSidebar() {
    const t = useTranslations("web");
    const { pathname } = useLocation();
    const current = useCurrentRepo();
    const { setOpenMobile, state } = useSidebar();
    // On a phone the sidebar is a sheet over the page: a click on a link closes it.
    const close = () => setOpenMobile(false);
    const newTask = current ? `${NEW_TASK}?repo=${current}` : NEW_TASK;
    useNewTaskShortcut(newTask);
    // The menu opens on the level of the current page and follows navigation, as in the kit.
    const [drill, setDrill] = useState(() => drillOf(pathname));
    const [drillFor, setDrillFor] = useState(pathname);
    if (drillFor !== pathname) {
        setDrillFor(pathname);
        setDrill(drillOf(pathname));
    }
    const header = useRef<HTMLDivElement>(null);
    const drillTo = (next: Drill) => {
        // The clicked button leaves with its level, so focus goes to the first button of the new one.
        flushSync(() => setDrill(next));
        header.current?.querySelector<HTMLElement>("[data-sidebar=menu-button]")?.focus();
    };
    return (
        <Sidebar variant="inset" collapsible="icon" mobileCloseLabel={t("common.close")}>
            <SidebarHeader ref={header}>
                <Link
                    to="/dashboard"
                    onClick={close}
                    aria-label="OLIMP"
                    className="flex h-10 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                >
                    <Logo />
                </Link>
                <SidebarMenu>
                    {drill ? (
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                tooltip={t("nav.back")}
                                onClick={() => drillTo(null)}
                            >
                                <ChevronLeftIcon />
                                <span>{t("nav.back")}</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    ) : (
                        <SidebarMenuItem className="flex items-center gap-2">
                            <SidebarMenuButton
                                asChild
                                variant="active"
                                isActive={pathname === NEW_TASK}
                                tooltip={`${t("nav.newTask")} (C)`}
                                className="relative justify-center font-medium"
                            >
                                <Link to={newTask} onClick={close}>
                                    <PlusIcon />
                                    <span className="group-data-[collapsible=icon]:hidden">
                                        {t("nav.newTask")}
                                    </span>
                                </Link>
                            </SidebarMenuButton>
                            <AddRepoMenu compact onAdded={close} />
                        </SidebarMenuItem>
                    )}
                </SidebarMenu>
                {!drill && (
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                asChild
                                isActive={pathname === "/dashboard"}
                                tooltip={t("nav.dashboard")}
                            >
                                <Link to="/dashboard" onClick={close}>
                                    <LayoutDashboardIcon className="text-brand" />
                                    <span>{t("nav.dashboard")}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                asChild
                                isActive={pathname === "/tasks"}
                                tooltip={t("nav.allTasks")}
                            >
                                <Link to="/tasks" onClick={close}>
                                    <LayersIcon className="text-brand" />
                                    <span>{t("nav.allTasks")}</span>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                )}
            </SidebarHeader>
            {/* Edge to edge: the inset frame pads the sidebar. */}
            {!drill && <SidebarSeparator className="mx-0 group-data-[variant=inset]:-mx-2" />}
            {/* Only the repositories scroll. The fade reaches full size within half the scroll, as on the infra panel's
                long list, and the content reaches the frame's edges so its clip spares the reorder handles. */}
            {/* A new level or a collapse remounts the list, so it starts at the top with the fade reset. */}
            <SidebarContent
                key={`${state}:${drill ? "settings" : "repos"}`}
                className="[--scroll-fade-reveal:min(calc(var(--spacing)*24),50%)] group-data-[variant=inset]:-mx-2 group-data-[variant=inset]:px-2"
            >
                {drill ? (
                    <SettingsNav repo={drill.repo} close={close} />
                ) : (
                    <RepoTree close={close} />
                )}
            </SidebarContent>
            <SidebarFooter>
                <SidebarMenu className="space-y-2">
                    <SidebarMenuItem>
                        <SearchMenu close={close} />
                    </SidebarMenuItem>
                    <SidebarMenuItem className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
                        <AccountMenu close={close} />
                        <SidebarMenuButton
                            asChild
                            tooltip={t("nav.generalSettings")}
                            isActive={!!drill}
                            className="size-8 shrink-0 justify-center"
                        >
                            {/* setDrill too: on Appearance already, after Back, the path stays the same. */}
                            <Link
                                to="/settings/general/appearance"
                                aria-label={t("nav.generalSettings")}
                                onClick={() => {
                                    setDrill({});
                                    close();
                                }}
                            >
                                <SettingsIcon />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarFooter>
            {/* On the edge between the sidebar and the page; collapsed, the page sits 0.5rem further. */}
            <SidebarTrigger className="absolute top-5 -right-3 z-30 hidden size-6 rounded-full border bg-background shadow-sm hover:bg-muted lg:inline-flex group-data-[collapsible=icon]:-right-4 [&_svg:not([class*='size-'])]:size-3.5" />
        </Sidebar>
    );
}
