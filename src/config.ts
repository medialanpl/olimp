import { homedir } from "node:os";
import { join } from "node:path";
import { must } from "./proc.ts";
import { parseAgentEnv } from "./sandbox.ts";
import { type Settings, settingsOf } from "./settings.ts";
import { WEB_DIR } from "./web.ts";

export interface Config {
    home: string;
    // mysql://user:password@host:port/database; null keeps SQLite in `home`.
    databaseUrl: string | null;
    port: number;
    // The agents' binaries: claude is required, the others are optional (null when not found).
    claude: string;
    codex: string | null;
    junie: string | null;
    opencode: string | null;
    cursor: string | null;
    pi: string | null;
    copilot: string | null;
    gh: string;
    taskTimeoutMs: number;
    // How long a Claude run that lost its login refresh to another Claude process waits to retry.
    loginRaceWaitMs: number;
    // How many tasks and workflow runs work at once.
    maxParallel: number;
    // Names from OLIMP_AGENT_ENV passed to every agent besides the allowed environment.
    agentEnv: string[];
    // The host name a TLS proxy forwards to the API with, accepted only while accounts exist.
    publicHost: string | null;
    // The built web panel; without its index.html the API serves no panel.
    webDir: string;
    // `pnpm dev`'s Vite server: the panel's pages go there instead of the build, which may be old.
    devPanel: string | null;
    // Where cloned and new repositories get their folders.
    projectsDir: string;
    // The folder the panel's folder picker starts in and cannot leave.
    browseRoot: string;
    // smtp(s)://user:password@host:port for invitations, password resets and sign-in codes;
    // null sends no e-mail.
    smtpUrl: string | null;
    mailFrom: string | null;
    // The two as the environment gives them, before a mail server saved in the panel.
    mailEnv: { smtpUrl: string | null; mailFrom: string | null };
    // skills.sh, whose search the panel offers when adding skill sources.
    skillsSearchUrl: string;
    // The HOME of agents that run without an account, where their own and claude.ai skills are.
    installationHome: string;
    // The settings as the environment gives them, before the ones saved in the panel.
    defaults: Settings;
}

// A host name, optionally with a port, as the proxy passes it in the Host header.
export const isHostName = (value: string) =>
    /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/.test(value);

// Why OLIMP must not start with this public host, or null. Without accounts nothing asks for a
// token, so the API must stay unreachable from outside.
export function publicHostProblem(publicHost: string | null, accounts: boolean): string | null {
    if (!publicHost) return null;
    if (!isHostName(publicHost))
        return `OLIMP_PUBLIC_HOST must be a host name, optionally with :port, not ${publicHost}`;
    if (!accounts)
        return (
            `OLIMP_PUBLIC_HOST is set but there are no accounts, so the API would answer anyone ` +
            "through the proxy: create the first account on 127.0.0.1 (POST /api/users) without " +
            "OLIMP_PUBLIC_HOST, then set it again"
        );
    return null;
}

// The agent runs inside the task's worktree, where the repository's own toolchain file (e.g. a
// mise.toml pinning another Node) would redirect a version-manager shim; resolve binaries once, from home.
export async function resolveBin(name: string): Promise<string> {
    if (name.includes("/")) return name;
    const cwd = homedir();
    const found = await must("sh", ["-c", 'command -v "$0"', name], { cwd });
    return found.includes("/mise/shims/") ? must("mise", ["which", name], { cwd }) : found;
}

export const expandHome = (path: string) =>
    path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
    const home = env.OLIMP_HOME ?? join(homedir(), ".olimp");
    const cfg = {
        home,
        databaseUrl: env.OLIMP_DATABASE_URL || null,
        port: Number(env.OLIMP_PORT ?? 4850),
        claude: env.OLIMP_CLAUDE ?? "claude",
        codex: env.OLIMP_CODEX ?? "codex",
        junie: env.OLIMP_JUNIE ?? "junie",
        opencode: env.OLIMP_OPENCODE ?? "opencode",
        cursor: env.OLIMP_CURSOR ?? "cursor-agent",
        pi: env.OLIMP_PI ?? "pi",
        copilot: env.OLIMP_COPILOT ?? "copilot",
        gh: env.OLIMP_GH ?? "gh",
        taskTimeoutMs: Number(env.OLIMP_TASK_TIMEOUT_MIN ?? 30) * 60_000,
        loginRaceWaitMs: 60_000,
        maxParallel: Number(env.OLIMP_MAX_PARALLEL ?? 1),
        agentEnv: parseAgentEnv(env.OLIMP_AGENT_ENV).names,
        publicHost: env.OLIMP_PUBLIC_HOST?.trim().toLowerCase() || null,
        webDir: WEB_DIR,
        devPanel: env.OLIMP_DEV_PANEL || null,
        projectsDir: expandHome(env.OLIMP_PROJECTS || join(home, "projects")),
        browseRoot: expandHome(env.OLIMP_BROWSE_ROOT || homedir()),
        smtpUrl: env.OLIMP_SMTP_URL || null,
        mailFrom: env.OLIMP_MAIL_FROM || null,
        mailEnv: { smtpUrl: env.OLIMP_SMTP_URL || null, mailFrom: env.OLIMP_MAIL_FROM || null },
        skillsSearchUrl: env.OLIMP_SKILLS_SEARCH_URL || "https://skills.sh",
        installationHome: env.HOME || homedir(),
    };
    return { ...cfg, defaults: settingsOf(cfg) };
}

// Where links in e-mails lead: the TLS proxy's host once accounts allow it, else loopback.
export const publicUrl = (cfg: Pick<Config, "publicHost" | "port">) =>
    cfg.publicHost ? `https://${cfg.publicHost}` : `http://127.0.0.1:${cfg.port}`;
