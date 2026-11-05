export interface GraphEdge {
    from: number;
    to: number;
    lane: number;
}

// One row of the graph: the commit's lane, lines from the row above into it (`top`) and lines from
// it down to the row below (`bottom`); `lane` picks an edge's colour.
export interface GraphRow {
    lane: number;
    top: GraphEdge[];
    bottom: GraphEdge[];
    width: number;
}

// Lanes of a log in children-before-parents order, as GitLens draws them: a lane waits for the sha
// it leads to, a commit takes the lane waiting for it, and a merge opens lanes for its other parents.
export function commitGraph(commits: { sha: string; parents: string[] }[]): GraphRow[] {
    const lanes: (string | null)[] = [];
    const free = () => {
        const at = lanes.indexOf(null);
        return at === -1 ? lanes.length : at;
    };
    return commits.map(({ sha, parents }) => {
        let lane = lanes.indexOf(sha);
        if (lane === -1) lane = free();
        const top: GraphEdge[] = [];
        lanes.forEach((waiting, i) => {
            if (waiting === null) return;
            top.push(
                waiting === sha ? { from: i, to: lane, lane: i } : { from: i, to: i, lane: i },
            );
            if (waiting === sha) lanes[i] = null;
        });
        lanes[lane] = parents[0] ?? null;
        const bottom: GraphEdge[] = [];
        lanes.forEach((waiting, i) => {
            if (waiting !== null && i !== lane) bottom.push({ from: i, to: i, lane: i });
        });
        if (parents[0]) bottom.push({ from: lane, to: lane, lane });
        for (const parent of parents.slice(1)) {
            let to = lanes.indexOf(parent);
            if (to === -1) {
                to = free();
                lanes[to] = parent;
            }
            bottom.push({ from: lane, to, lane: to });
        }
        while (lanes.length && lanes.at(-1) === null) lanes.pop();
        const width = Math.max(
            lane + 1,
            ...top.map((e) => e.from + 1),
            ...bottom.map((e) => e.to + 1),
        );
        return { lane, top, bottom, width };
    });
}
