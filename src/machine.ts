import { spawn } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { AGENT_SPECS, AGENTS, type AgentName } from "./agents.ts";
import { type Config, resolveBin } from "./config.ts";
import { runningJobs } from "./jobs.ts";
import { must, run } from "./proc.ts";
import { pauseWorker } from "./runner.ts";
import { agentLogins } from "./users.ts";

// The checkout OLIMP runs from.
export const ROOT = join(import.meta.dirname, "..");

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
    // Commits on origin that this checkout lacks, and its own commits origin lacks.
    behind: number;
    ahead: number;
    latest: { commit: string; subject: string; date: string } | null;
    error: string | null;
}

let lastCheck: UpdateCheck | null = null;

async function checkout() {
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

// Without a git checkout OLIMP cannot tell how it was installed, so it offers no update.
export async function version() {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    return { version: pkg.version, git: await checkout(), update: lastCheck, root: ROOT };
}

export async function checkUpdate(): Promise<UpdateCheck> {
    const at = new Date().toISOString();
    const current = await checkout();
    const failed = (error: string) => {
        lastCheck = { checkedAt: at, behind: 0, ahead: 0, latest: null, error };
        return lastCheck;
    };
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
        error: null,
    };
    return lastCheck;
}

const CHECK_EVERY_MS = 6 * 60 * 60_000;

export function startUpdateCheck(): () => void {
    const first = setTimeout(() => void checkUpdate(), 10_000);
    const timer = setInterval(() => void checkUpdate(), CHECK_EVERY_MS);
    return () => {
        clearTimeout(first);
        clearInterval(timer);
    };
}

export type UpdateRefusal = "busy" | "dirty" | "ahead" | "upToDate" | "notGit";

// Why OLIMP cannot update itself now, or null.
export async function updateRefusal(): Promise<UpdateRefusal | null> {
    const current = await checkout();
    if (!current || current.branch === "HEAD") return "notGit";
    if (current.dirty) return "dirty";
    if (runningJobs() > 0) return "busy";
    const check = await checkUpdate();
    if (check.error) return "notGit";
    if (check.ahead > 0) return "ahead";
    return check.behind > 0 ? null : "upToDate";
}

// Pulls origin's commits, installs and builds, then starts a copy of this process and exits.
// No job starts meanwhile; after a failed step the worker resumes and the checkout may be half
// updated. Undefined once the restart is under way.
export async function update(cfg: Config): Promise<UpdateRefusal | undefined> {
    pauseWorker(true);
    try {
        const refusal = await updateRefusal();
        if (refusal) {
            pauseWorker(false);
            return refusal;
        }
        const current = await checkout();
        const pnpm = await resolveBin("pnpm");
        await must("git", ["-C", ROOT, "pull", "--ff-only", "origin", current?.branch ?? "main"]);
        await must(pnpm, ["install", "--frozen-lockfile"], { cwd: ROOT });
        await must(pnpm, ["build"], { cwd: ROOT });
    } catch (error) {
        pauseWorker(false);
        throw error;
    }
    setTimeout(() => restart(cfg), 300);
    return undefined;
}

// The service's systemd starts the new version itself; otherwise a detached copy takes over, logging
// to OLIMP_HOME/olimp.log.
function restart(cfg: Config): void {
    if (process.env.OLIMP_SERVICE) process.exit(0);
    const log = openSync(join(cfg.home, "olimp.log"), "a");
    // The old process frees the port before the copy listens.
    spawn(
        "sh",
        [
            "-c",
            'sleep 2; exec "$0" "$@"',
            process.execPath,
            ...process.execArgv,
            ...process.argv.slice(1),
        ],
        { cwd: process.cwd(), env: process.env, detached: true, stdio: ["ignore", log, log] },
    ).unref();
    process.exit(0);
}
