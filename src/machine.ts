import { spawn } from "node:child_process";
import { openSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import { dirname, join, sep } from "node:path";
import { AGENT_SPECS, AGENTS, type AgentName } from "./agents.ts";
import { type Config, resolveBin } from "./config.ts";
import { runningJobs } from "./jobs.ts";
import { must, run } from "./proc.ts";
import { pauseWorker } from "./runner.ts";
import { agentLogins } from "./users.ts";

// The checkout or the npm package OLIMP runs from.
export const ROOT = join(import.meta.dirname, "..");
export const PACKAGE = "olimp-run";
// shortcut: npm's public registry only, make it configurable when someone installs from a mirror.
const REGISTRY = "https://registry.npmjs.org";
const GITHUB_REPO = "medialanpl/olimp";

const cpuTimes = () =>
    os.cpus().reduce(
        (sum, cpu) => {
            const { idle, ...busy } = cpu.times;
            sum.idle += idle;
            sum.total += idle + Object.values(busy).reduce((a, b) => a + b, 0);
            return sum;
        },
        { idle: 0, total: 0 },
    );

let lastCpu = cpuTimes();

// CPU use since the previous call (the panel asks every few seconds), or over a short sample.
async function cpuPercent(): Promise<number> {
    let before = lastCpu;
    let now = cpuTimes();
    if (now.total - before.total < 100) {
        before = now;
        await new Promise((resolve) => setTimeout(resolve, 250));
        now = cpuTimes();
    }
    lastCpu = now;
    const total = now.total - before.total;
    return total > 0 ? Math.round((1 - (now.idle - before.idle) / total) * 100) : 0;
}

export async function machine() {
    const total = os.totalmem();
    return {
        hostname: os.hostname(),
        user: os.userInfo().username,
        os: `${os.type()} ${os.release()}`,
        cores: os.availableParallelism(),
        cpu: await cpuPercent(),
        memory: { used: total - os.freemem(), total },
        load: os.loadavg(),
        uptime: Math.round(os.uptime()),
        olimp: {
            memory: process.memoryUsage().rss,
            uptime: Math.round(process.uptime()),
            running: runningJobs(),
        },
    };
}

// `owner` is the caller's account, whose logins these are: null for the installation's.
async function agentInfo(cfg: Config, agent: AgentName, owner: string | null) {
    const configured = cfg[agent];
    const bin = configured ? await resolveBin(configured).catch(() => null) : null;
    const [version, logins] = await Promise.all([
        bin ? run(bin, ["--version"], { timeoutMs: 10_000 }) : null,
        agentLogins(cfg, owner, agent),
    ]);
    const { label, install, configEnv, loginArgs, mcp, tokenEnv } = AGENT_SPECS[agent];
    // Other tools are called `copilot` too; GitHub's CLI answers --version with a version number.
    const foreign =
        agent === "copilot" &&
        (version?.code !== 0 || !/\d+\.\d+\.\d+/.test(`${version?.stdout}${version?.stderr}`));
    return {
        agent,
        label,
        // 127 is "command not found": a launcher left on PATH (e.g. an editor's shim) with no CLI.
        bin: version?.code === 127 || foreign ? null : bin,
        version: version?.code === 0 ? version.stdout.trim().split("\n")[0] || null : null,
        install,
        // The variable a second login sets; null when the agent has one login per HOME.
        configEnv,
        loginArgs,
        mcp,
        // Whether a login can take a token pasted in the panel.
        token: tokenEnv !== undefined,
        logins,
    };
}

export const agentsInfo = (cfg: Config, owner: string | null) =>
    Promise.all(AGENTS.map((a) => agentInfo(cfg, a, owner)));

const git = (args: string[], timeoutMs = 10_000) =>
    run("git", ["-C", ROOT, ...args], { timeoutMs });

export interface UpdateCheck {
    checkedAt: string;
    // Commits on origin that this checkout lacks, and its own commits origin lacks; from npm,
    // behind is 1 when npm has a newer version.
    behind: number;
    ahead: number;
    latest: { commit: string; subject: string; date: string } | null;
    // The newest version on npm, for an installation from npm.
    version: string | null;
    error: string | null;
}

// How OLIMP was installed decides how it updates: a checkout pulls origin, a global npm package
// installs the new version, npx starts it; a package inside another project does not update.
export type Install = "git" | "global" | "npx" | "package";

export function installKind(
    root: string,
    checkout: boolean,
    globalModules: string | null,
): Install {
    if (checkout) return "git";
    if (root.split(sep).includes("_npx")) return "npx";
    return globalModules !== null && dirname(root) === globalModules ? "global" : "package";
}

// Whether npm's version is newer than the running one; a pre-release counts as its release.
export function newerVersion(latest: string, current: string): boolean {
    const parts = (v: string) => (v.split("-")[0] ?? "").split(".").map((n) => Number(n) || 0);
    const [a, b] = [parts(latest), parts(current)];
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
    return false;
}

let installed: Promise<Install> | null = null;

export const install = (): Promise<Install> => {
    installed ??= (async () => {
        if (await checkout()) return "git";
        const npm = await run("npm", ["root", "-g"], { timeoutMs: 10_000 }).catch(() => null);
        const modules = npm?.code === 0 ? npm.stdout.trim() : "";
        let real: string | null = null;
        try {
            real = modules ? realpathSync(modules) : null;
        } catch {}
        return installKind(ROOT, false, real);
    })();
    return installed;
};

export const currentVersion = () =>
    (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version;

let lastCheck: UpdateCheck | null = null;
let stars: number | null = null;

async function checkout() {
    // A package inside a repository (another project's node_modules, the npx cache in a home kept
    // in git) is not OLIMP's checkout: updating it would pull that repository.
    const top = await git(["rev-parse", "--show-toplevel"]);
    if (top.code !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(ROOT)) return null;
    const head = await git(["rev-parse", "--short", "HEAD"]);
    if (head.code !== 0) return null;
    const [branch, date, status] = await Promise.all([
        git(["rev-parse", "--abbrev-ref", "HEAD"]),
        git(["log", "-1", "--format=%cI"]),
        git(["status", "--porcelain", "--untracked-files=no"]),
    ]);
    return {
        commit: head.stdout.trim(),
        branch: branch.stdout.trim(),
        date: date.stdout.trim(),
        dirty: status.stdout.trim() !== "",
    };
}

export async function version() {
    return {
        version: currentVersion(),
        install: await install(),
        git: await checkout(),
        update: lastCheck,
        stars,
        root: ROOT,
    };
}

async function checkNpm(at: string, failed: (error: string) => UpdateCheck): Promise<UpdateCheck> {
    const res = await fetch(`${REGISTRY}/${PACKAGE}/latest`, {
        signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!res?.ok)
        return failed(res ? `npm registry: HTTP ${res.status}` : "npm registry unreachable");
    const latest = String(((await res.json()) as { version?: unknown }).version ?? "");
    if (!latest) return failed("npm registry: no version");
    const behind = newerVersion(latest, currentVersion()) ? 1 : 0;
    lastCheck = { checkedAt: at, behind, ahead: 0, latest: null, version: latest, error: null };
    return lastCheck;
}

export async function checkUpdate(): Promise<UpdateCheck> {
    const at = new Date().toISOString();
    const failed = (error: string) => {
        lastCheck = { checkedAt: at, behind: 0, ahead: 0, latest: null, version: null, error };
        return lastCheck;
    };
    const kind = await install();
    if (kind === "global" || kind === "npx") return checkNpm(at, failed);
    const current = await checkout();
    if (!current) return failed("not a git checkout");
    if (current.branch === "HEAD") return failed("detached HEAD");
    const fetched = await git(["fetch", "--quiet", "origin", current.branch], 60_000);
    if (fetched.code !== 0)
        return failed(fetched.stderr.trim().split("\n").at(-1) || "git fetch failed");
    const upstream = `origin/${current.branch}`;
    const counts = await git(["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
    const [ahead = 0, behind = 0] = counts.stdout.trim().split(/\s+/).map(Number);
    const log = await git(["log", "-1", "--format=%h%x00%s%x00%cI", upstream]);
    const [commit = "", subject = "", date = ""] = log.stdout.trim().split("\0");
    lastCheck = {
        checkedAt: at,
        behind,
        ahead,
        latest: commit ? { commit, subject, date } : null,
        version: null,
        error: null,
    };
    return lastCheck;
}

async function checkStars() {
    const repo = (await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
        signal: AbortSignal.timeout(15_000),
    })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)) as { stargazers_count?: unknown } | null;
    if (typeof repo?.stargazers_count === "number") stars = repo.stargazers_count;
}

const CHECK_EVERY_MS = 6 * 60 * 60_000;

export function startUpdateCheck(): () => void {
    const check = () => {
        void checkUpdate();
        void checkStars();
    };
    const first = setTimeout(check, 10_000);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}

export type UpdateRefusal = "busy" | "dirty" | "ahead" | "upToDate" | "notGit";

// Why OLIMP cannot update itself now, or null.
export async function updateRefusal(): Promise<UpdateRefusal | null> {
    const kind = await install();
    if (kind === "global" || kind === "npx") {
        if (runningJobs() > 0) return "busy";
        const check = await checkUpdate();
        if (check.error) throw new Error(check.error);
        return check.behind > 0 ? null : "upToDate";
    }
    const current = await checkout();
    if (!current || current.branch === "HEAD") return "notGit";
    if (current.dirty) return "dirty";
    if (runningJobs() > 0) return "busy";
    const check = await checkUpdate();
    if (check.error) return "notGit";
    if (check.ahead > 0) return "ahead";
    return check.behind > 0 ? null : "upToDate";
}

// A checkout pulls origin's commits, installs and builds; a global package installs npm's newest
// version; then a copy of this process starts and this one exits (npx starts the new version).
// No job starts meanwhile; after a failed step the worker resumes and the checkout may be half
// updated. Undefined once the restart is under way.
export async function update(cfg: Config): Promise<UpdateRefusal | undefined> {
    pauseWorker(true);
    let command: string[] | undefined;
    try {
        const refusal = await updateRefusal();
        if (refusal) {
            pauseWorker(false);
            return refusal;
        }
        const kind = await install();
        const next = `${PACKAGE}@${lastCheck?.version}`;
        if (kind === "global") await must(await resolveBin("npm"), ["install", "-g", next]);
        else if (kind === "npx")
            command = [await resolveBin("npx"), "--yes", next, ...process.argv.slice(2)];
        else {
            const current = await checkout();
            const pnpm = await resolveBin("pnpm");
            await must("git", [
                "-C",
                ROOT,
                "pull",
                "--ff-only",
                "origin",
                current?.branch ?? "main",
            ]);
            await must(pnpm, ["install", "--frozen-lockfile"], { cwd: ROOT });
            await must(pnpm, ["build"], { cwd: ROOT });
        }
    } catch (error) {
        pauseWorker(false);
        throw error;
    }
    setTimeout(() => restart(cfg, command), 300);
    return undefined;
}

// The service's systemd starts the new version itself; otherwise a detached copy takes over, logging
// to OLIMP_HOME/olimp.log.
function restart(
    cfg: Config,
    command = [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
): void {
    if (process.env.OLIMP_SERVICE) process.exit(0);
    const log = openSync(join(cfg.home, "olimp.log"), "a");
    // The old process frees the port before the copy listens.
    spawn("sh", ["-c", 'sleep 2; exec "$0" "$@"', ...command], {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: ["ignore", log, log],
    }).unref();
    process.exit(0);
}
