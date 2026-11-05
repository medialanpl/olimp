import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { AgentName } from "./agents.ts";
import { HttpError } from "./http.ts";
import { AGENT_CONFIG_MAX } from "./limits.ts";
import { run } from "./proc.ts";

// `local` is in the project's folder too, but git-ignored: personal, never committed.
export type ConfigScope = "user" | "project" | "local";
export type ConfigKind = "settings" | "mcp" | "memory";
type Format = "json" | "jsonc" | "toml" | "markdown";

interface ConfigFile {
    id: string;
    agents: AgentName[];
    kind: ConfigKind;
    scope: ConfigScope;
    // Relative to HOME for the user scope, to the project's folder for the project one.
    path: string;
    format: Format;
    // The agent's own documentation of the file.
    docs: string;
    // Copied into each job's worktree, which git would otherwise leave without it.
    seeded: boolean;
}

// Each agent's documentation of its config files.
const DOCS: Record<string, string> = {
    "claude.settings": "https://code.claude.com/docs/en/settings",
    "claude.mcp": "https://code.claude.com/docs/en/mcp",
    "claude.memory": "https://code.claude.com/docs/en/memory",
    "codex.settings": "https://developers.openai.com/codex/config-reference",
    "codex.memory": "https://developers.openai.com/codex/guides/agents-md",
    "project.agents": "https://opencode.ai/docs/rules/",
    "opencode.settings": "https://opencode.ai/docs/config/",
    "opencode.memory": "https://opencode.ai/docs/rules/",
    "copilot.settings": "https://docs.github.com/en/copilot/how-tos/copilot-cli",
    "copilot.mcp": "https://docs.github.com/en/copilot/how-tos/copilot-cli#mcp-servers",
    "copilot.memory":
        "https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot",
    "cursor.settings": "https://cursor.com/docs/cli/reference/configuration",
    "cursor.mcp": "https://cursor.com/docs/cli/reference/configuration",
    "pi.settings": "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
    "pi.memory": "https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md",
};

// Only Claude documents a git-ignored personal layer meant to be read as it is.
const SEEDED = new Set(["claude.local.settings", "claude.local.memory"]);

// The catalog of the agents' own config files.
export const CONFIG_FILES: ConfigFile[] = [
    ["claude.user.settings", ["claude"], "settings", "user", ".claude/settings.json", "json"],
    ["claude.project.settings", ["claude"], "settings", "project", ".claude/settings.json", "json"],
    [
        "claude.local.settings",
        ["claude"],
        "settings",
        "local",
        ".claude/settings.local.json",
        "json",
    ],
    ["claude.project.mcp", ["claude"], "mcp", "project", ".mcp.json", "json"],
    ["claude.user.memory", ["claude"], "memory", "user", ".claude/CLAUDE.md", "markdown"],
    ["claude.project.memory", ["claude"], "memory", "project", "CLAUDE.md", "markdown"],
    ["claude.local.memory", ["claude"], "memory", "local", "CLAUDE.local.md", "markdown"],
    ["codex.user.config", ["codex"], "settings", "user", ".codex/config.toml", "toml"],
    ["codex.project.config", ["codex"], "settings", "project", ".codex/config.toml", "toml"],
    ["codex.user.memory", ["codex"], "memory", "user", ".codex/AGENTS.md", "markdown"],
    [
        "project.agents",
        ["codex", "opencode", "copilot", "pi"],
        "memory",
        "project",
        "AGENTS.md",
        "markdown",
    ],
    [
        "opencode.user.config",
        ["opencode"],
        "settings",
        "user",
        ".config/opencode/opencode.json",
        "jsonc",
    ],
    ["opencode.project.config", ["opencode"], "settings", "project", "opencode.json", "jsonc"],
    [
        "opencode.user.memory",
        ["opencode"],
        "memory",
        "user",
        ".config/opencode/AGENTS.md",
        "markdown",
    ],
    ["copilot.user.config", ["copilot"], "settings", "user", ".copilot/config.json", "json"],
    [
        "copilot.project.settings",
        ["copilot"],
        "settings",
        "project",
        ".github/copilot/settings.json",
        "json",
    ],
    [
        "copilot.local.settings",
        ["copilot"],
        "settings",
        "local",
        ".github/copilot/settings.local.json",
        "json",
    ],
    ["copilot.user.mcp", ["copilot"], "mcp", "user", ".copilot/mcp-config.json", "json"],
    [
        "copilot.user.memory",
        ["copilot"],
        "memory",
        "user",
        ".copilot/copilot-instructions.md",
        "markdown",
    ],
    [
        "copilot.project.memory",
        ["copilot"],
        "memory",
        "project",
        ".github/copilot-instructions.md",
        "markdown",
    ],
    ["cursor.user.settings", ["cursor"], "settings", "user", ".cursor/cli-config.json", "json"],
    ["cursor.project.settings", ["cursor"], "settings", "project", ".cursor/cli.json", "json"],
    ["cursor.user.mcp", ["cursor"], "mcp", "user", ".cursor/mcp.json", "json"],
    ["cursor.project.mcp", ["cursor"], "mcp", "project", ".cursor/mcp.json", "json"],
    // Not auth.json or models.json, which hold API keys.
    ["pi.user.settings", ["pi"], "settings", "user", ".pi/agent/settings.json", "json"],
    ["pi.project.settings", ["pi"], "settings", "project", ".pi/settings.json", "json"],
    ["pi.user.memory", ["pi"], "memory", "user", ".pi/agent/AGENTS.md", "markdown"],
].map(([id, agents, kind, scope, path, format]) => ({
    id,
    agents,
    kind,
    scope,
    path,
    format,
    docs: DOCS[id as string] ?? DOCS[`${(agents as string[])[0]}.${kind}`] ?? "",
    seeded: SEEDED.has(id as string),
})) as ConfigFile[];

export const configFile = (id: string) => CONFIG_FILES.find((file) => file.id === id);

// Where the file is: the project's own files must stay inside its folder, also through a link.
function located(file: ConfigFile, folder: string, home: string): string {
    const base = file.scope === "user" ? home : folder;
    const path = join(base, file.path);
    if (file.scope !== "user") {
        if (!existsSync(base))
            throw new HttpError(400, "agentConfig.outsideProject", { path: file.path });
        let probe = path;
        while (!existsSync(probe)) probe = dirname(probe);
        const inside = relative(realpathSync(base), realpathSync(probe));
        if (inside.startsWith(`..${sep}`) || inside === "..")
            throw new HttpError(400, "agentConfig.outsideProject", { path: file.path });
    }
    return path;
}

// A file OLIMP will not touch (outside the project, or no folder yet) is listed as `blocked`.
export function listConfig(folder: string, home: string) {
    return CONFIG_FILES.map((file) => {
        let path: string | null = null;
        try {
            path = located(file, folder, home);
        } catch {}
        const stat = path && existsSync(path) ? statSync(path) : null;
        return {
            ...file,
            blocked: path === null,
            exists: Boolean(stat?.isFile()),
            size: stat?.isFile() ? stat.size : null,
            modifiedAt: stat?.isFile() ? stat.mtime.toISOString() : null,
        };
    });
}

export type ConfigListing = ReturnType<typeof listConfig>[number];
export type ConfigContent = ReturnType<typeof readConfig>;

export function readConfig(file: ConfigFile, folder: string, home: string) {
    const path = located(file, folder, home);
    const exists = existsSync(path) && statSync(path).isFile();
    if (exists && statSync(path).size > AGENT_CONFIG_MAX)
        throw new HttpError(400, "agentConfig.tooLarge", { max: AGENT_CONFIG_MAX });
    return { ...file, exists, content: exists ? readFileSync(path, "utf8") : "" };
}

// The names of Claude's MCP servers in its state file, which `claude mcp add` manages: the user
// scope, and the local one of the project's folder. Only names: their entries may hold keys.
export function claudeMcpServers(home: string, folder: string) {
    let state: { mcpServers?: object; projects?: Record<string, { mcpServers?: object }> } = {};
    try {
        state = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"));
    } catch {}
    return {
        user: Object.keys(state.mcpServers ?? {}),
        local: Object.keys(state.projects?.[folder]?.mcpServers ?? {}),
    };
}

// The seeded personal layer, copied from the project's folder into a new worktree; only a file
// git ignores there, so it never reaches a commit.
export async function seedLocalLayer(folder: string, tree: string): Promise<string[]> {
    const seeded: string[] = [];
    for (const file of CONFIG_FILES.filter((f) => f.seeded)) {
        const source = join(folder, file.path);
        if (!existsSync(source)) continue;
        if ((await run("git", ["-C", folder, "check-ignore", "-q", "--", file.path])).code !== 0)
            continue;
        mkdirSync(dirname(join(tree, file.path)), { recursive: true });
        copyFileSync(source, join(tree, file.path));
        seeded.push(file.path);
    }
    return seeded;
}

// JSON is checked before it is written, so a typo does not stop the agent from starting; TOML and
// JSONC are written as given, without a parser in OLIMP.
export function writeConfig(file: ConfigFile, folder: string, home: string, content: unknown) {
    if (typeof content !== "string" || content.length > AGENT_CONFIG_MAX)
        throw new HttpError(400, "agentConfig.invalidContent", { max: AGENT_CONFIG_MAX });
    if (file.format === "json" && content.trim())
        try {
            JSON.parse(content);
        } catch (error) {
            throw new HttpError(400, "agentConfig.invalidJson", {
                reason: (error as Error).message,
            });
        }
    const path = located(file, folder, home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return readConfig(file, folder, home);
}
