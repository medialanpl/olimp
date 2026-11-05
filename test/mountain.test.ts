import assert from "node:assert/strict";
import { test } from "node:test";
import { mountainLayout } from "../web/src/lib/mountain.ts";
import type { MemoryGraph } from "../web/src/lib/types.ts";

const node = (id: string, kind: MemoryGraph["nodes"][number]["kind"]) => ({ id, kind, label: id });

test("the mountain is a cone: summit on the axis, wider rings below, children turned to parents", () => {
    const graph: MemoryGraph = {
        repo: "demo",
        nodes: [
            node("demo", "summit"),
            node("page:a-hub", "hub"),
            node("page:b-hub", "hub"),
            node("page:under-a", "page"),
            node("page:under-b", "page"),
            node("note:n1", "note"),
            node("note:n2", "note"),
        ],
        edges: [
            { from: "demo", to: "page:a-hub" },
            { from: "demo", to: "page:b-hub" },
            { from: "page:a-hub", to: "page:under-a" },
            { from: "page:b-hub", to: "page:under-b" },
            { from: "page:under-b", to: "note:n1" },
            { from: "page:under-a", to: "note:n2" },
            { from: "page:gone", to: "note:n2" },
        ],
        unwoven: 120,
    };
    const layout = mountainLayout(graph);
    const at = new Map(layout.nodes.map((n) => [n.id, n]));
    const get = (id: string) => at.get(id) ?? assert.fail(id);
    const ring = (id: string) => Math.hypot(get(id).x, get(id).z);
    const angle = (id: string) => Math.atan2(get(id).z, get(id).x);
    const apart = (a: string, b: string) => {
        const d = Math.abs(angle(a) - angle(b)) % (2 * Math.PI);
        return Math.min(d, 2 * Math.PI - d);
    };

    assert.equal(ring("demo"), 0);
    assert.ok(get("demo").y > get("page:a-hub").y && get("page:a-hub").y > get("page:under-a").y);
    assert.ok(get("page:under-a").y > get("note:n1").y);
    assert.ok(ring("page:a-hub") < ring("page:under-a") && ring("page:under-a") < ring("note:n1"));
    assert.ok(apart("page:under-a", "page:a-hub") < apart("page:under-a", "page:b-hub"));
    assert.ok(apart("note:n1", "page:under-b") < apart("note:n1", "page:under-a"));

    const scree = layout.nodes.filter((n) => n.kind === "scree");
    assert.equal(scree.length, 80);
    assert.ok(scree.every((s) => s.y < get("note:n1").y && Math.hypot(s.x, s.z) > ring("note:n1")));
    // Child to parent, so pulses climb; an edge from a page that is gone is left out.
    assert.equal(layout.links.length, 6);
    assert.deepEqual(layout.links[0], { source: "page:a-hub", target: "demo" });
    // Rings of two (the hubs, the pages, the notes here) are no contour.
    assert.deepEqual(layout.rings, []);
    const wide = mountainLayout({
        ...graph,
        nodes: [...graph.nodes, node("note:n3", "note")],
        unwoven: 0,
    });
    assert.equal(wide.rings.length, 3);
});
