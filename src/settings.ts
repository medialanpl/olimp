import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { type AgentDefaults, isAgent, isModel, perAgent } from "./agents.ts";
import { type Config, expandHome } from "./config.ts";
import { PARALLEL_MAX, TIMEOUT_MAX_MIN } from "./limits.ts";
import { mailReady } from "./mail.ts";
import type { Repo, Store } from "./store.ts";

export interface Settings {
    maxParallel: number;
    taskTimeoutMin: number;
    projectsDir: string;
    browseRoot: string;
}

export type SettingName = keyof Settings;

export const SETTING_NAMES: SettingName[] = [
    "maxParallel",
    "taskTimeoutMin",
    "projectsDir",
    "browseRoot",
];

const RANGES = {
    maxParallel: [1, PARALLEL_MAX],
    taskTimeoutMin: [1, TIMEOUT_MAX_MIN],
} as const;

export type SettingError =
    | { code: "settings.invalidNumber"; min: number; max: number }
    | { code: "settings.invalidFolder" };

export const settingsOf = (cfg: Omit<Config, "defaults">): Settings => ({
    maxParallel: cfg.maxParallel,
    taskTimeoutMin: cfg.taskTimeoutMs / 60_000,
    projectsDir: cfg.projectsDir,
    browseRoot: cfg.browseRoot,
});

function writableFolder(value: unknown): string | null {
    if (typeof value !== "string" || !value.trim()) return null;
    const path = expandHome(value.trim());
    if (!isAbsolute(path)) return null;
    try {
        if (!statSync(path).isDirectory()) return null;
        accessSync(path, constants.W_OK);
    } catch {
        return null;
    }
    return resolve(path);
}

// The value to keep, or why it cannot be kept.
export function checkSetting(
    name: SettingName,
    value: unknown,
): { value: number | string } | SettingError {
    if (name === "maxParallel" || name === "taskTimeoutMin") {
        const [min, max] = RANGES[name];
        return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
            ? { value: value as number }
            : { code: "settings.invalidNumber", min, max };
    }
    const folder = writableFolder(value);
    return folder ? { value: folder } : { code: "settings.invalidFolder" };
}

export function applySettings(cfg: Config, values: Partial<Settings>): void {
    if (values.maxParallel !== undefined) cfg.maxParallel = values.maxParallel;
    if (values.taskTimeoutMin !== undefined) cfg.taskTimeoutMs = values.taskTimeoutMin * 60_000;
    if (values.projectsDir !== undefined) cfg.projectsDir = values.projectsDir;
    if (values.browseRoot !== undefined) cfg.browseRoot = values.browseRoot;
}

// A saved value that no longer holds (e.g. a folder that is gone) is left out with a warning.
export async function loadSettings(store: Store, cfg: Config): Promise<void> {
    const saved = await store.settings();
    const values: Partial<Settings> = {};
    for (const name of SETTING_NAMES) {
        if (saved[name] === undefined) continue;
        const checked = checkSetting(name, JSON.parse(saved[name]));
        if ("value" in checked) Object.assign(values, { [name]: checked.value });
        else
            console.warn(
                `setting ${name}: saved value ${saved[name]} no longer valid, default used`,
            );
    }
    applySettings(cfg, values);
}

// What the panel shows: the values in force, the defaults, and which ones were saved.
export async function settingsView(store: Store, cfg: Config) {
    const saved = await store.settings();
    return {
        values: settingsOf(cfg),
        defaults: cfg.defaults,
        saved: SETTING_NAMES.filter((name) => saved[name] !== undefined),
        // Where the installation keeps its data, shown under the settings.
        home: cfg.home,
        // Whether OLIMP can send e-mail, through the server saved in the panel or the environment's.
        mail: mailReady(cfg),
    };
}

// Saves the given settings and applies them at once; null goes back to the default.
export async function saveSettings(
    store: Store,
    cfg: Config,
    body: Record<string, unknown>,
): Promise<{ name: SettingName; error: SettingError } | null> {
    const values: Partial<Settings> = {};
    const rows: Record<string, string | null> = {};
    for (const name of SETTING_NAMES) {
        if (!(name in body)) continue;
        if (body[name] === null) {
            Object.assign(values, { [name]: cfg.defaults[name] });
            rows[name] = null;
            continue;
        }
        const checked = checkSetting(name, body[name]);
        if (!("value" in checked)) return { name, error: checked };
        Object.assign(values, { [name]: checked.value });
        rows[name] = JSON.stringify(checked.value);
    }
    await store.saveSettings(rows);
    applySettings(cfg, values);
    return null;
}

export const globalInstructions = async (store: Store): Promise<string> =>
    (await store.settings()).instructions ?? "";

export async function agentDefaults(store: Store): Promise<AgentDefaults> {
    const saved = (await store.settings()).agentDefaults;
    return (saved && agentDefaultsOf(JSON.parse(saved))) || { agent: "claude", models: {} };
}

export function agentDefaultsOf(value: unknown): AgentDefaults | null {
    if (typeof value !== "object" || value === null) return null;
    const body = value as Record<string, unknown>;
    const models = perAgent(body.models, isModel);
    return isAgent(body.agent) && models ? { agent: body.agent, models } : null;
}

// The agent of a new task, automation or issue task that names none.
export const projectAgent = async (store: Store, repo: Repo) =>
    repo.agents.agent ?? (await agentDefaults(store)).agent;
