import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { INTEGRATION_NAME, parseServer } from "../src/integrations.ts";
import { CATEGORIES, PRESETS } from "../web/src/lib/integration-catalog.ts";

test("every preset passes the server's own validation", () => {
    assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
    for (const preset of PRESETS) {
        assert.match(preset.id, INTEGRATION_NAME, preset.id);
        assert.deepEqual(parseServer({ ...preset.spec }), preset.spec, preset.id);
        assert.ok(preset.docs.startsWith("https://"), preset.id);
        assert.ok(CATEGORIES.includes(preset.category), preset.id);
    }
});

test("every preset and category has its text in every catalog", () => {
    for (const locale of ["en", "pl"]) {
        const file = join(import.meta.dirname, "..", "messages", `${locale}.json`);
        const { integrations } = JSON.parse(readFileSync(file, "utf8")).web;
        for (const preset of PRESETS)
            assert.ok(integrations.catalog[preset.id], `${locale}: ${preset.id}`);
        for (const category of CATEGORIES)
            assert.ok(integrations.categories[category], `${locale}: ${category}`);
    }
});
