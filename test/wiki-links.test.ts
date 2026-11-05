import assert from "node:assert/strict";
import { test } from "node:test";
import { wikiLinks } from "../web/src/lib/wiki-links.ts";

test("wiki links become panel links outside code only", () => {
    assert.equal(
        wikiLinks("site", "See [[deploy]] and `[[raw]]`.\n```\n[[block]]\n```\nThen [[hub]]."),
        "See [deploy](/project/site/memory/deploy) and `[[raw]]`.\n```\n[[block]]\n```\nThen [hub](/project/site/memory/hub).",
    );
    assert.equal(wikiLinks("site", "```\n[[open]] fence"), "```\n[[open]] fence");
});
