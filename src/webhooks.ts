import { seal, unseal } from "./auth.ts";
import { type Config, publicUrl } from "./config.ts";
import { HttpError } from "./http.ts";
import { type Locale, t } from "./i18n.ts";
import { NAME_MAX, SECRET_VALUE_MAX, WEBHOOK_URL_MAX, WEBHOOKS_MAX } from "./limits.ts";
import type { JobKind, Store } from "./store.ts";

export const WEBHOOK_FORMATS = ["json", "slack", "discord", "ntfy"] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];
// waiting: a workflow run stopped at a gate or a question for a person.
export const WEBHOOK_EVENTS = ["done", "failed", "cancelled", "waiting"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// A receiver of a project's job updates: Slack, Discord, an ntfy topic or any JSON endpoint.
export interface Webhook {
    id: string;
    name: string;
    format: WebhookFormat;
    // Sealed with OLIMP_HOME/auth.key: a Slack or Discord URL, or an ntfy topic, is its own token.
    url: string;
    // Sealed too: the access token of a protected ntfy topic.
    token?: string;
    events: WebhookEvent[];
    enabled: boolean;
    // Whether jobs an automation queued are sent too; false keeps it to the ones people started.
    automations: boolean;
    // Its messages are in the language of the admin who added it.
    locale: Locale;
    createdAt: string;
}

export interface Delivery {
    at: string;
    ok: boolean;
    status: number | null;
    error: string | null;
}

const TIMEOUT_MS = 10_000;

// shortcut: the last delivery per receiver is kept in memory and a restart forgets it; a column
// once someone needs the history.
const deliveries = new Map<string, Delivery>();

const host = (url: string) => new URL(url).host;

// Never the URL, only its host, so a token in it stays sealed.
export const webhookView = (cfg: Config, hook: Webhook) => {
    const { url, token, ...rest } = hook;
    let shown = "";
    try {
        shown = host(unseal(cfg.home, url));
    } catch {}
    return {
        ...rest,
        host: shown,
        hasToken: Boolean(token),
        last: deliveries.get(hook.id) ?? null,
    };
};

export type WebhookView = ReturnType<typeof webhookView>;

function urlOf(value: unknown): string {
    if (typeof value !== "string" || value.length > WEBHOOK_URL_MAX)
        throw new HttpError(400, "webhook.invalidUrl");
    try {
        // HTTPS only: the receiver gets the project's job titles, and a plain address on the
        // network is where a request from OLIMP should not go unasked.
        if (new URL(value).protocol === "https:") return value;
    } catch {}
    throw new HttpError(400, "webhook.invalidUrl");
}

// ntfy takes a JSON message at its server's root, so the topic URL splits into the two.
function ntfyTarget(url: string) {
    const target = new URL(url);
    return { root: new URL(".", target).href, topic: target.pathname.split("/").pop() ?? "" };
}

function checkTopic(url: string) {
    if (!/^[-\w]{1,64}$/.test(ntfyTarget(url).topic))
        throw new HttpError(400, "webhook.invalidTopic");
}

// undefined keeps the current token and "" removes it; a receiver other than ntfy keeps none.
function tokenOf(cfg: Config, format: WebhookFormat, value: unknown, current?: string) {
    if (format !== "ntfy") return undefined;
    if (value === undefined) return current;
    if (typeof value !== "string" || value.length > SECRET_VALUE_MAX || /\s/.test(value))
        throw new HttpError(400, "webhook.invalidToken", { max: SECRET_VALUE_MAX });
    return value ? seal(cfg.home, value) : undefined;
}

function fields(body: Record<string, unknown>, current: Webhook | null) {
    const name = body.name ?? current?.name;
    if (typeof name !== "string" || !name.trim() || name.length > NAME_MAX)
        throw new HttpError(400, "field.invalidText", { field: "name", max: NAME_MAX });
    const format = body.format ?? current?.format ?? "json";
    if (!(WEBHOOK_FORMATS as readonly unknown[]).includes(format))
        throw new HttpError(400, "webhook.invalidFormat", { values: WEBHOOK_FORMATS.join(", ") });
    const events = body.events ?? current?.events ?? ["done", "failed"];
    if (
        !Array.isArray(events) ||
        !events.length ||
        events.some((e) => !(WEBHOOK_EVENTS as readonly unknown[]).includes(e))
    )
        throw new HttpError(400, "webhook.invalidEvents", { values: WEBHOOK_EVENTS.join(", ") });
    const flag = (field: "enabled" | "automations") => {
        const value = body[field] ?? current?.[field] ?? true;
        if (typeof value !== "boolean") throw new HttpError(400, "field.invalidBoolean", { field });
        return value;
    };
    return {
        name: name.trim(),
        format: format as WebhookFormat,
        events: [...new Set(events as WebhookEvent[])],
        enabled: flag("enabled"),
        automations: flag("automations"),
    };
}

export async function addWebhook(
    store: Store,
    cfg: Config,
    repo: string,
    body: Record<string, unknown>,
    locale: Locale,
    id: string,
): Promise<Webhook> {
    const hooks = await store.webhooks(repo);
    if (hooks.length >= WEBHOOKS_MAX)
        throw new HttpError(400, "webhook.tooMany", { max: WEBHOOKS_MAX });
    const set = fields(body, null);
    const url = urlOf(body.url);
    if (set.format === "ntfy") checkTopic(url);
    const token = tokenOf(cfg, set.format, body.token);
    const hook: Webhook = {
        id,
        ...set,
        url: seal(cfg.home, url),
        ...(token ? { token } : {}),
        locale,
        createdAt: new Date().toISOString(),
    };
    await store.setWebhooks(repo, [...hooks, hook]);
    return hook;
}

// shortcut: read-modify-write of one JSON column, as the secrets.
export async function updateWebhook(
    store: Store,
    cfg: Config,
    repo: string,
    id: string,
    body: Record<string, unknown>,
): Promise<Webhook | undefined> {
    const hooks = await store.webhooks(repo);
    const current = hooks.find((h) => h.id === id);
    if (!current) return undefined;
    const set = fields(body, current);
    const url = body.url !== undefined ? urlOf(body.url) : null;
    if (set.format === "ntfy") checkTopic(url ?? unseal(cfg.home, current.url));
    const { token: kept, ...rest } = current;
    const token = tokenOf(cfg, set.format, body.token, kept);
    const next: Webhook = {
        ...rest,
        ...set,
        ...(url !== null ? { url: seal(cfg.home, url) } : {}),
        ...(token ? { token } : {}),
    };
    await store.setWebhooks(
        repo,
        hooks.map((h) => (h.id === id ? next : h)),
    );
    return next;
}

export async function deleteWebhook(store: Store, repo: string, id: string) {
    const hooks = await store.webhooks(repo);
    const found = hooks.find((h) => h.id === id);
    if (found) {
        await store.setWebhooks(
            repo,
            hooks.filter((h) => h.id !== id),
        );
        deliveries.delete(id);
    }
    return found;
}

interface Message {
    event: WebhookEvent | "test";
    repo: string;
    kind: JobKind;
    id: string;
    title: string;
    error: string | null;
    prUrl: string | null;
    // The gate's message or the question a waiting run asks.
    question: string | null;
    url: string;
}

// ntfy shows these tags as emoji before the title.
const NTFY_TAGS = {
    done: "white_check_mark",
    failed: "x",
    cancelled: "stop_button",
    waiting: "raising_hand",
    test: "wave",
};
const NTFY_PRIORITY = { done: 3, failed: 4, cancelled: 2, waiting: 4, test: 3 };

function payload(hook: Webhook, m: Message, topic: string): object {
    const text = t(hook.locale, `webhook.${m.event}`, {
        repo: m.repo,
        title: m.title,
        url: m.url,
    });
    const detail = [m.question, m.prUrl, m.error].filter(Boolean).join("\n");
    const line = detail ? `${text}\n${detail}` : text;
    if (hook.format === "slack") return { text: line };
    if (hook.format === "discord") return { content: line.slice(0, 2000) };
    if (hook.format === "ntfy")
        return {
            topic,
            title: "OLIMP",
            // Under ntfy's 4096-byte message limit, past which it wants an attachment instead.
            message: line.slice(0, 1000),
            click: m.url,
            tags: [NTFY_TAGS[m.event]],
            priority: NTFY_PRIORITY[m.event],
        };
    return { ...m, text };
}

async function deliver(cfg: Config, hook: Webhook, message: Message): Promise<Delivery> {
    const at = new Date().toISOString();
    let delivery: Delivery;
    try {
        const url = unseal(cfg.home, hook.url);
        const ntfy = hook.format === "ntfy" ? ntfyTarget(url) : null;
        const headers: Record<string, string> = {
            "content-type": "application/json",
            "user-agent": "OLIMP",
        };
        if (ntfy && hook.token) headers.authorization = `Bearer ${unseal(cfg.home, hook.token)}`;
        const response = await fetch(ntfy?.root ?? url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload(hook, message, ntfy?.topic ?? "")),
            redirect: "error",
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        delivery = { at, ok: response.ok, status: response.status, error: null };
    } catch (error) {
        delivery = { at, ok: false, status: null, error: (error as Error).message };
    }
    deliveries.set(hook.id, delivery);
    if (!delivery.ok)
        console.warn(
            `webhook ${hook.name}: delivery failed (${delivery.status ?? delivery.error})`,
        );
    return delivery;
}

export async function testWebhook(cfg: Config, repo: string, hook: Webhook) {
    return deliver(cfg, hook, {
        event: "test",
        repo,
        kind: "task",
        id: "",
        title: "",
        error: null,
        prUrl: null,
        question: null,
        url: `${publicUrl(cfg)}/project/${repo}/settings/webhooks`,
    });
}

const isEvent = (status: string): status is WebhookEvent =>
    (WEBHOOK_EVENTS as readonly string[]).includes(status);

// Once a task or workflow run has ended, or a run parked at a gate or a question; a failed
// delivery is logged and not retried.
export async function notifyJob(
    store: Store,
    cfg: Config,
    kind: JobKind,
    id: string,
): Promise<void> {
    try {
        const job = kind === "task" ? await store.task(id) : await store.run(id);
        const wait = job && "state" in job ? job.state?.wait : undefined;
        const asks = wait?.kind === "gate" || wait?.kind === "ask";
        // A run waiting for CI or its subtasks needs nobody.
        if (!job || !isEvent(job.status) || (job.status === "waiting" && !asks)) return;
        const event = job.status;
        const hooks = (await store.webhooks(job.repo)).filter(
            (h) =>
                h.enabled &&
                h.events.includes(event) &&
                (h.automations !== false || !job.automation),
        );
        if (!hooks.length) return;
        const message: Message = {
            event,
            repo: job.repo,
            kind,
            id,
            title: "title" in job ? job.title : job.name,
            error: job.error,
            prUrl: job.prUrl,
            question: event === "waiting" ? (wait?.question ?? null) : null,
            url: `${publicUrl(cfg)}/tasks/${id}`,
        };
        await Promise.all(hooks.map((hook) => deliver(cfg, hook, message)));
    } catch (error) {
        console.error(`webhooks of ${kind} ${id}: ${(error as Error).message}`);
    }
}
