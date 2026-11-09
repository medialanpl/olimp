import type { Config } from "./config.ts";
import { TITLE_MAX } from "./limits.ts";
import { must } from "./proc.ts";
import { projectAgent } from "./settings.ts";
import type { Store, Task } from "./store.ts";

export const PULLS_PER_POLL = 30;
// GitHub takes 65,536 characters, Linux 128 KiB per argument.
const REVIEW_MAX = 30_000;

interface ListedPull {
    number: number;
    title: string;
    url: string;
    headRefOid: string;
    isDraft: boolean;
    isCrossRepository: boolean;
}

export interface Pull {
    // owner/name
    repo: string;
    number: number;
    title: string;
    body: string;
    url: string;
    headRefName: string;
    baseRefName: string;
}

function parsePulls(json: string): ListedPull[] {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) throw new Error("gh pr list: expected a JSON array");
    return value.filter(
        (p): p is ListedPull =>
            Number.isSafeInteger(p?.number) &&
            p.number > 0 &&
            typeof p.title === "string" &&
            typeof p.url === "string" &&
            /^[0-9a-f]{40}$/.test(p.headRefOid) &&
            typeof p.isDraft === "boolean" &&
            typeof p.isCrossRepository === "boolean",
    );
}

// One review task per new head of each open pull request of every repository with reviews on,
// queued as the account that turned them on. A draft waits until it is ready. A pull request from
// a fork is skipped: its code is anyone's, while a branch of the repository itself takes write
// access to push. A failing repository is logged and skipped.
export async function pollReviews(store: Store, cfg: Config): Promise<Task[]> {
    const created: Task[] = [];
    for (const repo of await store.repos()) {
        if (!repo.settings.prReview || !repo.github) continue;
        try {
            const out = await must(
                cfg.gh,
                [
                    "pr",
                    "list",
                    "--repo",
                    repo.github,
                    "--state",
                    "open",
                    "--limit",
                    String(PULLS_PER_POLL),
                    "--json",
                    "number,title,url,headRefOid,isDraft,isCrossRepository",
                ],
                { timeoutMs: 60_000 },
            );
            for (const pull of parsePulls(out)) {
                if (pull.isDraft || pull.isCrossRepository) continue;
                const task = await store.createReviewTask({
                    repo: repo.id,
                    reviewPr: pull.number,
                    reviewSha: pull.headRefOid,
                    title: `Review #${pull.number}: ${pull.title.trim()}`.slice(0, TITLE_MAX),
                    body: pull.url,
                    author: repo.settings.prReviewAuthor,
                    agent: await projectAgent(store, repo),
                });
                if (!task) continue;
                console.log(`pull request ${repo.id}#${pull.number} queued review ${task.id}`);
                created.push(task);
            }
        } catch (error) {
            console.error(`pull requests of ${repo.id}: ${error}`);
        }
    }
    return created;
}

// The pull request as it is when its review starts, which may be a later head than the poll saw.
export async function pullOf(cfg: Config, github: string, number: number): Promise<Pull> {
    const out = await must(
        cfg.gh,
        [
            "pr",
            "view",
            String(number),
            "--repo",
            github,
            "--json",
            "number,title,body,url,state,headRefName,baseRefName,isCrossRepository",
        ],
        { timeoutMs: 60_000 },
    );
    const pr = JSON.parse(out);
    if (pr?.state !== "OPEN")
        throw new Error(`pull request #${number} is ${String(pr?.state).toLowerCase()}`);
    if (pr.isCrossRepository !== false)
        throw new Error(
            `pull request #${number} comes from a fork, whose code OLIMP never checks out`,
        );
    const text = ["title", "body", "url", "headRefName", "baseRefName"];
    if (!text.every((key) => typeof pr[key] === "string"))
        throw new Error(`gh pr view #${number}: unexpected answer`);
    return {
        repo: github,
        number,
        title: pr.title,
        body: pr.body,
        url: pr.url,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
    };
}

export async function postReview(
    cfg: Config,
    pull: Pull,
    tree: string,
    task: string,
    review: string,
): Promise<void> {
    const head = await must("git", ["-C", tree, "rev-parse", "--short=12", "HEAD"]);
    const body =
        `${review.trim().slice(0, REVIEW_MAX)}\n\n---\n` +
        `OLIMP review of \`${head}\`, task \`${task}\``;
    await must(
        cfg.gh,
        ["pr", "comment", String(pull.number), "--repo", pull.repo, "--body", body],
        { timeoutMs: 60_000 },
    );
}
