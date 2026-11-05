import assert from "node:assert/strict";
import { test } from "node:test";
import { inOrder } from "../web/src/lib/order.ts";

const repos = ["a/one", "a/two", "b/three"].map((id) => ({ id }));
const ids = (items: { id: string }[]) => items.map((item) => item.id);

test("the saved order comes first, new repositories after it, gone ones are dropped", () => {
    assert.deepEqual(ids(inOrder(repos, [])), ["a/one", "a/two", "b/three"]);
    assert.deepEqual(ids(inOrder(repos, ["b/three", "gone/repo", "a/one"])), [
        "b/three",
        "a/one",
        "a/two",
    ]);
});
