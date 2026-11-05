import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { localBranch, repoDir } from "./clones.ts";
import type { Config } from "./config.ts";
import {
    COMMITS_MAX,
    DIFF_FILES_MAX,
    DIFF_MAX,
    FILE_MAX,
    IMAGE_MAX,
    TREE_FILES_MAX,
} from "./limits.ts";
import { ownEnv, run } from "./proc.ts";
import type { Repo } from "./store.ts";

// Lines added and deleted; both null for a binary file.
export interface ChangedFile {
    path: string;
    added: number | null;
    deleted: number | null;
}

// A job's branch against the default branch, as OLIMP's clone has them: `head` is null when the
// branch was never pushed (the agent failed, made no change, or the job has not run yet).
export interface Changes {
    branch: string | null;
    base: string;
    head: string | null;
    files: ChangedFile[];
    filesTruncated: boolean;
    diff: string;
    diffTruncated: boolean;
}

export interface Commit {
    sha: string;
    parents: string[];
    // Branches and tags ("tag: v1") pointing at the commit; "HEAD" for the checked-out one.
    refs: string[];
    author: string;
    email: string;
    date: string;
    title: string;
    body: string;
}

export interface BranchCommits {
    branch: string | null;
    base: string;
    head: string | null;
    commits: Commit[];
    truncated: boolean;
}

// One commit of a job's branch with its own files and diff.
export interface CommitChanges extends Commit {
    files: ChangedFile[];
    filesTruncated: boolean;
    diff: string;
    diffTruncated: boolean;
}

export interface BranchFiles {
    branch: string | null;
    head: string | null;
    files: string[];
    truncated: boolean;
}

// A file at the head of a job's branch; a binary one comes without its content, unless it is an
// image up to IMAGE_MAX: then `image` is its media type and `content` is base64.
export interface BranchFile {
    path: string;
    size: number;
    binary: boolean;
    content: string;
    truncated: boolean;
    image: string | null;
}

const IMAGES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
};

// Configured diff drivers, textconv and pagers stay off: the diff is read, never rendered by tools.
const DIFF_ARGS = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];

async function commit(clone: string, ref: string): Promise<string | null> {
    const res = await run("git", [
        "-C",
        clone,
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
    ]);
    return res.code === 0 ? res.stdout.trim() : null;
}

// Reads stdout up to `max` characters and stops the process there, so a huge diff never sits in
// memory whole.
function readCapped(
    args: string[],
    max: number,
    env = ownEnv(),
    encoding: BufferEncoding = "utf8",
): Promise<{ text: string; truncated: boolean }> {
    return new Promise((resolve, reject) => {
        const child = spawn("git", args, { env, stdio: ["ignore", "pipe", "pipe"] });
        let text = "";
        let truncated = false;
        let stderr = "";
        child.stdout.setEncoding(encoding);
        child.stdout.on("data", (chunk: string) => {
            if (truncated) return;
            text += chunk;
            if (text.length > max) {
                text = text.slice(0, max);
                truncated = true;
                child.kill();
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr = `${stderr}${chunk}`.slice(-2000);
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0 || truncated) resolve({ text, truncated });
            else
                reject(
                    new Error(
                        `git ${args[2]}: ${stderr.trim().split("\n").at(-1) || `exit ${code}`}`,
                    ),
                );
        });
    });
}

export function parseNumstat(output: string): ChangedFile[] {
    const files: ChangedFile[] = [];
    for (const entry of output.split("\0")) {
        const match = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(entry);
        if (!match) continue;
        const [, added = "-", deleted = "-", path = ""] = match;
        files.push({
            path,
            added: added === "-" ? null : Number(added),
            deleted: deleted === "-" ? null : Number(deleted),
        });
    }
    return files;
}

// Fields of `git log --format`, NUL between them and RS after each commit; the body comes last
// since only it may span lines.
export function parseLog(output: string): Commit[] {
    return output
        .split("\x1e")
        .map((entry) => entry.replace(/^\n/, ""))
        .filter(Boolean)
        .map((entry) => {
            const [
                sha = "",
                parents = "",
                refs = "",
                author = "",
                email = "",
                date = "",
                title = "",
            ] = entry.split("\0");
            return {
                sha,
                parents: parents.split(" ").filter(Boolean),
                refs: refs
                    .split(", ")
                    .flatMap((ref) => ref.split(" -> "))
                    .filter(Boolean),
                author,
                email,
                date,
                title,
                body: entry.split("\0").slice(7).join("\0").trim(),
            };
        });
}

// A job's branch as it was pushed, or a branch as the project's Git page browses it: the folder's
// own branches first (origin's when it is ahead) and its whole history.
export type View = "job" | "project";

// Read-only: no fetch, so the answers are what the last job, registration or POST
// /api/repos/:id/fetch fetched and pushed.
// A local project has no origin: its default branch is the folder's own.
async function branchRefs(cfg: Config, repo: Repo, branch: string | null, view: View) {
    const clone = repoDir(cfg, repo);
    if (!branch || !existsSync(clone)) return null;
    const prefixes =
        view === "job"
            ? ["refs/remotes/origin", "refs/heads"]
            : ["refs/heads", "refs/remotes/origin"];
    const resolveRef = async (name: string) => {
        const first = await commit(clone, `${prefixes[0]}/${name}`);
        const second = await commit(clone, `${prefixes[1]}/${name}`);
        // Fetching never moves the folder's own branch, so one origin is ahead of shows origin's.
        if (view === "project" && first && second && (await ancestor(clone, first, second)))
            return second;
        return first ?? second;
    };
    const base = await resolveRef(repo.defaultBranch);
    const head = await resolveRef(branch);
    return base && head ? { clone, base, head } : null;
}

async function diffOf(clone: string, range: string[], env = ownEnv()) {
    const stat = await readCapped(
        ["-C", clone, "diff", ...DIFF_ARGS, "--numstat", "-z", ...range],
        DIFF_MAX,
        env,
    );
    // A cut list ends in the middle of an entry.
    const files = parseNumstat(
        stat.truncated ? stat.text.slice(0, stat.text.lastIndexOf("\0") + 1) : stat.text,
    );
    const diff = await readCapped(["-C", clone, "diff", ...DIFF_ARGS, ...range], DIFF_MAX, env);
    return {
        files: files.slice(0, DIFF_FILES_MAX),
        filesTruncated: stat.truncated || files.length > DIFF_FILES_MAX,
        diff: diff.text,
        diffTruncated: diff.truncated,
    };
}

export async function branchChanges(
    cfg: Config,
    repo: Repo,
    branch: string | null,
): Promise<Changes> {
    const empty: Changes = {
        branch,
        base: repo.defaultBranch,
        head: null,
        files: [],
        filesTruncated: false,
        diff: "",
        diffTruncated: false,
    };
    const refs = await branchRefs(cfg, repo, branch, "job");
    if (!refs) return empty;
    return {
        ...empty,
        head: refs.head,
        ...(await diffOf(refs.clone, [`${refs.base}...${refs.head}`])),
    };
}

const LOG_FORMAT = "--format=%H%x00%P%x00%D%x00%an%x00%ae%x00%aI%x00%s%x00%b%x1e";

// The commits a job's branch adds to the default branch, or a project branch's whole log; newest
// first.
export async function branchCommits(
    cfg: Config,
    repo: Repo,
    branch: string | null,
    view: View = "job",
): Promise<BranchCommits> {
    const empty: BranchCommits = {
        branch,
        base: repo.defaultBranch,
        head: null,
        commits: [],
        truncated: false,
    };
    const refs = await branchRefs(cfg, repo, branch, view);
    if (!refs) return empty;
    const log = await readCapped(
        [
            "-C",
            refs.clone,
            "log",
            `--max-count=${COMMITS_MAX + 1}`,
            // Children before their parents, so the panel can draw the graph top down.
            "--date-order",
            LOG_FORMAT,
            view === "job" ? `${refs.base}..${refs.head}` : refs.head,
        ],
        DIFF_MAX,
    );
    const commits = parseLog(log.text.slice(0, log.text.lastIndexOf("\x1e") + 1));
    return {
        ...empty,
        head: refs.head,
        commits: commits.slice(0, COMMITS_MAX),
        truncated: log.truncated || commits.length > COMMITS_MAX,
    };
}

async function ancestor(clone: string, commit: string, of: string): Promise<boolean> {
    return (await run("git", ["-C", clone, "merge-base", "--is-ancestor", commit, of])).code === 0;
}

// Only a commit the branch adds, so a job never shows the rest of the repository's history; a
// project branch any commit it reaches.
export async function commitChanges(
    cfg: Config,
    repo: Repo,
    branch: string | null,
    sha: string,
    view: View = "job",
): Promise<CommitChanges | null> {
    const refs = await branchRefs(cfg, repo, branch, view);
    const full = refs && (await commit(refs.clone, sha));
    if (!refs || !full) return null;
    if (
        !(await ancestor(refs.clone, full, refs.head)) ||
        (view === "job" && (await ancestor(refs.clone, full, refs.base)))
    )
        return null;
    const log = await run("git", ["-C", refs.clone, "log", "-1", LOG_FORMAT, full]);
    const [info] = parseLog(log.stdout);
    if (!info) return null;
    // A root commit is diffed against the empty tree.
    const parent =
        (await commit(refs.clone, `${full}^`)) ??
        (
            await run("git", ["-C", refs.clone, "hash-object", "-t", "tree", "/dev/null"])
        ).stdout.trim();
    return { ...info, ...(await diffOf(refs.clone, [parent, full])) };
}

// The folder's uncommitted work against its checked-out commit, untracked files as new ones. They
// are marked intent-to-add in a copy of the index, so the user's own index stays untouched.
export async function workingChanges(cfg: Config, repo: Repo): Promise<Changes> {
    const dir = repoDir(cfg, repo);
    const head = await commit(dir, "HEAD");
    const empty: Changes = {
        branch: (await localBranch(dir)) || null,
        base: repo.defaultBranch,
        head,
        files: [],
        filesTruncated: false,
        diff: "",
        diffTruncated: false,
    };
    if (!head) return empty;
    const index = resolve(
        dir,
        (await run("git", ["-C", dir, "rev-parse", "--git-path", "index"])).stdout.trim(),
    );
    const tmp = mkdtempSync(join(tmpdir(), "olimp-index-"));
    const env = { ...ownEnv(), GIT_INDEX_FILE: join(tmp, "index") };
    try {
        if (existsSync(index)) copyFileSync(index, env.GIT_INDEX_FILE);
        await run("git", ["-C", dir, "add", "-A", "-N"], { env });
        return { ...empty, ...(await diffOf(dir, ["HEAD"], env)) };
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// Every file at the head of the branch, with its path from the repository root.
export async function branchFiles(
    cfg: Config,
    repo: Repo,
    branch: string | null,
    view: View = "job",
): Promise<BranchFiles> {
    const empty: BranchFiles = { branch, head: null, files: [], truncated: false };
    const refs = await branchRefs(cfg, repo, branch, view);
    if (!refs) return empty;
    const tree = await readCapped(
        ["-C", refs.clone, "ls-tree", "-r", "-z", "--name-only", refs.head],
        DIFF_MAX * 5,
    );
    const files = (tree.truncated ? tree.text.slice(0, tree.text.lastIndexOf("\0") + 1) : tree.text)
        .split("\0")
        .filter(Boolean);
    return {
        ...empty,
        head: refs.head,
        files: files.slice(0, TREE_FILES_MAX),
        truncated: tree.truncated || files.length > TREE_FILES_MAX,
    };
}

export async function branchFile(
    cfg: Config,
    repo: Repo,
    branch: string | null,
    path: string,
    view: View = "job",
): Promise<BranchFile | null> {
    const refs = await branchRefs(cfg, repo, branch, view);
    if (!refs) return null;
    const spec = `${refs.head}:${path}`;
    const type = await run("git", ["-C", refs.clone, "cat-file", "-t", spec]);
    if (type.code !== 0 || type.stdout.trim() !== "blob") return null;
    const size = Number(
        (await run("git", ["-C", refs.clone, "cat-file", "-s", spec])).stdout.trim(),
    );
    const image = IMAGES[extname(path).toLowerCase()] ?? null;
    if (image && size <= IMAGE_MAX) {
        const args = ["-C", refs.clone, "cat-file", "blob", spec];
        const read = await readCapped(args, Math.ceil(IMAGE_MAX / 3) * 4, ownEnv(), "base64");
        return { path, size, binary: true, content: read.text, truncated: false, image };
    }
    const read = await readCapped(["-C", refs.clone, "cat-file", "blob", spec], FILE_MAX);
    // Git's own test for binary content: a NUL in the first 8000 bytes.
    const binary = read.text.slice(0, 8000).includes("\0");
    return {
        path,
        size,
        binary,
        content: binary ? "" : read.text,
        truncated: !binary && read.truncated,
        image: null,
    };
}
