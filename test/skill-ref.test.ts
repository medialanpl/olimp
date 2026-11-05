import assert from "node:assert/strict";
import { test } from "node:test";
import { skillGroup, skillOf } from "../web/src/lib/skill-ref.ts";

test("a skill reference names its source and skill in every form", () => {
    const parts = (ref: string) => {
        const skill = skillOf(ref);
        return skill && [skill.id, skill.source, skill.name];
    };
    assert.deepEqual(parts("./review"), ["./review", ".", "review"]);
    assert.deepEqual(parts("~/notes"), ["~/notes", "~", "notes"]);
    assert.deepEqual(parts("claude.ai/pdf"), ["claude.ai/pdf", "claude.ai", "pdf"]);
    assert.deepEqual(parts("acme/skills:deploy"), ["acme/skills:deploy", "acme/skills", "deploy"]);
    assert.deepEqual(parts("deploy"), ["deploy", "", "deploy"]);
    assert.equal(skillOf(null), null);
    assert.equal(skillOf(""), null);
});

test("a project's skills group into its own, the team's and the account's", () => {
    assert.equal(skillGroup({ source: "." }), "project");
    assert.equal(skillGroup({ source: "acme/skills" }), "team");
    assert.equal(skillGroup({ source: "~" }), "own");
    assert.equal(skillGroup({ source: "claude.ai" }), "own");
});
