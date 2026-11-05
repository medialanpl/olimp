import { AGENTS, type AgentName, isAgent } from "../agents.ts";
import { branchChanges } from "../changes.ts";
import { isGitFolder, parseRepoRef, repoDir } from "../clones.ts";
import type { Config } from "../config.ts";
import { HttpError, text } from "../http.ts";
import { IntegrationError, parseNames } from "../integrations.ts";
import { cancelRunning } from "../jobs.ts";
import { PATH_MAX, REF_MAX, STEP_INTEGRATIONS_MAX } from "../limits.ts";
import { oneLine } from "../memory.ts";
import { listSkills, PROJECT_SKILL, projectSkills, resolveSkill, type Skill } from "../skills.ts";
import type { JobKind, Repo, Store, TaskStatus, User } from "../store.ts";
import { DefinitionError } from "../workflows.ts";

export type Answer = [number, unknown];

// owner/name, also from a GitHub address.
export function repoRef(value: unknown, field = "repo"): string {
    const id = parseRepoRef(text(value, field, REF_MAX));
    if (!id) throw new HttpError(400, field === "repo" ? "repo.invalidId" : "repo.invalidTemplate");
    return id;
}

// A project as the API shows it: with whether its folder is a git repository.
// `folder` is where it works: its own folder, or OLIMP's clone in OLIMP_HOME.
export type RepoView = Repo & { git: boolean; folder: string };

export const withGit = (cfg: Config, repo: Repo): RepoView => ({
    ...repo,
    git: isGitFolder(repoDir(cfg, repo)),
    folder: repoDir(cfg, repo),
});

export async function registered(store: Store, value: unknown): Promise<string> {
    const repo = text(value, "repo", REF_MAX);
    if (!(await store.repo(repo))) throw new HttpError(400, "repo.notRegistered", { repo });
    return repo;
}

export function agentOf(value: unknown): AgentName {
    const agent = value === undefined ? "claude" : value;
    if (!isAgent(agent))
        throw new HttpError(400, "task.invalidAgent", { agents: AGENTS.join(", ") });
    return agent;
}

// Names of integrations the repository has; checked again when the step starts.
export async function known(store: Store, repo: string, names: string[]): Promise<string[]> {
    for (const name of names)
        if (!(await store.integration(repo, name)))
            throw new HttpError(400, "integration.unknown", { integration: name, repo });
    return names;
}

export async function integrationsOf(
    store: Store,
    repo: string,
    value: unknown,
): Promise<string[]> {
    const names = parseNames(value);
    if (!names) throw new HttpError(400, "integration.invalidList", { max: STEP_INTEGRATIONS_MAX });
    return known(store, repo, names);
}

export function inputError(error: unknown): never {
    if (error instanceof IntegrationError || error instanceof DefinitionError)
        throw new HttpError(400, error.code, error.params);
    throw error;
}

export function resolved(skills: Skill[], ref: string): string {
    const found = resolveSkill(skills, ref);
    if ("skill" in found) return found.skill.id;
    throw new HttpError(400, found.error === "ambiguous" ? "skill.ambiguous" : "skill.unknown", {
        skill: ref,
    });
}

// A skill is stored as `owner/repo:name`, resolved against the freshly fetched sources, or as
// `./name` for a skill the task's repository keeps itself.
export async function skillOf(
    store: Store,
    cfg: Config,
    home: string,
    value: unknown,
    repo?: Repo,
): Promise<string | null> {
    if (value === undefined || value === null) return null;
    const ref = text(value, "skill", REF_MAX);
    if (repo && PROJECT_SKILL.test(ref)) return resolved(projectSkills(repoDir(cfg, repo)), ref);
    return resolved(await listSkills(store, cfg, home), ref);
}

export function flag(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") throw new HttpError(400, "field.invalidBoolean", { field });
    return value;
}

export function oneLineText(value: unknown, field: string, max: number): string {
    const line = typeof value === "string" ? oneLine(value) : value;
    return text(line, field, max);
}

export async function repoOf(store: Store, id: string) {
    const repo = await store.repo(id);
    if (!repo) throw new HttpError(404, "repo.notRegistered", { repo: id });
    return repo;
}

export async function changesOf(store: Store, cfg: Config, id: string, branch: string | null) {
    return branchChanges(cfg, await repoOf(store, id), branch);
}

// A path inside the repository's tree as git names it: relative, no `..`, no NUL.
export function filePath(value: string): string {
    const parts = value.split("/");
    if (
        !value ||
        value.length > PATH_MAX ||
        value.includes("\0") ||
        parts.some((part) => part === "" || part === "." || part === "..")
    )
        throw new HttpError(400, "task.badPath", { max: PATH_MAX });
    return value;
}

// A queued job is cancelled at once; a running one once its agent has stopped and the worktree is
// gone (cancelRunning waits for that).
export async function cancel(
    store: Store,
    kind: JobKind,
    id: string,
    status: TaskStatus | "waiting",
    actor: User | null,
): Promise<void> {
    const reason = actor ? `cancelled by ${actor.name}` : "cancelled";
    if (status === "queued" && (await store.cancelQueued(kind, id, reason))) return;
    if (await cancelRunning(id, reason)) return;
    const current = kind === "task" ? await store.task(id) : await store.run(id);
    throw new HttpError(409, kind === "task" ? "task.notCancellable" : "run.notCancellable", {
        [kind]: id,
        status: current?.status ?? status,
    });
}

// Pins and reads are the caller's own; "" is the installation while there are no accounts.
export const pinnerOf = (actor: User | null) => actor?.id ?? "";
