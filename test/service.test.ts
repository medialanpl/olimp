import assert from "node:assert/strict";
import { test } from "node:test";
import { checkoutRefusal, unitFile } from "../src/service.ts";

test("the service unit starts OLIMP from its checkout with the shell's PATH and no secrets", () => {
    const unit = unitFile(
        "/opt/node/bin/node",
        "/opt/pnpm",
        {
            PATH: '/home/a/bin:/opt/"x"',
            OLIMP_PORT: "4850",
            OLIMP_DATABASE_URL: "mysql://olimp:secret@db/olimp",
            OLIMP_SMTP_URL: "smtp://user:secret@mail",
        },
        "/srv/olimp 100%",
    );
    const lines = unit.split("\n");
    assert.ok(lines.includes("WorkingDirectory=/srv/olimp 100%%"));
    assert.ok(
        lines.includes('ExecStart="/opt/node/bin/node" --env-file-if-exists=.env src/main.ts'),
    );
    assert.ok(lines.includes('Environment="PATH=/home/a/bin:/opt/\\"x\\""'));
    assert.ok(lines.includes('Environment="OLIMP_PORT=4850"'));
    assert.ok(lines.includes("Environment=OLIMP_SERVICE=1"));
    assert.ok(!lines.some((line) => line.includes("OLIMP_HOME")));
    assert.ok(!unit.includes("secret"));
    // A failed install or build must not keep the last good build from starting.
    assert.ok(lines.includes('ExecStartPre=-"/opt/pnpm" build'));
    assert.ok(lines.includes("Restart=always"));
});

test("the service is installed only from a clean main, or from a copy without git", () => {
    assert.equal(checkoutRefusal("main", ""), null);
    assert.equal(checkoutRefusal(null, null), null);
    assert.match(checkoutRefusal("feat/x", "") ?? "", /on feat\/x, not main/);
    assert.match(checkoutRefusal("main", " M src/api.ts") ?? "", /uncommitted/);
});
