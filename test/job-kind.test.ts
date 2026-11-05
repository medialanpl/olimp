import assert from "node:assert/strict";
import { test } from "node:test";
import { type JobKind, jobKind } from "../web/src/lib/job-kind.ts";

const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

// The loader answers by kind; it records what it was asked, in order.
function loader(answers: Partial<Record<JobKind, Error>>) {
    const asked: JobKind[] = [];
    const load = async (kind: JobKind) => {
        asked.push(kind);
        if (answers[kind]) throw answers[kind];
        return { id: "0123456789ab" };
    };
    return { asked, load };
}

test("an id is a task when the task exists, without asking for a run", async () => {
    const { asked, load } = loader({});
    assert.equal(await jobKind(load), "task");
    assert.deepEqual(asked, ["task"]);
});

test("a task's 404 makes it a run when the run exists", async () => {
    const { asked, load } = loader({ task: fail(404) });
    assert.equal(await jobKind(load), "run");
    assert.deepEqual(asked, ["task", "run"]);
});

test("when neither exists the task's 404 is the answer", async () => {
    const missing = fail(404);
    const { load } = loader({ task: missing, run: fail(404) });
    await assert.rejects(jobKind(load), (error) => error === missing);
});

test("any other error is not taken for a missing task, nor a run's for a missing run", async () => {
    const down = fail(500);
    const tried = loader({ task: down });
    await assert.rejects(jobKind(tried.load), (error) => error === down);
    assert.deepEqual(tried.asked, ["task"]);
    const runDown = fail(503);
    await assert.rejects(
        jobKind(loader({ task: fail(404), run: runDown }).load),
        (error) => error === runDown,
    );
});
