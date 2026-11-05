import {
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { cloneDir, defaultBranch, inClone, REPO_ID, syncClone } from "./clones.ts";
import type { Config } from "./config.ts";
import { HttpError } from "./http.ts";
import { NAME_MAX } from "./limits.ts";
import { must, run } from "./proc.ts";
import type { SkillSource, Store } from "./store.ts";

export interface Skill {
    id: string;
    name: string;
    description: string;
    source: string;
}

export interface SkillHit {
    id: string;
    source: string;
    name: string;
    installs: number;
}

export const SKILL_NAME = /^\w[\w.-]*$/;
export const SKILL_REF = /^(?:([\w.-]+\/[\w.-]+):)?(\w[\w.-]*)$/;
export const SKILLS_DIR = ".olimp/skills";
// A skill the project keeps in its own repository, named `./name`; the agent reads it in place.
export const PROJECT_SKILL = /^\.\/(\w[\w.-]*)$/;
export const PROJECT = ".";
// An account's own skill `~/name` and one synced from claude.ai `claude.ai/name`, both in the HOME
// its agents run with.
export const HOME_SKILL = /^(~|claude\.ai)\/(\w[\w.-]*)$/;
export const OWN = "~";
export const SYNCED = "claude.ai";
const PROJECT_DIRS = [".claude/skills", ".agents/skills", "skills"];

// Agent configuration a skill could carry (settings, hooks, MCP servers, nested instructions) is
// left behind: a skill is data for the agent, never configuration.
const AGENT_FILES = new Set(["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"]);

export async function registerSkillSource(
    store: Store,
    cfg: Config,
    id: string,
    wanted = "",
): Promise<SkillSource> {
    const branch = wanted || (await defaultBranch(cfg, id));
    const dir = await syncClone(cfg, cloneDir(cfg, "skills", id), id);
    const ref = await run("git", [
        "-C",
        dir,
        "rev-parse",
        "-q",
        "--verify",
        `refs/remotes/origin/${branch}`,
    ]);
    if (ref.code !== 0) throw new HttpError(400, "skill.unknownBranch", { repo: id, branch });
    return store.addSkillSource(id, branch);
}

// skills.sh's search, the one `npx skills find` uses; it has no documented contract, so only
// well-formed hits pass.
export async function searchSkills(cfg: Config, query: string): Promise<SkillHit[]> {
    const params = new URLSearchParams({ q: query, limit: "20" });
    const res = await fetch(`${cfg.skillsSearchUrl}/api/search?${params}`, {
        signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!res?.ok) throw new HttpError(502, "skill.searchFailed");
    const body: unknown = await res.json().catch(() => null);
    const hits = (body as { skills?: unknown } | null)?.skills;
    return (Array.isArray(hits) ? hits : []).flatMap((hit) => {
        const { source, skillId, installs } = (hit ?? {}) as Record<string, unknown>;
        if (typeof source !== "string" || !REPO_ID.test(source)) return [];
        if (typeof skillId !== "string" || !SKILL_NAME.test(skillId)) return [];
        const count = typeof installs === "number" ? installs : 0;
        return [{ id: `${source}:${skillId}`, source, name: skillId, installs: count }];
    });
}

// Tasks and automations keep their skill: a run then fails because the source is not registered.
export async function removeSkillSource(
    store: Store,
    cfg: Config,
    id: string,
): Promise<SkillSource | undefined> {
    const source = await store.skillSource(id);
    if (!source) return undefined;
    await store.deleteSkillSource(id);
    rmSync(cloneDir(cfg, "skills", id), { recursive: true, force: true });
    return source;
}

// Skills are read from the clone's files, so the checkout follows the fetched default branch.
function refresh(cfg: Config, source: SkillSource): Promise<string> {
    return inClone(cloneDir(cfg, "skills", source.id), async () => {
        const dir = await syncClone(cfg, cloneDir(cfg, "skills", source.id), source.id);
        await must("git", ["-C", dir, "reset", "-q", "--hard", `origin/${source.defaultBranch}`]);
        return dir;
    });
}

// YAML's double-quoted escapes are JSON's for what a description holds (\", \\, \n).
function unquote(value: string): string {
    if (/^"[\s\S]*"$/.test(value) && value.length > 1) {
        try {
            return String(JSON.parse(value));
        } catch {
            return value.slice(1, -1);
        }
    }
    if (/^'[\s\S]*'$/.test(value) && value.length > 1)
        return value.slice(1, -1).replaceAll("''", "'");
    return value;
}

export function frontmatter(text: string): Record<string, string> {
    const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
    const out: Record<string, string> = {};
    let key: string | null = null;
    for (const line of block?.split(/\r?\n/) ?? []) {
        const pair = /^([\w-]+):\s*(.*)$/.exec(line);
        if (pair) {
            key = pair[1] as string;
            const value = (pair[2] as string).trim();
            out[key] = /^[>|][-+]?$/.test(value) ? "" : unquote(value);
        } else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
    }
    return out;
}

const isRealDir = (path: string) => existsSync(path) && lstatSync(path).isDirectory();
const isRealFile = (path: string) => existsSync(path) && lstatSync(path).isFile();

const skillId = (source: string, name: string) =>
    source === PROJECT
        ? `./${name}`
        : source === OWN || source === SYNCED
          ? `${source}/${name}`
          : `${source}:${name}`;

const skillAt = (dir: string, name: string, source: string): Skill => ({
    id: skillId(source, name),
    name,
    description: frontmatter(readFileSync(join(dir, "SKILL.md"), "utf8")).description ?? "",
    source,
});

function skillsIn(root: string, source: string): Skill[] {
    if (!isRealDir(root)) return [];
    return readdirSync(root)
        .filter((name) => SKILL_NAME.test(name) && isRealFile(join(root, name, "SKILL.md")))
        .sort()
        .map((name) => skillAt(join(root, name), name, source));
}

const SOURCE_DEPTH = 5;

// Skill repositories nest skills in many ways (skills/<name>, skills/<group>/<name>,
// plugins/<plugin>/skills/<name>); the shallowest folder of a name wins.
export function sourceSkillDirs(root: string): Map<string, string> {
    const found = new Map<string, string>();
    let level = isRealDir(root) ? [""] : [];
    for (let depth = 0; depth < SOURCE_DEPTH && level.length; depth++) {
        const next: string[] = [];
        for (const parent of level)
            for (const name of readdirSync(join(root, parent)).sort()) {
                const dir = join(parent, name);
                if (name.startsWith(".") || name === "node_modules" || !isRealDir(join(root, dir)))
                    continue;
                if (!isRealFile(join(root, dir, "SKILL.md"))) next.push(dir);
                else if (SKILL_NAME.test(name) && !found.has(name)) found.set(name, dir);
            }
        level = next;
    }
    return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
}

const ownDir = (home: string) => join(home, ".claude", "skills");

// claude.ai keeps its skills in one folder per account and organisation; the first of a name wins.
function syncedRoots(home: string): string[] {
    const root = join(ownDir(home), "synced");
    if (!isRealDir(root)) return [];
    return readdirSync(root)
        .sort()
        .map((sub) => join(root, sub))
        .filter(isRealDir);
}

function homeSkills(home: string): Skill[] {
    const synced = new Map<string, Skill>();
    for (const root of syncedRoots(home))
        for (const skill of skillsIn(root, SYNCED))
            if (!synced.has(skill.name)) synced.set(skill.name, skill);
    const sorted = [...synced.values()].sort((a, b) => a.name.localeCompare(b.name));
    return [...skillsIn(ownDir(home), OWN), ...sorted];
}

function homeSkillDir(home: string, ref: string): string | null {
    const [, source, name = ""] = HOME_SKILL.exec(ref) ?? [];
    if (!source) return null;
    const roots = source === OWN ? [ownDir(home)] : syncedRoots(home);
    return (
        roots.map((root) => join(root, name)).find((d) => isRealFile(join(d, "SKILL.md"))) ?? null
    );
}

// `home` is the HOME of the agents the skills are for: the caller's account, or the installation's.
// Without `sources` only HOME's own, as for a project that turned the team's skills off.
// Sources are listed as last fetched (registering, refreshing and every run that uses one fetch
// it); fetching each on every list made every list wait on GitHub.
export async function listSkills(
    store: Store,
    cfg: Config,
    home: string,
    sources = true,
): Promise<Skill[]> {
    const skills: Skill[] = [];
    for (const source of sources ? await store.skillSources() : []) {
        const clone = cloneDir(cfg, "skills", source.id);
        // A source that is gone or no longer reachable must not block the others.
        try {
            const dir = existsSync(clone) ? clone : await refresh(cfg, source);
            const found = await inClone(clone, async () =>
                [...sourceSkillDirs(dir)].map(([name, sub]) =>
                    skillAt(join(dir, sub), name, source.id),
                ),
            );
            skills.push(...found);
        } catch (error) {
            console.error(`skill source ${source.id}: ${error}`);
        }
    }
    return [...skills, ...homeSkills(home)];
}

// Fetches every source at once; the ones that could not be fetched are named in the error.
export async function refreshSkillSources(store: Store, cfg: Config): Promise<SkillSource[]> {
    const sources = await store.skillSources();
    const results = await Promise.allSettled(sources.map((source) => refresh(cfg, source)));
    const failed = sources.filter((source, i) => {
        const result = results[i];
        if (result?.status === "rejected")
            console.error(`skill source ${source.id}: ${result.reason}`);
        return result?.status === "rejected";
    });
    if (failed.length)
        throw new HttpError(502, "skill.refreshFailed", {
            repo: failed.map((s) => s.id).join(", "),
        });
    return sources;
}

// The first folder with a skill of that name wins, in the order Claude, Codex, plain.
export function projectSkills(dir: string): Skill[] {
    const found = new Map<string, Skill>();
    for (const sub of PROJECT_DIRS)
        for (const skill of skillsIn(join(dir, sub), PROJECT))
            if (!found.has(skill.name)) found.set(skill.name, skill);
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const projectSkillDir = (dir: string, name: string) =>
    PROJECT_DIRS.map((sub) => join(sub, name)).find((d) => isRealFile(join(dir, d, "SKILL.md")));

// The SKILL.md of a project skill in `dir`, of a skill in `home`, or of a source's skill as last
// fetched.
export function skillText(
    cfg: Config,
    ref: string,
    dir: string | null,
    home: string,
): string | null {
    if (HOME_SKILL.test(ref)) {
        const found = homeSkillDir(home, ref);
        return found ? readFileSync(join(found, "SKILL.md"), "utf8") : null;
    }
    const project = PROJECT_SKILL.exec(ref);
    if (project) {
        const found = dir && projectSkillDir(dir, project[1] as string);
        return found ? readFileSync(join(dir, found, "SKILL.md"), "utf8") : null;
    }
    const [, source, name] = SKILL_REF.exec(ref) ?? [];
    if (!source || !name) return null;
    const clone = cloneDir(cfg, "skills", source);
    const sub = sourceSkillDirs(clone).get(name);
    return sub ? readFileSync(join(clone, sub, "SKILL.md"), "utf8") : null;
}

export type Resolution = { skill: Skill } | { error: "unknown" } | { error: "ambiguous" };

export function resolveSkill(skills: Skill[], ref: string): Resolution {
    const exact = skills.find((s) => s.id === ref);
    if (exact) return { skill: exact };
    const match = SKILL_REF.exec(ref);
    if (!match) return { error: "unknown" };
    const [, source, name] = match;
    const found = skills.filter((s) => s.name === name && (!source || s.source === source));
    if (found.length > 1) return { error: "ambiguous" };
    return found[0] ? { skill: found[0] } : { error: "unknown" };
}

// Copies the skill into the worktree's .olimp/ (kept out of git by the runner) and returns its path;
// a project skill is already in the worktree.
export async function installSkill(
    store: Store,
    cfg: Config,
    ref: string,
    tree: string,
    home: string,
): Promise<string> {
    const project = PROJECT_SKILL.exec(ref);
    if (project) {
        const found = projectSkillDir(tree, project[1] as string);
        if (!found) throw new Error(`skill ${ref} not found in the repository`);
        return found;
    }
    const fromHome = HOME_SKILL.exec(ref);
    if (fromHome) {
        const from = homeSkillDir(home, ref);
        if (!from) throw new Error(`skill ${ref} not found in the agent's HOME`);
        // A skill folder in HOME is often a link (e.g. into ~/.agents/skills): copy what it points to.
        return copySkill(realpathSync(from), fromHome[2] as string, tree);
    }
    const [, sourceId = "", name = ""] = SKILL_REF.exec(ref) ?? [];
    const source = await store.skillSource(sourceId);
    if (!source) throw new Error(`skill source ${sourceId || ref} is not registered`);
    const dir = await refresh(cfg, source);
    const sub = sourceSkillDirs(dir).get(name);
    if (!sub) throw new Error(`skill ${ref} not found`);
    return copySkill(join(dir, sub), name, tree);
}

function copySkill(from: string, name: string, tree: string): string {
    const target = join(SKILLS_DIR, name);
    cpSync(from, join(tree, target), {
        recursive: true,
        filter: (path) => {
            const stat = lstatSync(path);
            const entry = basename(path);
            if (path === from) return true;
            return (
                (stat.isFile() || stat.isDirectory()) &&
                !entry.startsWith(".") &&
                !AGENT_FILES.has(entry)
            );
        },
    });
    return target;
}

// A skill folder that is a link (e.g. into ~/.agents/skills) is not the account's to change here.
function ownSkillDir(home: string, name: string, exists: boolean): string {
    if (!SKILL_NAME.test(name) || name.length > NAME_MAX || name === "synced")
        throw new HttpError(400, "skill.invalidName", { name });
    const dir = join(ownDir(home), name);
    const stat = lstatSync(dir, { throwIfNoEntry: false });
    if (stat && !stat.isDirectory()) throw new HttpError(409, "skill.notEditable", { skill: name });
    const file = lstatSync(join(dir, "SKILL.md"), { throwIfNoEntry: false });
    if (file && !file.isFile()) throw new HttpError(409, "skill.notEditable", { skill: name });
    if (exists && !file) throw new HttpError(404, "skill.unknown", { skill: `${OWN}/${name}` });
    if (!exists && file) throw new HttpError(409, "skill.exists", { skill: `${OWN}/${name}` });
    return dir;
}

export function saveOwnSkill(home: string, name: string, content: string, exists: boolean): Skill {
    if (!frontmatter(content).description) throw new HttpError(400, "skill.noDescription");
    const dir = ownSkillDir(home, name, exists);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
    return skillAt(dir, name, OWN);
}

export function deleteOwnSkill(home: string, name: string): Skill {
    const dir = ownSkillDir(home, name, true);
    const skill = skillAt(dir, name, OWN);
    rmSync(dir, { recursive: true, force: true });
    return skill;
}
