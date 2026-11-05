import assert from "node:assert/strict";
import { test } from "node:test";
import { passwordCompliant } from "../src/auth.ts";
import { passwordStrength } from "../web/src/lib/password.ts";

test("the panel's strength meter scores as Corivo's and agrees with the API's rule", () => {
    assert.deepEqual(passwordStrength("abc"), { score: 20, label: "weak" });
    assert.deepEqual(passwordStrength("lowercase-1"), { score: 70, label: "medium" });
    assert.deepEqual(passwordStrength("Correct-horse-1"), { score: 100, label: "strong" });
    // Anything the API accepts is at least medium.
    for (const p of ["lower-and-digits-1", "Abcdefg1", "ABCDEFG!1"])
        assert.ok(passwordCompliant(p) && passwordStrength(p).label !== "weak", p);
});
