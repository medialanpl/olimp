import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { AGENT_SPECS, AGENTS, type AgentName, isAgent, LOGIN_NAME } from "../agents.ts";
import { slugify } from "../clones.ts";
import { type Config, expandHome } from "../config.ts";
import { HttpError, readJson, requireAdmin } from "../http.ts";
import { PATH_MAX } from "../limits.ts";
import { agentsInfo } from "../machine.ts";
import { listModels } from "../models.ts";
import { agentDefaults, agentDefaultsOf } from "../settings.ts";
import type { Store, User } from "../store.ts";
import {
    addLogin,
    agentLogins,
    createUserHome,
    removeLogin,
    setLoginToken,
    userHome,
} from "../users.ts";
import type { Answer } from "./shared.ts";

// A second login may live in any folder, which does not have to exist yet; only
// without accounts, since with them one account could point at another's login.
function loginFolder(
    cfg: Config,
    agent: AgentName,
    value: unknown,
    actor: User | null,
): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (actor) throw new HttpError(403, "login.folderWithAccounts");
    const folder = typeof value === "string" && value.length <= PATH_MAX ? expandHome(value) : "";
    if (!isAbsolute(folder)) throw new HttpError(400, "login.invalidFolder");
    const own = resolve(folder);
    if (own === join(cfg.installationHome, AGENT_SPECS[agent].configDir))
        throw new HttpError(400, "login.defaultFolder");
    return own;
}

// A login name from a folder's name: ".claude-work" is "claude-work".
const slugOf = (name: string) => slugify(name, 32);

// Printable, without spaces: what `claude setup-token` prints.
const TOKEN = /^[\x21-\x7e]{20,1000}$/;

export async function agentsRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    actor: User | null,
): Promise<Answer | undefined> {
    const method = req.method;
    if (path === "/api/agents" && method === "GET")
        return [200, await agentsInfo(cfg, actor?.id ?? null)];
    const logins = /^\/api\/agents\/([a-z]+)\/logins(?:\/([^/]+)(\/token)?)?$/.exec(path);
    const agent = logins?.[1];
    if (logins && isAgent(agent)) {
        const name = logins[2];
        const owner = actor?.id ?? null;
        if (!name && method === "POST") {
            const body = await readJson(req);
            const spec = AGENT_SPECS[agent];
            if (!spec.configEnv) throw new HttpError(400, "login.single", { agent: spec.label });
            const folder = loginFolder(cfg, agent, body.folder, actor);
            const login = body.name ?? (folder ? slugOf(basename(folder)) : undefined);
            if (typeof login !== "string" || !LOGIN_NAME.test(login))
                throw new HttpError(400, "login.invalidName");
            const added = await addLogin(cfg, owner, agent, login, folder);
            if (!added) throw new HttpError(409, "login.exists", { login });
            return [201, added];
        }
        // A token from `claude setup-token`, pasted instead of a terminal login; never returned.
        if (name && logins[3] && (method === "PUT" || method === "DELETE")) {
            const spec = AGENT_SPECS[agent];
            if (!spec.tokenEnv) throw new HttpError(400, "login.noToken", { agent: spec.label });
            let token: string | null = null;
            if (method === "PUT") {
                const value = (await readJson(req)).token;
                token = typeof value === "string" ? value.trim() : "";
                if (!TOKEN.test(token) || !token.startsWith(spec.tokenPrefix ?? ""))
                    throw new HttpError(400, "login.invalidToken");
            }
            if (owner) createUserHome(cfg, owner);
            const login = await setLoginToken(cfg, owner, agent, name, token);
            if (!login) throw new HttpError(404, "login.notFound", { login: name });
            return [200, login];
        }
        if (name && !logins[3] && method === "DELETE") {
            if (!removeLogin(cfg, owner, agent, name))
                throw new HttpError(404, "login.notFound", { login: name });
            return [200, await agentLogins(cfg, owner, agent)];
        }
    }
    if (path === "/api/agent-defaults") {
        if (method === "GET") return [200, await agentDefaults(store)];
        if (method === "PUT") {
            requireAdmin(actor);
            const defaults = agentDefaultsOf(await readJson(req));
            if (!defaults)
                throw new HttpError(400, "agents.invalid", { agents: AGENTS.join(", ") });
            await store.saveSettings({ agentDefaults: JSON.stringify(defaults) });
            return [200, defaults];
        }
    }
    if (path === "/api/models" && method === "GET")
        return [200, await listModels(cfg, actor ? userHome(cfg, actor.id) : homedir())];
    return undefined;
}
