import assert from "node:assert/strict";
import { test } from "node:test";
import { comboOf, keysOf, recordable } from "../web/src/lib/shortcuts.ts";

const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
    comboOf({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test("a combo is the modifiers in order and the key's code", () => {
    assert.equal(key("KeyK", { metaKey: true }), "Mod+KeyK");
    assert.equal(
        key("KeyK", { ctrlKey: true, shiftKey: true, altKey: true }),
        "Mod+Alt+Shift+KeyK",
    );
    assert.equal(key("ShiftLeft", { shiftKey: true }), null);
    assert.equal(key(""), null);
    assert.deepEqual(keysOf("Alt+Digit1").slice(1), ["1"]);
});

test("without Ctrl or Alt only a letter, a digit or an F key can be recorded", () => {
    assert.ok(recordable("KeyC"));
    assert.ok(recordable("Shift+F2"));
    assert.ok(recordable("Mod+Enter"));
    assert.ok(!recordable("Enter"));
    assert.ok(!recordable("Shift+Space"));
});
