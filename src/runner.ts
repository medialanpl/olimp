import { runAgent, threadBlock } from "./agent-step.ts";
import { resumes } from "./agents.ts";
import { isGitFolder, repoDir } from "./clones.ts";
import type { Config } from "./config.ts";
import {
    cancelSubtasks,
    dispatchRequest,
    dispatchServers,
    IN_FLIGHT_MAX,
    issueToken,
    mergedNote,
    mergeSubtasks,
    queueMerge,
    revokeToken,
    subtaskNote,
} from "./dispatch.ts";
import { labelPr, parseType, typedTitle, typeRequest } from "./github.ts";
import { checkCancelled, claim, finalStatus, parked } from "./jobs.ts";
import { openPullRequest, requestedBy, stagedLines } from "./pull-requests.ts";
import { type Pull, postReview, pullOf } from "./reviews.ts";
import type { Store, Task, TaskStatus } from "./store.ts";
import { notifyJob } from "./webhooks.ts";
import { runWorkflow, settleParent } from "./workflow-runner.ts";
import {
    branchOf,
    openCheckout,
    openWorktree,
    releaseWorktree,
    setUp,
    type Worktree,
} from "./worktrees.ts";

// A retry of a task from an issue has no issue of its own (one task per issue), but its text is
// still the issue's.
async function issueOf(store: Store, task: Task): Promise<number | null> {
    let current: Task | undefined = task;
    for (let hops = 0; current && hops < 50; hops++) {
        if (current.issue) return current.issue;
        current = current.retryOf ? await store.task(current.retryOf) : undefined;
    }
    return null;
}

// A continuation works on its thread's branch in the thread's worktree, resumes the agent's session
// or sees the earlier tasks of the thread, and updates the thread's pull request instead of opening
// a second one.
export async function runTask(store: Store, cfg: Config, task: Task): Promise<void> {
    let w: Worktree | null = null;
    const branch =
        task.workspace === "branch" && task.branchName
            ? task.branchName
            : branchOf(task.thread ?? task.id);
    const job = await claim(store, "task", task.id, branch);
    if (!job) return;
    // A subtask has a parent and no thread; the step that merges them has both.
    const parent = (task.parent && (await store.task(task.parent))) || null;
    const subtask = parent !== null && task.thread === null;
    const merging = parent !== null && task.thread !== null;
    // A workflow run's fork or dispatch node: its branch starts from the run's, and a reviewer
    // commits nothing.
    const parentRun = (task.parentRun && (await store.run(task.parentRun))) || null;
    const review = Boolean(
        parentRun?.state?.wait?.children?.some((c) => c.id === task.id && c.review),
    );
    const token = task.dispatch ? issueToken(task.id) : null;
    let status: TaskStatus = "failed";
    try {
        checkCancelled(job.signal);
        const thread = task.thread ? await store.threadTasks(task.thread) : [];
        const earlier = thread.filter((t) => t.id !== task.id && t.createdAt <= task.createdAt);
        // A review reads its pull request as it is now and starts from its head.
        let pull: Pull | null = null;
        if (task.reviewPr !== null) {
            const github = (await store.repo(task.repo))?.github;
            if (!github) throw new Error(`project ${task.repo} is not on GitHub`);
            pull = await pullOf(cfg, github, task.reviewPr);
        }
        // A thread works in one folder, named after its first task, because Claude keeps a session
        // by the folder it ran in. After a failed job (a push that failed) the clone's copy of the
        // branch may hold commits GitHub's lacks; only then does it win over GitHub's.
        w =
            task.workspace === "worktree"
                ? await openWorktree(
                      store,
                      cfg,
                      task.repo,
                      task.thread ?? task.id,
                      branch,
                      task.thread !== null,
                      subtask
                          ? parent.branch
                          : parentRun
                            ? (parentRun.branch ?? branchOf(parentRun.id))
                            : (pull?.headRefName ?? null),
                      parentRun !== null || (!pull && earlier.at(-1)?.status === "failed"),
                  )
                : await openCheckout(
                      store,
                      cfg,
                      task.repo,
                      task.workspace === "branch" ? branch : null,
                  );
        // The thread's worktree is this job's now; parked, nothing reclaims it meanwhile.
        if (task.thread) parked.add(task.thread);
        if (w.branch !== branch) await store.update(task.id, { branch: w.branch });
        await setUp(w);
        const issue = await issueOf(store, task);
        let extra = "";
        if (subtask) extra = subtaskNote(parent);
        if (merging && !w.inPlace)
            extra = mergedNote(
                await mergeSubtasks(
                    w.tree,
                    await store.subtasks(parent.id),
                    w.repo.github ? "origin/" : "",
                ),
            );
        if (token && task.dispatch) extra = dispatchRequest(task.dispatch);
        const typed =
            !!w.repo.github && w.repo.settings.typeLabel && !subtask && !parentRun && !pull;
        if (typed) extra += typeRequest();
        const step = {
            ...task,
            issue,
            review: pull,
            body: `${task.body}${extra}`,
            ...(token ? { servers: dispatchServers(cfg, token) } : {}),
        };
        const source = {
            repo: task.repo,
            task: task.id,
            run: null,
            node: null,
            author: task.author,
        };
        // The same agent on the same account picks the conversation up; the session already holds
        // the thread, so the prompt leaves it out.
        const before = earlier.at(-1);
        const session =
            before?.sessionId && before.agent === task.agent && before.author === task.author
                ? before.sessionId
                : null;
        const resume = session && resumes(task.agent) ? session : null;
        let agent = await runAgent(
            store,
            cfg,
            w.tree,
            { ...step, resume },
            source,
            job.signal,
            resume ? "" : threadBlock(earlier),
        );
        // Another login, or a session folder cleared since: the step starts over with the thread.
        if (
            resume &&
            !agent.ok &&
            /no conversation found/i.test(`${agent.error}\n${agent.output}`)
        ) {
            checkCancelled(job.signal);
            agent = await runAgent(
                store,
                cfg,
                w.tree,
                step,
                source,
                job.signal,
                threadBlock(earlier),
            );
        }
        const answer = typed ? parseType(agent.output) : { type: null, text: agent.output };
        await store.update(task.id, {
            log: answer.text,
            ...agent.usage,
            sessionId: agent.sessionId ?? null,
        });
        checkCancelled(job.signal);
        if (!agent.ok) throw new Error(agent.error ?? "agent failed");
        if (pull) {
            await postReview(cfg, pull, w.tree, task.id, answer.text);
            await store.update(task.id, { status: "done", prUrl: pull.url });
            status = "done";
            return;
        }
        // The issue is already on GitHub, so its PR only links it.
        const body =
            `${issue ? `Closes #${issue}` : task.body}\n\n---\n` +
            `OLIMP task \`${task.id}\`${await requestedBy(store, task.author)}`;
        const existing = thread.findLast((t) => t.prUrl && t.id !== task.id)?.prUrl ?? null;
        const lines = w.commits && !review ? await stagedLines(w.tree) : {};
        const prUrl = review
            ? null
            : await openPullRequest(cfg, w, typedTitle(answer.type, task.title), body, existing, {
                  pr: !subtask && !parentRun,
                  committed: merging,
              });
        if (prUrl && prUrl !== existing && !subtask && !parentRun)
            await labelPr(cfg, w.repo, prUrl, [
                ...w.repo.settings.prLabels,
                ...(answer.type ? [answer.type] : []),
            ]);
        await store.update(task.id, { status: "done", prUrl, ...lines });
        status = "done";
    } catch (error) {
        const final = finalStatus(error);
        status = final.status;
        await store.update(task.id, final);
    } finally {
        if (token) revokeToken(task.id);
        if (w) await releaseWorktree(store, w);
        if (task.thread) parked.delete(task.thread);
        job.done();
        void notifyJob(store, cfg, "task", task.id);
        if (task.dispatch && status !== "done")
            await cancelSubtasks(store, task.id, `the dispatched task ${task.id} did not finish`);
        if (subtask) await queueMerge(store, parent.id);
        if (parentRun) await settleParent(store, cfg, "task", task.id);
    }
}

// One job at a time, tasks and workflow runs alike: the agent edits a shared clone.
let paused = false;

// While OLIMP updates itself no new job starts; the jobs running now finish.
export function pauseWorker(pause: boolean): void {
    paused = pause;
}

export interface Taken {
    repo: string;
    // The thread's first task; a workflow run is a thread of its own.
    thread: string;
    // A folder without git: its agent works in the folder itself.
    alone: boolean;
    // A subtask's dispatched task, which caps how many of its subtasks run at once.
    parent?: string | null;
}

// A job waits while its folder without git is busy, or while an earlier task of its thread works
// on the branch it continues.
export const waits = (taken: Taken[], job: Taken) =>
    taken.some((t) => t.thread === job.thread || ((t.alone || job.alone) && t.repo === job.repo));

// Up to cfg.maxParallel jobs at once, oldest first, skipping the ones that wait.
export function startWorker(store: Store, cfg: Config, intervalMs = 2000): () => void {
    const taken = new Map<string, Taken>();
    let busy = false;
    const timer = setInterval(async () => {
        if (busy || paused) return;
        // Set before the first await, so the next tick cannot take the same job meanwhile.
        busy = true;
        const waiting: string[] = [];
        try {
            while (taken.size < cfg.maxParallel && !paused) {
                const jobs = [...taken.values()];
                const job = await store.nextJob({
                    ids: [...taken.keys(), ...waiting],
                    repos: jobs.filter((j) => j.alone).map((j) => j.repo),
                });
                if (!job) return;
                const id = job.kind === "task" ? job.task.id : job.run.id;
                const repoId = job.kind === "task" ? job.task.repo : job.run.repo;
                const repo = await store.repo(repoId);
                const parent = job.kind === "task" && !job.task.thread ? job.task.parent : null;
                const next: Taken = {
                    repo: repoId,
                    thread: job.kind === "task" ? (job.task.thread ?? id) : (job.run.thread ?? id),
                    // A task in the project's checkout takes turns with every other job there.
                    alone:
                        !repo ||
                        !isGitFolder(repoDir(cfg, repo)) ||
                        (job.kind === "task" && job.task.workspace !== "worktree"),
                    parent,
                };
                const inFlight = parent
                    ? ((await store.task(parent))?.dispatch?.inFlight ?? IN_FLIGHT_MAX)
                    : Number.POSITIVE_INFINITY;
                if (
                    waits(jobs, next) ||
                    jobs.filter((j) => parent && j.parent === parent).length >= inFlight
                ) {
                    waiting.push(id);
                    continue;
                }
                taken.set(id, next);
                const work =
                    job.kind === "task"
                        ? runTask(store, cfg, job.task)
                        : runWorkflow(store, cfg, job.run);
                void work.finally(() => taken.delete(id));
            }
        } finally {
            busy = false;
        }
    }, intervalMs);
    return () => clearInterval(timer);
}
