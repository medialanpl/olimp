import type { IncomingMessage } from "node:http";
import type { Config } from "../config.ts";
import { isCron, nextMatch, parseCron } from "../cron.ts";
import { HttpError, readJson, text } from "../http.ts";
import { CRON_MAX, NAME_MAX, REF_MAX, TASK_BODY_MAX, TITLE_MAX } from "../limits.ts";
import { projectAgent } from "../settings.ts";
import type { Automation, AutomationInput, Repo, Store, User } from "../store.ts";
import {
    type Answer,
    agentOf,
    flag,
    integrationsOf,
    known,
    registered,
    skillOf,
} from "./shared.ts";

// When the scheduler starts an automation next, in the server's time zone; null while it is off.
export type AutomationView = Automation & { nextRunAt: string | null };
const scheduled = (automation: Automation): AutomationView => ({
    ...automation,
    nextRunAt: automation.enabled
        ? (nextMatch(parseCron(automation.cron), new Date())?.toISOString() ?? null)
        : null,
});

async function workflowRef(store: Store, value: unknown): Promise<string> {
    const id = text(value, "workflow", REF_MAX);
    if (!(await store.workflow(id)))
        throw new HttpError(400, "workflow.notFound", { workflow: id });
    return id;
}

function cronOf(value: unknown): string {
    const cron = text(value, "cron", CRON_MAX).replace(/\s+/g, " ");
    if (!isCron(cron)) throw new HttpError(400, "automation.invalidCron", { cron });
    return cron;
}

const TEMPLATE = ["repo", "title", "body", "agent", "skill", "integrations"] as const;
// What makes a built-in automation the upkeep of its project.
const FIXED = ["name", "title", "repo", "workflow"] as const;

// POST validates a whole automation; PATCH only the fields it carries, on top of the stored ones.
// Setting `workflow` drops the task template, `"workflow": null` asks for a new template.
async function automationInput(
    store: Store,
    cfg: Config,
    home: string,
    body: Record<string, unknown>,
    base?: AutomationInput,
): Promise<AutomationInput> {
    const keep = <K extends keyof AutomationInput>(key: K, parse: () => AutomationInput[K]) =>
        base && body[key] === undefined ? base[key] : parse();
    const common = {
        name: keep("name", () => text(body.name, "name", NAME_MAX)),
        cron: keep("cron", () => cronOf(body.cron)),
        enabled: keep("enabled", () => body.enabled === undefined || flag(body.enabled, "enabled")),
    };
    const workflow =
        body.workflow === undefined
            ? (base?.workflow ?? null)
            : body.workflow === null
              ? null
              : await workflowRef(store, body.workflow);
    if (workflow) {
        if (TEMPLATE.some((key) => body[key] !== undefined && body[key] !== null))
            throw new HttpError(400, "automation.taskAndWorkflow");
        return {
            ...common,
            workflow,
            repo: null,
            title: null,
            body: null,
            agent: null,
            skill: null,
            integrations: null,
        };
    }
    const template = base && !base.workflow ? base : undefined;
    const pick = <K extends (typeof TEMPLATE)[number]>(key: K, parse: () => AutomationInput[K]) =>
        template && body[key] === undefined ? template[key] : parse();
    const repo =
        template && body.repo === undefined
            ? (template.repo as string)
            : await registered(store, body.repo);
    // Kept integrations are checked again only when the repository changes.
    const integrations =
        template && body.integrations === undefined
            ? repo === template.repo
                ? template.integrations
                : await known(store, repo, template.integrations ?? [])
            : await integrationsOf(store, repo, body.integrations);
    return {
        ...common,
        workflow: null,
        repo,
        integrations,
        title: pick("title", () => text(body.title, "title", TITLE_MAX)),
        body: pick("body", () => text(body.body, "body", TASK_BODY_MAX, false)),
        agent:
            template && body.agent === undefined
                ? template.agent
                : body.agent === undefined
                  ? await projectAgent(store, (await store.repo(repo)) as Repo)
                  : agentOf(body.agent),
        skill:
            template && body.skill === undefined
                ? template.skill
                : await skillOf(store, cfg, home, body.skill, (await store.repo(repo)) as Repo),
    };
}

export async function automationsRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    actor: User | null,
    home: string,
): Promise<Answer | undefined> {
    const method = req.method;
    const author = actor?.id ?? null;
    if (path === "/api/automations") {
        if (method === "GET") return [200, (await store.automations()).map(scheduled)];
        if (method === "POST") {
            const input = await automationInput(store, cfg, home, await readJson(req));
            return [201, scheduled(await store.createAutomation(input, author))];
        }
    }
    const auto = /^\/api\/automations\/([0-9a-f]{12})(\/run)?$/.exec(path);
    const current = auto && (await store.automation(auto[1] as string));
    if (auto && current) {
        if (auto[2] && method === "POST") return [201, await store.runAutomation(current.id)];
        if (!auto[2] && method === "GET") return [200, scheduled(current)];
        if (!auto[2] && method === "PATCH") {
            const body = await readJson(req);
            if (
                current.builtin &&
                FIXED.some((k) => body[k] !== undefined && body[k] !== current[k])
            )
                throw new HttpError(409, "automation.builtin");
            const input = await automationInput(store, cfg, home, body, current);
            const updated = await store.updateAutomation(current.id, input);
            return [200, updated && scheduled(updated)];
        }
        if (!auto[2] && method === "DELETE") {
            if (current.builtin) throw new HttpError(409, "automation.builtin");
            await store.deleteAutomation(current.id);
            return [200, current];
        }
    }
    return undefined;
}
