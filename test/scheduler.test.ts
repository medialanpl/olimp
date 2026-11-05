import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ensureUpkeep, WEAVE_AGE_MS, WEAVE_BACKLOG } from "../src/memory-upkeep.ts";
import { dueAutomations, runDue } from "../src/scheduler.ts";
import type { Automation, AutomationInput, Repo, Store, Task } from "../src/store.ts";
import { parseDefinition } from "../src/workflows.ts";
import { chain, openStore } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-scheduler-"));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
async function fresh() {
    const home = join(root, `home-${n++}`);
    const store = await openStore(home);
    await store.addRepo("acme/demo", "main");
    return { home, store };
}

const template: AutomationInput = {
    name: "Nightly",
    cron: "0 3 * * *",
    workflow: null,
    repo: "acme/demo",
    title: "Tidy up",
    body: "Remove dead code",
    agent: "claude",
    skill: "acme/skills:tidy",
    integrations: [],
    enabled: true,
};

// Local time, like the scheduler.
const at = (h: number, mi: number, s = 0, d = 2) => new Date(2026, 10, d, h, mi, s);

test("only enabled automations whose schedule matches the minute are due", async () => {
    const { store } = await fresh();
    const nightly = await store.createAutomation(template);
    const weekdays = await store.createAutomation({
        ...template,
        name: "Weekdays",
        cron: "0 3 * * 1-5",
    });
    await store.createAutomation({ ...template, name: "Off", enabled: false });
    await store.createAutomation({ ...template, name: "Later", cron: "30 3 * * *" });
    const automations = await store.automations();
    const ids = (date: Date) =>
        dueAutomations(automations, date)
            .map((a) => a.id)
            .sort();
    assert.deepEqual(ids(at(3, 0, 42)), [nightly.id, weekdays.id].sort());
    assert.deepEqual(ids(at(3, 0, 0, 1)), [nightly.id]);
    assert.deepEqual(ids(at(3, 1)), []);
});

test("a due automation queues one task with its template and a trace back to it", async () => {
    const { store } = await fresh();
    const automation = await store.createAutomation(template);
    const [task, ...rest] = (await runDue(store, at(3, 0, 5))) as Task[];
    assert.equal(rest.length, 0);
    assert.ok(task);
    assert.equal(task.status, "queued");
    assert.equal(task.automation, automation.id);
    assert.equal(task.skill, "acme/skills:tidy");
    assert.deepEqual(
        [task.repo, task.title, task.body, task.agent],
        ["acme/demo", "Tidy up", "Remove dead code", "claude"],
    );
    assert.ok((await store.automation(automation.id))?.lastRunAt);
});

test("one minute never queues the same automation twice, also after a restart", async () => {
    const { home, store } = await fresh();
    await store.createAutomation(template);
    assert.equal((await runDue(store, at(3, 0, 1))).length, 1);
    assert.equal((await runDue(store, at(3, 0, 59))).length, 0);
    assert.equal((await runDue(await openStore(home), at(3, 0, 30))).length, 0);
    // A clock set back to an earlier minute does not repeat it either.
    assert.equal((await runDue(store, at(3, 0, 0, 1))).length, 0);
    assert.equal((await runDue(store, at(3, 0, 0, 3))).length, 1);
    assert.equal((await store.tasks()).length, 2);
});

test("concurrent claims of one minute queue a single job", async () => {
    const { store } = await fresh();
    const automation = await store.createAutomation(template);
    const slot = at(3, 0).toISOString();
    const jobs = await Promise.all(
        Array.from({ length: 5 }, () => store.runAutomation(automation.id, slot)),
    );
    assert.equal(jobs.filter(Boolean).length, 1);
    assert.equal((await store.tasks()).length, 1);
});

// With one shared connection, a request that ran inside the automation's transaction would be
// rolled back with it.
test("a failed automation run rolls back alone, not a request made at the same time", async () => {
    const { store } = await fresh();
    const workflow = await store.createWorkflow({
        name: "Gone",
        repo: "acme/demo",
        definition: parseDefinition(chain({ id: "pr", type: "github.draft-pr" })),
    });
    const automation = await store.createAutomation({
        ...template,
        workflow: workflow.id,
        repo: null,
        title: null,
        body: null,
        agent: null,
        skill: null,
        integrations: null,
    });
    await store.deleteWorkflow(workflow.id);
    const [run, task] = await Promise.allSettled([
        store.runAutomation(automation.id),
        store.createTask({ repo: "acme/demo", title: "Concurrent", body: "" }),
    ]);
    assert.equal(run.status, "rejected");
    assert.match(String(run.reason), /workflow [0-9a-f]{12} of automation .* is gone/);
    assert.equal(task.status, "fulfilled");
    assert.deepEqual(
        (await store.tasks()).map((t) => t.title),
        ["Concurrent"],
    );
    assert.equal((await store.automation(automation.id))?.lastRunAt, null);
});

test("running an automation by hand does not use up its scheduled minute", async () => {
    const { store } = await fresh();
    const automation = await store.createAutomation({ ...template, enabled: false });
    const manual = await store.runAutomation(automation.id);
    assert.equal(manual?.automation, automation.id);
    assert.equal((await runDue(store, at(3, 0))).length, 0);
    await store.updateAutomation(automation.id, { ...template, enabled: true });
    assert.equal((await runDue(store, at(3, 0))).length, 1);
});

test("a deleted automation stops, its tasks keep the trace", async () => {
    const { store } = await fresh();
    const automation = await store.createAutomation(template);
    const [task] = await runDue(store, at(3, 0));
    assert.equal(await store.deleteAutomation(automation.id), true);
    assert.equal(await store.deleteAutomation(automation.id), false);
    assert.equal((await runDue(store, at(3, 0, 0, 3))).length, 0);
    assert.equal((await store.task(task?.id ?? ""))?.automation, automation.id);
});

// The knowledge base of acme/demo turned on.
const withMemory = async (store: Store) => {
    const repo = (await store.repo("acme/demo")) as Repo;
    return (await store.setRepoSettings(repo.id, { ...repo.settings, memory: true })) as Repo;
};

test("a project with the knowledge base gets memory weaving and lint once, turned on", async () => {
    const { store } = await fresh();
    await ensureUpkeep(store, (await store.repo("acme/demo")) as Repo);
    assert.deepEqual(await store.automations(), []);
    const repo = await withMemory(store);
    await ensureUpkeep(store, repo);
    const [lint] = (await store.automations()).filter((a) => a.builtin === "lint");
    await store.updateAutomation(lint?.id as string, { ...(lint as Automation), enabled: false });
    await ensureUpkeep(store, repo);
    const upkeep = (await store.automations()).map((a) => [a.builtin, a.repo, a.cron, a.enabled]);
    assert.deepEqual(upkeep.sort(), [
        ["lint", "acme/demo", "0 4 * * 0", false],
        ["weave", "acme/demo", "0 3 * * *", true],
    ]);
});

// The first time after now, local, at the hour (on the weekday, 0 is Sunday), plus whole days.
function upcoming(hour: number, weekday: number | null, days = 0) {
    const when = new Date();
    when.setHours(hour, 0, 0, 0);
    while (when.getTime() <= Date.now() || (weekday !== null && when.getDay() !== weekday))
        when.setDate(when.getDate() + 1);
    when.setDate(when.getDate() + days);
    return when;
}

async function upkept() {
    const { store } = await fresh();
    await ensureUpkeep(store, await withMemory(store));
    const queued = async (when: Date) =>
        ((await runDue(store, when)) as Task[]).map((t) => t.title);
    return { store, queued, none: { task: null, run: null, node: null } };
}

// One scenario a test: a shared MySQL database is emptied only between tests.
test("memory weaving runs at its hour only once the oldest note is a week old", async () => {
    const { store, queued, none } = await upkept();
    assert.deepEqual(await queued(upcoming(3, null)), []);
    await store.addNotes("acme/demo", ["one"], none);
    assert.deepEqual(await queued(upcoming(3, null)), []);
    assert.ok(WEAVE_AGE_MS < 8 * 86_400_000);
    assert.deepEqual(await queued(upcoming(3, null, 8)), ["Memory weaving"]);
});

test("memory weaving runs at its hour with a backlog of notes", async () => {
    const { store, queued, none } = await upkept();
    const notes = Array.from({ length: WEAVE_BACKLOG + 1 }, (_, i) => `note ${i}`);
    await store.addNotes("acme/demo", notes, none);
    assert.deepEqual(await queued(upcoming(3, null)), ["Memory weaving"]);
});

test("memory lint runs on Sundays only when the memory changed since the last one", async () => {
    const { store, queued, none } = await upkept();
    assert.deepEqual(await queued(upcoming(4, 0)), []);
    const page = { slug: "build", title: "Build", description: "How to build.", kind: "page" };
    await store.createMemoryPage("acme/demo", { ...page, kind: "page" }, none);
    assert.deepEqual(await queued(upcoming(4, 0)), ["Memory lint"]);
    assert.deepEqual(await queued(upcoming(4, 0, 7)), []);
    await store.createMemoryPage("acme/demo", { ...page, slug: "test", kind: "page" }, none);
    await store.deleteRepo("acme/demo");
    assert.deepEqual(await queued(upcoming(4, 0, 14)), []);
});
