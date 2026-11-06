import assert from "node:assert/strict";
import { test } from "node:test";
import { banner } from "../src/banner.ts";

const facts = {
    version: "1.2.3",
    url: "http://127.0.0.1:4850",
    rows: [["Database", "SQLite /srv/olimp.db"]] as [string, string][],
    agents: [
        { name: "claude", found: true },
        { name: "codex", found: false },
    ],
};

test("the banner puts the facts beside the mark when they fit, under it when not", () => {
    const wide = banner(facts, 120, 1).split("\n");
    assert.ok(wide.some((line) => /█.*Database {2,}SQLite \/srv\/olimp\.db$/.test(line)));
    assert.ok(wide.some((line) => line.endsWith("● claude")));
    assert.ok(wide.some((line) => line.endsWith("○ codex")));
    assert.ok(wide.every((line) => line.length <= 120));
    const narrow = banner(facts, 40, 1).split("\n");
    assert.ok(narrow.some((line) => line.trim() === "OLIMP 1.2.3"));
    assert.ok(!narrow.some((line) => /█.*OLIMP/.test(line)));
});

test("the banner has no escape codes without colours and the ochre one with true colour", () => {
    assert.ok(!banner(facts, 120, 1).includes("\x1b"));
    assert.ok(banner(facts, 120, 24).includes("\x1b[38;2;184;122;32m"));
});
