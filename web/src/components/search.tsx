import { defaultFilter } from "cmdk";
import {
    CoinsIcon,
    FolderGit2Icon,
    FolderIcon,
    LayersIcon,
    LayoutDashboardIcon,
    PlusIcon,
    SearchIcon,
    WorkflowIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { StatusBadge } from "@/components/status-badge";
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { NEW_TASK, repoPages, SETTINGS, useCurrentRepo } from "@/lib/nav";
import { useRepos, useTasks } from "@/lib/queries";
import { keysOf, triggered, useKeyMap } from "@/lib/shortcuts";

const VIEWS = [
    { to: "/dashboard", key: "dashboard", Icon: LayoutDashboardIcon },
    { to: "/tasks", key: "allTasks", Icon: LayersIcon },
    { to: "/workflows", key: "workflows", Icon: WorkflowIcon },
    { to: "/costs", key: "costs", Icon: CoinsIcon },
] as const;

type Entry = {
    id: string;
    label: string;
    to: string;
    description?: string;
    icon?: ReactNode;
    badge?: ReactNode;
    shortcut?: string;
};

// The command palette: actions, views, settings, repositories and tasks, opened with its shortcut (Ctrl+K by default).
export function SearchMenu({ close }: { close: () => void }) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const current = useCurrentRepo();
    const repos = useRepos();
    const tasks = useTasks();
    const keyMap = useKeyMap();
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!triggered(e, "search")) return;
            e.preventDefault();
            setOpen((value) => !value);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);
    const groups: { heading: string; items: Entry[] }[] = [
        {
            heading: t("search.actions"),
            items: [
                {
                    id: "new-task",
                    label: t("nav.newTask"),
                    to: current ? `${NEW_TASK}?repo=${current}` : NEW_TASK,
                    icon: <PlusIcon />,
                    shortcut: keysOf(keyMap.newTask).join("+"),
                },
            ],
        },
        {
            heading: t("search.views"),
            items: [
                ...VIEWS.map(({ to, key, Icon }) => ({
                    id: to,
                    label: t(`nav.${key}`),
                    to,
                    icon: <Icon />,
                })),
                // The pages of the repository at hand.
                ...(current ? repoPages(current) : []).map(({ to, key, Icon }) => ({
                    id: to,
                    label: t(`nav.${key}`),
                    description: current ?? undefined,
                    to,
                    icon: <Icon />,
                })),
            ],
        },
        {
            heading: t("nav.generalSettings"),
            items: SETTINGS.map(({ key, Icon }) => ({
                id: `/settings/general/${key}`,
                label: t(`settings.${key}`),
                to: `/settings/general/${key}`,
                icon: <Icon />,
            })),
        },
        {
            heading: t("nav.projects"),
            items: (repos.data ?? []).map((repo) => ({
                id: `repo:${repo.id}`,
                label: repo.id,
                to: `/project/${repo.id}`,
                icon: repo.git ? <FolderGit2Icon /> : <FolderIcon />,
                shortcut: repo.defaultBranch,
            })),
        },
        {
            heading: t("nav.tasks"),
            items: (tasks.data ?? []).map((task) => ({
                id: `task:${task.id}`,
                label: task.title,
                description: task.repo,
                to: `/tasks/${task.id}`,
                badge: <StatusBadge status={task.status} />,
            })),
        },
    ].filter((group) => group.items.length > 0);
    const go = (to: string) => {
        setOpen(false);
        close();
        navigate(to);
    };
    return (
        <>
            <SidebarMenuButton
                variant="outline"
                tooltip={`${t("nav.search")} (${keysOf(keyMap.search).join("+")})`}
                onClick={() => setOpen(true)}
                className="text-sidebar-foreground/70"
            >
                <SearchIcon />
                <span>{t("nav.search")}</span>
                <KbdGroup className="ml-auto">
                    {keysOf(keyMap.search).map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                    ))}
                </KbdGroup>
            </SidebarMenuButton>
            <CommandDialog
                open={open}
                onOpenChange={setOpen}
                title={t("search.title")}
                description={t("search.description")}
            >
                {/* Only the label and description count: the id, a path, matched stray letters. */}
                <Command
                    filter={(_, search, words) => defaultFilter(words?.join(" ") ?? "", search)}
                >
                    <CommandInput placeholder={t("search.placeholder")} />
                    <CommandList>
                        <CommandEmpty>{t("search.empty")}</CommandEmpty>
                        {groups.map((group, index) => (
                            <Fragment key={group.heading}>
                                {index > 0 && <CommandSeparator />}
                                <CommandGroup heading={group.heading}>
                                    {group.items.map((item) => (
                                        // The id as value, since cmdk merges items with the same text.
                                        <CommandItem
                                            key={item.id}
                                            value={item.id}
                                            keywords={[item.label, item.description ?? ""]}
                                            onSelect={() => go(item.to)}
                                        >
                                            {item.icon}
                                            <span className="flex min-w-0 flex-col">
                                                <span className="truncate">{item.label}</span>
                                                {item.description && (
                                                    <span className="truncate text-xs text-muted-foreground">
                                                        {item.description}
                                                    </span>
                                                )}
                                            </span>
                                            {item.badge && (
                                                <span className="ml-auto">{item.badge}</span>
                                            )}
                                            {item.shortcut && (
                                                <CommandShortcut>{item.shortcut}</CommandShortcut>
                                            )}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </Fragment>
                        ))}
                    </CommandList>
                </Command>
            </CommandDialog>
        </>
    );
}
