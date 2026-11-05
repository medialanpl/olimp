import assert from "node:assert/strict";
import { test } from "node:test";
import { commitGraph } from "../web/src/lib/commit-graph.ts";

test("a merge opens a lane for its second parent, which joins back at their common parent", () => {
    const rows = commitGraph([
        { sha: "m", parents: ["a", "b"] },
        { sha: "a", parents: ["c"] },
        { sha: "b", parents: ["c"] },
        { sha: "c", parents: [] },
    ]);
    assert.deepEqual(
        rows.map((row) => [row.lane, row.width]),
        [
            [0, 2],
            [0, 2],
            [1, 2],
            [0, 2],
        ],
    );
    assert.deepEqual(rows[0]?.bottom, [
        { from: 0, to: 0, lane: 0 },
        { from: 0, to: 1, lane: 1 },
    ]);
    assert.deepEqual(rows[3]?.top, [
        { from: 0, to: 0, lane: 0 },
        { from: 1, to: 0, lane: 1 },
    ]);
    assert.deepEqual(rows[3]?.bottom, []);
});

test("a branch tip that nothing above leads to starts a new lane", () => {
    const rows = commitGraph([
        { sha: "x", parents: ["a"] },
        { sha: "y", parents: ["a"] },
        { sha: "a", parents: [] },
    ]);
    assert.deepEqual(
        rows.map((row) => row.lane),
        [0, 1, 0],
    );
    assert.deepEqual(rows[1]?.top, [{ from: 0, to: 0, lane: 0 }]);
});
