import assert from "node:assert/strict";
import { test } from "node:test";
import { cronMatches, isCron, nextMatch, parseCron } from "../src/cron.ts";

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);
// Local time, like the scheduler; months are 1-based here.
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
    new Date(y, mo - 1, d, h, mi);
const matches = (expr: string, date: Date) => cronMatches(parseCron(expr), date);

test("wildcards, lists, ranges and steps expand to the right values", () => {
    const c = parseCron("*/15 1,3-5 1-31/10 */4 1-5/2");
    assert.deepEqual(sorted(c.minute), [0, 15, 30, 45]);
    assert.deepEqual(sorted(c.hour), [1, 3, 4, 5]);
    assert.deepEqual(sorted(c.dayOfMonth), [1, 11, 21, 31]);
    assert.deepEqual(sorted(c.month), [1, 5, 9]);
    assert.deepEqual(sorted(c.dayOfWeek), [1, 3, 5]);
    assert.deepEqual(sorted(parseCron("5/20 * * * *").minute), [5, 25, 45]);
    assert.deepEqual(sorted(parseCron("7 * * * *").minute), [7]);
    assert.equal(parseCron("* * * * *").minute.size, 60);
});

test("Sunday is both 0 and 7", () => {
    assert.deepEqual(sorted(parseCron("0 0 * * 7").dayOfWeek), [0]);
    assert.deepEqual(sorted(parseCron("0 0 * * 5-7").dayOfWeek), [0, 5, 6]);
    assert.deepEqual(sorted(parseCron("0 0 * * 0,7").dayOfWeek), [0]);
    const sunday = at(2026, 11, 1, 0, 0);
    assert.equal(sunday.getDay(), 0);
    assert.ok(matches("0 0 * * 7", sunday));
    assert.ok(matches("0 0 * * 0", sunday));
    assert.ok(!matches("0 0 * * 1-6", sunday));
});

test("invalid expressions are refused", () => {
    for (const expr of [
        "",
        "* * * *",
        "* * * * * *",
        "60 * * * *",
        "* 24 * * *",
        "* * 0 * *",
        "* * 32 * *",
        "* * * 13 *",
        "* * * * 8",
        "5-1 * * * *",
        "*/0 * * * *",
        "*/ * * * *",
        "1-2-3 * * * *",
        "*/2/3 * * * *",
        "a * * * *",
        "-1 * * * *",
        "1,,2 * * * *",
        "MON * * * *",
    ])
        assert.equal(isCron(expr), false, expr);
    assert.equal(isCron("  0  6 * *   1-5 "), true);
});

test("a schedule matches only its minute, across midnight and month ends", () => {
    assert.ok(matches("59 23 * * *", at(2026, 12, 31, 23, 59)));
    assert.ok(!matches("59 23 * * *", at(2027, 1, 1, 0, 0)));
    assert.ok(matches("0 0 1 1 *", at(2027, 1, 1, 0, 0)));
    assert.ok(!matches("0 0 1 1 *", at(2026, 12, 31, 0, 0)));
    // 23:30 Sunday and 00:30 Monday: the day of week changes at midnight.
    assert.ok(matches("30 23,0 * * 0", at(2026, 11, 1, 23, 30)));
    assert.ok(!matches("30 23,0 * * 0", at(2026, 11, 2, 0, 30)));
    assert.ok(matches("30 23,0 * * 1", at(2026, 11, 2, 0, 30)));
    assert.ok(matches("*/20 * * * *", at(2026, 11, 2, 0, 40)));
    assert.ok(!matches("*/20 * * * *", at(2026, 11, 2, 0, 41)));
});

test("day of month and day of week: either when both are set, both when one is *", () => {
    const friday13 = at(2026, 11, 13, 9, 0);
    const monday2 = at(2026, 11, 2, 9, 0);
    const saturday14 = at(2026, 11, 14, 9, 0);
    assert.ok(matches("0 9 13 * 1", friday13));
    assert.ok(matches("0 9 13 * 1", monday2));
    assert.ok(!matches("0 9 13 * 1", saturday14));
    assert.ok(matches("0 9 * * 1-5", friday13));
    assert.ok(!matches("0 9 * * 1-5", saturday14));
    assert.ok(!matches("0 9 13 * *", monday2));
    // A field starting with * counts as unrestricted, so */2 (odd days) and Monday both apply.
    assert.ok(matches("0 9 */2 * 1", at(2026, 11, 9, 9, 0)));
    assert.ok(!matches("0 9 */2 * 1", monday2));
    assert.ok(!matches("0 9 */2 * 1", at(2026, 11, 3, 9, 0)));
});

test("the next run is the first matching minute after now, or none within a year", () => {
    const next = (expr: string, from: Date) => nextMatch(parseCron(expr), from)?.getTime();
    // Friday 13 Nov 2026 16:00 exactly: the run of this minute has started, the next is a week on.
    assert.equal(next("0 16 * * 5", at(2026, 11, 13, 16, 0)), at(2026, 11, 20, 16, 0).getTime());
    assert.equal(next("0 16 * * 5", at(2026, 11, 13, 15, 59)), at(2026, 11, 13, 16, 0).getTime());
    assert.equal(
        next("59 23 31 12 *", at(2026, 12, 31, 23, 59)),
        at(2027, 12, 31, 23, 59).getTime(),
    );
    assert.equal(next("0 0 30 2 *", at(2026, 11, 13, 9, 0)), undefined);
});
