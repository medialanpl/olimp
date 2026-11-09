import { parseNumstat } from "./changes.ts";
import { prHead, pushRemote } from "./clones.ts";
import type { Config } from "./config.ts";
import { must, run } from "./proc.ts";
import type { Store } from "./store.ts";
import { stageAll } from "./workflow-nodes.ts";
import type { Worktree } from "./worktrees.ts";

// Commits everything, pushes the branch and opens a pull request, unless the branch has one
// already (`existing`), which the push updates. Without changes nothing is pushed, but for commits
// an earlier push left behind. A local project
// keeps the commit on its branch; a folder without git keeps the change as it is.
export async function stagedLines(tree: string) {
    await must("git", ["-C", tree, "add", "-A"]);
    const files = parseNumstat(
        await must("git", [
            "-C",
            tree,
            "diff",
            "--cached",
            "--numstat",
            "-z",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
        ]),
    );
    const sum = (key: "added" | "deleted") => files.reduce((n, f) => n + (f[key] ?? 0), 0);
    return { linesAdded: sum("added"), linesDeleted: sum("deleted") };
}

// A subtask pushes its branch without a pull request; the merge step pushes its merge commits
// even when its agent changed nothing more.
export async function openPullRequest(
    cfg: Config,
    w: Worktree,
    title: string,
    body: string,
    existing: string | null = null,
    { pr = true, committed = false, draft = w.repo.settings.draftPr, checkOwned = {} } = {},
): Promise<string | null> {
    if (!w.commits) return null;
    await stageAll(w.tree, checkOwned);
    const changed = (await run("git", ["-C", w.tree, "diff", "--cached", "--quiet"])).code !== 0;
    // Commits no remote has: an earlier job of the thread committed and its push failed.
    const unsent =
        !changed &&
        pr &&
        Boolean(w.repo.github) &&
        (await run("git", ["-C", w.tree, "rev-list", "-1", "HEAD", "--not", "--remotes"]))
            .stdout !== "";
    if (!changed && !committed && !unsent) return existing;
    if (changed) await must("git", ["-C", w.tree, "commit", "-m", `olimp: ${title}`]);
    if (!w.repo.github) return null;
    const remote = await pushRemote(w.tree);
    await must("git", ["-C", w.tree, "push", "-u", remote, w.branch]);
    if (existing || !pr) return existing;
    const out = await must(cfg.gh, [
        "pr",
        "create",
        "--repo",
        w.repo.github,
        "--head",
        await prHead(w.tree, remote, w.branch),
        "--base",
        w.repo.defaultBranch,
        "--title",
        title,
        "--body",
        body,
        ...(draft ? ["--draft"] : []),
    ]);
    return out.split("\n").at(-1) ?? null;
}

// The pull request is opened with the installation's gh login, so it names the account behind it.
export async function requestedBy(store: Store, author: string | null): Promise<string> {
    if (!author) return "";
    return `, requested by ${(await store.user(author))?.name ?? `deleted account ${author}`}`;
}
