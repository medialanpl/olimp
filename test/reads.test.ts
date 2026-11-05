import assert from "node:assert/strict";
import { test } from "node:test";
import { needsYou, threadsOf, unreadOf } from "../web/src/lib/reads.ts";

test("a thread is one task: the first's id and title, the newest step's state, the whole cost", () => {
    const task = (
        id: string,
        thread: string | null,
        minute: number,
        status: string,
        costUsd: number | null,
    ) => ({
        id,
        title: `title ${id}`,
        thread,
        retryOf: null,
        issue: null,
        automation: null,
        author: null,
        variantGroup: null,
        variant: null,
        archivedAt: null,
        createdAt: `2026-11-02T10:0${minute}:00Z`,
        costUsd,
        status,
    });
    const threads = threadsOf([
        task("a2", "a", 5, "done", 0.25),
        task("a", null, 0, "failed", 0.5),
        task("b", null, 1, "running", null),
        task("c3", "c", 7, "queued", null),
        task("c2", "c", 6, "done", 1),
    ]);
    const view = threads.map((t) => [t.id, t.title, t.status, t.costUsd, t.last, t.createdAt]);
    assert.deepEqual(view, [
        ["a", "title a", "done", 0.75, "a2", "2026-11-02T10:00:00Z"],
        ["b", "title b", "running", null, "b", "2026-11-02T10:01:00Z"],
        ["c2", "title c2", "queued", 1, "c3", "2026-11-02T10:06:00Z"],
    ]);
});

test("a finished job not read yet is unread, and nothing is before the reads load", () => {
    const unread = unreadOf({ tasks: ["seen"], runs: ["seen-run"] });
    assert.equal(unread({ id: "seen", status: "done" }), false);
    assert.equal(unread({ id: "seen-run", status: "failed" }), false);
    assert.equal(unread({ id: "new", status: "cancelled" }), true);
    assert.equal(unread({ id: "new", status: "running" }), false);
    assert.equal(unreadOf(undefined)({ id: "new", status: "done" }), false);
});

test("a job needs you when it is unread or waits for an answer", () => {
    assert.ok(needsYou({ status: "done", unread: true }));
    assert.ok(needsYou({ status: "waiting", unread: false }));
    assert.ok(!needsYou({ status: "done", unread: false }));
    assert.ok(!needsYou({ status: "running", unread: false }));
});
