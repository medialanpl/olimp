import { cronMatches, parseCron } from "./cron.ts";
import { upkeepDue } from "./memory-upkeep.ts";
import type { Automation, Store, Task, WorkflowRun } from "./store.ts";

const MINUTE = 60_000;

export const minuteOf = (at: Date) => new Date(Math.floor(at.getTime() / MINUTE) * MINUTE);

export function dueAutomations(automations: Automation[], at: Date): Automation[] {
    return automations.filter((a) => {
        if (!a.enabled) return false;
        try {
            return cronMatches(parseCron(a.cron), at);
        } catch (error) {
            console.error(`automation ${a.id}: ${error}`);
            return false;
        }
    });
}

// Each due automation queues one task or workflow run per minute; the minute is claimed in the
// database.
export async function runDue(store: Store, at: Date = new Date()): Promise<(Task | WorkflowRun)[]> {
    const slot = minuteOf(at).toISOString();
    const jobs: (Task | WorkflowRun)[] = [];
    for (const a of dueAutomations(await store.automations(), at)) {
        if (a.builtin && !(await upkeepDue(store, a, at))) continue;
        const job = await store.runAutomation(a.id, slot);
        if (!job) continue;
        const kind = "workflow" in job ? "workflow run" : "task";
        console.log(`automation ${a.id} (${a.name}) queued ${kind} ${job.id}`);
        jobs.push(job);
    }
    return jobs;
}

// Checks the current minute on start and then just after every minute boundary; minutes the
// server was down for are not made up.
export function startScheduler(store: Store): () => void {
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const tick = async () => {
        try {
            await runDue(store);
        } catch (error) {
            console.error(`scheduler: ${error}`);
        }
        if (!stopped) timer = setTimeout(tick, MINUTE - (Date.now() % MINUTE) + 100);
    };
    void tick();
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
