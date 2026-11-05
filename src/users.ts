import { createHash, randomBytes } from "node:crypto";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { AGENT_SPECS, type AgentName, DEFAULT_LOGIN, LOGIN_NAME } from "./agents.ts";
import type { Config } from "./config.ts";
import { run } from "./proc.ts";
import { agentEnv } from "./sandbox.ts";
import type { Role, Store } from "./store.ts";

export const ROLES = ["admin", "member"] as const satisfies readonly Role[];
export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);

export const USER_ID = /^[0-9a-f]{12}$/;

// A token is a password: 256 random bits, of which the database keeps only the SHA-256 hash.
export const newToken = () => `olimp_${randomBytes(32).toString("base64url")}`;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const userDir = (cfg: Pick<Config, "home">, id: string) => join(cfg.home, "users", id);

// The HOME of the account's agents, where `claude` and `codex` keep its own login.
export const userHome = (cfg: Pick<Config, "home">, id: string) => join(userDir(cfg, id), "home");

export function createUserHome(cfg: Pick<Config, "home">, id: string): void {
    mkdirSync(userHome(cfg, id), { recursive: true, mode: 0o700 });
}

// The agent logins of a deleted account go with it.
export function removeUserHome(cfg: Pick<Config, "home">, id: string): void {
    rmSync(userDir(cfg, id), { recursive: true, force: true });
}

type Homes = Pick<Config, "home" | "installationHome" | "agentEnv" | AgentName>;

// A long-lived token pasted in the panel, kept beside the login's own file, readable only by OLIMP.
export const TOKEN_FILE = "olimp-oauth-token";

function tokenEnv(agent: AgentName, dir: string): Record<string, string> {
    const variable = AGENT_SPECS[agent].tokenEnv;
    const file = join(dir, TOKEN_FILE);
    return variable && existsSync(file) ? { [variable]: readFileSync(file, "utf8").trim() } : {};
}

export interface AgentLogin {
    name: string;
    // The agent's configuration folder, where its login file is.
    dir: string;
    // null when OLIMP cannot tell (no way to check, or the CLI is not installed).
    loggedIn: boolean | null;
    // The one the CLI finds in HOME by itself; the others are folders OLIMP made or was pointed at.
    discovered: boolean;
    // A folder chosen when it was added (OLIMP keeps only a link to it): removing the login
    // leaves it on the disk.
    linked: boolean;
    // Logged in with a token pasted in the panel, which can be replaced or removed there.
    token: boolean;
}

// `owner` is an account id, or null for the installation (no accounts, or a step without author).
const loginsRoot = (cfg: Homes, owner: string | null, agent: AgentName) =>
    join(owner ? userDir(cfg, owner) : cfg.home, "logins", agent);

const PROBE_TIMEOUT_MS = 10_000;

async function loggedIn(
    cfg: Homes,
    owner: string | null,
    agent: AgentName,
    dir: string,
): Promise<boolean | null> {
    const how = AGENT_SPECS[agent].login;
    if (Object.keys(tokenEnv(agent, dir)).length) return true;
    if (!how) return null;
    if ("file" in how) return existsSync(join(dir, how.file));
    const bin = cfg[agent];
    if (!bin) return null;
    const home = owner ? userHome(cfg, owner) : null;
    const res = await run(bin, how.probe, {
        cwd: home ?? cfg.installationHome,
        timeoutMs: PROBE_TIMEOUT_MS,
        env: agentEnv(agent, {}, cfg.agentEnv, process.env, home),
    });
    return res.code === -1 ? null : how.ok.test(`${res.stdout}\n${res.stderr}`);
}

// A login's folder in OLIMP's logins: the folder itself, or a link to the one chosen.
function linkTarget(path: string): string | null {
    try {
        return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null;
    } catch {
        return null;
    }
}

async function loginOf(
    cfg: Homes,
    owner: string | null,
    agent: AgentName,
    name: string,
    path: string,
): Promise<AgentLogin> {
    const target = name === DEFAULT_LOGIN ? null : linkTarget(path);
    const dir = target ?? path;
    return {
        name,
        dir,
        loggedIn: await loggedIn(cfg, owner, agent, dir),
        discovered: name === DEFAULT_LOGIN,
        linked: target !== null,
        token: Object.keys(tokenEnv(agent, dir)).length > 0,
    };
}

export async function agentLogins(
    cfg: Homes,
    owner: string | null,
    agent: AgentName,
): Promise<AgentLogin[]> {
    const home = owner ? userHome(cfg, owner) : cfg.installationHome;
    const root = loginsRoot(cfg, owner, agent);
    const names =
        AGENT_SPECS[agent].configEnv && existsSync(root)
            ? readdirSync(root, { withFileTypes: true })
                  .filter(
                      (entry) =>
                          (entry.isDirectory() || entry.isSymbolicLink()) &&
                          LOGIN_NAME.test(entry.name),
                  )
                  .map((entry) => entry.name)
                  .sort()
            : [];
    return Promise.all([
        loginOf(cfg, owner, agent, DEFAULT_LOGIN, join(home, AGENT_SPECS[agent].configDir)),
        ...names.map((name) => loginOf(cfg, owner, agent, name, join(root, name))),
    ]);
}

// A new login, or null when the name is taken. Only an agent whose folder a variable moves can
// have one. Without `folder` OLIMP makes an empty one; with it (an absolute path, made when
// missing) OLIMP links to it.
export async function addLogin(
    cfg: Homes,
    owner: string | null,
    agent: AgentName,
    name: string,
    folder: string | null = null,
): Promise<AgentLogin | null> {
    const root = loginsRoot(cfg, owner, agent);
    const path = join(root, name);
    if (!AGENT_SPECS[agent].configEnv || name === DEFAULT_LOGIN) return null;
    if (existsSync(path) || linkTarget(path)) return null;
    if (folder) {
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        mkdirSync(root, { recursive: true, mode: 0o700 });
        symlinkSync(folder, path);
    } else mkdirSync(path, { recursive: true, mode: 0o700 });
    return loginOf(cfg, owner, agent, name, path);
}

// Saves a login's pasted token, or removes it (null); null when there is no such login.
export async function setLoginToken(
    cfg: Homes,
    owner: string | null,
    agent: AgentName,
    name: string,
    token: string | null,
): Promise<AgentLogin | null> {
    const found = (await agentLogins(cfg, owner, agent)).find((l) => l.name === name);
    if (!found) return null;
    const file = join(found.dir, TOKEN_FILE);
    if (token === null) rmSync(file, { force: true });
    else {
        mkdirSync(found.dir, { recursive: true, mode: 0o700 });
        writeFileSync(file, token, { mode: 0o600 });
    }
    return (await agentLogins(cfg, owner, agent)).find((l) => l.name === name) ?? null;
}

// Removes a login: a chosen folder only loses OLIMP's link to it, a folder OLIMP made goes with
// the login in it. The one in HOME is never OLIMP's to remove.
export function removeLogin(
    cfg: Homes,
    owner: string | null,
    agent: AgentName,
    name: string,
): boolean {
    const path = join(loginsRoot(cfg, owner, agent), name);
    if (name === DEFAULT_LOGIN || !LOGIN_NAME.test(name)) return false;
    if (linkTarget(path)) unlinkSync(path);
    else if (existsSync(path)) rmSync(path, { recursive: true, force: true });
    else return false;
    return true;
}

// How an agent step runs: on its author's HOME (null, the installation's, for a step without an
// author), on the login its project chose for the agent. A missing login is an error, never the
// installation's login.
export async function agentHome(
    store: Store,
    cfg: Homes,
    author: string | null,
    agent: AgentName,
    login: string | null = null,
): Promise<{ home: string | null; env: Record<string, string>; dir: string }> {
    const user = author ? await store.user(author) : null;
    if (author && !user)
        throw new Error(`account ${author}, on whose behalf this runs, was deleted`);
    const owner = user?.id ?? null;
    const name = login ?? DEFAULT_LOGIN;
    const home = owner ? userHome(cfg, owner) : null;
    const spec = AGENT_SPECS[agent];
    if (name === DEFAULT_LOGIN && !owner) {
        const dir = join(cfg.installationHome, spec.configDir);
        return { home, env: tokenEnv(agent, dir), dir };
    }
    const found = (await agentLogins(cfg, owner, agent)).find((l) => l.name === name);
    // A login OLIMP cannot check is left to the CLI, which fails on its own without one.
    if (!found || found.loggedIn === false) {
        const which = name === DEFAULT_LOGIN ? "of their own" : `"${name}"`;
        const how = user
            ? `\`pnpm agent-login ${agent}${login ? ` ${login}` : ""}\` and OLIMP_TOKEN set to their token${spec.tokenEnv ? ", or paste a token in the panel (Settings, Agent accounts, Connect)" : ""}`
            : `${spec.configEnv}=${found?.dir ?? "<folder>"} ${[agent, ...spec.loginArgs].join(" ")}`;
        throw new Error(
            `${user?.name ?? "this installation"} has no ${agent} login ${which}` +
                `${found ? "" : " (add it under agent accounts)"}: log in with ${how}`,
        );
    }
    return {
        home,
        env: {
            ...(found.discovered || !spec.configEnv ? {} : { [spec.configEnv]: found.dir }),
            ...tokenEnv(agent, found.dir),
        },
        dir: found.dir,
    };
}
