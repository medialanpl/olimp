import { useSyncExternalStore } from "react";

export const SHORTCUTS = ["newTask", "search", "sidebar", "send", "terminal"] as const;
export type Shortcut = (typeof SHORTCUTS)[number];
export type KeyMap = Record<Shortcut, string>;

// A combo is "Mod+Alt+Shift+<KeyboardEvent.code>": the code, not the key, so Shift and Alt do not change it.
export const DEFAULTS: KeyMap = {
    newTask: "KeyC",
    search: "Mod+KeyK",
    sidebar: "Mod+KeyB",
    send: "Mod+Enter",
    terminal: "Mod+Backquote",
};

const KEY = "olimp.shortcuts";

// The modifier of the panel's shortcuts on this device.
export const MOD = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgent ?? "") ? "⌘" : "Ctrl";

type Keys = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

export function comboOf(e: Keys): string | null {
    // Chrome's autofill sends a keydown without a code.
    if (!e.code || /^(Control|Meta|Alt|Shift|OS)(Left|Right)?$/.test(e.code)) return null;
    const parts = [
        e.ctrlKey || e.metaKey ? "Mod" : "",
        e.altKey ? "Alt" : "",
        e.shiftKey ? "Shift" : "",
    ];
    return [...parts.filter(Boolean), e.code].join("+");
}

export const keysOf = (combo: string): string[] =>
    combo.split("+").map((k) => (k === "Mod" ? MOD : k.replace(/^(Key|Digit|Numpad)/, "")));

// Without Ctrl or Alt the combo types text, so it is a letter, a digit or an F key and skips fields.
const plain = (combo: string) => !/^(Mod|Alt)\+/.test(combo);
export const recordable = (combo: string) =>
    !plain(combo) || /^(Shift\+)?(Key|Digit|F\d)/.test(combo);

let current: KeyMap | undefined;
const listeners = new Set<() => void>();

// shortcut: kept per browser in localStorage, move to the account when one person uses several.
export function keyMap(): KeyMap {
    if (current) return current;
    let saved: Partial<Record<string, unknown>> = {};
    try {
        saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {};
    } catch {}
    current = { ...DEFAULTS };
    for (const id of SHORTCUTS) {
        const combo = saved[id];
        if (typeof combo === "string" && recordable(combo)) current[id] = combo;
    }
    return current;
}

// null brings back the default.
export function setShortcut(id: Shortcut, combo: string | null): void {
    const next = { ...keyMap(), [id]: combo ?? DEFAULTS[id] };
    current = next;
    const custom = Object.fromEntries(
        SHORTCUTS.filter((s) => next[s] !== DEFAULTS[s]).map((s) => [s, next[s]]),
    );
    try {
        localStorage.setItem(KEY, JSON.stringify(custom));
    } catch {}
    for (const listener of listeners) listener();
}

export function useKeyMap(): KeyMap {
    return useSyncExternalStore((onChange) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
    }, keyMap);
}

export function triggered(e: KeyboardEvent, id: Shortcut): boolean {
    if (e.repeat || e.defaultPrevented || comboOf(e) !== keyMap()[id]) return false;
    if (!plain(keyMap()[id])) return true;
    const target = e.target instanceof Element ? e.target : null;
    return !target?.closest(
        "input, textarea, select, [contenteditable=true], [role=dialog], [role=menu], [role=listbox]",
    );
}
