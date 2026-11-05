import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { agentsRoute } from "./api/agents.ts";
import { authRoute, sessionUser } from "./api/auth.ts";
import { automationsRoute } from "./api/automations.ts";
import { dispatchRoute } from "./api/dispatch.ts";
import { githubRoute } from "./api/github.ts";
import { integrationsRoute } from "./api/integrations.ts";
import { memoryRoute, stepMemoryRoute } from "./api/memory.ts";
import { previewRoute } from "./api/preview.ts";
import { projectSettingsRoute } from "./api/project-settings.ts";
import { projectsRoute } from "./api/projects.ts";
import type { Answer } from "./api/shared.ts";
import { skillsRoute } from "./api/skills.ts";
import { systemRoute } from "./api/system.ts";
import { tasksRoute } from "./api/tasks.ts";
import { terminalsRoute } from "./api/terminals.ts";
import { usersRoute } from "./api/users.ts";
import { workflowsRoute } from "./api/workflows.ts";
import { EventBus } from "./bus.ts";
import type { Config } from "./config.ts";
import { FileBody, HttpError } from "./http.ts";
import { localeFrom, t } from "./i18n.ts";
import type { Session, Store, User } from "./store.ts";
import { onTerminalChange } from "./terminals.ts";
import { hashToken, userHome } from "./users.ts";
import { isApiPath, panelBuilt, servePanel } from "./web.ts";

// Without accounts the API trusts anything that reaches it, so it only answers on loopback names;
// a web page cannot reach it either: cross-origin writes need an Origin match and a JSON body. With
// accounts every request carries a token, and the host name of a TLS proxy is accepted too.
function guard(req: IncomingMessage, port: number, publicHost: string | null): void {
    const local = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
    const hosts = publicHost ? [...local, publicHost] : local;
    if (!hosts.includes(req.headers.host ?? "")) throw new HttpError(403, "request.unknownHost");
    const origins = [
        ...local.map((host) => `http://${host}`),
        ...(publicHost ? [`https://${publicHost}`] : []),
    ];
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) throw new HttpError(403, "request.foreignOrigin");
    if (req.method !== "GET" && !req.headers["content-type"]?.startsWith("application/json"))
        throw new HttpError(415, "request.expectedJson");
}

// A token (MCP, scripts) or the panel's session cookie; `session` only for the panel.
async function authenticate(
    store: Store,
    req: IncomingMessage,
): Promise<{ user: User; session: Session | null }> {
    const token = /^Bearer +(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!token) {
        const signedIn = await sessionUser(store, req);
        if (!signedIn) throw new HttpError(401, "auth.missingToken");
        return signedIn;
    }
    const user = await store.userByToken(hashToken(token));
    if (!user) throw new HttpError(401, "auth.invalidToken");
    return { user, session: null };
}

const isHealth = (req: IncomingMessage) =>
    req.method === "GET" && new URL(req.url ?? "/", "http://localhost").pathname === "/health";

// `actor` is the caller's account; null only while there are no accounts. `session` is the
// panel's sign-in, null for a token.
async function route(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    actor: User | null,
    session: Session | null = null,
): Promise<Answer> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const home = actor ? userHome(cfg, actor.id) : cfg.installationHome;
    if (isHealth(req)) return [200, { ok: true }];
    const answer =
        (await terminalsRoute(store, cfg, req, url)) ??
        (await previewRoute(cfg, req, path)) ??
        (await usersRoute(store, cfg, req, path, actor, session)) ??
        (await projectsRoute(store, cfg, req, url, actor)) ??
        (await githubRoute(store, cfg, req, path, actor)) ??
        (await systemRoute(store, cfg, req, url, actor)) ??
        (await agentsRoute(store, cfg, req, path, actor)) ??
        (await projectSettingsRoute(store, cfg, req, path, actor, home)) ??
        (await integrationsRoute(store, req, path)) ??
        (await memoryRoute(store, cfg, req, url, actor)) ??
        (await skillsRoute(store, cfg, req, url, home)) ??
        (await tasksRoute(store, cfg, req, url, actor, home)) ??
        (await automationsRoute(store, cfg, req, path, actor, home)) ??
        (await workflowsRoute(store, cfg, req, path, actor, home));
    if (answer) return answer;
    throw new HttpError(404, "request.notFound");
}

// Server-Sent Events from the bus, one stream per connection. A client that closes, or reads too
// slowly for its buffer, is dropped with everything it held.
const STREAMS_MAX = 10;
const STREAM_BUFFER_MAX = 1024 * 1024;
const HEARTBEAT_MS = 25_000;

function openStream(req: IncomingMessage, res: ServerResponse, bus: EventBus, open: Set<object>) {
    if (open.size >= STREAMS_MAX) throw new HttpError(503, "events.tooMany", { max: STREAMS_MAX });
    const handle = {};
    open.add(handle);
    res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
    });
    res.write(": olimp events\n\n");
    let id = 0;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        open.delete(handle);
        res.destroy();
    };
    const unsubscribe = bus.subscribe((event) => {
        if (res.writableLength > STREAM_BUFFER_MAX) return close();
        res.write(`id: ${++id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    req.on("close", close);
    res.on("close", close);
    res.on("error", close);
}

// `bus` is the one the store publishes on (see `publishing`); GET /api/events streams it.
export function createApi(store: Store, cfg: Config, bus: EventBus = new EventBus()): Server {
    const streams = new Set<object>();
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        let status = 500;
        let payload: unknown;
        let cookie: string | undefined;
        const locale = localeFrom(req.headers["accept-language"]);
        try {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : cfg.port;
            const accounts = await store.hasUsers();
            guard(req, port, accounts ? cfg.publicHost : null);
            const path = new URL(req.url ?? "/", "http://localhost").pathname;
            // The panel's files hold no data, so they need no token: the panel signs in itself.
            if (req.method === "GET" && !isApiPath(path)) {
                if (cfg.devPanel) {
                    res.writeHead(302, { location: `${cfg.devPanel}${req.url ?? "/"}` });
                    res.end();
                    return;
                }
                if (!panelBuilt(cfg.webDir)) {
                    if (path === "/") throw new HttpError(404, "panel.notBuilt");
                } else if (await servePanel(cfg.webDir, path, res)) return;
            }
            // A dispatched task's agent and an agent step's memory tools sign their calls with
            // their own token, never an account's.
            const dispatching = path === "/api/dispatch/subtasks";
            const stepping = req.headers["x-olimp-step"] !== undefined;
            const signIn =
                !dispatching && !stepping && (accounts || path === "/api/auth/login")
                    ? await authRoute(store, cfg, req, path, locale)
                    : undefined;
            if (dispatching) {
                [status, payload] = await dispatchRoute(store, req);
            } else if (stepping) {
                [status, payload] = await stepMemoryRoute(store, cfg, req);
            } else if (signIn) {
                status = signIn.status;
                payload = signIn.payload;
                if (signIn.cookie) cookie = signIn.cookie;
            } else {
                // The token comes only in the Authorization header, never in the URL, also here.
                const caller = accounts && !isHealth(req) ? await authenticate(store, req) : null;
                if (path === "/api/events" && req.method === "GET")
                    return openStream(req, res, bus, streams);
                [status, payload] = await route(
                    store,
                    cfg,
                    req,
                    caller?.user ?? null,
                    caller?.session,
                );
            }
        } catch (error) {
            // Anything but an HttpError carries raw output of git, gh or the store: kept untranslated.
            const failure =
                error instanceof HttpError
                    ? error
                    : new HttpError(500, "request.internal", {
                          detail: error instanceof Error ? error.message : String(error),
                      });
            status = failure.status;
            payload = { error: t(locale, failure.code, failure.params), code: failure.code };
        }
        if (payload instanceof FileBody) {
            res.writeHead(status, {
                "content-type": payload.type,
                "content-disposition": payload.disposition,
                "x-content-type-options": "nosniff",
                "cache-control": "private, max-age=3600",
            });
            res.end(payload.data);
            return;
        }
        res.writeHead(status, {
            "content-type": "application/json",
            ...(status === 401 ? { "www-authenticate": "Bearer" } : {}),
            ...(cookie ? { "set-cookie": cookie } : {}),
            // Account responses may carry a token.
            "cache-control": "no-store",
        });
        res.end(JSON.stringify(payload));
    });
    const unwatch = onTerminalChange((session) =>
        bus.publish({ type: "terminal", owner: session.owner, id: session.id }),
    );
    server.on("close", unwatch);
    return server;
}
