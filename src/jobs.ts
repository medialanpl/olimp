import { KILL_GRACE_MS } from "./proc.ts";
import type { JobKind, Store } from "./store.ts";

// The jobs running now, by id, so the API can cancel them; `settled` resolves once a job has
// stopped and cleaned up.
const active = new Map<string, { controller: AbortController; settled: Promise<void> }>();
// Runs that wait with their worktree kept, so nothing reclaims it meanwhile.
export const parked = new Set<string>();

function track(id: string) {
    const controller = new AbortController();
    let settle = () => {};
    const settled = new Promise<void>((resolve) => {
        settle = resolve;
    });
    active.set(id, { controller, settled });
    return {
        signal: controller.signal,
        done: () => {
            active.delete(id);
            settle();
        },
    };
}

// Cancels a running task or run: its agent gets SIGTERM, then SIGKILL. Resolves once it has
// stopped and cleaned up, or after a while; false when the job is not running here.
export async function cancelRunning(id: string, reason: string): Promise<boolean> {
    const job = active.get(id);
    if (!job) return false;
    job.controller.abort(reason);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
        job.settled,
        new Promise((resolve) => {
            timer = setTimeout(resolve, KILL_GRACE_MS + 10_000);
        }),
    ]);
    clearTimeout(timer);
    return true;
}

export const runningJobs = () => active.size;

export const isActive = (id: string) => active.has(id) || parked.has(id);

class Cancelled extends Error {}

export function checkCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new Cancelled(String(signal.reason ?? "cancelled"));
}

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The job is tracked before it is claimed, so a cancel always finds it queued or tracked.
export async function claim(store: Store, kind: JobKind, id: string, branch: string) {
    const job = track(id);
    if (await store.startJob(kind, id, branch)) return job;
    job.done();
    return null;
}

export const finalStatus = (error: unknown) =>
    error instanceof Cancelled
        ? ({ status: "cancelled", error: error.message } as const)
        : ({ status: "failed", error: message(error) } as const);
