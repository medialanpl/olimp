import type { IncomingMessage } from "node:http";
import type { Config } from "../config.ts";
import { HttpError, readJson, requireAdmin } from "../http.ts";
import { localeFrom } from "../i18n.ts";
import {
    COST_DAYS_MAX,
    COST_GROUPS,
    type CostGroup,
    INSTRUCTIONS_MAX,
    TEMPLATE_LABEL_MAX,
    TEMPLATE_TEXT_MAX,
    TEMPLATES_BYTES_MAX,
    TEMPLATES_MAX,
} from "../limits.ts";
import { checkUpdate, machine, update, version } from "../machine.ts";
import { mailView, resetMail, saveMail } from "../mail.ts";
import { globalInstructions, saveSettings, settingsView } from "../settings.ts";
import type { Store, User } from "../store.ts";
import { totalUsage } from "../workflow-runner.ts";
import { email, sendTestMail } from "./auth.ts";
import type { Answer } from "./shared.ts";

// The machine, the installation's version, the settings saved in the panel and the costs.
export async function systemRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    url: URL,
    actor: User | null,
): Promise<Answer | undefined> {
    const path = url.pathname;
    const method = req.method;
    const locale = localeFrom(req.headers["accept-language"]);
    if (path === "/api/machine" && method === "GET") return [200, await machine()];
    if (path === "/api/version" && method === "GET") return [200, await version()];
    if (path === "/api/version/check" && method === "POST") {
        requireAdmin(actor);
        return [200, await checkUpdate()];
    }
    if (path === "/api/version/update" && method === "POST") {
        requireAdmin(actor);
        const refusal = await update(cfg).catch((error: Error) => {
            throw new HttpError(500, "version.updateFailed", { error: error.message });
        });
        if (refusal) throw new HttpError(409, `version.${refusal}`);
        return [202, { restarting: true }];
    }
    if (path === "/api/settings") {
        if (method === "GET") return [200, await settingsView(store, cfg)];
        if (method === "PUT") {
            requireAdmin(actor);
            const invalid = await saveSettings(store, cfg, await readJson(req));
            if (invalid) {
                const { code, ...params } = invalid.error;
                throw new HttpError(400, code, { ...params, setting: invalid.name });
            }
            return [200, await settingsView(store, cfg)];
        }
    }
    if (path === "/api/instructions") {
        if (method === "GET") return [200, { instructions: await globalInstructions(store) }];
        if (method === "PUT") {
            requireAdmin(actor);
            const { instructions } = await readJson(req);
            if (typeof instructions !== "string" || instructions.length > INSTRUCTIONS_MAX)
                throw new HttpError(400, "instructions.invalid", { max: INSTRUCTIONS_MAX });
            await store.saveSettings({ instructions: instructions.trim() || null });
            return [200, { instructions: instructions.trim() }];
        }
    }
    if (path === "/api/mail") {
        requireAdmin(actor);
        if (method === "GET") return [200, await mailView(store, cfg)];
        if (method === "PUT") return [200, await saveMail(store, cfg, await readJson(req))];
        if (method === "DELETE") return [200, await resetMail(store, cfg)];
    }
    if (path === "/api/mail/test" && method === "POST") {
        requireAdmin(actor);
        const body = await readJson(req);
        const to = body.to === undefined && actor?.email ? actor.email : email(body.to);
        await sendTestMail(cfg, locale, to);
        return [200, { to }];
    }
    if (path === "/api/prompt-templates") {
        if (method === "GET") return [200, await promptTemplates(store)];
        if (method === "PUT") {
            const templates = templatesOf((await readJson(req)).templates);
            await store.saveSettings({
                promptTemplates: templates && JSON.stringify(templates),
            });
            return [200, templates];
        }
    }
    if (path === "/api/costs" && method === "GET") return [200, await costs(store, url)];
    return undefined;
}

const TEMPLATE_ID = /^[\w-]{1,40}$/;

interface PromptTemplate {
    id: string;
    label: string;
    text: string;
}

// Saved templates, or null while the panel's built-in ones apply.
async function promptTemplates(store: Store): Promise<PromptTemplate[] | null> {
    const saved = (await store.settings()).promptTemplates;
    return saved ? (JSON.parse(saved) as PromptTemplate[]) : null;
}

function templatesOf(value: unknown): PromptTemplate[] | null {
    if (value === null) return null;
    const invalid = () =>
        new HttpError(400, "templates.invalid", {
            count: TEMPLATES_MAX,
            label: TEMPLATE_LABEL_MAX,
            text: TEMPLATE_TEXT_MAX,
        });
    if (!Array.isArray(value) || value.length > TEMPLATES_MAX) throw invalid();
    const templates = value.map((entry) => {
        const t = (entry ?? {}) as Record<string, unknown>;
        if (
            typeof t.id !== "string" ||
            !TEMPLATE_ID.test(t.id) ||
            typeof t.label !== "string" ||
            !t.label.trim() ||
            t.label.length > TEMPLATE_LABEL_MAX ||
            typeof t.text !== "string" ||
            !t.text.trim() ||
            t.text.length > TEMPLATE_TEXT_MAX
        )
            throw invalid();
        return { id: t.id, label: t.label.trim(), text: t.text };
    });
    if (Buffer.byteLength(JSON.stringify(templates)) > TEMPLATES_BYTES_MAX) throw invalid();
    return templates;
}

const DAY = 24 * 3_600_000;

async function costs(store: Store, url: URL) {
    const by = url.searchParams.get("by") ?? "day";
    if (!COST_GROUPS.includes(by as CostGroup))
        throw new HttpError(400, "costs.invalidGroup", { groups: COST_GROUPS.join(", ") });
    const daysParam = url.searchParams.get("days") ?? "30";
    const days = /^\d{1,3}$/.test(daysParam) ? Number(daysParam) : 0;
    if (days < 1 || days > COST_DAYS_MAX)
        throw new HttpError(400, "costs.invalidDays", { max: COST_DAYS_MAX });
    const since = new Date(Date.now() - days * DAY).toISOString();
    const rows = await store.costs(by as CostGroup, since);
    const names =
        by === "author" ? new Map((await store.users()).map((u) => [u.id, u.name])) : null;
    const groups = rows.map((row) => ({
        ...(names ? { name: row.key ? (names.get(row.key) ?? null) : null } : {}),
        ...row,
    }));
    const total = {
        jobs: rows.reduce((sum, row) => sum + row.jobs, 0),
        unpriced: rows.reduce((sum, row) => sum + row.unpriced, 0),
        ...totalUsage(rows),
    };
    return { by, days, since, total, groups };
}
