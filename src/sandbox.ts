import { AGENT_SPECS, type AgentName, type Servers } from "./agents.ts";
import { variablesOf } from "./integrations.ts";
import { COMMAND_MAX, COMMANDS_MAX } from "./limits.ts";

const SYSTEM = new Set([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LANGUAGE",
    "TZ",
    "TERM",
    "TMPDIR",
    ...["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"].flatMap((n) => [n, n.toLowerCase()]),
]);

const ENV_NAME = /^[A-Za-z_]\w*$/;

// OLIMP's own variables (the database URL, the test database, binaries) never reach an agent.
export const isOlimpVariable = (name: string) => name.toUpperCase().startsWith("OLIMP_");

// Names an agent gets without an integration asking for them: system variables and the agents' own.
export const passedToAgents = (name: string) =>
    SYSTEM.has(name) ||
    name.startsWith("LC_") ||
    Object.values(AGENT_SPECS).some((spec) => spec.envPrefixes.some((p) => name.startsWith(p)));

// OLIMP_AGENT_ENV, comma-separated: names that are not variable names or belong to OLIMP are
// refused, so the start-up log can name them.
export function parseAgentEnv(value: string | undefined): { names: string[]; refused: string[] } {
    const names: string[] = [];
    const refused: string[] = [];
    for (const raw of (value ?? "").split(",")) {
        const name = raw.trim();
        if (!name) continue;
        if (ENV_NAME.test(name) && !isOlimpVariable(name)) names.push(name);
        else refused.push(name);
    }
    return { names: [...new Set(names)], refused };
}

// The whole environment of an agent process: system variables, the agent's own login and
// configuration, the variables the step's integrations refer to and the names in OLIMP_AGENT_ENV.
// With a user's `home` the agent runs on that user's login: HOME is theirs and the installation's
// login and configuration variables stay out.
export function agentEnv(
    agent: AgentName,
    servers: Servers,
    extra: string[],
    env: NodeJS.ProcessEnv = process.env,
    home: string | null = null,
): Record<string, string> {
    const named = new Set([...extra, ...Object.values(servers).flatMap(variablesOf)]);
    const allowed = (name: string) =>
        !isOlimpVariable(name) &&
        (SYSTEM.has(name) ||
            name.startsWith("LC_") ||
            (!home && AGENT_SPECS[agent].envPrefixes.some((prefix) => name.startsWith(prefix))) ||
            named.has(name));
    const passed = Object.fromEntries(
        Object.entries(env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined && allowed(entry[0]),
        ),
    );
    return home ? { ...passed, HOME: home } : passed;
}

// Characters that chain, substitute or redirect shell commands, a line break, and `( ) , * \`,
// which no check needs: each entry stays one plain command.
const FORBIDDEN = /[;&|`$<>(),*\\\p{Cc}]/u;

// The commands a repository's agents check their work with, normalised (single spaces, no duplicates), or null
// when the value is not such a list.
export function parseCommands(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0 || value.length > COMMANDS_MAX) return null;
    const commands: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") return null;
        const command = item.trim().replace(/ +/g, " ");
        if (!command || command.length > COMMAND_MAX || FORBIDDEN.test(command)) return null;
        commands.push(command);
    }
    return [...new Set(commands)];
}
