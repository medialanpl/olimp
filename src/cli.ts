#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./machine.ts";
import { deploy, SERVICE_USAGE, service } from "./service.ts";

const USAGE = `olimp            start OLIMP: API and panel on http://127.0.0.1:4850
olimp deploy     update the running OLIMP to origin's main once no job is working, and restart it
${SERVICE_USAGE}`;

const [command, argument] = process.argv.slice(2);
if (!command || command === "start") {
    // As `pnpm start`: the shell's variables win over .env.
    const env = join(ROOT, ".env");
    if (existsSync(env)) process.loadEnvFile(env);
    await import("./main.ts");
} else if (command === "deploy") {
    process.exitCode = await deploy();
} else if (command === "service") {
    process.exitCode = await service(argument);
} else {
    console.log(USAGE);
    process.exitCode = command === "help" || command === "--help" ? 0 : 2;
}
