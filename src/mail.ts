import { createTransport } from "nodemailer";
import { EMAIL, seal, unseal } from "./auth.ts";
import type { Config } from "./config.ts";
import { text as field, HttpError } from "./http.ts";
import type { Store } from "./store.ts";

export const mailReady = (cfg: Pick<Config, "smtpUrl" | "mailFrom">) =>
    Boolean(cfg.smtpUrl && cfg.mailFrom);

export interface Mail {
    to: string;
    subject: string;
    // Paragraphs of plain text; `link` becomes a button in the HTML part and a line in the text.
    paragraphs: string[];
    link?: { label: string; url: string };
    code?: string;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// One plain layout for every message, as Corivo's base layout without the brand images.
function html(mail: Mail): string {
    const p = (text: string) =>
        `<p style="margin:0 0 16px;font:15px/1.5 Inter,Arial,sans-serif;color:#1c1917">${escapeHtml(text)}</p>`;
    return [
        '<div style="max-width:520px;margin:0 auto;padding:32px 24px;background:#ffffff">',
        '<p style="margin:0 0 24px;font:600 18px Inter,Arial,sans-serif;letter-spacing:.08em">OLIMP</p>',
        ...mail.paragraphs.map(p),
        mail.code
            ? `<p style="margin:0 0 16px;font:600 28px/1 ui-monospace,monospace;letter-spacing:.3em">${escapeHtml(mail.code)}</p>`
            : "",
        mail.link
            ? `<p style="margin:24px 0"><a href="${escapeHtml(mail.link.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1c1917;color:#fafaf9;font:600 14px Inter,Arial,sans-serif;text-decoration:none">${escapeHtml(mail.link.label)}</a></p>`
            : "",
        "</div>",
    ].join("");
}

const text = (mail: Mail) =>
    [...mail.paragraphs, mail.code ?? "", mail.link ? `${mail.link.label}: ${mail.link.url}` : ""]
        .filter(Boolean)
        .join("\n\n");

export async function sendMail(cfg: Pick<Config, "smtpUrl" | "mailFrom">, mail: Mail) {
    if (!cfg.smtpUrl || !cfg.mailFrom)
        throw new Error("OLIMP_SMTP_URL and OLIMP_MAIL_FROM are not set");
    await createTransport(cfg.smtpUrl).sendMail({
        from: cfg.mailFrom,
        to: mail.to,
        subject: mail.subject,
        text: text(mail),
        html: html(mail),
    });
}

// A mail server saved in the panel; it replaces OLIMP_SMTP_URL and OLIMP_MAIL_FROM.
export interface MailServer {
    host: string;
    port: number;
    // TLS from the first byte (smtps, usually 465); otherwise STARTTLS when the server offers it.
    secure: boolean;
    user: string;
    from: string;
}

// The password is sealed with OLIMP_HOME/auth.key, as the TOTP secret.
type SavedMail = MailServer & { password: string | null };

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

const savedOf = async (store: Store): Promise<SavedMail | null> => {
    const row = (await store.settings()).mail;
    return row ? JSON.parse(row) : null;
};

function urlOf(server: MailServer, password: string): string {
    const url = new URL(`${server.secure ? "smtps" : "smtp"}://${server.host}:${server.port}`);
    if (server.user) {
        url.username = server.user;
        url.password = password;
    }
    return url.href;
}

function fromEnvironment(cfg: Config): { server: MailServer; password: string } | null {
    const { smtpUrl, mailFrom } = cfg.mailEnv;
    if (!smtpUrl) return null;
    try {
        const url = new URL(smtpUrl);
        const secure = url.protocol === "smtps:";
        return {
            server: {
                host: url.hostname,
                port: Number(url.port) || (secure ? 465 : 587),
                secure,
                user: decodeURIComponent(url.username),
                from: mailFrom ?? "",
            },
            password: decodeURIComponent(url.password),
        };
    } catch {
        return null;
    }
}

function applyMail(cfg: Config, saved: SavedMail | null): void {
    cfg.smtpUrl = saved
        ? urlOf(saved, saved.password ? unseal(cfg.home, saved.password) : "")
        : cfg.mailEnv.smtpUrl;
    cfg.mailFrom = saved ? saved.from : cfg.mailEnv.mailFrom;
}

// A password that no longer unseals (auth.key replaced) leaves the environment's server in force.
export async function loadMail(store: Store, cfg: Config): Promise<void> {
    try {
        applyMail(cfg, await savedOf(store));
    } catch (error) {
        console.warn(`mail server: saved one unreadable (${(error as Error).message}), env used`);
        applyMail(cfg, null);
    }
}

// Never the password, only whether there is one.
export async function mailView(store: Store, cfg: Config) {
    const saved = await savedOf(store);
    const env = fromEnvironment(cfg);
    return {
        saved: Boolean(saved),
        ready: mailReady(cfg),
        server: saved
            ? { ...saved, password: Boolean(saved.password) }
            : env && { ...env.server, password: Boolean(env.password) },
    };
}

export async function saveMail(store: Store, cfg: Config, body: Record<string, unknown>) {
    const host = field(body.host, "host", 253);
    if (!HOST.test(host)) throw new HttpError(400, "mail.invalidHost");
    const port = body.port;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535)
        throw new HttpError(400, "mail.invalidPort");
    if (typeof body.secure !== "boolean")
        throw new HttpError(400, "field.invalidBoolean", { field: "secure" });
    const user = field(body.user, "user", 254, false);
    const from = field(body.from, "from", 320);
    if (!EMAIL.test(/<([^<>]+)>$/.exec(from)?.[1] ?? from))
        throw new HttpError(400, "mail.invalidFrom");
    const previous = await savedOf(store);
    const sealed = (value: string) => (value ? seal(cfg.home, value) : null);
    // No password keeps the one in force, saved or from the environment; "" signs in without one.
    const password =
        body.password !== undefined
            ? sealed(field(body.password, "password", 1024, false))
            : previous
              ? previous.password
              : sealed(fromEnvironment(cfg)?.password ?? "");
    const saved: SavedMail = { host, port, secure: body.secure, user, from, password };
    await store.saveSettings({ mail: JSON.stringify(saved) });
    applyMail(cfg, saved);
    return mailView(store, cfg);
}

export async function resetMail(store: Store, cfg: Config) {
    await store.saveSettings({ mail: null });
    applyMail(cfg, null);
    return mailView(store, cfg);
}
