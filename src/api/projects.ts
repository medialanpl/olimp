import { existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
    branchCommits,
    branchFile,
    branchFiles,
    commitChanges,
    workingChanges,
} from "../changes.ts";
import {
    createRepo,
    ensureClone,
    FOLDER_NAME,
    hasCommit,
    inClone,
    initGit,
    insideRoot,
    isEmptyFolder,
    isGitFolder,
    listFolders,
    parseRepoRef,
    projectId,
    registerRepo,
    repoDir,
    waitForBranch,
} from "../clones.ts";
import type { Config } from "../config.ts";
import { HttpError, readJson, requireAdmin, text } from "../http.ts";
import { message } from "../jobs.ts";
import { PATH_MAX, REF_MAX, REPO_DESCRIPTION_MAX } from "../limits.ts";
import { must, run } from "../proc.ts";
import type { Repo, Store, User } from "../store.ts";
import { closeRepoTerminals } from "../terminals.ts";
import { type Answer, filePath, flag, oneLineText, repoOf, repoRef, withGit } from "./shared.ts";

const VISIBILITIES = ["private", "public"] as const;

// A new folder in OLIMP_PROJECTS, named after the repository unless given; never an existing one.
function newFolder(cfg: Config, value: unknown, name: string): string {
    const folder = value === undefined ? name : value;
    if (typeof folder !== "string" || !FOLDER_NAME.test(folder))
        throw new HttpError(400, "repo.invalidFolder");
    const path = join(cfg.projectsDir, folder);
    if (existsSync(path)) throw new HttpError(409, "repo.folderExists", { path });
    return path;
}

const nameOf = (github: string) => github.slice(github.indexOf("/") + 1);

// A project registered again keeps its id; a new one is named after its folder.
async function register(
    store: Store,
    cfg: Config,
    path: string | null,
    github: string | null,
): Promise<Repo> {
    const repos = await store.repos();
    const known = repos.find((r) => (github ? r.github === github : r.path === path));
    const id =
        known?.id ??
        projectId(
            path ? basename(path) : nameOf(github ?? ""),
            repos.map((r) => r.id),
        );
    return registerRepo(store, cfg, id, path ?? known?.path ?? null, github);
}

// Clones into a new folder; a repository registered before is fetched in its own folder again.
async function cloneRepo(store: Store, cfg: Config, body: Record<string, unknown>): Promise<Repo> {
    const github = repoRef(body.repo);
    const known = (await store.repos()).find((r) => r.github === github);
    if (known) return register(store, cfg, known.path, github);
    return register(store, cfg, newFolder(cfg, body.folder, nameOf(github)), github);
}

// Any local folder: a git repository whose origin is on GitHub is that repository,
// any other folder a local project. The folder is the machine's, so only an admin may pick one.
export async function addFolder(
    store: Store,
    cfg: Config,
    actor: User | null,
    value: unknown,
): Promise<Repo> {
    requireAdmin(actor);
    const path = insideRoot(cfg.browseRoot, text(value, "path", PATH_MAX));
    if (!path) throw new HttpError(400, "folder.outsideRoot", { root: cfg.browseRoot });
    if (path === realpathSync(homedir())) throw new HttpError(400, "repo.homeFolder");
    let github: string | null = null;
    if (isGitFolder(path)) {
        // The configured URL, not the one `insteadOf` rewrites it to.
        const origin = await run("git", ["-C", path, "config", "--get", "remote.origin.url"]);
        github = origin.code === 0 ? parseRepoRef(origin.stdout.trim()) : null;
    }
    const other =
        github &&
        (await store.repos()).find((r) => r.github === github && r.path && r.path !== path);
    if (other)
        throw new HttpError(409, "repo.otherFolder", { repo: other.id, path: other.path ?? "" });
    // An empty folder becomes a repository, as a new project does; one without a commit gets it.
    const git = isGitFolder(path);
    if (git ? !(await hasCommit(path)) : isEmptyFolder(path)) await gitIn(path);
    return register(store, cfg, path, github);
}

async function gitIn(path: string): Promise<string> {
    try {
        return await initGit(path);
    } catch (error) {
        throw new HttpError(500, "repo.gitInit", { reason: message(error) });
    }
}

// A new project: with GitHub, a repository created with the installation's gh login, empty (with
// a README) or from a template, then cloned into a new folder; without, a git repository with an
// empty first commit.
async function newRepo(store: Store, cfg: Config, body: Record<string, unknown>): Promise<Repo> {
    if (body.github === false) {
        const path = newFolder(cfg, body.name, "");
        try {
            mkdirSync(path, { recursive: true });
            await gitIn(path);
        } catch (error) {
            rmSync(path, { recursive: true, force: true });
            throw error;
        }
        return register(store, cfg, path, null);
    }
    const github = repoRef(body.repo);
    const visibility = body.visibility ?? "private";
    if (!VISIBILITIES.includes(visibility as (typeof VISIBILITIES)[number]))
        throw new HttpError(400, "repo.invalidVisibility");
    const description =
        body.description === undefined
            ? ""
            : oneLineText(body.description, "description", REPO_DESCRIPTION_MAX);
    const template =
        body.template === undefined || body.template === null
            ? null
            : repoRef(body.template, "template");
    const path = newFolder(cfg, body.folder, nameOf(github));
    await createRepo(
        cfg,
        github,
        visibility as (typeof VISIBILITIES)[number],
        description,
        template,
    );
    if (template) await waitForBranch(cfg, github);
    return register(store, cfg, path, github);
}

// The branches a task may start from: local and origin's, without OLIMP's own task branches.
async function repoBranches(cfg: Config, repo: Repo): Promise<string[]> {
    const dir = repoDir(cfg, repo);
    if (!withGit(cfg, repo).git) throw new HttpError(400, "repo.noGit", { repo: repo.id });
    const refs = await run("git", [
        "-C",
        dir,
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads",
        "refs/remotes/origin",
    ]);
    const names = refs.stdout
        .split("\n")
        .map((ref) => ref.replace(/^refs\/(heads|remotes\/origin)\//, ""))
        .filter((name) => name && name !== "HEAD" && !name.startsWith("olimp/"));
    return [...new Set(names)].sort();
}

// A local branch from the base, where a task would start; the folder stays on its branch.
async function createBranch(cfg: Config, repo: Repo, name: string) {
    const dir = repoDir(cfg, repo);
    const branches = await repoBranches(cfg, repo);
    // Echoed back unchanged only for a plain name: git expands @{-1} to the previous branch.
    const check = await run("git", ["-C", dir, "check-ref-format", "--branch", name]);
    if (check.code !== 0 || check.stdout.trim() !== name || name.startsWith("olimp/"))
        throw new HttpError(400, "repo.invalidBranch", { branch: name });
    if (branches.includes(name))
        throw new HttpError(409, "repo.branchExists", { repo: repo.id, branch: name });
    const base = repo.defaultBranch;
    const fromOrigin =
        !!repo.github &&
        (
            await run("git", [
                "-C",
                dir,
                "rev-parse",
                "--verify",
                "--quiet",
                `refs/remotes/origin/${base}`,
            ])
        ).code === 0;
    await must("git", [
        "-C",
        dir,
        "branch",
        "--no-track",
        name,
        fromOrigin ? `origin/${base}` : base,
    ]);
}

export async function projectsRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    url: URL,
    actor: User | null,
): Promise<Answer | undefined> {
    const path = url.pathname;
    const method = req.method;
    if (path === "/api/repos") {
        if (method === "GET") return [200, (await store.repos()).map((r) => withGit(cfg, r))];
        if (method === "POST") {
            const body = await readJson(req);
            if (body.path !== undefined)
                return [201, withGit(cfg, await addFolder(store, cfg, actor, body.path))];
            if (body.create !== undefined && flag(body.create, "create"))
                return [201, withGit(cfg, await newRepo(store, cfg, body))];
            return [201, withGit(cfg, await cloneRepo(store, cfg, body))];
        }
    }
    if (path === "/api/folders" && method === "GET") {
        requireAdmin(actor);
        const list = await listFolders(
            cfg.browseRoot,
            url.searchParams.get("path") || cfg.browseRoot,
            url.searchParams.get("hidden") === "1",
        );
        if (!list) throw new HttpError(400, "folder.outsideRoot", { root: cfg.browseRoot });
        return [200, list];
    }
    if (path === "/api/folders" && method === "POST") {
        requireAdmin(actor);
        const body = await readJson(req);
        const parent = insideRoot(cfg.browseRoot, text(body.path, "path", PATH_MAX));
        if (!parent) throw new HttpError(400, "folder.outsideRoot", { root: cfg.browseRoot });
        if (typeof body.folder !== "string" || !FOLDER_NAME.test(body.folder))
            throw new HttpError(400, "repo.invalidFolder");
        const created = join(parent, body.folder);
        if (existsSync(created)) throw new HttpError(409, "repo.folderExists", { path: created });
        mkdirSync(created);
        return [201, await listFolders(cfg.browseRoot, created)];
    }
    const oneRepo = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)$/.exec(path);
    if (oneRepo) {
        const repo = oneRepo[1] as string;
        const found = await store.repo(repo);
        if (!found) throw new HttpError(404, "repo.notRegistered", { repo });
        if (method === "GET") return [200, withGit(cfg, found)];
        // Only the registration goes: nothing on disk, and its history stays.
        if (method === "DELETE") {
            requireAdmin(actor);
            const active = await store.activeJobs(repo);
            if (active) throw new HttpError(409, "repo.busy", { repo, count: active });
            const flows = new Set(
                (await store.workflows()).filter((w) => w.repo === repo).map((w) => w.id),
            );
            // Its built-in upkeep stays with it and comes back when the project is added again.
            const users = (await store.automations()).filter(
                (a) =>
                    !a.builtin &&
                    (a.repo === repo || (a.workflow !== null && flows.has(a.workflow))),
            );
            if (users.length)
                throw new HttpError(409, "repo.inUse", {
                    repo,
                    automations: users.map((a) => a.name).join(", "),
                });
            await store.deleteRepo(repo);
            closeRepoTerminals(repo);
            return [200, withGit(cfg, found)];
        }
    }
    const git =
        /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/(changes|commits|files)(?:\/([0-9a-f]{7,40}))?$/.exec(
            path,
        );
    if (git && method === "GET" && (!git[3] || git[2] === "commits")) {
        const [, id = "", section, sha] = git;
        const repo = await repoOf(store, id);
        if (!withGit(cfg, repo).git) throw new HttpError(400, "repo.noGit", { repo: id });
        if (section === "changes") return [200, { repo: id, ...(await workingChanges(cfg, repo)) }];
        const branch = url.searchParams.get("branch") ?? repo.defaultBranch;
        if (!(await repoBranches(cfg, repo)).includes(branch))
            throw new HttpError(400, "repo.unknownBranch", { repo: id, branch });
        if (section === "commits") {
            if (!sha)
                return [200, { repo: id, ...(await branchCommits(cfg, repo, branch, "project")) }];
            const found = await commitChanges(cfg, repo, branch, sha, "project");
            if (!found) throw new HttpError(404, "repo.commitNotFound", { repo: id, sha });
            return [200, { repo: id, ...found }];
        }
        const file = url.searchParams.get("path");
        if (file === null)
            return [200, { repo: id, ...(await branchFiles(cfg, repo, branch, "project")) }];
        const found = await branchFile(cfg, repo, branch, filePath(file), "project");
        if (!found) throw new HttpError(404, "repo.fileNotFound", { repo: id, path: file });
        return [200, { repo: id, ...found }];
    }
    const fetchOrigin = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/fetch$/.exec(path);
    if (fetchOrigin && method === "POST") {
        const repo = await repoOf(store, fetchOrigin[1] as string);
        if (!repo.github) throw new HttpError(400, "github.localProject", { repo: repo.id });
        try {
            await inClone(repoDir(cfg, repo), () => ensureClone(cfg, repo));
        } catch (error) {
            console.error(`fetch ${repo.id}: ${message(error)}`);
            throw new HttpError(502, "repo.fetchFailed", { repo: repo.id });
        }
        return [200, withGit(cfg, repo)];
    }
    const gitInit = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/git$/.exec(path);
    if (gitInit && method === "POST") {
        requireAdmin(actor);
        const repo = await repoOf(store, gitInit[1] as string);
        const dir = repoDir(cfg, repo);
        if (repo.github || isGitFolder(dir))
            throw new HttpError(409, "repo.alreadyGit", { repo: repo.id });
        const branch = await gitIn(dir);
        return [200, withGit(cfg, (await store.setDefaultBranch(repo.id, branch)) as Repo)];
    }
    const ofRepo = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/(branches|branch)(?:\/([\w-]+))?$/.exec(
        path,
    );
    if (ofRepo) {
        const [, repo = "", section, name] = ofRepo;
        const found = await store.repo(repo);
        if (!found) throw new HttpError(404, "repo.notRegistered", { repo });
        if (section === "branches" && !name && method === "GET")
            return [200, { base: found.defaultBranch, branches: await repoBranches(cfg, found) }];
        if (section === "branches" && !name && method === "POST") {
            const branch = text((await readJson(req)).name, "name", REF_MAX);
            await createBranch(cfg, found, branch);
            return [201, { base: found.defaultBranch, branches: await repoBranches(cfg, found) }];
        }
        if (section === "branch" && !name && method === "PUT") {
            const branch = text((await readJson(req)).branch, "branch", REF_MAX);
            if (!(await repoBranches(cfg, found)).includes(branch))
                throw new HttpError(400, "repo.unknownBranch", { repo, branch });
            return [200, withGit(cfg, (await store.setDefaultBranch(repo, branch)) as Repo)];
        }
    }
    return undefined;
}
