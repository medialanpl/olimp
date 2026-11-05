import {
    appendFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { access, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { Config } from "./config.ts";
import { ensureUpkeep } from "./memory-upkeep.ts";
import { must, run } from "./proc.ts";
import type { Repo, Store } from "./store.ts";

export const REPO_ID = /^[\w.-]+\/[\w.-]+$/;
export const FOLDER_NAME = /^(?!\.{1,2}$)[\w.-]{1,100}$/;
export const FOLDERS_MAX = 500;

// owner/name from owner/name or a GitHub address (https or ssh, with or without .git); else null.
export function parseRepoRef(value: string): string | null {
    const ref = value
        .trim()
        .replace(/\/+$/, "")
        .replace(/\.git$/, "");
    const match =
        /^(?:(?:https?:\/\/|ssh:\/\/git@)(?:www\.)?github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+)$/.exec(
            ref,
        );
    return match?.[1] ?? null;
}

export const cloneDir = (cfg: Config, kind: "repos" | "skills", id: string) =>
    join(cfg.home, kind, id.replace("/", "__"));

// A repository works in its own folder; one registered before folders keeps OLIMP's clone.
export const repoDir = (cfg: Config, repo: Pick<Repo, "id" | "path" | "github">) =>
    repo.path ?? cloneDir(cfg, "repos", repo.github ?? repo.id);

export const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

// The runs of lowercase ASCII letters and digits in a name, joined by single dashes.
export const slugify = (name: string, max: number) =>
    (name.toLowerCase().match(/[a-z0-9]+/g) ?? []).join("-").slice(0, max).replace(/-$/, "");

// A project's id from its folder or repository name, with -2, -3 when taken.
export function projectId(name: string, taken: string[]): string {
    const base = slugify(name, 60) || "project";
    let id = base;
    for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
    return id;
}

// A folder inside another repository is not one itself: OLIMP would commit to the outer one.
export const isGitFolder = (path: string) => existsSync(join(path, ".git"));

// The branch checked out in a local folder; "" when it is not a git repository.
export async function localBranch(path: string): Promise<string> {
    if (!isGitFolder(path)) return "";
    const head = await run("git", ["-C", path, "symbolic-ref", "--short", "HEAD"]);
    return head.code === 0 ? head.stdout.trim() : "";
}

// The user's own `gh` login decides which repositories OLIMP can reach.
export async function defaultBranch(cfg: Config, id: string): Promise<string> {
    if (!REPO_ID.test(id)) throw new Error(`invalid repository: ${id}`);
    const info = JSON.parse(await must(cfg.gh, ["repo", "view", id, "--json", "defaultBranchRef"]));
    const branch: unknown = info?.defaultBranchRef?.name;
    if (typeof branch !== "string" || !branch) throw new Error(`${id}: no default branch`);
    return branch;
}

// A new repository on GitHub, from a template or with a README, so that it has a default branch.
export async function createRepo(
    cfg: Config,
    id: string,
    visibility: "private" | "public",
    description: string,
    template: string | null = null,
): Promise<void> {
    if (!REPO_ID.test(id)) throw new Error(`invalid repository: ${id}`);
    await must(cfg.gh, [
        "repo",
        "create",
        id,
        `--${visibility}`,
        ...(template ? ["--template", template] : ["--add-readme"]),
        ...(description ? ["--description", description] : []),
    ]);
}

// GitHub fills a repository from a template after `gh repo create` returns.
export async function waitForBranch(cfg: Config, id: string, attempts = 20): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await defaultBranch(cfg, id);
            return;
        } catch (error) {
            if (attempt >= attempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }
}

export interface GithubOwner {
    login: string;
    name: string | null;
    description: string | null;
    kind: "user" | "org";
    avatarUrl: string | null;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

// The installation's gh login, or null when gh is missing or signed out.
export async function githubLogin(cfg: Config): Promise<string | null> {
    const done = await run(cfg.gh, ["api", "user", "--jq", "{login}"], { timeoutMs: 15_000 });
    try {
        return done.code === 0 ? textOrNull(JSON.parse(done.stdout).login) : null;
    } catch {
        return null;
    }
}

// The installation's gh account and its organizations: where a new repository can go.
export async function githubOwners(cfg: Config): Promise<GithubOwner[]> {
    const user = JSON.parse(
        await must(cfg.gh, ["api", "user", "--jq", "{login, name, avatar_url}"]),
    );
    const orgs = (await must(cfg.gh, ["api", "--paginate", "user/orgs", "--jq", ".[]"]))
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    return [
        {
            login: user.login,
            name: textOrNull(user.name),
            description: null,
            kind: "user" as const,
            avatarUrl: textOrNull(user.avatar_url),
        },
        ...orgs.map((org) => ({
            login: org.login,
            name: null,
            description: textOrNull(org.description),
            kind: "org" as const,
            avatarUrl: textOrNull(org.avatar_url),
        })),
    ].filter((owner) => typeof owner.login === "string" && /^[\w.-]+$/.test(owner.login));
}

export interface FolderList {
    root: string;
    path: string;
    parent: string | null;
    // Whether `path` itself is a git repository.
    git: boolean;
    folders: { name: string; path: string; git: boolean }[];
    truncated: boolean;
}

// The real path of `path` when it is `root` or inside it, else null: no `..` or symlink leads out.
export function insideRoot(root: string, path: string): string | null {
    if (!isAbsolute(path)) return null;
    try {
        const top = realpathSync(root);
        const real = realpathSync(path);
        const rel = relative(top, real);
        return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : real;
    } catch {
        return null;
    }
}

// The subfolders of a folder inside the browse root; symlinks are left out, and dot folders unless
// asked for (an agent's config folder is one). Asynchronous, so a slow disk (/mnt/c, a network
// mount) does not stall the API.
export async function listFolders(
    root: string,
    path: string,
    hidden = false,
): Promise<FolderList | null> {
    const real = insideRoot(root, path);
    if (!real) return null;
    let entries: string[];
    try {
        entries = (await readdir(real, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && (hidden || !entry.name.startsWith(".")))
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return null;
    }
    const top = realpathSync(root);
    const git = (dir: string) =>
        access(join(dir, ".git")).then(
            () => true,
            () => false,
        );
    return {
        root: top,
        path: real,
        parent: real === top ? null : dirname(real),
        git: await git(real),
        // libuv's thread pool already bounds how many of these run at once.
        folders: await Promise.all(
            entries.slice(0, FOLDERS_MAX).map(async (name) => ({
                name,
                path: join(real, name),
                git: await git(join(real, name)),
            })),
        ),
        truncated: entries.length > FOLDERS_MAX,
    };
}

const clones = new Map<string, Promise<unknown>>();

// Parallel jobs share a project's clone: fetching, adding or removing worktrees and checking a
// skills clone out take git's locks there, so they go one after another.
export function inClone<T>(clone: string, work: () => Promise<T>): Promise<T> {
    const next = (clones.get(clone) ?? Promise.resolve()).then(work, work);
    clones.set(
        clone,
        next.catch(() => {}),
    );
    return next;
}

// Where job branches go: the remote named by remote.pushDefault (a fork set up in the clone, so an
// account that may only read the repository opens pull requests from it), else origin.
export async function pushRemote(dir: string): Promise<string> {
    const named = await run("git", ["-C", dir, "config", "--get", "remote.pushDefault"]);
    return named.stdout.trim() || "origin";
}

// A pull request's head: a branch on a fork is `owner:branch`.
export async function prHead(dir: string, remote: string, branch: string): Promise<string> {
    if (remote === "origin") return branch;
    const url = (await run("git", ["-C", dir, "config", "--get", `remote.${remote}.url`])).stdout;
    const owner = /github\.com[:/]([^/]+)\//.exec(url)?.[1];
    return owner ? `${owner}:${branch}` : branch;
}

export async function syncClone(cfg: Config, dir: string, id: string): Promise<string> {
    if (existsSync(dir)) await must("git", ["-C", dir, "fetch", "--prune", "origin"]);
    else await must(cfg.gh, ["repo", "clone", id, dir]);
    return dir;
}

// A GitHub repository is fetched (or cloned); a local project is used as its folder is.
export async function ensureClone(cfg: Config, repo: Pick<Repo, "id" | "path" | "github">) {
    const dir = repoDir(cfg, repo);
    if (repo.github) return syncClone(cfg, dir, repo.github);
    if (!existsSync(dir)) throw new Error(`the folder ${dir} of project ${repo.id} is gone`);
    return dir;
}

const OLIMP_AUTHOR = ["-c", "user.name=OLIMP", "-c", "user.email=olimp@localhost"];
const SECRETS = ["node_modules/", ".env", ".env.*", "!.env.example"];
const GITIGNORE = [...SECRETS, ".DS_Store", "*.log", ""].join("\n");
const EXCLUDES = [
    "",
    "# OLIMP: secrets and installed dependencies stay out of commits",
    ...SECRETS,
    "",
];

export const isEmptyFolder = (path: string) => readdirSync(path).length === 0;
export const hasCommit = async (path: string) =>
    (await run("git", ["-C", path, "rev-parse", "--verify", "-q", "HEAD"])).code === 0;

// A folder becomes a repository with its files in a first commit: a task's worktree starts from
// HEAD, so an empty commit would hand every agent an empty tree. A repository without a commit
// gets that commit. Secrets and installed dependencies stay out: a .gitignore when the folder has
// none, and info/exclude whatever its own says. Without a git identity the commit is OLIMP's.
export async function initGit(path: string): Promise<string> {
    const fresh = !isGitFolder(path);
    if (fresh) await must("git", ["-C", path, "init", "-q", "-b", "main"]);
    try {
        mkdirSync(join(path, ".git", "info"), { recursive: true });
        appendFileSync(join(path, ".git", "info", "exclude"), EXCLUDES.join("\n"));
        if (!existsSync(join(path, ".gitignore")))
            writeFileSync(join(path, ".gitignore"), GITIGNORE);
        await must("git", ["-C", path, "add", "-A"]);
        const named = (await run("git", ["-C", path, "config", "user.email"])).code === 0;
        const commit = ["commit", "-q", "--allow-empty", "-m", "Initial commit"];
        await must("git", ["-C", path, ...(named ? [] : OLIMP_AUTHOR), ...commit]);
    } catch (error) {
        // A retry then starts from the folder as it was, not from a repository without a commit.
        if (fresh) rmSync(join(path, ".git"), { recursive: true, force: true });
        throw error;
    }
    return localBranch(path);
}

export const SANDBOX = "sandbox";

const SANDBOX_README = `# Sandbox

A local project OLIMP made on its first start, to try agents on: ask for a small change, watch
the agent work and find its commit on a branch \`olimp/<task>\`. Nothing here leaves this machine.
Remove the project in its settings once you add your own; its folder stays.
`;

// A fresh installation gets a local git project to try OLIMP on. A removed one does not come
// back: its folder stays on disk.
export async function ensureSandbox(store: Store, cfg: Config): Promise<Repo | null> {
    const dir = join(cfg.projectsDir, SANDBOX);
    if ((await store.repos()).length || existsSync(dir)) return null;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "README.md"), SANDBOX_README);
    await must("git", ["-C", dir, "init", "-q", "-b", "main"]);
    await must("git", ["-C", dir, "add", "README.md"]);
    // OLIMP's own commit, so it needs no git identity of the account yet.
    await must("git", ["-C", dir, ...OLIMP_AUTHOR, "commit", "-q", "-m", "Sandbox to try OLIMP"]);
    return registerRepo(store, cfg, SANDBOX, dir, null);
}

// Clones a GitHub repository into `path` unless that folder is already there (then it is
// fetched); without `path` it uses OLIMP's clone in OLIMP_HOME. A local project has no GitHub.
export async function registerRepo(
    store: Store,
    cfg: Config,
    id: string,
    path: string | null,
    github: string | null,
): Promise<Repo> {
    const branch = github ? await defaultBranch(cfg, github) : await localBranch(path ?? "");
    await ensureClone(cfg, { id, path, github });
    const repo = await store.addRepo(id, branch, path, github);
    await ensureUpkeep(store, repo);
    return repo;
}
