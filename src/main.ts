import { realpathSync } from "node:fs";
import { createServer } from "node:net";
import { AGENTS } from "./agents.ts";
import { addFolder } from "./api/projects.ts";
import { createApi } from "./api.ts";
import { banner } from "./banner.ts";
import { EventBus, publishing } from "./bus.ts";
import { ensureSandbox } from "./clones.ts";
import type { Config } from "./config.ts";
import { loadConfig, publicHostProblem, resolveBin } from "./config.ts";
import { startAutoMerge } from "./github.ts";
import { HttpError } from "./http.ts";
import { t } from "./i18n.ts";
import { startIssuePoller } from "./issues.ts";
import { currentVersion, startUpdateCheck } from "./machine.ts";
import { loadMail } from "./mail.ts";
import { ensureUpkeep } from "./memory-upkeep.ts";
import { closeAllPreviews } from "./preview.ts";
import { killAgents } from "./proc.ts";
import { startWorker } from "./runner.ts";
import { parseAgentEnv } from "./sandbox.ts";
import { startScheduler } from "./scheduler.ts";
import { loadSettings } from "./settings.ts";
import { Store } from "./store.ts";
import { closeAllTerminals } from "./terminals.ts";
import { startEventPurge } from "./trace.ts";
import { tightenHomes } from "./users.ts";
import { startWaits } from "./workflow-runner.ts";

// Before the database: a second OLIMP on the same home would mark the first one's jobs interrupted.
const portFree = (port: number) =>
    new Promise<boolean>((resolve) => {
        const probe = createServer()
            .once("error", () => resolve(false))
            .listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });

// The repository OLIMP was started in (`cd my-repo && npx olimp-run`), unless it is a project.
async function openFolder(store: Store, cfg: Config, folder: string): Promise<string | null> {
    const real = (path: string) => {
        try {
            return realpathSync(path);
        } catch {
            return path;
        }
    };
    const known = (await store.repos()).find((repo) => repo.path && real(repo.path) === folder);
    if (known) return known.id;
    try {
        return (await addFolder(store, cfg, null, folder)).id;
    } catch (error) {
        const reason =
            error instanceof HttpError ? t("en", error.code, error.params) : String(error);
        console.warn(`${folder} is not a project: ${reason}`);
        return null;
    }
}

export async function start(folder: string | null = null): Promise<void> {
    const base = loadConfig();
    // In a terminal the facts wait for the banner; in a log each is a line as it comes.
    const tty = process.stdout.isTTY;
    const facts: [string, string][] = [];
    const info = (label: string, value: string) =>
        tty ? facts.push([label, value]) : console.log(`${label.toLowerCase()}: ${value}`);
    const missing = new Set<string>();
    // The agents but claude are optional: without one only the steps that use it fail.
    const optional = Object.fromEntries(
        await Promise.all(
            AGENTS.filter((agent) => agent !== "claude").map(async (agent) => {
                const bin = base[agent];
                const found = bin ? await resolveBin(bin).catch(() => null) : null;
                if (!found) missing.add(agent);
                if (!found && !tty)
                    console.warn(`${agent} not found (${bin}): steps on ${agent} will fail`);
                return [agent, found];
            }),
        ),
    );
    // claude and gh keep their name when missing: OLIMP starts, and what needs them fails saying so.
    const kept = (tool: "claude" | "gh", effect: string) =>
        resolveBin(base[tool]).catch(() => {
            missing.add(tool);
            console.warn(`${base[tool]} not found: ${effect}`);
            return base[tool];
        });
    const cfg = {
        ...base,
        ...optional,
        claude: await kept("claude", "steps on claude fail; pick another default agent"),
        gh: await kept("gh", "GitHub projects fail until the GitHub CLI is installed"),
    };
    const { refused } = parseAgentEnv(process.env.OLIMP_AGENT_ENV);
    if (refused.length)
        console.warn(
            `OLIMP_AGENT_ENV: not passed to agents (not a name or OLIMP's own): ${refused}`,
        );
    const taken = `port ${cfg.port} is taken, by another OLIMP perhaps (OLIMP_PORT picks another)`;
    if (!(await portFree(cfg.port))) {
        console.error(`OLIMP does not start: ${taken}`);
        process.exit(1);
    }
    tightenHomes(cfg);
    const opened = await Store.open(cfg).catch((error: Error) => {
        console.error(`OLIMP cannot open its database: ${error.message}`);
        process.exit(1);
    });
    const bus = new EventBus();
    const store = publishing(opened, bus);
    info("Database", store.description);
    const accounts = await store.hasUsers();
    const problem = publicHostProblem(cfg.publicHost, accounts);
    if (problem) {
        console.error(`OLIMP does not start: ${problem}`);
        process.exit(1);
    }
    info(
        "Accounts",
        accounts
            ? `every request needs a token${cfg.publicHost ? `; public host ${cfg.publicHost}` : ""}`
            : "none, the API trusts loopback",
    );
    info("Agent env", `allowed list${cfg.agentEnv.length ? ` and ${cfg.agentEnv}` : ""}`);
    await loadSettings(store, cfg);
    await loadMail(store, cfg);
    const interrupted = await store.failInterrupted();
    if (interrupted)
        console.warn(
            `${interrupted} task(s) or workflow run(s) interrupted by restart marked failed`,
        );
    const project = folder && (await openFolder(store, cfg, folder));
    if (project) info("Project", `${project}  ${folder}`);
    await ensureSandbox(store, cfg).catch((error) => console.error(`sandbox: ${error}`));
    for (const repo of await store.repos())
        await ensureUpkeep(store, repo).catch((error) =>
            console.error(`memory upkeep of ${repo.id}: ${error}`),
        );
    // Agents and terminals run in process groups of their own, so they would outlive OLIMP.
    for (const signal of ["SIGINT", "SIGTERM"] as const)
        process.on(signal, () => {
            killAgents();
            closeAllTerminals();
            closeAllPreviews();
            process.exit(128 + (signal === "SIGINT" ? 2 : 15));
        });
    createApi(store, cfg, bus)
        .once("error", (error: NodeJS.ErrnoException) => {
            if (error.code !== "EADDRINUSE") throw error;
            console.error(`OLIMP stops: ${taken}`);
            process.exit(1);
        })
        .listen(cfg.port, "127.0.0.1", () => {
            const url = `http://127.0.0.1:${cfg.port}`;
            if (!tty) {
                console.log(`OLIMP on ${url}, the panel and the API (data in ${cfg.home})`);
                return;
            }
            const agents = AGENTS.map((name) => ({ name, found: !missing.has(name) }));
            const panel = cfg.devPanel ?? url;
            const rows: [string, string][] = [
                ...(cfg.devPanel ? [["API", url] as [string, string]] : []),
                ["API docs", `${panel}/docs/api`],
                ["Data", cfg.home],
                ...facts,
            ];
            const { columns = 80 } = process.stdout;
            const depth = process.stdout.getColorDepth();
            console.log(
                banner({ version: currentVersion(), url: panel, rows, agents }, columns, depth),
            );
        });
    startWorker(store, cfg);
    startWaits(store, cfg);
    startScheduler(store);
    startIssuePoller(store, cfg);
    startAutoMerge(store, cfg);
    startEventPurge(store);
    startUpdateCheck();
}

if (import.meta.main) await start();
