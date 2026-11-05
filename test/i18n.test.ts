import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { LOCALES, localeFrom, t } from "../src/i18n.ts";

const dir = join(import.meta.dirname, "..", "messages");

function flatten(node: unknown, prefix = ""): Map<string, string> {
    const out = new Map<string, string>();
    if (typeof node === "string") return out.set(prefix, node);
    assert.ok(node && typeof node === "object" && !Array.isArray(node), `${prefix}: not an object`);
    for (const [key, value] of Object.entries(node))
        for (const entry of flatten(value, prefix ? `${prefix}.${key}` : key)) out.set(...entry);
    return out;
}

const placeholders = (message: string) =>
    [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every catalog in messages/ has the same keys and placeholders as en", () => {
    const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    assert.deepEqual(files.map((file) => file.slice(0, -5)).sort(), [...LOCALES].sort());
    const read = (file: string) => flatten(JSON.parse(readFileSync(join(dir, file), "utf8")));
    const en = read("en.json");
    for (const file of files) {
        const other = read(file);
        assert.deepEqual([...other.keys()].sort(), [...en.keys()].sort(), `${file}: keys differ`);
        for (const [key, message] of en)
            assert.deepEqual(
                placeholders(other.get(key) ?? ""),
                placeholders(message),
                `${file}: ${key}`,
            );
    }
});

// Lowercase only for words the panel puts inside a sentence, values written as in code, and API
// errors that start with the field's name.
const LOWERCASE = new Set([
    "web.table.of",
    "web.automations.atMinute",
    "web.repo.worktreesUnit",
    "web.settings.minutes",
    "web.repo.scripts.timeoutHint",
    "web.flow.simulateLeaves",
    "web.workflows.namePlaceholder",
    "web.addRepo.repoPlaceholder",
    "web.prompt.branchAuto",
    "web.repo.format.ntfy",
    "web.skills.kind.synced",
    "skill.searchFailed",
]);
const lowercase = (key: string, message: string) =>
    LOWERCASE.has(key) ||
    key.startsWith("web.flow.port.") ||
    (!key.startsWith("web.") && /^[a-z]\w*: /.test(message));

// A plural or select starts with each of its branches.
function starts(message: string): string[] {
    if (!/^\{\w+, (?:plural|select),/.test(message)) return [message];
    const out: string[] = [];
    let depth = 0;
    for (let i = 0; i < message.length; i++) {
        if (message[i] === "{" && ++depth === 2) out.push(message.slice(i + 1).trimStart());
        else if (message[i] === "}" && --depth === 0) break;
    }
    return out;
}

test("messages are in sentence case: each starts with a capital letter", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")))
        for (const [key, message] of flatten(JSON.parse(readFileSync(join(dir, file), "utf8")))) {
            if (lowercase(key, message)) continue;
            for (const start of starts(message))
                assert.ok(!/^\p{Ll}/u.test(start), `${file}: ${key} starts lowercase: ${start}`);
        }
});

// use-intl reads <name> as a rich-text tag and shows the key instead of a message passed to t().
test("the panel's messages have no angle brackets", () => {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
        const { web } = JSON.parse(readFileSync(join(dir, file), "utf8"));
        for (const [key, message] of flatten(web, "web"))
            assert.ok(!/[<>]/.test(message), `${file}: ${key}`);
    }
});

// The panel reads the same catalogs through use-intl, every component with useTranslations("web").
test("every key the web panel uses is in the catalogs under web", () => {
    const src = join(import.meta.dirname, "..", "web", "src");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((file) =>
        /\.tsx?$/.test(file),
    );
    const en = flatten(JSON.parse(readFileSync(join(dir, "en.json"), "utf8")));
    const prefixes = new Set(
        [...en.keys()].flatMap((key) => {
            const parts = key.split(".");
            return parts.map((_, i) => `${parts.slice(0, i).join(".")}.`);
        }),
    );
    let used = 0;
    for (const file of files) {
        const code = readFileSync(join(src, file), "utf8");
        if (/useTranslations\(\s*(?!"web")/.test(code))
            assert.fail(`${file}: useTranslations without the "web" namespace`);
        for (const [, key] of code.matchAll(/\bt\(\s*"([\w.]+)"/g)) {
            used++;
            assert.ok(en.has(`web.${key}`), `${file}: web.${key} is not in messages/en.json`);
        }
        // A key built from a value, e.g. t(`status.${status}`), needs at least its group.
        for (const [, prefix] of code.matchAll(/\bt\(\s*`([\w.]+\.)\$\{/g))
            assert.ok(prefixes.has(`web.${prefix}`), `${file}: no group web.${prefix}`);
    }
    assert.ok(used > 50, "the scan found the panel's keys");
});

test("t fills placeholders in the chosen locale", () => {
    assert.equal(
        t("en", "repo.notRegistered", { repo: "acme/demo" }),
        "Project acme/demo is not registered.",
    );
    assert.equal(
        t("pl", "repo.notRegistered", { repo: "acme/demo" }),
        "Projekt acme/demo nie jest zarejestrowany.",
    );
    assert.equal(
        t("en", "field.invalidText", { field: "title", max: 200 }),
        "title: expected text of up to 200 characters.",
    );
});

test("t throws on a key missing from the catalog", () => {
    assert.throws(() => t("en", "repo.nope" as "repo.invalidId"), /missing message en:repo.nope/);
});

test("the locale comes from Accept-Language with en as fallback", () => {
    assert.equal(localeFrom(undefined), "en");
    assert.equal(localeFrom(""), "en");
    assert.equal(localeFrom("pl"), "pl");
    assert.equal(localeFrom("pl-PL,pl;q=0.9,en;q=0.8"), "pl");
    assert.equal(localeFrom("de-DE,pl;q=0.5,en;q=0.7"), "en");
    assert.equal(localeFrom("de, fr;q=0.8"), "en");
    assert.equal(localeFrom("pl;q=0, en;q=0.1"), "en");
    assert.equal(localeFrom("*"), "en");
});
