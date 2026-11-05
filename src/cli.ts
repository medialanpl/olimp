#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./machine.ts";
import { deploy, SERVICE_USAGE, service } from "./service.ts";

const USAGE = `olimp            start OLIMP: API and panel on http://127.0.0.1:4850; started inside a git
                 repository, it adds that repository as a project
olimp deploy     update the running OLIMP (a checkout to origin's main, an npm install to npm's
                 latest version) once no job is working, and restart it
olimp mcp        OLIMP's MCP server on stdio for your own agent (OLIMP_URL, OLIMP_TOKEN)
olimp agent-login <agent> [login]
                 log an agent CLI in as the account of OLIMP_TOKEN
${SERVICE_USAGE}`;

// The repository the command runs in, unless it is OLIMP's own checkout.
function startFolder(): string | null {
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
    if (top.status !== 0) return null;
    const folder = realpathSync(top.stdout.trim());
    return folder === realpathSync(ROOT) ? null : folder;
}

// As `pnpm start`: the shell's variables win over a checkout's .env.
const env = join(ROOT, ".env");
if (existsSync(env)) process.loadEnvFile(env);
const [command, argument, more] = process.argv.slice(2);
if (!command || command === "start") {
    const { start } = await import("./main.ts");
    await start(startFolder());
} else if (command === "deploy") {
    process.exitCode = await deploy();
} else if (command === "service") {
    process.exitCode = await service(argument);
} else if (command === "mcp") {
    const { createMcpServer } = await import("./mcp.ts");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    await createMcpServer().connect(new StdioServerTransport());
} else if (command === "agent-login") {
    const { agentLogin } = await import("./agent-login.ts");
    await agentLogin(argument, more);
} else {
    console.log(USAGE);
    process.exitCode = command === "help" || command === "--help" ? 0 : 2;
}
