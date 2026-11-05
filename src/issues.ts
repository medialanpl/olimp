import type { Config } from "./config.ts";
import { TASK_BODY_MAX, TITLE_MAX } from "./limits.ts";
import { must } from "./proc.ts";
import { projectAgent } from "./settings.ts";
import type { Store, Task } from "./store.ts";

export const DEFAULT_ISSUE_LABEL = "olimp";
export const ISSUE_POLL_MS = 5 * 60_000;
export const ISSUES_PER_POLL = 30;

interface Issue {
    number: number;
    title: string;
    body: string;
}

function parseIssues(json: string): Issue[] {
    const value: unknown = JSON.parse(json);
    if (!Array.isArray(value)) throw new Error("gh issue list: expected a JSON array");
    return value.filter(
        (i): i is Issue =>
            Number.isSafeInteger(i?.number) &&
            i.number > 0 &&
            typeof i.title === "string" &&
            typeof i.body === "string",
    );
}

// One task per open labelled issue of every repository with issues on, queued as the account that
// turned issues on. The label is the gate: on GitHub only people with triage access can add it. A
// failing repository is logged and skipped.
export async function pollIssues(store: Store, cfg: Config): Promise<Task[]> {
    const created: Task[] = [];
    for (const repo of await store.repos()) {
        if (!repo.issueLabel || !repo.github) continue;
        try {
            const out = await must(
                cfg.gh,
                [
                    "issue",
                    "list",
                    "--repo",
                    repo.github,
                    "--state",
                    "open",
                    "--label",
                    repo.issueLabel,
                    "--limit",
                    String(ISSUES_PER_POLL),
                    "--json",
                    "number,title,body",
                ],
                // A hung gh would stop the polling of every repository until a restart.
                { timeoutMs: 60_000 },
            );
            for (const issue of parseIssues(out)) {
                const task = await store.createIssueTask({
                    repo: repo.id,
                    issue: issue.number,
                    title: issue.title.trim().slice(0, TITLE_MAX) || `Issue #${issue.number}`,
                    body: issue.body.slice(0, TASK_BODY_MAX),
                    author: repo.issueAuthor,
                    agent: await projectAgent(store, repo),
                });
                if (!task) continue;
                console.log(`issue ${repo.id}#${issue.number} queued task ${task.id}`);
                created.push(task);
            }
        } catch (error) {
            console.error(`issues of ${repo.id}: ${error}`);
        }
    }
    return created;
}

export function startIssuePoller(store: Store, cfg: Config): () => void {
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const tick = async () => {
        try {
            await pollIssues(store, cfg);
        } catch (error) {
            console.error(`issues: ${error}`);
        }
        if (!stopped) timer = setTimeout(tick, ISSUE_POLL_MS);
    };
    void tick();
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
