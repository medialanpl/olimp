import type { Reads, RunStatus, Task } from "./types.ts";

export const FINISHED: RunStatus[] = ["done", "failed", "cancelled"];

// A finished task or run the caller has not opened; until the reads load, none is.
export function unreadOf(reads: Reads | undefined) {
    const read = new Set([...(reads?.tasks ?? []), ...(reads?.runs ?? [])]);
    return (job: { id: string; status: RunStatus }) =>
        !!reads && FINISHED.includes(job.status) && !read.has(job.id);
}

type ThreadStep = Pick<
    Task,
    | "id"
    | "title"
    | "thread"
    | "retryOf"
    | "issue"
    | "automation"
    | "author"
    | "variantGroup"
    | "variant"
    | "archivedAt"
    | "createdAt"
    | "costUsd"
>;

// One entry per thread, as one task: the first task's identity (its id is what pins and archives),
// the newest step's state, the whole cost, and `last`, the newest step's id, whose read counts.
// A thread whose first task fell off the list starts at its oldest step there.
export function threadsOf<T extends ThreadStep>(tasks: T[]): (T & { last: string })[] {
    const groups = new Map<string, T[]>();
    for (const task of tasks) {
        const root = task.thread ?? task.id;
        groups.set(root, [...(groups.get(root) ?? []), task]);
    }
    return [...groups].map(([root, group]) => {
        const steps = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const first = group.find((task) => task.id === root) ?? (steps[0] as T);
        const last = steps.at(-1) as T;
        return {
            ...last,
            id: first.id,
            title: first.title,
            thread: first.thread,
            retryOf: first.retryOf,
            issue: first.issue,
            automation: first.automation,
            author: first.author,
            variantGroup: first.variantGroup,
            variant: first.variant,
            archivedAt: first.archivedAt,
            createdAt: first.createdAt,
            costUsd: group.reduce<number | null>(
                (sum, task) => (task.costUsd === null ? sum : (sum ?? 0) + task.costUsd),
                null,
            ),
            last: last.id,
        };
    });
}

// A run waiting at a gate or a question needs an answer before anything else.
export const needsYou = (job: { status: RunStatus; unread: boolean }) =>
    job.unread || job.status === "waiting";
