import type { MemoryGraph } from "./types.ts";

type Node = MemoryGraph["nodes"][number];
export type PeakKind = Node["kind"] | "scree";
export interface Peak {
    id: string;
    kind: PeakKind;
    label: string;
    x: number;
    y: number;
    z: number;
}

const LEVEL_HEIGHT = 70;
const RING_STEP = 60;
// The arc each node needs on its ring, so a crowded ring grows wider than the one above it.
const GAP = { summit: 0, hub: 70, page: 30, note: 8 } as const;
const SCREE_MAX = 80;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

const meanAngle = (angles: number[]) =>
    angles.length
        ? Math.atan2(
              angles.reduce((s, a) => s + Math.sin(a), 0),
              angles.reduce((s, a) => s + Math.cos(a), 0),
          )
        : null;

// A cone: the summit on the axis, then a ring per level, each wider than the one above, every node
// turned towards its parents; links run from child to parent, so pulses climb to the summit.
export function mountainLayout(graph: MemoryGraph) {
    const kinds = (["summit", "hub", "page", "note"] as const).filter((k) =>
        graph.nodes.some((n) => n.kind === k),
    );
    const parents = new Map<string, string[]>();
    for (const e of graph.edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
    const angle = new Map<string, number>();
    const nodes: Peak[] = [];
    // Contour lines: each ring of three or more joined round, so the links outline the mountain.
    const rings: { source: string; target: string }[] = [];
    const top = ((kinds.length - 1) * LEVEL_HEIGHT) / 2;
    let radius = 0;
    kinds.forEach((kind, level) => {
        const row = graph.nodes.filter((n) => n.kind === kind);
        if (level > 0)
            radius = Math.max(radius + RING_STEP, (row.length * GAP[kind]) / (2 * Math.PI));
        const ordered = row
            .map((n) => ({
                n,
                at: meanAngle((parents.get(n.id) ?? []).flatMap((p) => angle.get(p) ?? [])),
            }))
            .sort(
                (a, b) =>
                    (a.at ?? Number.POSITIVE_INFINITY) - (b.at ?? Number.POSITIVE_INFINITY) ||
                    a.n.label.localeCompare(b.n.label),
            );
        const step = (2 * Math.PI) / Math.max(row.length, 1);
        // The evenly spaced ring is turned to sit as close as it can to where the parents point.
        const base = meanAngle(ordered.flatMap(({ at }, i) => (at === null ? [] : at - i * step)));
        ordered.forEach(({ n }, i) => {
            const a = (base ?? -Math.PI / 2) + i * step;
            if (radius > 0) angle.set(n.id, a);
            const y = top - level * LEVEL_HEIGHT;
            nodes.push({ ...n, x: radius * Math.cos(a), y, z: radius * Math.sin(a) });
            const next = ordered[(i + 1) % ordered.length];
            if (ordered.length >= 3 && next) rings.push({ source: n.id, target: next.n.id });
        });
    });
    const foot = top - (kinds.length - 1) * LEVEL_HEIGHT;
    // Unwoven notes lie as scree round the foot, scattered the same way every time.
    for (let i = 0; i < Math.min(graph.unwoven, SCREE_MAX); i++) {
        const r = radius * (1.08 + ((i * 0.37) % 1) * 0.18) + 12;
        const a = i * GOLDEN;
        const y = foot - 10 - ((i * 7) % 4) * 3;
        nodes.push({
            id: `scree:${i}`,
            kind: "scree",
            label: "",
            x: r * Math.cos(a),
            y,
            z: r * Math.sin(a),
        });
    }
    const placed = new Set(nodes.map((n) => n.id));
    return {
        nodes,
        links: graph.edges
            .filter((e) => placed.has(e.from) && placed.has(e.to))
            .map((e) => ({ source: e.to, target: e.from })),
        rings,
        radius,
        height: top * 2,
    };
}
