import type { IncomingMessage } from "node:http";
import { hashPassword } from "../auth.ts";
import type { Config } from "../config.ts";
import { HttpError, readJson, requireAdmin } from "../http.ts";
import { localeFrom } from "../i18n.ts";
import { mailReady } from "../mail.ts";
import type { Role, Session, Store, Token, User } from "../store.ts";
import {
    createUserHome,
    hashToken,
    isRole,
    newToken,
    ROLES,
    removeUserHome,
    USER_ID,
} from "../users.ts";
import { email, meRoute, password, sendLink, userName } from "./auth.ts";
import type { Answer } from "./shared.ts";

function roleOf(value: unknown): Role {
    const role = value === undefined ? "member" : value;
    if (!isRole(role)) throw new HttpError(400, "account.invalidRole", { roles: ROLES.join(", ") });
    return role;
}

async function accountOf(store: Store, id: string): Promise<User> {
    const user = USER_ID.test(id) ? await store.user(id) : undefined;
    if (!user) throw new HttpError(404, "account.notFound", { account: id });
    return user;
}

// The token itself is in the response only here, once.
const issued = (token: Token, value: string) => ({ ...token, token: value });

export async function usersRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    actor: User | null,
    session: Session | null,
): Promise<Answer | undefined> {
    const method = req.method;
    const locale = localeFrom(req.headers["accept-language"]);
    if (path === "/api/me" && method === "GET") {
        if (!actor) throw new HttpError(404, "account.none");
        return [200, { ...actor, tokens: await store.tokens(actor.id), mail: mailReady(cfg) }];
    }
    if (actor && (path === "/api/me" || path.startsWith("/api/me/"))) {
        const own = await meRoute(store, cfg, req, path, actor, session);
        if (own) return own;
    }
    if (path === "/api/users") {
        if (method === "GET") {
            requireAdmin(actor);
            return [200, await store.users()];
        }
        if (method === "POST") {
            requireAdmin(actor);
            const body = await readJson(req);
            const name = userName(body.name);
            const address = body.email === undefined ? null : email(body.email);
            // The first account, made without a token while there are none, is the admin; it
            // may set its password at once, since nobody could send it a link yet.
            const role = actor ? roleOf(body.role) : "admin";
            const passwordHash =
                !actor && body.password !== undefined
                    ? await hashPassword(password(body.password))
                    : null;
            // An account that signs in to the panel (invited, or the first with a password) needs
            // no token; one for scripts and agents gets its first token.
            const token = (actor && address) || passwordHash ? null : newToken();
            const created = await store.createUser(
                { name, role, email: address, passwordHash },
                token && hashToken(token),
                !actor,
            );
            if (!created) {
                if (!actor) throw new HttpError(401, "auth.missingToken");
                throw new HttpError(409, "account.exists", { name });
            }
            createUserHome(cfg, created.user.id);
            const invited =
                actor && address ? await sendLink(store, cfg, locale, created.user) : null;
            return [
                201,
                {
                    ...created.user,
                    ...(token && created.token && { token: issued(created.token, token) }),
                    ...(invited && { sent: invited }),
                },
            ];
        }
    }
    const user = /^\/api\/users\/([^/]+)(\/tokens|\/link|\/two-factor)?$/.exec(path);
    if (user) {
        const account = await accountOf(store, user[1] as string);
        if (!user[2] && method === "PATCH") {
            requireAdmin(actor);
            const body = await readJson(req);
            const updated = await store.updateUser(account.id, {
                name: body.name === undefined ? undefined : userName(body.name),
                email: body.email === undefined ? undefined : email(body.email),
                role: body.role === undefined ? undefined : roleOf(body.role),
            });
            if (updated === "lastAdmin")
                throw new HttpError(409, "account.lastAdmin", { account: account.name });
            if (updated === "taken")
                throw new HttpError(409, "account.exists", {
                    name: String(body.name ?? body.email),
                });
            if (updated === "missing")
                throw new HttpError(404, "account.notFound", { account: account.id });
            return [200, updated];
        }
        if (user[2] === "/link" && method === "POST") {
            requireAdmin(actor);
            return [200, { sent: await sendLink(store, cfg, locale, account) }];
        }
        // For a lost phone: back to codes by e-mail, or to setting the app up at the next sign-in.
        if (user[2] === "/two-factor" && method === "DELETE") {
            requireAdmin(actor);
            await store.updateUser(account.id, { totpSecret: null, backupCodes: [] });
            await store.deleteSessions(account.id);
            return [200, await store.user(account.id)];
        }
        if (!user[2] && method === "DELETE") {
            requireAdmin(actor);
            const deleted = await store.deleteUser(account.id);
            if (deleted === "lastAdmin")
                throw new HttpError(409, "account.lastAdmin", { account: account.name });
            if (deleted === "missing")
                throw new HttpError(404, "account.notFound", { account: account.id });
            removeUserHome(cfg, account.id);
            return [200, account];
        }
        if (user[2] === "/tokens" && method === "GET") {
            if (actor?.id !== account.id) requireAdmin(actor);
            return [200, await store.tokens(account.id)];
        }
        if (user[2] === "/tokens" && method === "POST") {
            requireAdmin(actor);
            const token = newToken();
            return [201, issued(await store.addToken(account.id, hashToken(token)), token)];
        }
    }
    const tokenId = /^\/api\/tokens\/([0-9a-f]{12})$/.exec(path);
    if (tokenId && method === "DELETE") {
        const token = await store.token(tokenId[1] as string);
        if (!token) throw new HttpError(404, "token.notFound", { token: tokenId[1] as string });
        // Anyone may revoke their own token, e.g. one that leaked.
        if (actor?.id !== token.user) requireAdmin(actor);
        await store.deleteToken(token.id);
        return [200, token];
    }
    return undefined;
}
