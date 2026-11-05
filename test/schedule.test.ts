import assert from "node:assert/strict";
import { test } from "node:test";
import { between, cronOf, lanes, scheduleOf, upcoming } from "../web/src/lib/schedule.ts";

test("a preset's cron reads back as the same preset", () => {
    for (const [cron, preset] of [
        ["0 4 * * *", "daily"],
        ["30 9 * * 1-5", "weekdays"],
        ["0 16 * * 5", "weekly"],
        ["0 8 * * 0,1,6", "weekly"],
        ["15 */6 * * *", "hours"],
        ["0 * * * *", "hours"],
    ]) {
        const schedule = scheduleOf(cron as string);
        assert.equal(schedule.preset, preset, cron);
        assert.equal(cronOf(schedule), cron);
    }
});

test("what the presets cannot show stays a custom cron, unchanged", () => {
    for (const cron of ["*/5 * * * *", "0 4 1 * *", "0 4 * * 7", "0 */5 * * *", "61 4 * * *"]) {
        const schedule = scheduleOf(cron);
        assert.equal(schedule.preset, "custom", cron);
        assert.equal(cronOf(schedule), cron);
    }
});

test("weekly days come out sorted and once each", () => {
    const schedule = scheduleOf("0 8 * * 5,1,5");
    assert.deepEqual(schedule.days, [1, 5]);
    assert.equal(cronOf(schedule), "0 8 * * 1,5");
});

test("the next runs and the runs in a window follow the cron", () => {
    const wednesday = new Date(2026, 9, 28, 12, 0);
    assert.deepEqual(upcoming("0 16 * * 5", wednesday, 2), [
        new Date(2026, 9, 30, 16, 0),
        new Date(2026, 10, 6, 16, 0),
    ]);
    assert.deepEqual(upcoming("not a cron", wednesday, 2), []);
    const day = new Date(2026, 9, 26);
    assert.equal(between("0 */6 * * *", day, new Date(2026, 9, 27)).length, 4);
});

test("overlapping calendar entries share the width, separate ones keep it whole", () => {
    const placed = lanes(
        [{ m: 60 }, { m: 0 }, { m: 10 }, { m: 30 }, { m: 35 }, { m: 300 }],
        (e) => e.m,
        30,
    );
    assert.deepEqual(
        placed.map(({ m, lane, count }) => [m, lane, count]),
        [
            [0, 0, 3],
            [10, 1, 3],
            [30, 0, 3],
            [35, 2, 3],
            [60, 0, 3],
            [300, 0, 1],
        ],
    );
    assert.deepEqual(
        lanes([], (e: { m: number }) => e.m, 30),
        [],
    );
});
