import assert from "node:assert/strict";
import { test } from "node:test";
import { installKind, newerVersion } from "../src/machine.ts";

test("how OLIMP was installed follows from where it runs", () => {
    const global = "/usr/lib/node_modules";
    assert.equal(installKind("/home/a/olimp", true, null), "git");
    assert.equal(
        installKind("/home/a/.npm/_npx/1f2e/node_modules/olimp-run", false, global),
        "npx",
    );
    assert.equal(installKind("/usr/lib/node_modules/olimp-run", false, global), "global");
    // Inside another project, or without npm: no self-update.
    assert.equal(installKind("/home/a/shop/node_modules/olimp-run", false, global), "package");
    assert.equal(installKind("/usr/lib/node_modules/olimp-run", false, null), "package");
});

test("npm's version is newer only when a number of it is higher", () => {
    assert.equal(newerVersion("0.0.7", "0.0.6"), true);
    assert.equal(newerVersion("0.1.0", "0.0.9"), true);
    assert.equal(newerVersion("1.0.0", "0.10.0"), true);
    assert.equal(newerVersion("0.10.0", "0.9.0"), true);
    assert.equal(newerVersion("0.0.6", "0.0.6"), false);
    assert.equal(newerVersion("0.0.0", "0.0.6"), false);
    assert.equal(newerVersion("0.0.7-beta.1", "0.0.6"), true);
    assert.equal(newerVersion("0.0.6-beta.1", "0.0.6"), false);
});
