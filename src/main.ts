import { realpathSync } from "node:fs";
import { createServer } from "node:net";
import { AGENTS } from "./agents.ts";
import { addFolder } from "./api/projects.ts";
import { createApi } from "./api.ts";
import { EventBus, publishing } from "./bus.ts";
import { ensureSandbox } from "./clones.ts";
import type { Config } from "./config.ts";
import { loadConfig, publicHostProblem, resolveBin } from "./config.ts";
import { startAutoMerge } from "./github.ts";
import { HttpError } from "./http.ts";
import { t } from "./i18n.ts";
import { startIssuePoller } from "./issues.ts";
import { startUpdateCheck } from "./machine.ts";
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
import { startWaits } from "./workflow-runner.ts";

// Before the database: a second OLIMP on the same home would mark the first one's jobs interrupted.
const portFree = (port: number) =>
    new Promise<boolean>((resolve) => {
        const probe = createServer()
            .once("error", () => resolve(false))
            .listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
    });

// The repository OLIMP was started in (`cd my-repo && npx olimp-run`), unless it is a project.
async function openFolder(store: Store, cfg: Config, folder: string): Promise<void> {
    const real = (path: string) => {
        try {
            return realpathSync(path);
        } catch {
            return path;
        }
    };
    if ((await store.repos()).some((repo) => repo.path && real(repo.path) === folder)) return;
    try {
        const repo = await addFolder(store, cfg, null, folder);
        console.log(`project ${repo.id}: ${folder}`);
    } catch (error) {
        const reason =
            error instanceof HttpError ? t("en", error.code, error.params) : String(error);
        console.warn(`${folder} is not a project: ${reason}`);
    }
}

export async function start(folder: string | null = null): Promise<void> {
    const base = loadConfig();
    // The agents but claude are optional: without one only the steps that use it fail.
    const optional = Object.fromEntries(
        await Promise.all(
            AGENTS.filter((agent) => agent !== "claude").map(async (agent) => {
                const bin = base[agent];
                const found = bin ? await resolveBin(bin).catch(() => null) : null;
                if (!found)
                    console.warn(`${agent} not found (${bin}): steps on ${agent} will fail`);
                return [agent, found];
            }),
        ),
    );
    // claude and gh keep their name when missing: OLIMP starts, and what needs them fails saying so.
    const kept = (name: string, effect: string) =>
        resolveBin(name).catch(() => {
            console.warn(`${name} not found: ${effect}`);
            return name;
        });
    const cfg = {
        ...base,
        ...optional,
        claude: await kept(base.claude, "steps on claude fail; pick another default agent"),
        gh: await kept(base.gh, "GitHub projects fail until the GitHub CLI is installed"),
    };
    const { refused } = parseAgentEnv(process.env.OLIMP_AGENT_ENV);
    if (refused.length)
        console.warn(
            `OLIMP_AGENT_ENV: not passed to agents (not a name or OLIMP's own): ${refused}`,
        );
    console.log(
        `agent environment: allowed list${cfg.agentEnv.length ? ` and ${cfg.agentEnv}` : ""}`,
    );
    const taken = `port ${cfg.port} is taken, by another OLIMP perhaps (OLIMP_PORT picks another)`;
    if (!(await portFree(cfg.port))) {
        console.error(`OLIMP does not start: ${taken}`);
        process.exit(1);
    }
    const opened = await Store.open(cfg).catch((error: Error) => {
        console.error(`OLIMP cannot open its database: ${error.message}`);
        process.exit(1);
    });
    const bus = new EventBus();
    const store = publishing(opened, bus);
    console.log(`database: ${store.description}`);
    const accounts = await store.hasUsers();
    const problem = publicHostProblem(cfg.publicHost, accounts);
    if (problem) {
        console.error(`OLIMP does not start: ${problem}`);
        process.exit(1);
    }
    console.log(
        accounts
            ? `accounts: every request needs a token${cfg.publicHost ? `; public host ${cfg.publicHost}` : ""}`
            : "accounts: none, the API trusts loopback",
    );
    await loadSettings(store, cfg);
    await loadMail(store, cfg);
    const interrupted = await store.failInterrupted();
    if (interrupted)
        console.warn(
            `${interrupted} task(s) or workflow run(s) interrupted by restart marked failed`,
        );
    if (folder) await openFolder(store, cfg, folder);
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
            console.log(
                `OLIMP on http://127.0.0.1:${cfg.port}, the panel and the API (data in ${cfg.home})`,
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
