import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// What a worktree's own files offer to run, each with the file it came from: `dev` means one thing
// in package.json and another in a Makefile. Only listed here; it runs when a person picks it.
export interface ProjectCommand {
    command: string;
    source: string;
    detail?: string;
}

const MANAGERS = ["pnpm", "yarn", "bun", "npm"] as const;
const LOCKFILES: Record<string, (typeof MANAGERS)[number]> = {
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "bun.lock": "bun",
    "bun.lockb": "bun",
    "package-lock.json": "npm",
};

// The `packageManager` field, then the lockfile; npm without either.
export function packageManager(dir: string, manifest: Record<string, unknown> = {}): string {
    const declared = String(manifest.packageManager ?? "").split("@")[0] ?? "";
    if ((MANAGERS as readonly string[]).includes(declared)) return declared;
    for (const [file, manager] of Object.entries(LOCKFILES))
        if (existsSync(join(dir, file))) return manager;
    return "npm";
}

export function packageScripts(manifest: Record<string, unknown>, manager: string) {
    const scripts = manifest.scripts;
    if (!scripts || typeof scripts !== "object") return [];
    return Object.entries(scripts)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([name, detail]) => ({
            command: `${manager} run ${name}`,
            source: "package.json",
            detail,
        }));
}

// Targets that start a line with an ordinary name; not pattern rules, `.PHONY` or `VAR :=`.
export function makeTargets(text: string): ProjectCommand[] {
    const names = [...text.matchAll(/^([A-Za-z0-9][\w.-]*)[ \t]*:(?![:=])/gm)].map((m) => m[1]);
    return [...new Set(names)].map((name) => ({ command: `make ${name}`, source: "Makefile" }));
}

function readManifest(dir: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        return value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

// Never throws: an unreadable file is nothing from that source. `install` is offered when the
// worktree has a package.json and no node_modules, since Node would then resolve packages from a
// parent folder, and the project's own setup scripts do not do it.
export function projectCommands(dir: string, setupScripts: boolean) {
    const manifest = readManifest(dir);
    const manager = manifest ? packageManager(dir, manifest) : null;
    let makefile = "";
    try {
        makefile = readFileSync(join(dir, "Makefile"), "utf8");
    } catch {}
    const commands = [
        ...(manifest && manager ? packageScripts(manifest, manager) : []),
        ...makeTargets(makefile),
    ];
    const install =
        manager && !setupScripts && !existsSync(join(dir, "node_modules"))
            ? `${manager} install`
            : null;
    return { commands, install };
}
