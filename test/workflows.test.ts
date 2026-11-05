import assert from "node:assert/strict";
import { test } from "node:test";
import { skillCatalog } from "../src/workflow-builder.ts";
import {
    advance,
    compareValues,
    enter,
    fromLegacy,
    globMatch,
    graphIssues,
    importWorkflow,
    layoutOf,
    NODES_MAX,
    type NodeOf,
    parseVerdict,
    portsOf,
    promptReviewers,
    render,
    stripVerdict,
    TEMPLATES,
} from "../src/workflow-graph.ts";
import { DefinitionError, parseDefinition } from "../src/workflows.ts";
import { chain, step } from "./fixtures.ts";

const fails = (value: unknown, code: string, params?: object) =>
    assert.throws(
        () => parseDefinition(value),
        (error: unknown) => {
            assert.ok(error instanceof DefinitionError, String(error));
            assert.equal(error.code, code);
            if (params) assert.deepEqual(error.params, params);
            return true;
        },
    );

test("a valid definition comes back normalised with defaults and without unknown fields", () => {
    const parsed = parseDefinition({
        nodes: [
            { id: "start", type: "start", extra: 1 },
            { id: "fix", type: "agent", name: " Fix ", prompt: " {{task}} ", integrations: [] },
            { id: "retry", type: "loop" },
            { id: "tests", type: "check", command: "npm test", retryOn: [1, 1] },
            { id: "end", type: "end" },
        ],
        edges: [
            { from: "start.next", to: "fix", label: "x" },
            { from: "fix.done", to: "tests" },
            { from: "tests.fail", to: "retry" },
            { from: "retry.repeat", to: "fix" },
            { from: "tests.pass", to: "end" },
        ],
        layout: { fix: { x: 1.6, y: 2 }, nope: { x: 0, y: 0 }, tests: { x: "a" } },
    });
    assert.deepEqual(parsed, {
        nodes: [
            { id: "start", type: "start" },
            { id: "fix", type: "agent", name: "Fix", prompt: "{{task}}" },
            { id: "retry", type: "loop", max: 3 },
            { id: "tests", type: "check", command: "npm test", retryOn: [1] },
            { id: "end", type: "end", status: "success" },
        ],
        edges: [
            { from: "start.next", to: "fix" },
            { from: "fix.done", to: "tests" },
            { from: "tests.fail", to: "retry" },
            { from: "retry.repeat", to: "fix" },
            { from: "tests.pass", to: "end" },
        ],
        layout: { fix: { x: 2, y: 2 } },
    });
});

test("a malformed definition, node or field is refused with its code", () => {
    fails("graph", "workflow.invalidDefinition");
    fails({ nodes: {}, edges: [] }, "workflow.invalidDefinition");
    fails({ nodes: [], edges: [] }, "workflow.nodeCount", { max: NODES_MAX });
    fails({ nodes: [{ id: "a.b", type: "start" }], edges: [] }, "workflow.invalidNodeId");
    fails({ nodes: [{ id: "x", type: "shell" }], edges: [] }, "workflow.unknownNodeType", {
        node: "x",
        type: "shell",
    });
    const field = (node: object, name: string) =>
        fails({ ...chain({ id: "x", ...node }) }, "workflow.invalidField", {
            node: "x",
            field: name,
        });
    field({ type: "agent", prompt: "a", agent: "gpt" }, "agent");
    field({ type: "agent", prompt: "a", integrations: "jira" }, "integrations");
    field({ type: "agent", prompt: "a", verdicts: ["done"] }, "verdicts");
    field({ type: "check", command: "" }, "command");
    field({ type: "loop", max: 21 }, "max");
    field({ type: "fork", branches: 5 }, "branches");
    field({ type: "gate.human", message: "ok?", timeoutMs: 1000 }, "timeoutMs");
    field(
        { type: "ask-user", question: "?", options: ["1", "2", "3", "4", "5", "6", "7"] },
        "options",
    );
    field({ type: "notify.webhook", url: "http://example.com" }, "url");
    field(
        { type: "if", condition: { kind: "output", ref: "nodot", op: "equals", value: 1 } },
        "condition",
    );
    fails(
        { nodes: [{ id: "start", type: "start" }], edges: [{ from: "start.next" }] },
        "workflow.invalidEdge",
    );
});

test("graph problems come back as issues, the first one refused by the parser", () => {
    const codes = (def: unknown) => graphIssues(def as never).map((i) => i.code);
    const base = chain(step("a", "A"), step("b", "B"));
    assert.deepEqual(codes(base), []);
    assert.deepEqual(codes({ ...base, nodes: base.nodes.slice(1), edges: base.edges.slice(1) }), [
        "startCount",
    ]);
    assert.deepEqual(codes({ ...base, edges: [...base.edges, { from: "b.done", to: "a" }] }), [
        "cycle",
    ]);
    assert.deepEqual(codes({ ...base, edges: [...base.edges, { from: "a.done", to: "b" }] }), [
        "portWiredTwice",
    ]);
    assert.deepEqual(codes({ ...base, edges: [...base.edges, { from: "b.done", to: "start" }] }), [
        "edgeIntoStart",
        "cycle",
    ]);
    assert.deepEqual(codes({ ...base, nodes: [...base.nodes, step("c", "C")] }), ["unreachable"]);
    assert.deepEqual(codes(chain({ id: "end", type: "end", status: "success" })), ["nothingToRun"]);
    assert.deepEqual(codes(chain(step("a", "A", { prompt: "{{nodes.ghost.summary}}" }))), [
        "unknownRef",
    ]);
    assert.deepEqual(codes(chain(step("a", "A", { session: { continue: "a" } }))), ["sessionSelf"]);
    assert.deepEqual(codes(chain(step("a", "A", { review: true }))), ["forkOnly"]);
    fails({ ...base, edges: [...base.edges, { from: "b.done", to: "a" }] }, "workflow.cycle", {
        node: "a",
    });
});

test("a fork needs one agent per branch and one join they all lead into", () => {
    const fork = (
        extra: object[] = [],
        wiring = [
            ["x.done", "join"],
            ["y.done", "join"],
        ],
    ) => ({
        nodes: [
            { id: "start", type: "start" },
            { id: "fork", type: "fork", branches: 2 },
            step("x", "X"),
            step("y", "Y"),
            { id: "join", type: "join", wait: "all" },
            ...extra,
        ],
        edges: [
            { from: "start.next", to: "fork" },
            { from: "fork.1", to: "x" },
            { from: "fork.2", to: "y" },
            ...wiring.map(([from, to]) => ({ from, to })),
        ],
    });
    assert.deepEqual(graphIssues(fork() as never), []);
    const first = (def: object) => graphIssues(def as never)[0]?.code;
    assert.equal(first(fork([], [["x.done", "join"]])), "forkBranchDone");
    assert.equal(
        first(
            fork(
                [{ id: "other", type: "join", wait: "all" }],
                [
                    ["x.done", "join"],
                    ["y.done", "other"],
                ],
            ),
        ),
        "forkOneJoin",
    );
    assert.equal(
        first(
            fork(
                [],
                [
                    ["x.done", "join"],
                    ["y.done", "join"],
                    ["y.failed", "x"],
                ],
            ),
        ),
        "forkBranchShared",
    );
    // A loop back into a fork is allowed when it goes through a loop node.
    const loop = fork(
        [step("judge", "Judge"), { id: "again", type: "loop", max: 2 }],
        [
            ["x.done", "join"],
            ["y.done", "join"],
            ["join.done", "judge"],
            ["judge.failed", "again"],
            ["again.repeat", "fork"],
        ],
    );
    assert.deepEqual(graphIssues(loop as never), []);
});

test("advance counts loop visits: repeat within max, then exhausted; an unwired port ends", () => {
    const def = parseDefinition({
        nodes: [
            { id: "start", type: "start" },
            step("work", "Work"),
            { id: "tests", type: "check", command: "false" },
            { id: "retry", type: "loop", max: 2 },
            { id: "bad", type: "end", status: "failed" },
        ],
        edges: [
            { from: "start.next", to: "work" },
            { from: "work.done", to: "tests" },
            { from: "tests.fail", to: "retry" },
            { from: "retry.repeat", to: "work" },
            { from: "retry.exhausted", to: "bad" },
        ],
    });
    const loops: Record<string, number> = {};
    const first = enter(def, loops);
    assert.equal(first.kind === "node" && first.node.id, "work");
    for (const round of [1, 2]) {
        const back = advance(def, "tests", "fail", loops);
        assert.equal(back.kind === "node" && back.node.id, "work", `round ${round}`);
    }
    const out = advance(def, "tests", "fail", loops);
    assert.deepEqual(out.kind === "end" && out.status, "failed");
    assert.deepEqual(loops, { retry: 3 });
    assert.deepEqual(advance(def, "tests", "pass", loops), {
        kind: "end",
        status: "done",
        transitions: [{ from: "tests", port: "pass", to: null }],
    });
    assert.equal(advance(def, "work", "failed", loops).kind === "end" && "failed", "failed");
});

test("templates read the task, node outputs and loop counters", () => {
    const def = parseDefinition(chain(step("a", "A"), { id: "retry", type: "loop", max: 3 }));
    assert.equal(
        render(
            "{{ task }}: {{nodes.a.summary}} ({{nodes.retry.iteration}}/{{nodes.retry.max}}) {{nodes.a.none}}.",
            "Fix",
            { a: { summary: "done it" } },
            { retry: 5 },
            def,
        ),
        "Fix: done it (3/3) .",
    );
});

test("verdicts, globs and comparisons", () => {
    assert.equal(parseVerdict("Looks good.\nOLIMP:VERDICT ship\n", ["ship", "fix"]), "ship");
    assert.equal(parseVerdict("CEZ:VERDICT fix", ["ship", "fix"]), "fix");
    assert.equal(parseVerdict("OLIMP:VERDICT maybe", ["ship"]), null);
    assert.equal(parseVerdict("OLIMP:VERDICT ship\nmore", ["ship"]), null);
    assert.equal(stripVerdict("Report.\n\nOLIMP:VERDICT ship"), "Report.");
    assert.equal(globMatch("src/**/*.ts", "src/a/b/c.ts"), true);
    assert.equal(globMatch("src/*.ts", "src/a/b.ts"), false);
    assert.equal(globMatch("docs/?.md", "docs/a.md"), true);
    assert.equal(compareValues("12", ">", 3), true);
    assert.equal(compareValues("abc", ">", 3), false);
    assert.equal(compareValues("ship it", "contains", "ship"), true);
    assert.equal(compareValues("", "equals", ""), true);
});

test("ports follow verdicts, branches and timeouts", () => {
    assert.deepEqual(portsOf({ id: "a", type: "agent", prompt: "", verdicts: ["ok", "no"] }), [
        "ok",
        "no",
        "failed",
    ]);
    assert.deepEqual(portsOf({ id: "f", type: "fork", branches: 4 }), ["1", "2", "3", "4"]);
    assert.deepEqual(portsOf({ id: "g", type: "gate.human", message: "?", timeoutMs: 60_000 }), [
        "approve",
        "reject",
        "timeout",
    ]);
    assert.deepEqual(portsOf({ id: "g", type: "gate.human", message: "?" }), ["approve", "reject"]);
});

test("every built-in template is a valid workflow", () => {
    for (const template of TEMPLATES)
        assert.deepEqual(graphIssues(template.definition), [], template.id);
});

test("workflow files import as graphs: version 2, steps with a retry and skills", () => {
    const graph = importWorkflow({
        version: 2,
        name: "imported-graph",
        description: "Imported",
        nodes: [
            { id: "start", type: "start" },
            { id: "work", type: "agent", prompt: "{{task}}", runner: "codex", secrets: ["X"] },
        ],
        edges: [{ from: "start", to: "work" }],
        layout: { work: { x: 1, y: 2 } },
    });
    assert.equal(graph.name, "imported-graph");
    assert.deepEqual(parseDefinition(graph.definition), {
        nodes: [
            { id: "start", type: "start" },
            { id: "work", type: "agent", prompt: "{{task}}", agent: "codex" },
        ],
        edges: [{ from: "start.next", to: "work" }],
        layout: { work: { x: 1, y: 2 } },
    });
    const steps = importWorkflow({
        name: "fix-and-verify",
        steps: [
            { id: "implement", prompt: "{{task}}" },
            { id: "verify", command: "npm test", onFail: { retry: "implement", max: 2 } },
        ],
    });
    assert.deepEqual(parseDefinition(steps.definition).edges, [
        { from: "start.next", to: "implement" },
        { from: "verify.fail", to: "verify-retry" },
        { from: "verify-retry.repeat", to: "implement" },
        { from: "implement.done", to: "verify" },
        { from: "verify.pass", to: "end" },
    ]);
    const skills = importWorkflow({ name: "s", skills: ["tidy", "review"] });
    assert.deepEqual(
        parseDefinition(skills.definition)
            .nodes.filter((n) => n.type === "agent")
            .map((n) => n.type === "agent" && n.skill),
        ["tidy", "review"],
    );
    assert.throws(() => importWorkflow("nope"), /not an object/);
    assert.throws(() => importWorkflow({ name: "x" }), /no nodes, steps or skills/);
});

test("a definition saved before the graph editor reads as an equal graph", () => {
    const def = fromLegacy({
        start: "fix",
        nodes: {
            fix: { type: "agent", title: "Fix", body: "Do it", agent: "codex", next: "status" },
            status: { type: "condition", check: "done", yes: "review", no: "pr" },
            review: { type: "agent", title: "Review", next: "said" },
            said: { type: "condition", check: "includes", text: "LGTM", yes: "pr" },
            pr: { type: "pr", title: "Ship" },
        },
    });
    assert.deepEqual(graphIssues(def), []);
    assert.deepEqual(def.edges, [
        { from: "start.next", to: "fix" },
        { from: "fix.done", to: "review" },
        { from: "fix.failed", to: "pr" },
        { from: "review.done", to: "said" },
        { from: "said.true", to: "pr" },
    ]);
    const said = def.nodes.find((n) => n.id === "said");
    assert.deepEqual(said?.type === "if" && said.condition, {
        kind: "output",
        ref: "review.summary",
        op: "contains",
        value: "LGTM",
    });
    assert.equal(
        def.nodes.some((n) => n.id === "status"),
        false,
    );
});

test("the layout keeps placed nodes and puts the rest in columns by distance", () => {
    const def = parseDefinition({
        ...chain(step("a", "A"), step("b", "B")),
        layout: { b: { x: 5, y: 6 } },
    });
    assert.deepEqual(layoutOf(def), {
        start: { x: 0, y: 0 },
        a: { x: 340, y: 0 },
        b: { x: 5, y: 6 },
    });
});

test("the planner's skill catalog puts named skills first and stays within its size", () => {
    const skill = (name: string, description = "x".repeat(500)) => ({
        id: `acme/skills:${name}`,
        name,
        description,
        source: "acme/skills",
    });
    const skills = [
        ...Array.from({ length: 100 }, (_, i) => skill(`s${i}`)),
        skill("deploy", "Ship it."),
    ];
    const catalog = skillCatalog("Use the deploy skill", skills);
    assert.equal(catalog[0], "- acme/skills:deploy: Ship it.");
    assert.ok(catalog.join("\n").length <= 6000);
    assert.ok(catalog.length > 20 && catalog.length < 101);
    assert.ok(catalog.slice(1).every((line) => line.endsWith("…")));
});

test("reviewers named only in an agent's prompt are found, unless a PR update requests them", () => {
    const def = parseDefinition(
        chain(
            step("edit", "Edit", { prompt: "Fix it, then ask @ana-b and @Octo for a review." }),
            { id: "pr", type: "github.draft-pr" },
            { id: "update", type: "github.pr-update", reviewers: ["octo"] },
        ),
    );
    const edit = def.nodes.find((n) => n.id === "edit") as NodeOf<"agent">;
    assert.deepEqual(promptReviewers(def, edit), ["ana-b"]);
    // Without a word of review a mention is something else.
    assert.deepEqual(promptReviewers(def, { ...edit, prompt: "Mail @ana-b the result." }), []);
});
