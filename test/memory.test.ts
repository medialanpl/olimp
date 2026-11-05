import assert from "node:assert/strict";
import { test } from "node:test";
import { hasHeading, isSlug, linkedSlugs, memoryGraph, searchMemory } from "../src/memory.ts";
import type { MemoryPage, Note } from "../src/store.ts";

const page: MemoryPage = {
    repo: "acme/demo",
    slug: "build",
    title: "Build",
    description: "How to build the repository.",
    kind: "page",
    version: 3,
    task: "0123456789ab",
    run: null,
    node: null,
    author: null,
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T13:00:00.000Z",
    sections: [
        {
            heading: "Build",
            body: "Run pnpm build.\n\n```sh\n## not a heading\n```",
            sources: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"],
            version: 2,
            task: null,
            run: "cccccccccccc",
            node: "edit",
            author: null,
            updatedAt: "2026-10-28T13:00:00.000Z",
        },
        {
            heading: "Test",
            body: "Run pnpm test.\nSources: kept in the text",
            sources: [],
            version: 1,
            task: null,
            run: null,
            node: null,
            author: null,
            updatedAt: "2026-10-28T12:00:00.000Z",
        },
    ],
};

test("slugs are lowercase words joined by single hyphens", () => {
    for (const slug of ["build", "build-and-test", "v2", "a".repeat(64)]) assert.ok(isSlug(slug));
    for (const slug of ["", "Build", "a--b", "-a", "a-", "a_b", "a.md"])
        assert.ok(!isSlug(slug), slug);
    assert.ok(!isSlug("a".repeat(65)));
});

test("a ## line starts a section only outside a code fence", () => {
    assert.ok(hasHeading("x\n## Heading"));
    assert.ok(!hasHeading("x\n```\n## in code\n```\n### Smaller"));
});

test("a search needs every word, ranks title over heading over text and cuts a snippet", () => {
    const section = page.sections[0] as MemoryPage["sections"][number];
    const long = `${"word ".repeat(30)}the Deploy key lives in the vault ${"tail ".repeat(60)}`;
    const pages: MemoryPage[] = [
        { ...page, slug: "build" },
        {
            ...page,
            slug: "deploy",
            title: "Deploy",
            description: "Shipping.",
            sections: [
                { ...section, heading: "Keys", body: long },
                { ...section, heading: "Deploy key", body: "Rotate it." },
            ],
        },
    ];
    const found = searchMemory(pages, "  DEPLOY   key ");
    assert.equal(found.total, 2);
    assert.deepEqual(
        found.hits.map((h) => [h.slug, h.heading]),
        [
            ["deploy", "Deploy key"],
            ["deploy", "Keys"],
        ],
    );
    const cut = found.hits[1]?.snippet ?? "";
    assert.match(cut, /^…word .*the Deploy key lives in the vault tail .*…$/);
    assert.ok(cut.length <= 202);
    assert.deepEqual(
        searchMemory(pages, "deploy").hits.map((h) => [h.slug, h.heading, h.snippet]),
        [
            ["deploy", null, "Shipping."],
            ["deploy", "Deploy key", "Rotate it."],
            ["deploy", "Keys", cut],
        ],
    );
    assert.deepEqual(searchMemory(pages, "deploy nowhere"), { total: 0, hits: [] });
    assert.deepEqual(
        searchMemory(pages, "pnpm").hits.map((h) => [h.slug, h.heading]),
        [
            ["build", "Build"],
            ["build", "Test"],
        ],
    );
});

test("the memory graph hangs hubs from the summit, linked pages from hubs, cited notes at the foot", () => {
    assert.deepEqual(linkedSlugs("See [[build]], [[build]] and `[[code]]`.\n```\n[[block]]\n```"), [
        "build",
    ]);
    const section = page.sections[0] as MemoryPage["sections"][number];
    const hub: MemoryPage = {
        ...page,
        slug: "start",
        title: "Start",
        kind: "hub",
        sections: [{ ...section, body: "[[build]], [[gone]] and [[start]]", sources: [] }],
    };
    const lonely: MemoryPage = {
        ...page,
        slug: "lonely",
        title: "Lonely",
        sections: [{ ...section, sources: ["bbbbbbbbbbbb", "dddddddddddd"] }],
    };
    const notes = [{ id: "aaaaaaaaaaaa", text: "Build  with\npnpm." }] as Note[];
    const graph = memoryGraph("demo", [hub, page, lonely], notes, 3);
    assert.deepEqual(
        graph.nodes.map((n) => [n.id, n.kind, n.label]),
        [
            ["demo", "summit", "demo"],
            ["page:start", "hub", "Start"],
            ["page:build", "page", "Build"],
            ["page:lonely", "page", "Lonely"],
            ["note:aaaaaaaaaaaa", "note", "Build with pnpm."],
            ["note:bbbbbbbbbbbb", "note", "bbbbbbbbbbbb"],
            ["note:dddddddddddd", "note", "dddddddddddd"],
        ],
    );
    assert.deepEqual(
        graph.edges.map((e) => `${e.from} > ${e.to}`),
        [
            "demo > page:start",
            "page:start > page:build",
            "page:build > note:aaaaaaaaaaaa",
            "page:build > note:bbbbbbbbbbbb",
            "demo > page:lonely",
            "page:lonely > note:bbbbbbbbbbbb",
            "page:lonely > note:dddddddddddd",
        ],
    );
    assert.equal(graph.unwoven, 3);
});
