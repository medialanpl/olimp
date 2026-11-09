import type { IncomingMessage } from "node:http";
import {
    type ConfigListing,
    claudeMcpServers,
    configFile,
    listConfig,
    readConfig,
    writeConfig,
} from "../agent-config.ts";
import { AGENTS, repoAgentsOf } from "../agents.ts";
import { isGitFolder, repoDir } from "../clones.ts";
import type { Config } from "../config.ts";
import { newId } from "../db/rows.ts";
import { HttpError, readJson, requireAdmin } from "../http.ts";
import { localeFrom } from "../i18n.ts";
import { COMMAND_MAX, COMMANDS_MAX } from "../limits.ts";
import { ensureUpkeep } from "../memory-upkeep.ts";
import { run } from "../proc.ts";
import {
    checkScripts,
    deleteSecret,
    secretName,
    secretsView,
    setSecret,
    settingsPatch,
} from "../project.ts";
import { parseCommands } from "../sandbox.ts";
import type { JobKind, Repo, RunStatus, Store, User } from "../store.ts";
import { addWebhook, deleteWebhook, testWebhook, updateWebhook, webhookView } from "../webhooks.ts";
import {
    type KeptWorktree,
    projectWorktrees,
    reclaimProjectWorktrees,
    removeProjectWorktree,
    treeSize,
} from "../worktrees.ts";
import { type Answer, skillOf, withGit } from "./shared.ts";

export type WorktreeView = KeptWorktree & {
    job: { kind: JobKind; title: string; status: RunStatus } | null;
    bytes: number | null;
};

// Whether each project file is committed: a worktree task reads the committed copy only.
async function withGitState(folder: string, files: ConfigListing[]) {
    const project = files.filter((f) => f.scope !== "user").map((f) => f.path);
    const out = isGitFolder(folder)
        ? await run("git", ["-C", folder, "status", "--porcelain", "--ignored", "--", ...project])
        : null;
    const states = new Map<string, GitState>();
    for (const line of out?.code === 0 ? out.stdout.split("\n") : []) {
        const code = line.slice(0, 2);
        const path = line.slice(3);
        if (path)
            states.set(path, code === "??" ? "untracked" : code === "!!" ? "ignored" : "modified");
    }
    return files.map((file) => ({
        ...file,
        git:
            file.scope === "user" || !out
                ? null
                : (states.get(file.path) ?? (file.exists ? "committed" : null)),
    }));
}

export type GitState = "committed" | "modified" | "untracked" | "ignored";
export type ConfigView = Awaited<ReturnType<typeof withGitState>>[number];

const ROUTE =
    /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/(settings|secrets|webhooks|agent-config|worktrees)(?:\/([\w.-]+))?(?:\/(test))?$/;

// The project's settings: its agents and commands, its own settings, secrets, webhooks, the
// agents' config files and the worktrees on disk.
// `home` is the caller's: the user scope of the agents' config files is theirs.
export async function projectSettingsRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    actor: User | null,
    home: string,
): Promise<Answer | undefined> {
    const match = ROUTE.exec(path);
    if (!match) return agentsAndCommands(store, cfg, req, path);
    const [, id = "", section, name, action] = match;
    const method = req.method;
    const repo = await store.repo(id);
    if (!repo) throw new HttpError(404, "repo.notRegistered", { repo: id });
    if (action && (section !== "webhooks" || !name || method !== "POST"))
        throw new HttpError(404, "request.notFound");
    switch (section) {
        case "settings":
            if (!name && method === "PATCH") {
                const body = await readJson(req);
                // Both run unattended: what lands on the base branch, and Bash as the OLIMP user.
                if (body.autoMergeLabel !== undefined || body.worktreeScripts !== undefined)
                    requireAdmin(actor);
                if (body.defaultSkill !== undefined)
                    body.defaultSkill = await skillOf(store, cfg, home, body.defaultSkill, repo);
                const settings = settingsPatch(repo.settings, body);
                for (const area of body.areas === undefined ? [] : settings.areas)
                    if (area === id || !(await store.repo(area)))
                        throw new HttpError(400, "project.unknownArea", { repo: id, area });
                if (body.worktreeScripts !== undefined)
                    await checkScripts(settings.worktreeScripts);
                if (settings.prReview && !repo.settings.prReview) {
                    if (!repo.github) throw new HttpError(400, "github.localProject", { repo: id });
                    settings.prReviewAuthor = actor?.id ?? null;
                }
                const saved = (await store.setRepoSettings(id, settings)) as Repo;
                await ensureUpkeep(store, saved);
                return [200, withGit(cfg, saved)];
            }
            break;
        case "secrets":
            requireAdmin(actor);
            if (!name && method === "GET") return [200, await secretsView(store, id)];
            if (name && method === "PUT") {
                await setSecret(store, cfg, id, secretName(name), (await readJson(req)).value);
                return [200, await secretsView(store, id)];
            }
            if (name && method === "DELETE") {
                if (!(await deleteSecret(store, id, name)))
                    throw new HttpError(404, "secret.notFound", { repo: id, name });
                return [200, await secretsView(store, id)];
            }
            break;
        case "webhooks":
            return webhooksRoute(store, cfg, req, repo, name, action, actor);
        case "agent-config": {
            const folder = repoDir(cfg, repo);
            if (!name && method === "GET")
                return [
                    200,
                    {
                        files: await withGitState(folder, listConfig(folder, home)),
                        mcpServers: claudeMcpServers(home, folder),
                    },
                ];
            const file = name ? configFile(name) : undefined;
            if (!file) throw new HttpError(404, "agentConfig.notFound", { id: name ?? "" });
            if (method === "GET") return [200, readConfig(file, folder, home)];
            if (method === "PUT") {
                // The project's files are everyone's; the user scope is the caller's own HOME.
                if (file.scope !== "user") requireAdmin(actor);
                return [200, writeConfig(file, folder, home, (await readJson(req)).content)];
            }
            break;
        }
        case "worktrees":
            if (!name && method === "GET") {
                const trees = await projectWorktrees(cfg, repo);
                return [
                    200,
                    await Promise.all(
                        trees.map(async (tree): Promise<WorktreeView> => {
                            const task = await store.task(tree.id);
                            const run = task ? undefined : await store.run(tree.id);
                            const job = task
                                ? { kind: "task" as const, title: task.title, status: task.status }
                                : run
                                  ? { kind: "run" as const, title: run.name, status: run.status }
                                  : null;
                            return { ...tree, job, bytes: await treeSize(tree.path) };
                        }),
                    ),
                ];
            }
            if (name === "reclaim" && method === "POST") {
                requireAdmin(actor);
                return [200, await reclaimProjectWorktrees(cfg, repo)];
            }
            if (name && method === "DELETE") {
                requireAdmin(actor);
                return [200, await removeProjectWorktree(cfg, repo, name)];
            }
            break;
    }
    return undefined;
}

const LISTS = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/(commands|agents)(?:\/([\w-]+))?$/;

async function agentsAndCommands(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
): Promise<Answer | undefined> {
    const match = LISTS.exec(path);
    if (!match) return undefined;
    const [, repo = "", section, name] = match;
    const method = req.method;
    if (!(await store.repo(repo))) throw new HttpError(404, "repo.notRegistered", { repo });
    if (section === "agents" && !name && method === "PUT") {
        const agents = repoAgentsOf(await readJson(req));
        if (!agents) throw new HttpError(400, "agents.invalid", { agents: AGENTS.join(", ") });
        return [200, withGit(cfg, (await store.setRepoAgents(repo, agents)) as Repo)];
    }
    if (section === "commands" && !name) {
        if (method === "PUT") {
            const commands = parseCommands((await readJson(req)).commands);
            if (!commands)
                throw new HttpError(400, "commands.invalid", {
                    count: COMMANDS_MAX,
                    max: COMMAND_MAX,
                });
            return [200, await store.setCommands(repo, commands)];
        }
        if (method === "DELETE") return [200, await store.setCommands(repo, [])];
    }
    return undefined;
}

async function webhooksRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    repo: Repo,
    id: string | undefined,
    action: string | undefined,
    actor: User | null,
): Promise<Answer | undefined> {
    requireAdmin(actor);
    const method = req.method;
    const list = async () => (await store.webhooks(repo.id)).map((h) => webhookView(cfg, h));
    if (!id) {
        if (method === "GET") return [200, await list()];
        if (method === "POST") {
            const locale = localeFrom(req.headers["accept-language"]);
            const hook = await addWebhook(
                store,
                cfg,
                repo.id,
                await readJson(req),
                locale,
                newId(),
            );
            return [201, webhookView(cfg, hook)];
        }
        return undefined;
    }
    const found = (await store.webhooks(repo.id)).find((h) => h.id === id);
    if (!found) throw new HttpError(404, "webhook.notFound", { repo: repo.id, id });
    if (action === "test") {
        await testWebhook(cfg, repo.id, found);
        return [200, webhookView(cfg, found)];
    }
    if (method === "PATCH") {
        const hook = await updateWebhook(store, cfg, repo.id, id, await readJson(req));
        return [200, webhookView(cfg, hook ?? found)];
    }
    if (method === "DELETE") {
        await deleteWebhook(store, repo.id, id);
        return [200, webhookView(cfg, found)];
    }
    return undefined;
}
