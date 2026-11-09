import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { seedLocalLayer } from "./agent-config.ts";
import { ensureClone, inClone, isGitFolder, pushRemote, repoDir } from "./clones.ts";
import type { Config } from "./config.ts";
import { HttpError } from "./http.ts";
import { isActive } from "./jobs.ts";
import { SCRIPT_TIMEOUT_DEFAULT_S } from "./limits.ts";
import { must, run } from "./proc.ts";
import type { WorktreeScript } from "./project.ts";
import { isOlimpVariable } from "./sandbox.ts";
import type { Repo, Store, WorkflowRun } from "./store.ts";
import { closeTerminalsIn } from "./terminals.ts";

export interface Worktree {
    repo: Repo;
    clone: string;
    tree: string;
    branch: string;
    // A folder that is not a git repository, or a task in the project's checkout: the agent works
    // in it.
    inPlace: boolean;
    // OLIMP commits the agent's changes on `branch` and pushes them.
    commits: boolean;
    // A continuation's kept worktree, already set up.
    reused?: boolean;
}

export const branchOf = (id: string) => `olimp/${id}`;

export const OLIMP_DIR = ".olimp";

// One worktree per thread or workflow run. A first task or a run gets a new branch from the default
// branch; a continuation takes its thread's folder and branch as it is on GitHub (in a local project, in its
// folder), or a new one when nothing was committed yet. The repository must not have its own .olimp/: OLIMP puts each agent step's
// skill and notes file there.
export async function openWorktree(
    store: Store,
    cfg: Config,
    repoId: string,
    id: string,
    branch: string,
    continued = false,
    base: string | null = null,
    localBase = false,
) {
    const repo = await store.repo(repoId);
    if (!repo) throw new Error(`repository ${repoId} is not registered`);
    return inClone(repoDir(cfg, repo), () =>
        addWorktree(cfg, repo, id, branch, continued, base, localBase),
    );
}

// A task without a worktree works in the project's own checkout. With `branch` the checkout
// switches to it first (made from the base the first time) and OLIMP commits there; without, it
// stays on the branch it has and the changes are left uncommitted for the user to review.
export async function openCheckout(
    store: Store,
    cfg: Config,
    repoId: string,
    branch: string | null,
): Promise<Worktree> {
    const repo = await store.repo(repoId);
    if (!repo) throw new Error(`repository ${repoId} is not registered`);
    return inClone(repoDir(cfg, repo), async () => {
        const dir = await ensureClone(cfg, repo);
        if (existsSync(join(dir, OLIMP_DIR)))
            throw new Error("the folder already has .olimp/, where OLIMP puts a step's files");
        if (!branch) {
            const current = await must("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
            return { repo, clone: dir, tree: dir, branch: current, inPlace: true, commits: false };
        }
        const ref = ["-C", dir, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`];
        if ((await run("git", ref)).code === 0) await must("git", ["-C", dir, "switch", branch]);
        else {
            const base = repo.github ? `origin/${repo.defaultBranch}` : repo.defaultBranch;
            await must("git", ["-C", dir, "switch", "--no-track", "-c", branch, base]);
        }
        return { repo, clone: dir, tree: dir, branch, inPlace: true, commits: true };
    });
}

// `base` is the branch a new one starts from, the default branch unless given (a subtask's is
// its dispatched task's branch). A workflow run's subtask starts from the run's branch in the
// clone, `localBase`, which holds commits never pushed; so does a run's continuation.
async function addWorktree(
    cfg: Config,
    repo: Repo,
    id: string,
    branch: string,
    continued: boolean,
    base: string | null,
    localBase = false,
) {
    const clone = await ensureClone(cfg, repo);
    if (!isGitFolder(clone)) {
        if (existsSync(join(clone, OLIMP_DIR)))
            throw new Error("the folder already has .olimp/, where OLIMP puts a step's files");
        return { repo, clone, tree: clone, branch, inPlace: true, commits: false };
    }
    const w: Worktree = {
        repo,
        clone,
        tree: join(worktreesDir(cfg), id),
        branch,
        inPlace: false,
        commits: true,
    };
    const remote = repo.github ? "origin/" : "";
    // A continuation finds the branch where jobs push it: origin, or the clone's fork.
    const pushedTo = repo.github ? `${await pushRemote(w.clone)}/` : "";
    const git = (...args: string[]) => run("git", ["-C", w.clone, ...args]);
    const own = `refs/heads/${branch}`;
    try {
        const pushed =
            continued &&
            (
                await git(
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    repo.github ? `refs/remotes/${pushedTo}${branch}` : own,
                )
            ).code === 0;
        // A run's continuation keeps the clone's copy when the pushed one lacks its commits (no
        // push node, a push that failed): starting from GitHub's would reset them away.
        const unpushed =
            continued &&
            localBase &&
            Boolean(repo.github) &&
            (await git("rev-parse", "--verify", "--quiet", own)).code === 0 &&
            (!pushed ||
                (await git("merge-base", "--is-ancestor", own, `${pushedTo}${branch}`)).code !== 0);
        const start = unpushed
            ? branch
            : pushed
              ? `${pushedTo}${branch}`
              : localBase && base
                ? base
                : `${remote}${base ?? repo.defaultBranch}`;
        // A finished job's kept worktree, or one left by a crash, may still hold the branch. A
        // continuation stays in its thread's, with the person's terminals, dependencies and env
        // files, when the branch only moves forward; otherwise the folder is made anew.
        for (const kept of await worktreesOf(w.clone, dirname(w.tree))) {
            if (kept.branch !== w.branch || kept.active) continue;
            const forward = ["-C", w.tree, "merge", "--ff-only", "-q", start];
            if (continued && kept.path === w.tree && (await run("git", forward)).code === 0)
                return { ...w, reused: true };
            await retireTree(repo, w.clone, kept);
        }
        await must("git", [
            "-C",
            w.clone,
            "worktree",
            "add",
            // A continuation resets the clone's copy of the branch, left by an earlier task.
            continued ? "-B" : "-b",
            w.branch,
            w.tree,
            start,
        ]);
        if (existsSync(join(w.tree, OLIMP_DIR)))
            throw new Error(
                "the repository already has .olimp/, where OLIMP puts the skill, notes and memory " +
                    "of a step",
            );
    } catch (error) {
        await dropWorktree(w);
        throw error;
    }
    return w;
}

// Inside addWorktree, which already holds the clone.
const dropTree = (clone: string, tree: string) =>
    run("git", ["-C", clone, "worktree", "remove", "--force", tree]);
const dropWorktree = (w: Worktree) => dropTree(w.clone, w.tree);

export interface KeptWorktree {
    // The task or workflow run it was made for.
    id: string;
    path: string;
    branch: string | null;
    active: boolean;
    // When it last changed; null when its folder is gone and git still lists it.
    modifiedAt: string | null;
}

// The worktrees OLIMP made in `dir` from the clone, as git lists them, newest first.
async function worktreesOf(clone: string, dir: string): Promise<KeptWorktree[]> {
    const out = await run("git", ["-C", clone, "worktree", "list", "--porcelain"]);
    if (out.code !== 0) return [];
    return out.stdout
        .split("\n\n")
        .map((block) => {
            const path = /^worktree (.+)$/m.exec(block)?.[1] ?? "";
            const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
            const modified = existsSync(path) ? statSync(path).mtime.toISOString() : null;
            return { id: basename(path), path, branch, modifiedAt: modified };
        })
        .filter((tree) => tree.path && dirname(tree.path) === dir)
        .map((tree) => ({ ...tree, active: isActive(tree.id) }))
        .sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
}

export const worktreesDir = (cfg: Pick<Config, "home">) => join(cfg.home, "worktrees");

export async function projectWorktrees(cfg: Config, repo: Repo): Promise<KeptWorktree[]> {
    const clone = repoDir(cfg, repo);
    return isGitFolder(clone) ? worktreesOf(clone, worktreesDir(cfg)) : [];
}

// A worktree of a job that is not running; its branch stays, so the work can be recovered.
export async function removeProjectWorktree(cfg: Config, repo: Repo, id: string) {
    const clone = repoDir(cfg, repo);
    return inClone(clone, async () => {
        const found = (await projectWorktrees(cfg, repo)).find((tree) => tree.id === id);
        if (!found) throw new HttpError(404, "worktree.notFound", { repo: repo.id, id });
        if (found.active) throw new HttpError(409, "worktree.busy", { id });
        const kept = await retireTree(repo, clone, found);
        if (kept) throw new HttpError(409, "worktree.cleanupFailed", { reason: kept });
        await run("git", ["-C", clone, "worktree", "prune"]);
        return found;
    });
}

// "Reclaim now": the finished worktrees beyond the ones the project keeps.
export async function reclaimProjectWorktrees(cfg: Config, repo: Repo): Promise<KeptWorktree[]> {
    const clone = repoDir(cfg, repo);
    if (!isGitFolder(clone)) return [];
    return inClone(clone, async () => {
        const finished = (await projectWorktrees(cfg, repo)).filter((tree) => !tree.active);
        const gone = finished.slice(repo.settings.keepWorktrees);
        for (const tree of gone) await retireTree(repo, clone, tree);
        await run("git", ["-C", clone, "worktree", "prune"]);
        return gone;
    });
}

// Bytes on disk, as `du` counts them; null when it cannot tell in time.
export async function treeSize(path: string): Promise<number | null> {
    const out = await run("du", ["-sk", path], { timeoutMs: 10_000 });
    const kib = Number(out.stdout.split("\t")[0]);
    return out.code === 0 && Number.isFinite(kib) ? kib * 1024 : null;
}

// A project may keep its last finished worktrees; the oldest beyond that go.
export async function releaseWorktree(store: Store, w: Worktree) {
    const repo = (await store.repo(w.repo.id)) ?? w.repo;
    const keep = repo.settings.keepWorktrees;
    if (w.inPlace || !keep) return removeWorktree({ ...w, repo });
    rmSync(join(w.tree, OLIMP_DIR), { recursive: true, force: true });
    await inClone(w.clone, async () => {
        const id = basename(w.tree);
        const finished = (await worktreesOf(w.clone, dirname(w.tree))).filter(
            (tree) => !tree.active || tree.id === id,
        );
        for (const tree of finished.slice(keep)) await retireTree(repo, w.clone, tree);
    });
}

const removeWorktree = async (w: Worktree) => {
    if (w.inPlace) rmSync(join(w.tree, OLIMP_DIR), { recursive: true, force: true });
    else
        await inClone(w.clone, () =>
            retireTree(w.repo, w.clone, { path: w.tree, branch: w.branch }),
        );
};

const SCRIPT_OUTPUT_MAX = 2000;

// One phase of the project's worktree scripts, in order, by Bash in the worktree, with the
// worktree's facts as variables and without OLIMP's own; the first failure stops it.
async function runScripts(
    scripts: WorktreeScript[],
    root: string,
    tree: { path: string; branch: string | null },
): Promise<string | null> {
    const env: Record<string, string> = {
        ...Object.fromEntries(
            Object.entries(process.env).filter(
                (entry): entry is [string, string] =>
                    entry[1] !== undefined && !isOlimpVariable(entry[0]),
            ),
        ),
        OLIMP_PROJECT_PATH: root,
        OLIMP_WORKTREE_PATH: tree.path,
        OLIMP_JOB_ID: basename(tree.path),
        OLIMP_BRANCH: tree.branch ?? "",
    };
    for (const [index, script] of scripts.entries()) {
        const done = await run("bash", ["-c", script.command], {
            cwd: tree.path,
            env,
            timeoutMs: (script.timeoutSeconds ?? SCRIPT_TIMEOUT_DEFAULT_S) * 1000,
        });
        if (done.code !== 0)
            return (
                `script ${script.name || index + 1} failed (code ${done.code}): ` +
                (done.stderr || done.stdout).trim().slice(-SCRIPT_OUTPUT_MAX)
            );
    }
    return null;
}

// The worktree lifecycle, after creation: what a fresh checkout needs before the agent.
export async function setUp(w: Worktree): Promise<void> {
    if (w.inPlace) return;
    await seedLocalLayer(w.clone, w.tree);
    if (w.reused) return;
    const failed = await runScripts(w.repo.settings.worktreeScripts.afterCreate, w.clone, {
        path: w.tree,
        branch: w.branch,
    });
    if (failed) throw new Error(`worktree setup ${failed}`);
}

// Before removal the cleanup scripts run while the files are there; a failing one keeps the
// folder for recovery and its reason comes back.
// shortcut: they run under the clone's lock, so a slow one delays the project's next worktree; run them outside it if that bites.
async function retireTree(
    repo: Repo,
    clone: string,
    tree: { path: string; branch: string | null },
): Promise<string | null> {
    closeTerminalsIn(tree.path);
    if (existsSync(tree.path)) {
        const failed = await runScripts(repo.settings.worktreeScripts.beforeRemove, clone, tree);
        if (failed) {
            console.error(`worktree ${tree.path} kept: cleanup ${failed}`);
            return `cleanup ${failed}`;
        }
    }
    await dropTree(clone, tree.path);
    return null;
}

// The clone's info/exclude is shared by its worktrees, so `git add -A` never picks .olimp/ up.
export async function openOlimpDir(tree: string): Promise<void> {
    mkdirSync(join(tree, OLIMP_DIR), { recursive: true });
    if (!isGitFolder(tree)) return;
    const exclude = resolve(
        tree,
        await must("git", ["-C", tree, "rev-parse", "--git-path", "info/exclude"]),
    );
    const current = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    if (!current.split("\n").includes(`/${OLIMP_DIR}/`)) {
        mkdirSync(dirname(exclude), { recursive: true });
        appendFileSync(
            exclude,
            `${current && !current.endsWith("\n") ? "\n" : ""}/${OLIMP_DIR}/\n`,
        );
    }
}

// A run works in its thread's folder, named after the thread's first run.
export const runFolder = (run: Pick<WorkflowRun, "id" | "thread">) => run.thread ?? run.id;

// The worktree of a run that waited is still on disk; the worker opens it again. A resumed failed
// run's may be gone (the project keeps none, or reclaimed it): it comes back from the run's local
// branch, which holds the commits and the end-of-run autosave even when nothing was pushed.
export async function reopenWorktree(
    store: Store,
    cfg: Config,
    wr: WorkflowRun,
    restore = false,
): Promise<Worktree> {
    const repo = await store.repo(wr.repo);
    if (!repo) throw new Error(`repository ${wr.repo} is not registered`);
    const clone = repoDir(cfg, repo);
    const branch = wr.branch ?? branchOf(runFolder(wr));
    if (!isGitFolder(clone))
        return { repo, clone, tree: clone, branch, inPlace: true, commits: false };
    const tree = join(worktreesDir(cfg), runFolder(wr));
    const w = { repo, clone, tree, branch, inPlace: false, commits: true };
    if (existsSync(tree)) return { ...w, reused: true };
    if (!restore) throw new Error("the run's worktree is gone, so the run cannot go on");
    await inClone(clone, async () => {
        await run("git", ["-C", clone, "worktree", "prune"]);
        await must("git", ["-C", clone, "worktree", "add", tree, branch]);
    });
    return w;
}
