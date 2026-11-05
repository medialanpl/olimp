import type { Skill } from "./types.ts";

export const PROJECT = ".";
export const OWN = "~";
export const SYNCED = "claude.ai";

// A skill by the canonical reference a project's default is stored as.
export function skillOf(ref: string | null): Skill | null {
    if (!ref) return null;
    const own = /^(\.|~|claude\.ai)\/(.+)$/.exec(ref);
    const at = ref.lastIndexOf(":");
    const [source = "", name = ""] = own
        ? [own[1], own[2]]
        : [ref.slice(0, Math.max(at, 0)), ref.slice(at + 1)];
    return { id: ref, name, description: "", source };
}

// Where a project's skill comes from: its repository, the team's sources, or the account's HOME.
export const skillGroup = ({ source }: Pick<Skill, "source">) =>
    source === PROJECT ? "project" : source === OWN || source === SYNCED ? "own" : "team";
