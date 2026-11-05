import { seal, unseal } from "./auth.ts";
import { PROJECT_ID } from "./clones.ts";
import type { Config } from "./config.ts";
import { HttpError } from "./http.ts";
import { variablesOf } from "./integrations.ts";
import {
    AREAS_MAX,
    INSTRUCTIONS_MAX,
    ISSUE_LABEL_MAX,
    KEEP_WORKTREES_MAX,
    PR_LABELS_MAX,
    SCRIPT_MAX,
    SCRIPT_NAME_MAX,
    SCRIPT_TIMEOUT_MAX_S,
    SECRET_NAME_MAX,
    SECRET_VALUE_MAX,
    SECRETS_MAX,
    WORKTREE_SCRIPTS_MAX,
} from "./limits.ts";
import { run } from "./proc.ts";
import { isOlimpVariable, passedToAgents } from "./sandbox.ts";
import type { Store } from "./store.ts";

export const WORKSPACES = ["worktree", "checkout"] as const;
export const SCRIPT_PHASES = ["afterCreate", "beforeRemove"] as const;

// A Bash script of a worktree's lifecycle; null timeout is SCRIPT_TIMEOUT_DEFAULT_S.
export interface WorktreeScript {
    name: string;
    command: string;
    timeoutSeconds: number | null;
}
export type WorktreeScripts = Record<(typeof SCRIPT_PHASES)[number], WorktreeScript[]>;
export type Workspace = (typeof WORKSPACES)[number];

// What a project sets for its own tasks.
export interface RepoSettings {
    // The project's system prompt, read after the global one; "" is none.
    instructions: string;
    // Where a task works when its request does not say; null is a worktree of its own.
    workspace: Workspace | null;
    // Finished worktrees kept on disk; 0 removes a job's worktree as soon as it ends.
    keepWorktrees: number;
    // Run in a new worktree before its agent, and in a worktree before it is removed.
    worktreeScripts: WorktreeScripts;
    // The skill the composer preselects, canonical as a task names it.
    defaultSkill: string | null;
    // Whether the composer offers the skill sources' skills, beside the project's and HOME's own.
    teamSkills: boolean;
    // Pull requests open as drafts.
    draftPr: boolean;
    // Labels on every pull request OLIMP opens, e.g. `olimp`.
    prLabels: string[];
    // The agent names the kind of change (fix, feat…), which labels its task's pull request.
    typeLabel: boolean;
    // OLIMP merges its own pull requests with this label once every check passed; null never.
    autoMergeLabel: string | null;
    // The knowledge base: agent steps get the olimp-memory tools and the memory upkeep runs. Off,
    // agents know only what the repository's own files say, such as AGENTS.md.
    memory: boolean;
    // Projects whose memory is a knowledge area of this one: its agent steps read and write it too.
    areas: string[];
}

export const noSettings = (): RepoSettings => ({
    instructions: "",
    workspace: null,
    keepWorktrees: 10,
    worktreeScripts: { afterCreate: [], beforeRemove: [] },
    defaultSkill: null,
    teamSkills: true,
    draftPr: false,
    prLabels: [],
    typeLabel: false,
    autoMergeLabel: null,
    memory: false,
    areas: [],
});

function flagOf(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw new HttpError(400, "field.invalidBoolean", { field });
    return value;
}

// gh splits --label on commas.
function labelOf(value: unknown): string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > ISSUE_LABEL_MAX ||
        value.includes(",")
    )
        throw new HttpError(400, "project.invalidLabel", { max: ISSUE_LABEL_MAX });
    return value.trim();
}

function scriptsOf(value: unknown): WorktreeScripts {
    const invalid = () =>
        new HttpError(400, "worktree.invalidScripts", {
            count: WORKTREE_SCRIPTS_MAX,
            max: SCRIPT_MAX,
            name: SCRIPT_NAME_MAX,
            timeout: SCRIPT_TIMEOUT_MAX_S,
        });
    const phases = value as Record<string, unknown> | null;
    if (typeof phases !== "object" || phases === null) throw invalid();
    const entry = (item: unknown): WorktreeScript => {
        const {
            name = "",
            command,
            timeoutSeconds = null,
        } = (item ?? {}) as Record<string, unknown>;
        if (
            typeof name !== "string" ||
            name.length > SCRIPT_NAME_MAX ||
            typeof command !== "string" ||
            !command.trim() ||
            command.length > SCRIPT_MAX ||
            command.includes("\0") ||
            (timeoutSeconds !== null &&
                (!Number.isInteger(timeoutSeconds) ||
                    (timeoutSeconds as number) < 1 ||
                    (timeoutSeconds as number) > SCRIPT_TIMEOUT_MAX_S))
        )
            throw invalid();
        return { name: name.trim(), command, timeoutSeconds: timeoutSeconds as number | null };
    };
    const list = (items: unknown) => {
        if (!Array.isArray(items) || items.length > WORKTREE_SCRIPTS_MAX) throw invalid();
        return items.map(entry);
    };
    return {
        afterCreate: list(phases.afterCreate ?? []),
        beforeRemove: list(phases.beforeRemove ?? []),
    };
}

// Bash parses each script without running it (-n), so a typo fails the save, not a task.
export async function checkScripts(scripts: WorktreeScripts): Promise<void> {
    for (const phase of SCRIPT_PHASES)
        for (const [index, script] of scripts[phase].entries()) {
            const done = await run("bash", ["-n", "-c", script.command], { timeoutMs: 10_000 });
            if (done.code !== 0)
                throw new HttpError(400, "worktree.invalidScript", {
                    script: script.name || String(index + 1),
                    reason: ((done.stderr || done.stdout).trim().split("\n")[0] ?? "").replace(
                        /^bash: -c: /,
                        "",
                    ),
                });
        }
}

// Settings saved before worktree scripts had plain setup commands, valid Bash as they are.
export function settingsFrom(json: string | null): RepoSettings {
    const { setupCommands, ...stored } = json ? JSON.parse(json) : {};
    const settings: RepoSettings = { ...noSettings(), ...stored };
    if (Array.isArray(setupCommands) && !stored.worktreeScripts)
        settings.worktreeScripts = {
            afterCreate: setupCommands.map((command: string) => ({
                name: "",
                command,
                timeoutSeconds: null,
            })),
            beforeRemove: [],
        };
    return settings;
}

// The settings with the given fields changed; a field that is not valid is refused.
export function settingsPatch(current: RepoSettings, body: Record<string, unknown>): RepoSettings {
    const next = { ...current };
    if (body.instructions !== undefined) {
        if (typeof body.instructions !== "string" || body.instructions.length > INSTRUCTIONS_MAX)
            throw new HttpError(400, "instructions.invalid", { max: INSTRUCTIONS_MAX });
        next.instructions = body.instructions.trim();
    }
    if (body.workspace !== undefined) {
        if (body.workspace !== null && !(WORKSPACES as readonly unknown[]).includes(body.workspace))
            throw new HttpError(400, "project.invalidWorkspace", { values: WORKSPACES.join(", ") });
        next.workspace = body.workspace as Workspace | null;
    }
    if (body.keepWorktrees !== undefined) {
        const keep = body.keepWorktrees;
        if (
            !Number.isInteger(keep) ||
            (keep as number) < 0 ||
            (keep as number) > KEEP_WORKTREES_MAX
        )
            throw new HttpError(400, "project.invalidKeep", { max: KEEP_WORKTREES_MAX });
        next.keepWorktrees = keep as number;
    }
    if (body.worktreeScripts !== undefined) next.worktreeScripts = scriptsOf(body.worktreeScripts);
    // The caller resolved it to the canonical reference first.
    if (body.defaultSkill !== undefined) next.defaultSkill = body.defaultSkill as string | null;
    if (body.teamSkills !== undefined) next.teamSkills = flagOf(body.teamSkills, "teamSkills");
    if (body.draftPr !== undefined) next.draftPr = flagOf(body.draftPr, "draftPr");
    if (body.prLabels !== undefined) {
        if (!Array.isArray(body.prLabels) || body.prLabels.length > PR_LABELS_MAX)
            throw new HttpError(400, "project.invalidLabels", { count: PR_LABELS_MAX });
        next.prLabels = [...new Set(body.prLabels.map(labelOf))];
    }
    if (body.typeLabel !== undefined) next.typeLabel = flagOf(body.typeLabel, "typeLabel");
    if (body.autoMergeLabel !== undefined)
        next.autoMergeLabel = body.autoMergeLabel === null ? null : labelOf(body.autoMergeLabel);
    if (body.memory !== undefined) next.memory = flagOf(body.memory, "memory");
    // The caller checks that each is another registered project.
    if (body.areas !== undefined) {
        if (
            !Array.isArray(body.areas) ||
            body.areas.length > AREAS_MAX ||
            !body.areas.every((a) => typeof a === "string" && PROJECT_ID.test(a))
        )
            throw new HttpError(400, "project.invalidAreas", { max: AREAS_MAX });
        next.areas = [...new Set(body.areas as string[])];
    }
    return next;
}

// A value sealed with OLIMP_HOME/auth.key, as the TOTP secret; only its name leaves the API.
export interface StoredSecret {
    value: string;
    updatedAt: string;
}

const SECRET_NAME = new RegExp(`^[A-Za-z_]\\w{0,${SECRET_NAME_MAX - 1}}$`);

export function secretName(value: string): string {
    // A name agents get anyway (PATH, ANTHROPIC_API_KEY) would reach them without an integration.
    if (!SECRET_NAME.test(value) || isOlimpVariable(value) || passedToAgents(value))
        throw new HttpError(400, "secret.invalidName", { max: SECRET_NAME_MAX });
    return value;
}

// With the integrations that refer to each secret.
export async function secretsView(store: Store, repo: string) {
    const integrations = await store.integrations(repo);
    return Object.entries(await store.secrets(repo))
        .map(([name, { updatedAt }]) => ({
            name,
            updatedAt,
            usedBy: integrations.filter((i) => variablesOf(i).includes(name)).map((i) => i.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

// The references of an integration that neither a project secret nor the OLIMP process fills.
export async function unresolved(store: Store, repo: string, env = process.env) {
    const secrets = await store.secrets(repo);
    return (integration: Parameters<typeof variablesOf>[0]) =>
        variablesOf(integration).filter((name) => !(name in secrets) && env[name] === undefined);
}

export type SecretView = Awaited<ReturnType<typeof secretsView>>[number];

// shortcut: read-modify-write of one JSON column, so two admins saving at once may lose one
// change; a table of its own once several people edit one project's secrets.
export async function setSecret(
    store: Store,
    cfg: Config,
    repo: string,
    name: string,
    value: unknown,
) {
    if (typeof value !== "string" || !value || value.length > SECRET_VALUE_MAX)
        throw new HttpError(400, "secret.invalidValue", { max: SECRET_VALUE_MAX });
    const secrets = await store.secrets(repo);
    if (!(name in secrets) && Object.keys(secrets).length >= SECRETS_MAX)
        throw new HttpError(400, "secret.tooMany", { max: SECRETS_MAX });
    secrets[name] = { value: seal(cfg.home, value), updatedAt: new Date().toISOString() };
    await store.setSecrets(repo, secrets);
}

export async function deleteSecret(store: Store, repo: string, name: string): Promise<boolean> {
    const secrets = await store.secrets(repo);
    if (!(name in secrets)) return false;
    delete secrets[name];
    await store.setSecrets(repo, secrets);
    return true;
}

// The environment an agent step of the project resolves `${NAME}` references in: its secrets win
// over the OLIMP process's variables. A secret that no longer unseals (auth.key replaced) is left
// out, so the reference reports it missing.
export async function projectEnv(
    store: Store,
    cfg: Config,
    repo: string,
    env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
    const values: Record<string, string> = {};
    for (const [name, secret] of Object.entries(await store.secrets(repo)))
        try {
            values[name] = unseal(cfg.home, secret.value);
        } catch {
            console.warn(`secret ${name} of ${repo}: no longer unseals, left out`);
        }
    return { ...env, ...values };
}
