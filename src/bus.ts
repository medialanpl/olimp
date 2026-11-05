import type { AgentEvent, JobKind, RunSummary, Store, Task } from "./store.ts";

export type BusEvent =
    | { type: "task"; task: Omit<Task, "log"> }
    | { type: "run"; run: RunSummary }
    | { type: "agent"; event: AgentEvent }
    // Only which terminal changed: its output is read through the API, by those who may.
    | { type: "terminal"; owner: string; id: string };

type Listener = (event: BusEvent) => void;

// The API process's own event bus: the worker, scheduler and API publish through the store, the
// event stream (GET /api/events) subscribes.
export class EventBus {
    private readonly listeners = new Set<Listener>();

    get size(): number {
        return this.listeners.size;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    publish(event: BusEvent): void {
        for (const listener of this.listeners)
            try {
                listener(event);
            } catch (error) {
                console.error(`event listener: ${error}`);
            }
    }
}

const summaryOf = ({ log: _, ...task }: Task): Omit<Task, "log"> => task;

// The store with every change of a task, a run or an agent event published on the bus once it is
// stored. Nothing is read back while no one listens.
export function publishing(store: Store, bus: EventBus): Store {
    const task = async (id: string) => {
        const found = await store.task(id);
        if (found) bus.publish({ type: "task", task: summaryOf(found) });
    };
    const run = async (id: string) => {
        const found = await store.run(id);
        if (found) {
            const { definition: _, steps: __, ...summary } = found;
            bus.publish({ type: "run", run: summary });
        }
    };
    const job = (kind: JobKind, id: string) => (kind === "task" ? task(id) : run(id));
    const created = (result: unknown) => {
        if (!result || typeof result !== "object") return;
        const { id } = result as { id: string };
        return "workflow" in result ? run(id) : task(id);
    };
    const after: Partial<Record<keyof Store, (args: unknown[], result: unknown) => unknown>> = {
        createTask: (_, result) => created(result),
        createIssueTask: (_, result) => created(result),
        runAutomation: (_, result) => created(result),
        createRun: (_, result) => created(result),
        update: ([id]) => task(id as string),
        archiveTask: ([id]) => task(id as string),
        updateRun: ([id]) => run(id as string),
        startJob: ([kind, id], result) => result && job(kind as JobKind, id as string),
        cancelQueued: ([kind, id], result) => result && job(kind as JobKind, id as string),
        addAgentEvent: (_, result) => bus.publish({ type: "agent", event: result as AgentEvent }),
    };
    return new Proxy(store, {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if (typeof value !== "function") return value;
            const hook = after[property as keyof Store];
            if (!hook) return value.bind(target);
            return async (...args: unknown[]) => {
                const result = await value.apply(target, args);
                if (bus.size)
                    try {
                        await hook(args, result);
                    } catch (error) {
                        console.error(`event bus: ${error}`);
                    }
                return result;
            };
        },
    });
}
