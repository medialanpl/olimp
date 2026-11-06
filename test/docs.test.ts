import assert from "node:assert/strict";
import { test } from "node:test";
import { docsText } from "../src/docs.ts";
import { openApi } from "../src/openapi.ts";

const spec = (await openApi()) as Parameters<typeof docsText>[0];
const url = "http://127.0.0.1:4850";

test("olimp docs lists every operation by group and links the reference", () => {
    const text = docsText(spec, "", url, 120, 1);
    assert.ok(!text.includes("\x1b"), "no colours without a colour terminal");
    assert.match(text, /^ {2}Tasks$/m);
    assert.match(text, /^ {4}POST {4}\/api\/tasks +Create task$/m);
    assert.equal(text.match(/^ {2}System$/gm)?.length, 1, "a group is one block");
    assert.ok(text.includes(`${url}/docs/api`));
});

test("olimp docs with words shows the few operations that match in full", () => {
    const text = docsText(spec, "create task", url, 120, 1);
    assert.match(text, /MCP olimp_create_task/);
    assert.match(text, /^ {4}repo\* +string$/m);
    assert.match(text, /^ {4}title\* +string$/m);
    // Many matches stay a list; none says so.
    assert.ok(!docsText(spec, "tasks", url, 120, 1).includes("MCP olimp_"));
    assert.match(docsText(spec, "no such thing", url, 120, 1), /Nothing matches/);
});
