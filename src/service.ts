import { spawnSync } from "node:child_process";
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readlinkSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { parseEnv } from "node:util";
import { resolveBin } from "./config.ts";
import { install as installKind, ROOT } from "./machine.ts";

const NAME = "olimp";
const UNIT = join(homedir(), ".config", "systemd", "user", `${NAME}.service`);
const LINK = join(homedir(), ".local", "bin", NAME);
// .ts in a checkout, which installs and builds before every start; .js in the npm package.
const EXT = extname(import.meta.filename);
const CLI = join(import.meta.dirname, `cli${EXT}`);
// From the installing shell: where the agents' CLIs are, and which instance. Secrets stay in .env.
const PASSED = ["PATH", "OLIMP_HOME", "OLIMP_PORT"];

export const SERVICE_USAGE = `olimp service <command>
  install     run OLIMP from this checkout (a clean main) or this npm install as a systemd user
              service, started with the system, and link \`olimp\` from a checkout
  restart     install dependencies, build the panel and restart (running tasks are interrupted)
  start, stop, status
  logs        follow the log
  uninstall   remove the service and the link`;

// systemd expands % and reads backslashes and quotes inside a quoted word.
const word = (value: string) => `"${value.replace(/[\\"]/g, "\\$&").replaceAll("%", "%%")}"`;

// Without pnpm (the npm package) the unit starts the build it holds.
export function unitFile(
    node: string,
    pnpm: string | null,
    env: NodeJS.ProcessEnv,
    root = ROOT,
    ext = EXT,
): string {
    const passed = PASSED.filter((name) => env[name]).map(
        (name) => `Environment=${word(`${name}=${env[name]}`)}`,
    );
    return [
        "[Unit]",
        "Description=OLIMP: coding agents, API and panel",
        "After=network-online.target",
        "",
        "[Service]",
        `WorkingDirectory=${root.replaceAll("%", "%%")}`,
        "Environment=OLIMP_SERVICE=1",
        ...passed,
        // After a merge: its dependencies and panel. A failed step still starts the last good build.
        ...(pnpm
            ? [
                  `ExecStartPre=-${word(pnpm)} install --frozen-lockfile --config.confirmModulesPurge=false`,
                  `ExecStartPre=-${word(pnpm)} build`,
              ]
            : []),
        `ExecStart=${word(node)} --env-file-if-exists=.env src/main${ext}`,
        "Restart=always",
        "RestartSec=3",
        // OLIMP's exit codes on SIGINT and SIGTERM: a stop, not a failure.
        "SuccessExitStatus=130 143",
        "",
        "[Install]",
        "WantedBy=default.target",
        "",
    ].join("\n");
}

const gitOut = (...args: string[]) => {
    const out = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
    return out.status === 0 ? out.stdout.trim() : null;
};

// The service runs whatever its checkout holds, so it is installed only from a clean main: a clone
// of its own, never the folder OLIMP is worked on in. A copy without git is left alone.
export function checkoutRefusal(branch: string | null, status: string | null): string | null {
    if (branch === null) return null;
    if (branch !== "main") return `this checkout is on ${branch}, not main`;
    return status ? "this checkout has uncommitted changes" : null;
}

const call = (command: string, args: string[], quiet = false) =>
    spawnSync(command, args, { stdio: quiet ? "ignore" : "inherit" }).status ?? 1;
const systemctl = (...args: string[]) => call("systemctl", ["--user", ...args]);

async function install(): Promise<number> {
    const kind = await installKind();
    if (kind === "npx") {
        console.error(
            "npx runs OLIMP from a cache npm may clear: install it to keep it as a service:\n" +
                "  npm install -g olimp-run && olimp service install",
        );
        return 1;
    }
    const refused =
        kind === "git"
            ? checkoutRefusal(
                  gitOut("rev-parse", "--abbrev-ref", "HEAD"),
                  gitOut("status", "--porcelain", "--untracked-files=no"),
              )
            : null;
    if (refused) {
        const origin = gitOut("remote", "get-url", "origin") ?? "<OLIMP's repository>";
        console.error(
            `${refused}. Install the service from a clone of its own and keep this folder for ` +
                `\`pnpm dev\`:\n  git clone ${origin} ~/.olimp/app\n  cd ~/.olimp/app && ` +
                "pnpm install && pnpm olimp service install",
        );
        return 1;
    }
    if (call("systemctl", ["--user", "show-environment"], true) !== 0) {
        console.error(
            "systemd user services are not available here (on WSL: systemd=true in /etc/wsl.conf)",
        );
        return 1;
    }
    mkdirSync(dirname(UNIT), { recursive: true });
    const pnpm = EXT === ".ts" ? await resolveBin("pnpm") : null;
    writeFileSync(UNIT, unitFile(process.execPath, pnpm, process.env));
    const failed = systemctl("daemon-reload") || systemctl("enable", NAME);
    if (failed) return failed;
    // Without lingering the service waits for a login; WSL logs in when a terminal opens.
    if (call("loginctl", ["enable-linger"], true) !== 0)
        console.warn("could not enable lingering: OLIMP starts with your first login");
    // npm put the olimp command on PATH already.
    if (EXT === ".ts") link();
    console.log(`OLIMP is the systemd user service "${NAME}" (${UNIT})`);
    // Started against an OLIMP outside the service, it would rebuild and fail every few seconds.
    if (call("systemctl", ["--user", "is-active", NAME], true) !== 0 && (await portTaken())) {
        console.log("another OLIMP holds the port: stop it, then run `olimp service start`");
        return 0;
    }
    return systemctl("restart", NAME);
}

function servicePort(): string {
    const dotenv = join(ROOT, ".env");
    const fromFile = existsSync(dotenv) ? parseEnv(readFileSync(dotenv, "utf8")).OLIMP_PORT : null;
    return process.env.OLIMP_PORT ?? fromFile ?? "4850";
}

async function portTaken(): Promise<boolean> {
    const port = servicePort();
    return fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }).then(
        () => true,
        () => false,
    );
}

function linked(): boolean {
    try {
        return lstatSync(LINK).isSymbolicLink() && readlinkSync(LINK) === CLI;
    } catch {
        return false;
    }
}

// A link to another checkout's CLI, left by a service installed from there.
function otherLink(): boolean {
    try {
        return (
            lstatSync(LINK).isSymbolicLink() && readlinkSync(LINK).endsWith(join("src", "cli.ts"))
        );
    } catch {
        return false;
    }
}

function link(): void {
    if (linked()) return;
    const moved = otherLink();
    if (!existsSync(dirname(LINK)) || (existsSync(LINK) && !moved)) {
        console.warn(`not linking ${LINK}: run \`pnpm olimp\` in ${ROOT} instead`);
        return;
    }
    if (moved) rmSync(LINK);
    symlinkSync(CLI, LINK);
    console.log(`linked ${LINK}: \`olimp service restart\` works from anywhere`);
}

function uninstall(): number {
    systemctl("disable", "--now", NAME);
    rmSync(UNIT, { force: true });
    systemctl("daemon-reload");
    if (linked()) rmSync(LINK);
    return 0;
}

// The running OLIMP updates itself to origin, as from the panel: it waits for no job to be working,
// pulls, installs, builds and restarts. With accounts it needs an admin's OLIMP_TOKEN.
export async function deploy(): Promise<number> {
    const port = servicePort();
    const token = process.env.OLIMP_TOKEN?.trim();
    let res: Response;
    try {
        res = await fetch(`http://127.0.0.1:${port}/api/version/update`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: "{}",
            signal: AbortSignal.timeout(10 * 60_000),
        });
    } catch {
        console.error(`no OLIMP answers on port ${port}: \`olimp service start\``);
        return 1;
    }
    if (res.ok) {
        console.log("updated: OLIMP restarts with the new version (`olimp service logs`)");
        return 0;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    console.error(body.error ?? `HTTP ${res.status}`);
    return body.code === "version.upToDate" ? 0 : 1;
}

export async function service(command: string | undefined): Promise<number> {
    switch (command) {
        case "install":
            return install();
        case "uninstall":
            return uninstall();
        case "start":
        case "stop":
        case "restart":
            return systemctl(command, NAME);
        case "status":
            return systemctl("status", NAME, "--no-pager");
        case "logs":
            return call("journalctl", ["--user", "-u", NAME, "-f", "-n", "100"]);
        default:
            console.error(SERVICE_USAGE);
            return 2;
    }
}
