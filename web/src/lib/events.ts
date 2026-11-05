import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { headers, reportUnauthorized } from "./api";
import { notifyEnabled } from "./notify";
import { keys, type Trace, taskSource } from "./queries";
import type { BusEvent, RunSummary, Task, TaskSummary } from "./types";

export type LiveState = "connecting" | "live" | "offline";

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
// A hidden tab gives its connection back (6 per origin over HTTP/1.1) unless notifications need it.
const HIDDEN_RELEASE_MS = 30_000;
const FINISHED = new Set(["done", "failed", "cancelled"]);

function upsert<T extends { id: string }>(list: T[] | undefined, item: T): T[] | undefined {
    if (!list) return list;
    const at = list.findIndex((entry) => entry.id === item.id);
    if (at === -1) return [item, ...list];
    return list.map((entry, i) => (i === at ? { ...entry, ...item } : entry));
}

const terminalListeners = new Map<string, Set<() => void>>();

// A terminal's view reads its output again when the stream says it changed, and after a reconnect.
export function onTerminalOutput(id: string, listener: () => void): () => void {
    const set = terminalListeners.get(id) ?? new Set();
    terminalListeners.set(id, set);
    set.add(listener);
    return () => {
        set.delete(listener);
        if (!set.size) terminalListeners.delete(id);
    };
}

const pokeTerminals = (id?: string) => {
    for (const [session, set] of terminalListeners)
        if (!id || session === id) for (const listener of set) listener();
};

// A job that finished or failed just now, for a notification.
export interface Finished {
    kind: "task" | "run";
    id: string;
    title: string;
    status: "done" | "failed";
}

function finished<T extends { id: string; status: string }>(
    list: T[] | undefined,
    item: T,
): boolean {
    const before = list?.find((entry) => entry.id === item.id);
    return (
        !!before &&
        !FINISHED.has(before.status) &&
        (item.status === "done" || item.status === "failed")
    );
}

function apply(client: QueryClient, event: BusEvent, onFinished: (job: Finished) => void): void {
    if (event.type === "task") {
        const task = event.task;
        if (finished(client.getQueryData<TaskSummary[]>(keys.tasks), task))
            onFinished({
                kind: "task",
                id: task.id,
                title: task.title,
                status: task.status as Finished["status"],
            });
        client.setQueryData<TaskSummary[]>(keys.tasks, (list) => upsert(list, task));
        client.setQueryData<Task>(keys.task(task.id), (old) => (old ? { ...old, ...task } : old));
        void client.invalidateQueries({ queryKey: keys.thread(task.thread ?? task.id) });
        if (task.parent) void client.invalidateQueries({ queryKey: keys.subtasks(task.parent) });
        if (task.dispatch) void client.invalidateQueries({ queryKey: keys.subtasks(task.id) });
        if (task.variantGroup)
            void client.invalidateQueries({ queryKey: keys.variants(task.variantGroup) });
        // The answer (log) and the pushed branch arrive when the task finishes.
        if (FINISHED.has(task.status)) {
            void client.invalidateQueries({ queryKey: keys.task(task.id) });
            void client.invalidateQueries({ queryKey: keys.changes("task", task.id) });
            void client.invalidateQueries({ queryKey: keys.commits(taskSource(task.id)) });
            void client.invalidateQueries({ queryKey: keys.files(taskSource(task.id)) });
        }
    } else if (event.type === "run") {
        const run = event.run;
        if (finished(client.getQueryData<RunSummary[]>(keys.runs), run))
            onFinished({
                kind: "run",
                id: run.id,
                title: run.name,
                status: run.status as Finished["status"],
            });
        client.setQueryData<RunSummary[]>(keys.runs, (list) => upsert(list, run));
        void client.invalidateQueries({ queryKey: keys.run(run.id) });
        if (FINISHED.has(run.status))
            void client.invalidateQueries({ queryKey: keys.changes("run", run.id) });
    } else if (event.type === "terminal") {
        pokeTerminals(event.id);
    } else {
        const { task, run } = event.event;
        const key = task ? keys.trace("task", task) : run ? keys.trace("run", run) : null;
        if (key)
            client.setQueryData<Trace>(key, (old) =>
                old && !old.events.some((e) => e.seq === event.event.seq)
                    ? { ...old, events: [...old.events, event.event] }
                    : old,
            );
    }
}

// Server-Sent Events read through fetch, so the token stays in the Authorization header (an
// EventSource can only send cookies). A lost stream reconnects after a growing pause, and the lists
// are fetched again in case something was missed meanwhile. A tab hidden for a while closes the
// stream and opens it again when shown.
export function useLiveEvents(onFinished: (job: Finished) => void = () => {}): LiveState {
    const client = useQueryClient();
    const [state, setState] = useState<LiveState>("connecting");
    const finishedRef = useRef(onFinished);
    finishedRef.current = onFinished;
    useEffect(() => {
        let conn: AbortController | null = null;
        let delay = RETRY_MIN_MS;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let idle: ReturnType<typeof setTimeout> | undefined;
        const connect = async () => {
            const own = new AbortController();
            conn = own;
            setState("connecting");
            try {
                const res = await fetch("/api/events", {
                    headers: headers({ accept: "text/event-stream" }),
                    signal: own.signal,
                    cache: "no-store",
                });
                if (res.status === 401) {
                    reportUnauthorized();
                    return;
                }
                if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
                setState("live");
                delay = RETRY_MIN_MS;
                void client.invalidateQueries({ queryKey: keys.tasks });
                void client.invalidateQueries({ queryKey: keys.runs });
                void client.invalidateQueries({ queryKey: keys.traces });
                pokeTerminals();
                const decoder = new TextDecoder();
                let buffer = "";
                const reader = res.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const frames = buffer.split("\n\n");
                    buffer = frames.pop() ?? "";
                    for (const frame of frames) {
                        const data = frame
                            .split("\n")
                            .filter((line) => line.startsWith("data:"))
                            .map((line) => line.slice(5).trim())
                            .join("\n");
                        if (data)
                            apply(client, JSON.parse(data) as BusEvent, (job) =>
                                finishedRef.current(job),
                            );
                    }
                }
                throw new Error("events: stream ended");
            } catch {
                if (own.signal.aborted) return;
                setState("offline");
                timer = setTimeout(connect, delay);
                delay = Math.min(delay * 2, RETRY_MAX_MS);
            }
        };
        const release = () => {
            conn?.abort();
            conn = null;
            clearTimeout(timer);
        };
        const onVisibility = () => {
            clearTimeout(idle);
            if (document.hidden) {
                if (!notifyEnabled()) idle = setTimeout(release, HIDDEN_RELEASE_MS);
            } else if (!conn) void connect();
        };
        void connect();
        onVisibility();
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            clearTimeout(idle);
            release();
        };
    }, [client]);
    return state;
}
