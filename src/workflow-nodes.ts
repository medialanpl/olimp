import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseNumstat } from "./changes.ts";
import { pushRemote } from "./clones.ts";
import type { Config } from "./config.ts";
import { checkOf, type GhCheck } from "./github.ts";
import { expand } from "./integrations.ts";
import { must, run, stream } from "./proc.ts";
import { isOlimpVariable } from "./sandbox.ts";
import type { Repo } from "./store.ts";
import {
    CHECK_OUTPUT_MAX,
    type Condition,
    compareValues,
    globMatch,
    type Outputs,
} from "./workflow-graph.ts";

// What a node of a run works on: the run's worktree, or the project's folder without git.
export interface NodeSite {
    cfg: Config;
    repo: Repo;
    tree: string;
    branch: string;
    git: boolean;
    signal: AbortSignal;
    // The process environment with the project's secrets, OLIMP's own variables left out.
    env: Record<string, string>;
    // What checks wrote into files that were clean before them: path to blob hash.
    checkOwned: Record<string, string>;
}

export interface NodeResult {
    port: string;
    log: string;
    outputs?: Record<string, string | number>;
    error?: string;
}

const failed = (log: string): NodeResult => ({ port: "failed", log, error: log });

export function siteEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    return Object.fromEntries(
        Object.entries(env).filter(
            (entry): entry is [string, string] =>
                entry[1] !== undefined && !isOlimpVariable(entry[0]),
        ),
    );
}

// Any shell command: whoever edits a workflow runs code as the OLIMP user.
export async function runCheck(
    site: NodeSite,
    command: string,
    timeoutMs: number,
): Promise<{ code: number; output: string; stopped: boolean }> {
    const lines: string[] = [];
    let size = 0;
    const done = await stream("sh", ["-c", command], {
        cwd: site.tree,
        env: site.env,
        timeoutMs,
        signal: site.signal,
        onLine: (line) => {
            lines.push(line);
            size += line.length + 1;
            while (size > CHECK_OUTPUT_MAX * 2 && lines.length > 1)
                size -= (lines.shift() as string).length + 1;
        },
    });
    const output = [lines.join("\n"), done.stderr.trim()].filter(Boolean).join("\n");
    return {
        code: done.stopped === "timeout" ? 124 : done.code,
        output: output.slice(-CHECK_OUTPUT_MAX),
        stopped: done.stopped === "cancelled",
    };
}

const baseRef = (repo: Repo) => (repo.github ? `origin/${repo.defaultBranch}` : repo.defaultBranch);

// The run's changes against where its branch left the base, committed or not.
async function changedFiles(site: NodeSite) {
    if (!site.git) return [];
    await must("git", ["-C", site.tree, "add", "-A"]);
    const base = await must("git", ["-C", site.tree, "merge-base", "HEAD", baseRef(site.repo)]);
    return parseNumstat(
        await must("git", [
            "-C",
            site.tree,
            "diff",
            "--cached",
            "--numstat",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            base,
        ]),
    );
}

export async function evaluate(
    site: NodeSite,
    condition: Condition,
    outputs: Outputs,
): Promise<{ result: boolean; value: string | number }> {
    if (condition.kind === "output") {
        const [id = "", field = ""] = condition.ref.split(".");
        const seen = outputs[id]?.[field] ?? "";
        return { value: seen, result: compareValues(seen, condition.op, condition.value) };
    }
    if (condition.kind === "branch") {
        const name = site.repo.defaultBranch;
        const { op, value: wanted } = condition;
        return { value: name, result: op === "equals" ? name === wanted : globMatch(wanted, name) };
    }
    const changed = await changedFiles(site);
    if (condition.kind === "paths-changed") {
        const matching = changed.flatMap((file) =>
            globMatch(condition.glob, file.path) ? [file.path] : [],
        );
        const listed = matching.slice(0, 5).join(", ");
        return { value: listed || "no match", result: matching.length > 0 };
    }
    let measured = changed.length;
    if (condition.kind === "diff-lines") {
        measured = 0;
        for (const file of changed) measured += (file.added ?? 0) + (file.deleted ?? 0);
    }
    return { value: measured, result: compareValues(measured, condition.op, condition.value) };
}

const CHECK_OWNED_MAX = 5000;
const PATHS_PER_CALL = 500;

const chunks = (paths: string[]) =>
    Array.from({ length: Math.ceil(paths.length / PATHS_PER_CALL) }, (_, i) =>
        paths.slice(i * PATHS_PER_CALL, (i + 1) * PATHS_PER_CALL),
    );

// The changed paths of a worktree, each untracked file on its own.
export async function changedPaths(tree: string): Promise<Set<string>> {
    const out = await run("git", [
        "-C",
        tree,
        "status",
        "--porcelain",
        "-z",
        "--no-renames",
        "--untracked-files=all",
    ]);
    // An empty set would make every change the agent left look written by the next check.
    if (out.code !== 0) throw new Error(`git status: ${out.stderr.trim() || `exit ${out.code}`}`);
    return new Set(
        out.stdout
            .split("\0")
            .filter(Boolean)
            .map((entry) => entry.slice(3)),
    );
}

// Blob hashes of files, or null for one git cannot hash (a folder, a submodule).
async function blobs(tree: string, paths: string[]): Promise<Map<string, string | null>> {
    const found = new Map<string, string | null>();
    for (const part of chunks(paths.filter((path) => existsSync(join(tree, path))))) {
        const out = await run("git", ["-C", tree, "hash-object", "--", ...part]);
        const lines = out.code === 0 ? out.stdout.trim().split("\n") : [];
        for (const [i, path] of part.entries()) found.set(path, lines[i] ?? null);
    }
    return found;
}

// What a check wrote into paths that were clean before it.
// shortcut: past CHECK_OWNED_MAX paths the rest stays in commits, ignore them in .gitignore instead.
export async function checkWrote(
    tree: string,
    before: Set<string>,
): Promise<Record<string, string>> {
    const fresh = [...(await changedPaths(tree))].filter((path) => !before.has(path));
    const owned: Record<string, string> = {};
    for (const [path, hash] of await blobs(tree, fresh.slice(0, CHECK_OWNED_MAX)))
        if (hash) owned[path] = hash;
    return owned;
}

// Stages everything but what a check wrote and nothing changed since, so generated files and
// caches stay out of the commit while a later edit of them goes in.
export async function stageAll(tree: string, owned: Record<string, string> = {}) {
    await must("git", ["-C", tree, "add", "-A"]);
    const now = await blobs(tree, Object.keys(owned));
    const same = [...now].filter(([path, hash]) => hash && hash === owned[path]).map(([p]) => p);
    for (const part of chunks(same)) await must("git", ["-C", tree, "reset", "-q", "--", ...part]);
}

type Tree = Pick<NodeSite, "tree" | "git" | "checkOwned">;

async function hasStaged(site: Tree) {
    await stageAll(site.tree, site.checkOwned);
    return (await run("git", ["-C", site.tree, "diff", "--cached", "--quiet"])).code !== 0;
}

// Commits what the steps left, so a push, a merge or a subtask's worktree sees it.
export async function autosave(site: Tree, message: string): Promise<boolean> {
    if (!site.git || !(await hasStaged(site))) return false;
    await must("git", ["-C", site.tree, "commit", "-m", message]);
    return true;
}

export async function commit(site: NodeSite, message: string): Promise<NodeResult> {
    if (!site.git) return failed("the project folder has no git");
    if (!(await hasStaged(site))) return { port: "nothing", log: "nothing to commit" };
    const done = await run("git", ["-C", site.tree, "commit", "-m", message]);
    if (done.code !== 0) return failed((done.stderr || done.stdout).trim());
    const sha = await must("git", ["-C", site.tree, "rev-parse", "HEAD"]);
    return { port: "done", log: `committed ${sha.slice(0, 8)}`, outputs: { sha } };
}

export async function push(site: NodeSite): Promise<NodeResult> {
    if (!site.git) return failed("the project folder has no git");
    if (!site.repo.github) return failed("a local project has no remote to push to");
    await autosave(site, "olimp: before push");
    const remote = await pushRemote(site.tree);
    const done = await run("git", ["-C", site.tree, "push", "-u", remote, site.branch]);
    if (done.code !== 0) return failed((done.stderr || done.stdout).trim());
    return { port: "done", log: `pushed ${site.branch}` };
}

// On a conflict the merge is left in progress, for the next agent to resolve.
export async function syncBase(site: NodeSite): Promise<NodeResult> {
    if (!site.git) return failed("the project folder has no git");
    await autosave(site, "olimp: before merging the base branch");
    if (site.repo.github) {
        const fetched = await run("git", [
            "-C",
            site.tree,
            "fetch",
            "origin",
            site.repo.defaultBranch,
        ]);
        if (fetched.code !== 0) return failed((fetched.stderr || fetched.stdout).trim());
    }
    const base = baseRef(site.repo);
    const merged = await run("git", ["-C", site.tree, "merge", "--no-edit", base]);
    if (merged.code === 0) return { port: "done", log: `merged the latest ${base}` };
    const conflicts = (
        await run("git", ["-C", site.tree, "diff", "--name-only", "--diff-filter=U"])
    ).stdout.trim();
    if (!conflicts) return failed((merged.stderr || merged.stdout).trim());
    return {
        port: "conflict",
        log: `merge conflict with ${base}, left in progress:\n${conflicts}`,
        outputs: { conflicts },
    };
}

// Commits on the branch that the base does not have.
export async function ahead(site: NodeSite): Promise<number> {
    if (!site.git) return 0;
    const out = await run("git", [
        "-C",
        site.tree,
        "rev-list",
        "--count",
        `${baseRef(site.repo)}..HEAD`,
    ]);
    return out.code === 0 ? Number(out.stdout.trim()) || 0 : 0;
}

export const prNumber = (url: string | null) => {
    const match = url ? /\/pull\/(\d+)/.exec(url) : null;
    return match ? Number(match[1]) : null;
};

async function gh(cfg: Config, args: string[]): Promise<string | null> {
    const done = await run(cfg.gh, args, { timeoutMs: 60_000 });
    return done.code === 0 ? null : (done.stderr || done.stdout).trim() || `exit ${done.code}`;
}

export async function updatePr(
    site: NodeSite,
    prUrl: string | null,
    change: { ready?: boolean; addLabels?: string[]; reviewers?: string[] },
): Promise<NodeResult> {
    const number = prNumber(prUrl);
    if (!site.repo.github || number === null) return failed("this run has no pull request");
    const repo = ["--repo", site.repo.github];
    if (change.ready) {
        const error = await gh(site.cfg, ["pr", "ready", String(number), ...repo]);
        if (error) return failed(error);
    }
    const edits = [
        ...(change.addLabels?.length ? ["--add-label", change.addLabels.join(",")] : []),
        ...(change.reviewers?.length ? ["--add-reviewer", change.reviewers.join(",")] : []),
    ];
    if (edits.length) {
        const error = await gh(site.cfg, ["pr", "edit", String(number), ...repo, ...edits]);
        if (error) return failed(error);
    }
    return { port: "done", log: `updated pull request #${number}` };
}

export async function commentPr(
    site: NodeSite,
    prUrl: string | null,
    body: string,
): Promise<NodeResult> {
    const number = prNumber(prUrl);
    if (!site.repo.github || number === null) return failed("this run has no pull request");
    const error = await gh(site.cfg, [
        "pr",
        "comment",
        String(number),
        "--repo",
        site.repo.github,
        "--body",
        body,
    ]);
    return error ? failed(error) : { port: "done", log: `commented on #${number}` };
}

const ISSUE_MARKER = /(?:OLIMP|CEZ):ISSUE[ \t:=#]+(\d+)/g;

// The issue an agent step named with `OLIMP:ISSUE <number>`, the latest one.
export function markedIssue(outputs: Outputs): number | null {
    let found: number | null = null;
    for (const values of Object.values(outputs))
        for (const m of String(values.summary ?? "").matchAll(ISSUE_MARKER)) found = Number(m[1]);
    return found;
}

export async function commentIssue(
    site: NodeSite,
    issue: number | null,
    body: string,
): Promise<NodeResult> {
    if (!site.repo.github) return failed("a local project has no GitHub issues");
    if (issue === null) return failed("no issue: set one on the node or name it with OLIMP:ISSUE");
    const error = await gh(site.cfg, [
        "issue",
        "comment",
        String(issue),
        "--repo",
        site.repo.github,
        "--body",
        body,
    ]);
    return error
        ? failed(error)
        : { port: "done", log: `commented on issue #${issue}`, outputs: { issue } };
}

export type CiState = "passing" | "failing" | "pending" | "conflict";

// Unavailable (offline, gh logged out, no checks yet) is pending: the wait goes on to its timeout.
// GitHub runs no CI on a conflicting pull request, so a conflict ends the wait, and the checks of
// another head than `sha` do not count.
export async function ciState(
    cfg: Config,
    repo: Repo,
    number: number,
    sha?: string,
): Promise<CiState> {
    if (!repo.github) return "pending";
    // statusCheckRollup, unlike `gh pr checks --json`, is there in older gh as well (2.46, Debian).
    const view = await run(
        cfg.gh,
        [
            ...["pr", "view", String(number), "--repo", repo.github],
            ...["--json", "headRefOid,mergeable,statusCheckRollup"],
        ],
        { timeoutMs: 60_000 },
    );
    let pr: { headRefOid?: string; mergeable?: string; statusCheckRollup?: GhCheck[] | null } = {};
    try {
        pr = JSON.parse(view.stdout) ?? {};
    } catch {}
    if (pr.mergeable === "CONFLICTING") return "conflict";
    if (sha && pr.headRefOid && pr.headRefOid !== sha) return "pending";
    const checks = (pr.statusCheckRollup ?? []).map(checkOf);
    if (!checks.length) return "pending";
    if (checks.some((c) => c.state === "failing")) return "failing";
    return checks.every((c) => c.state === "passing") ? "passing" : "pending";
}

const WEBHOOK_TIMEOUT_MS = 15_000;

export async function sendWebhook(
    site: NodeSite,
    url: string,
    payload: object,
): Promise<NodeResult> {
    let target: URL;
    try {
        target = new URL(expand(url, site.env));
    } catch {
        return failed("the webhook address is not a URL");
    }
    if (target.protocol !== "https:") return failed("a webhook address must be HTTPS");
    try {
        const response = await fetch(target, {
            method: "POST",
            headers: { "content-type": "application/json", "user-agent": "OLIMP" },
            body: JSON.stringify(payload),
            redirect: "error",
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        const outputs = { status: response.status };
        return response.ok
            ? { port: "done", log: `webhook answered ${response.status}`, outputs }
            : { ...failed(`webhook answered ${response.status}`), outputs };
    } catch (error) {
        return failed(`webhook failed: ${(error as Error).message}`);
    }
}
