import {
    BellIcon,
    BotIcon,
    BrainIcon,
    FileCogIcon,
    FolderIcon,
    FolderTreeIcon,
    GaugeIcon,
    GitBranchIcon,
    IdCardIcon,
    KeyboardIcon,
    KeyRoundIcon,
    ListChecksIcon,
    ListTodoIcon,
    MailIcon,
    NotebookPenIcon,
    PaletteIcon,
    PlugIcon,
    ScrollTextIcon,
    SettingsIcon,
    SlidersHorizontalIcon,
    SparklesIcon,
    UsersIcon,
    WebhookIcon,
    WorkflowIcon,
    ZapIcon,
} from "lucide-react";
import { useLocation, useSearchParams } from "react-router";

export const NEW_TASK = "/tasks/new";

// The project of the last task created in this browser, which the new task form starts with.
const LAST_REPO = "olimp.newTaskRepo";

export function lastRepo(): string | null {
    try {
        return localStorage.getItem(LAST_REPO);
    } catch {
        return null;
    }
}

export function rememberRepo(repo: string): void {
    try {
        localStorage.setItem(LAST_REPO, repo);
    } catch {}
}

// OLIMP keeps no secrets of the installation and sends nothing out, so there are no pages for them.
export const SETTINGS = [
    { key: "appearance", Icon: PaletteIcon },
    { key: "notifications", Icon: BellIcon },
    { key: "keyboard", Icon: KeyboardIcon },
    { key: "templates", Icon: NotebookPenIcon },
    { key: "instructions", Icon: ScrollTextIcon },
    { key: "resources", Icon: GaugeIcon },
    { key: "skills", Icon: SparklesIcon },
    { key: "agents", Icon: IdCardIcon },
    { key: "accounts", Icon: UsersIcon },
    { key: "mail", Icon: MailIcon },
    { key: "projects", Icon: FolderIcon },
] as const;

// A project's settings; GitHub issues are under Tasks. `path` is the address under /project/<id>/settings/.
export const REPO_SETTINGS = [
    { key: "general", path: "general", Icon: SlidersHorizontalIcon },
    { key: "secrets", path: "secrets", Icon: KeyRoundIcon },
    { key: "webhooks", path: "webhooks", Icon: WebhookIcon },
    { key: "integrations", path: "integrations", Icon: PlugIcon },
    { key: "agents", path: "agents", Icon: BotIcon },
    { key: "instructions", path: "instructions", Icon: ScrollTextIcon },
    { key: "tasks", path: "tasks", Icon: ListTodoIcon },
    { key: "agentConfig", path: "agent-config", Icon: FileCogIcon },
    { key: "worktrees", path: "worktrees", Icon: FolderTreeIcon },
] as const;

export type RepoSetting = (typeof REPO_SETTINGS)[number]["key"];

export const repoPages = (repo: string) =>
    [
        { to: `/project/${repo}`, key: "tasks", Icon: ListChecksIcon },
        { to: `/project/${repo}/memory`, key: "memory", Icon: BrainIcon },
        { to: `/project/${repo}/skills`, key: "skills", Icon: SparklesIcon },
        { to: `/project/${repo}/git`, key: "git", Icon: GitBranchIcon },
        { to: `/project/${repo}/automations`, key: "automations", Icon: ZapIcon },
        { to: `/workflows?repo=${repo}`, key: "workflows", Icon: WorkflowIcon },
        { to: `/project/${repo}/settings/general`, key: "settings", Icon: SettingsIcon },
    ] as const;

// The project a page is about: `?repo=` on a list, or a page under /project/<id>.
export function useCurrentRepo(): string | null {
    const { pathname } = useLocation();
    const [params] = useSearchParams();
    return params.get("repo") ?? pathname.match(/^\/project\/([^/]+)(?:\/|$)/)?.[1] ?? null;
}

// The new task's form with a project and a prompt filled in, e.g. from the Preview's picks.
export const newTaskWith = (repo: string, prompt: string) =>
    `/tasks/new?${new URLSearchParams({ repo, prompt })}`;
