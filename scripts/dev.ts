import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Work on OLIMP: the API restarts on every change, with data of its own, so the service's tasks and
// data stay untouched; the panel reloads in place.
const home = process.env.OLIMP_DEV_HOME ?? join(homedir(), ".olimp-dev");
const env: NodeJS.ProcessEnv = {
    ...process.env,
    OLIMP_HOME: home,
    OLIMP_PORT: "4851",
    OLIMP_DEV_PANEL: "http://127.0.0.1:5175",
};
delete env.OLIMP_DATABASE_URL;

// `--from-prod`: the service's SQLite data, so dev shows the same projects and settings. The copy
// polls no issues and runs no automations: the service already does, and twice would be two tasks.
function copyProd(): void {
    const prod = process.env.OLIMP_HOME ?? join(homedir(), ".olimp");
    const source = join(prod, "olimp.db");
    if (!existsSync(source)) throw new Error(`no SQLite database in ${prod}`);
    const db = join(home, "olimp.db");
    mkdirSync(home, { recursive: true });
    const kept = existsSync(db);
    if (kept) renameSync(db, `${db}.bak`);
    for (const extra of ["-wal", "-shm"]) rmSync(`${db}${extra}`, { force: true });
    const from = new DatabaseSync(source, { readOnly: true });
    from.exec(`VACUUM INTO '${db.replaceAll("'", "''")}'`);
    from.close();
    const copy = new DatabaseSync(db);
    copy.exec("UPDATE repos SET issue_label = NULL; UPDATE automations SET enabled = 0;");
    copy.close();
    // Without the key the copied authenticator secrets cannot be read.
    if (existsSync(join(prod, "auth.key")))
        copyFileSync(join(prod, "auth.key"), join(home, "auth.key"));
    console.log(`dev data copied from ${prod}${kept ? `; the previous one is ${db}.bak` : ""}`);
}

if (process.argv.includes("--from-prod")) copyProd();

const children = [
    // Only OLIMP's own files: plain --watch follows node_modules too, and a job's `pnpm install`
    // hard-links the same store files, which restarted the API and interrupted the job.
    spawn(process.execPath, ["--watch-path=src", "--watch-path=messages", "src/main.ts"], {
        env,
        stdio: "inherit",
    }),
    // Vite's own banner stays quiet: OLIMP's names the panel and the API.
    spawn("pnpm", ["dev:web", "--logLevel", "warn"], { env, stdio: "inherit" }),
];
// Ctrl+C reaches both; when one ends on its own, the other goes too.
for (const child of children)
    child.on("exit", (code) => {
        for (const other of children) other.kill();
        process.exitCode = code ?? 0;
    });
