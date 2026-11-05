import { spawn } from "node:child_process";
import {
    AGENT_SPECS,
    AGENTS,
    type AgentName,
    DEFAULT_LOGIN,
    isAgent,
    LOGIN_NAME,
} from "./agents.ts";
import { loadConfig, resolveBin } from "./config.ts";
import { agentEnv } from "./sandbox.ts";
import { addLogin, agentLogins, createUserHome, USER_ID, userHome } from "./users.ts";

// `pnpm agent-login <claude|codex> [login]` logs an agent CLI in as the account of OLIMP_TOKEN,
// into that account's HOME under OLIMP_HOME (or a second login's folder beside it), on the machine
// OLIMP runs on. Only the API opens the database, so the account comes from GET /api/me.

function fail(message: string): never {
    console.error(`agent-login: ${message}`);
    process.exit(1);
}

async function whoAmI(base: string, token: string): Promise<{ id: string; name: string }> {
    const res = await fetch(`${base}/api/me`, {
        headers: { authorization: `Bearer ${token}`, "accept-language": "en" },
    }).catch((error: unknown) => fail(`OLIMP API at ${base}: ${error}`));
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) fail(`OLIMP API at ${base}: ${body.error ?? `HTTP ${res.status}`}`);
    if (typeof body.id !== "string" || !USER_ID.test(body.id) || typeof body.name !== "string")
        fail(`OLIMP API at ${base}: unexpected answer to GET /api/me`);
    return { id: body.id, name: body.name };
}

async function main(arg: string | undefined, login = DEFAULT_LOGIN): Promise<void> {
    if (!isAgent(arg) || !LOGIN_NAME.test(login))
        fail(`usage: pnpm agent-login <${AGENTS.join("|")}> [login]`);
    const agent: AgentName = arg;
    const token = process.env.OLIMP_TOKEN?.trim();
    if (!token) fail("set OLIMP_TOKEN to your OLIMP token: the login goes to its account");
    const cfg = loadConfig();
    const user = await whoAmI(process.env.OLIMP_URL ?? `http://127.0.0.1:${cfg.port}`, token);
    const { configEnv, loginArgs } = AGENT_SPECS[agent];
    if (login !== DEFAULT_LOGIN && !configEnv)
        fail(`${agent} keeps its login outside its config folder: it has one login per account`);
    const configured = cfg[agent] ?? agent;
    const bin = await resolveBin(configured).catch(() =>
        fail(`${agent} CLI not found: install it or set OLIMP_${agent.toUpperCase()}`),
    );
    const home = userHome(cfg, user.id);
    createUserHome(cfg, user.id);
    const second =
        login === DEFAULT_LOGIN
            ? null
            : ((await agentLogins(cfg, user.id, agent)).find((l) => l.name === login) ??
              (await addLogin(cfg, user.id, agent, login)));
    const where = second ? `, ${configEnv}=${second.dir}` : "";
    console.log(`agent-login: ${agent} for ${user.name}, HOME=${home}${where}`);
    const child = spawn(bin, loginArgs, {
        cwd: home,
        stdio: "inherit",
        env: {
            ...agentEnv(agent, {}, cfg.agentEnv, process.env, home),
            ...(second && configEnv ? { [configEnv]: second.dir } : {}),
        },
    });
    child.on("error", (error) => fail(`${agent}: ${error.message}`));
    child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

await main(process.argv[2], process.argv[3]);
