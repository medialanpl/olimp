import type { IncomingMessage } from "node:http";
import {
    ABSOLUTE_MS,
    CODE_ATTEMPTS,
    checkTotp,
    clearFailures,
    EMAIL,
    EMAIL_CODE_MS,
    hashBackupCode,
    hashPassword,
    IDLE_MS,
    LINK_MS,
    lockedFor,
    newBackupCodes,
    newEmailCode,
    newSecret,
    newTotpSecret,
    normalizeEmail,
    PASSWORD_MIN,
    passwordCompliant,
    recordFailure,
    safeEqual,
    seal,
    sha256,
    totpUri,
    unseal,
    verifyPassword,
} from "../auth.ts";
import { type Config, publicUrl } from "../config.ts";
import { HttpError, readJson, text } from "../http.ts";
import { type Locale, t } from "../i18n.ts";
import { USER_NAME, USER_NAME_MAX } from "../limits.ts";
import { mailReady, sendMail } from "../mail.ts";
import type { AuthLink, Session, Store, User } from "../store.ts";

export const SESSION_COOKIE = "olimp_session";

export interface AuthAnswer {
    status: number;
    payload: unknown;
    // A Set-Cookie value for the session.
    cookie?: string;
}

// Corivo's audit events, as one JSON line each in the service log.
function audit(event: string, fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ audit: event, at: new Date().toISOString(), ...fields }));
}

function cookieOf(req: IncomingMessage): string | null {
    for (const part of (req.headers.cookie ?? "").split(";")) {
        const [name, ...value] = part.trim().split("=");
        if (name === SESSION_COOKIE) return value.join("=") || null;
    }
    return null;
}

// Secure only behind the TLS proxy: on http://127.0.0.1 the browser would drop it.
function cookie(cfg: Config, req: IncomingMessage, value: string | null): string {
    const secure = cfg.publicHost && req.headers.host === cfg.publicHost ? "; Secure" : "";
    const age = value ? Math.floor(ABSOLUTE_MS / 1000) : 0;
    return `${SESSION_COOKIE}=${value ?? ""}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
}

function clientIp(cfg: Config, req: IncomingMessage): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (cfg.publicHost && req.headers.host === cfg.publicHost && typeof forwarded === "string")
        return forwarded.split(",")[0]?.trim() ?? "";
    return req.socket.remoteAddress ?? "";
}

const iso = (ms: number) => new Date(ms).toISOString();

export function password(value: unknown): string {
    if (typeof value !== "string" || !passwordCompliant(value))
        throw new HttpError(400, "auth.weakPassword", { min: PASSWORD_MIN });
    return value;
}

export function email(value: unknown): string {
    const address = typeof value === "string" ? normalizeEmail(value) : "";
    if (!EMAIL.test(address)) throw new HttpError(400, "account.invalidEmail");
    return address;
}

const code = (value: unknown) => text(value, "code", 40);

export function userName(value: unknown): string {
    if (typeof value !== "string" || !USER_NAME.test(value))
        throw new HttpError(400, "account.invalidName", { max: USER_NAME_MAX });
    return value;
}

function readSession(session: Session | undefined, now = Date.now()) {
    if (!session) return null;
    const idle = now - Date.parse(session.seenAt) > IDLE_MS;
    const old = now - Date.parse(session.createdAt) > ABSOLUTE_MS;
    return idle || old ? null : session;
}

// The account of a signed-in panel, or null. A session waiting for its second factor, idle for
// 30 minutes or older than 8 hours signs nobody in.
export async function sessionUser(
    store: Store,
    req: IncomingMessage,
): Promise<{ user: User; session: Session } | null> {
    const value = cookieOf(req);
    if (!value) return null;
    const session = readSession(await store.session(sha256(value)));
    if (!session?.verifiedAt) return null;
    const user = await store.user(session.user);
    if (!user) return null;
    const now = Date.now();
    // Every minute at most, so a busy panel does not write on every request.
    if (now - Date.parse(session.seenAt) > 60_000)
        await store.updateSession(session.id, { seenAt: iso(now) });
    return { user, session };
}

async function mail(
    cfg: Config,
    locale: Locale,
    to: string,
    kind: "invite" | "reset" | "code" | "test",
    extra: { url?: string; code?: string; name?: string },
) {
    const params = { name: extra.name ?? "" };
    await sendMail(cfg, {
        to,
        subject: t(locale, `mail.${kind}.subject`, params),
        paragraphs: [t(locale, `mail.${kind}.body`, params), t(locale, "mail.footer")],
        ...(extra.url && {
            link: {
                label: t(locale, kind === "invite" ? "mail.invite.button" : "mail.reset.button"),
                url: extra.url,
            },
        }),
        ...(extra.code && { code: extra.code }),
    }).catch((error: Error) => {
        throw new HttpError(502, "mail.failed", { error: error.message });
    });
}

// Sends an invitation (no password yet) or a password reset as a one-time link valid 7 days.
export async function sendLink(
    store: Store,
    cfg: Config,
    locale: Locale,
    user: User,
): Promise<AuthLink["kind"]> {
    if (!mailReady(cfg)) throw new HttpError(409, "mail.notConfigured");
    if (!user.email) throw new HttpError(409, "account.noEmail", { account: user.name });
    const kind = (await store.credentials(user.id))?.passwordHash ? "reset" : "invite";
    const token = newSecret();
    await store.createLink({
        id: sha256(token),
        user: user.id,
        kind,
        expiresAt: iso(Date.now() + LINK_MS),
    });
    const url = `${publicUrl(cfg)}/${kind === "invite" ? "accept-invitation" : "reset-password"}?token=${token}`;
    await mail(cfg, locale, user.email, kind, { url, name: user.name });
    audit(`auth.${kind}_sent`, { user: user.id });
    return kind;
}

export const sendTestMail = (cfg: Config, locale: Locale, to: string) => {
    if (!mailReady(cfg)) throw new HttpError(409, "mail.notConfigured");
    return mail(cfg, locale, to, "test", {});
};

async function sendCode(store: Store, cfg: Config, locale: Locale, user: User, session: Session) {
    const value = newEmailCode();
    await store.updateSession(session.id, {
        codeHash: sha256(`${session.id}:${value}`),
        codeExpiresAt: iso(Date.now() + EMAIL_CODE_MS),
        attempts: 0,
    });
    await mail(cfg, locale, user.email as string, "code", { code: value, name: user.name });
}

// The second factor: the app's code, a backup code, or the code sent by e-mail.
async function checkSecondFactor(
    store: Store,
    cfg: Config,
    user: User,
    session: Session,
    value: string,
): Promise<boolean> {
    const credentials = await store.credentials(user.id);
    if (credentials?.totpSecret) {
        if (/^\d{6}$/.test(value))
            return checkTotp(user.id, unseal(cfg.home, credentials.totpSecret), value);
        return store.spendBackupCode(user.id, hashBackupCode(value));
    }
    if (
        !session.codeHash ||
        !session.codeExpiresAt ||
        Date.parse(session.codeExpiresAt) < Date.now()
    )
        throw new HttpError(401, "auth.codeExpired");
    return safeEqual(session.codeHash, sha256(`${session.id}:${value}`));
}

// Turns the app on with a secret the caller was shown and a code from it; new backup codes.
async function enableTotp(store: Store, cfg: Config, user: User, body: Record<string, unknown>) {
    const secret = text(body.secret, "secret", 64);
    if (!/^[A-Z2-7]{32}$/.test(secret) || !checkTotp(user.id, secret, code(body.code)))
        throw new HttpError(400, "auth.invalidCode");
    const codes = newBackupCodes();
    await store.updateUser(user.id, {
        totpSecret: seal(cfg.home, secret),
        backupCodes: codes.map(hashBackupCode),
    });
    audit("auth.two_factor_enabled", { user: user.id });
    return codes;
}

const newTotp = (user: User) => {
    const secret = newTotpSecret();
    return { secret, uri: totpUri(secret, user.email ?? user.name) };
};

async function pending(store: Store, req: IncomingMessage) {
    const value = cookieOf(req);
    const session = value ? readSession(await store.session(sha256(value))) : null;
    // The second factor must follow the password within the life of an e-mail code.
    if (
        !session ||
        session.verifiedAt ||
        Date.now() - Date.parse(session.createdAt) > EMAIL_CODE_MS
    )
        throw new HttpError(401, "auth.signInAgain");
    const user = await store.user(session.user);
    if (!user) throw new HttpError(401, "auth.signInAgain");
    return { session, user };
}

async function verified(store: Store, user: User, session: Session) {
    await store.updateSession(session.id, { verifiedAt: iso(Date.now()), codeHash: null });
    await store.updateUser(user.id, { lastLoginAt: iso(Date.now()) });
    audit("auth.login", { user: user.id });
    return user;
}

// Sign-in as in Corivo: e-mail and password, then always a second factor. Outside MCP, which
// signs in with a token.
export async function authRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    locale: Locale,
): Promise<AuthAnswer | undefined> {
    if (!path.startsWith("/api/auth/") || req.method !== "POST") return undefined;
    const ip = clientIp(cfg, req);
    const body = await readJson(req);
    if (path === "/api/auth/login") {
        if (!(await store.hasUsers())) throw new HttpError(404, "account.none");
        const address = email(body.email);
        const keys = [`email:${address}`, `ip:${ip}`];
        const locked = Math.max(...keys.map((key) => lockedFor(key)));
        if (locked) {
            audit("auth.rate_limited", { email: address, ip });
            throw new HttpError(429, "auth.locked", { seconds: locked });
        }
        const user = await store.userByEmail(address);
        const credentials = user && (await store.credentials(user.id));
        const ok = await verifyPassword(
            typeof body.password === "string" ? body.password : "",
            credentials?.passwordHash ?? null,
        );
        if (!user || !ok) {
            for (const key of keys) recordFailure(key);
            audit("auth.denied", { email: address, ip });
            throw new HttpError(401, "auth.invalidLogin");
        }
        for (const key of keys) clearFailures(key);
        const now = Date.now();
        await store.purgeSessions(iso(now - IDLE_MS), iso(now - ABSOLUTE_MS));
        const value = newSecret();
        const session: Session = {
            id: sha256(value),
            user: user.id,
            createdAt: iso(now),
            seenAt: iso(now),
            verifiedAt: null,
            codeHash: null,
            codeExpiresAt: null,
            attempts: 0,
            ip: ip.slice(0, 255),
            userAgent: (req.headers["user-agent"] ?? "").slice(0, 255),
        };
        await store.createSession(session);
        // Without an app the code comes by e-mail; without e-mail the app must be set up now.
        const method = user.totp ? "app" : mailReady(cfg) ? "email" : "setup";
        if (method === "email") await sendCode(store, cfg, locale, user, session);
        return { status: 200, payload: { method }, cookie: cookie(cfg, req, value) };
    }
    if (path === "/api/auth/two-factor") {
        const { session, user } = await pending(store, req);
        if (session.attempts >= CODE_ATTEMPTS) throw new HttpError(401, "auth.signInAgain");
        if (!(await checkSecondFactor(store, cfg, user, session, code(body.code)))) {
            await store.updateSession(session.id, { attempts: session.attempts + 1 });
            audit("auth.two_factor_denied", { user: user.id, ip });
            throw new HttpError(401, "auth.invalidCode");
        }
        return { status: 200, payload: await verified(store, user, session) };
    }
    if (path === "/api/auth/two-factor/email") {
        const { session, user } = await pending(store, req);
        if (user.totp || !mailReady(cfg)) throw new HttpError(409, "mail.notConfigured");
        await sendCode(store, cfg, locale, user, session);
        return { status: 200, payload: { method: "email" } };
    }
    if (path === "/api/auth/two-factor/setup") {
        const { user } = await pending(store, req);
        if (user.totp) throw new HttpError(409, "auth.appExists");
        return { status: 200, payload: newTotp(user) };
    }
    if (path === "/api/auth/two-factor/enable") {
        const { session, user } = await pending(store, req);
        if (user.totp) throw new HttpError(409, "auth.appExists");
        const backupCodes = await enableTotp(store, cfg, user, body);
        return {
            status: 200,
            payload: { user: await verified(store, user, session), backupCodes },
        };
    }
    if (path === "/api/auth/logout") {
        const value = cookieOf(req);
        if (value) await store.deleteSession(sha256(value));
        audit("auth.logout", { ip });
        return { status: 200, payload: { ok: true }, cookie: cookie(cfg, req, null) };
    }
    if (path === "/api/auth/forgot") {
        const address = email(body.email);
        if (!mailReady(cfg)) throw new HttpError(409, "mail.notConfigured");
        const key = `forgot:${ip}`;
        if (lockedFor(key)) throw new HttpError(429, "auth.locked", { seconds: lockedFor(key) });
        recordFailure(key);
        const user = await store.userByEmail(address);
        // The same answer for any address, so it does not tell who has an account.
        if (user) await sendLink(store, cfg, locale, user).catch(() => {});
        return { status: 200, payload: { ok: true } };
    }
    if (path === "/api/auth/link") {
        const link = await store.link(sha256(text(body.token, "token", 100)));
        const user =
            link && Date.parse(link.expiresAt) > Date.now() && (await store.user(link.user));
        if (!link || !user) throw new HttpError(404, "auth.invalidLink");
        return { status: 200, payload: { kind: link.kind, email: user.email, name: user.name } };
    }
    if (path === "/api/auth/password") {
        const hash = await hashPassword(password(body.password));
        const link = await store.takeLink(sha256(text(body.token, "token", 100)));
        if (!link || Date.parse(link.expiresAt) < Date.now())
            throw new HttpError(404, "auth.invalidLink");
        await store.updateUser(link.user, { passwordHash: hash });
        await store.deleteSessions(link.user);
        audit("auth.password_set", { user: link.user, kind: link.kind });
        return { status: 200, payload: { ok: true } };
    }
    return undefined;
}

// The caller's own account in the panel: name and e-mail, password, the app, sessions.
export async function meRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    actor: User,
    current: Session | null,
): Promise<[number, unknown] | undefined> {
    const method = req.method;
    const checkPassword = async (value: unknown) => {
        const credentials = await store.credentials(actor.id);
        const key = `password:${actor.id}`;
        if (lockedFor(key)) throw new HttpError(429, "auth.locked", { seconds: lockedFor(key) });
        if (
            !(await verifyPassword(
                typeof value === "string" ? value : "",
                credentials?.passwordHash ?? null,
            ))
        ) {
            recordFailure(key);
            throw new HttpError(403, "auth.wrongPassword");
        }
    };
    if (path === "/api/me" && method === "PATCH") {
        const body = await readJson(req);
        const address = body.email === undefined ? undefined : email(body.email);
        if (address !== undefined && address !== actor.email) await checkPassword(body.password);
        const name = body.name === undefined ? undefined : userName(body.name);
        const updated = await store.updateUser(actor.id, { name, email: address });
        if (updated === "taken")
            throw new HttpError(409, "account.exists", { name: name ?? address ?? "" });
        return [200, updated];
    }
    if (path === "/api/me/password" && method === "PUT") {
        const body = await readJson(req);
        await checkPassword(body.current);
        await store.updateUser(actor.id, {
            passwordHash: await hashPassword(password(body.password)),
        });
        await store.deleteSessions(actor.id, current?.id);
        audit("auth.password_changed", { user: actor.id });
        return [200, { ok: true }];
    }
    if (path === "/api/me/two-factor/setup" && method === "POST") {
        await checkPassword((await readJson(req)).password);
        return [200, newTotp(actor)];
    }
    if (path === "/api/me/two-factor/enable" && method === "POST")
        return [200, { backupCodes: await enableTotp(store, cfg, actor, await readJson(req)) }];
    if (path === "/api/me/two-factor" && method === "DELETE") {
        await checkPassword((await readJson(req)).password);
        // The second factor is mandatory: without the app the codes must come by e-mail.
        if (!mailReady(cfg) || !actor.email) throw new HttpError(409, "auth.appRequired");
        await store.updateUser(actor.id, { totpSecret: null, backupCodes: [] });
        audit("auth.two_factor_disabled", { user: actor.id });
        return [200, await store.user(actor.id)];
    }
    if (path === "/api/me/backup-codes" && method === "POST") {
        await checkPassword((await readJson(req)).password);
        if (!actor.totp) throw new HttpError(409, "auth.appRequired");
        const codes = newBackupCodes();
        await store.updateUser(actor.id, { backupCodes: codes.map(hashBackupCode) });
        return [200, { backupCodes: codes }];
    }
    if (path === "/api/me/sessions") {
        if (method === "GET")
            return [
                200,
                (await store.sessions(actor.id))
                    .filter((s) => s.verifiedAt && readSession(s))
                    .map(({ id, createdAt, seenAt, ip, userAgent }) => ({
                        id,
                        createdAt,
                        seenAt,
                        ip,
                        userAgent,
                        current: id === current?.id,
                    })),
            ];
        if (method === "DELETE") {
            await store.deleteSessions(actor.id, current?.id);
            return [200, { ok: true }];
        }
    }
    const one = /^\/api\/me\/sessions\/([0-9a-f]{64})$/.exec(path);
    if (one && method === "DELETE") {
        const session = await store.session(one[1] as string);
        if (session?.user === actor.id) await store.deleteSession(session.id);
        return [200, { ok: true }];
    }
    return undefined;
}
