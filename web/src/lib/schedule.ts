import { cronMatches, nextMatch, parseCron } from "../../../src/cron.ts";

export const PRESETS = ["daily", "weekdays", "weekly", "hours", "custom"] as const;
export type Preset = (typeof PRESETS)[number];
export const EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12];

// Every field stays while the preset changes, so switching back keeps what was typed.
export interface Schedule {
    preset: Preset;
    hour: number;
    minute: number;
    // 0 is Sunday, as in cron.
    days: number[];
    every: number;
    cron: string;
}

export function cronOf(s: Schedule): string {
    const at = `${s.minute} ${s.hour}`;
    if (s.preset === "daily") return `${at} * * *`;
    if (s.preset === "weekdays") return `${at} * * 1-5`;
    if (s.preset === "weekly") return `${at} * * ${[...s.days].sort().join(",")}`;
    if (s.preset === "hours") return `${s.minute} ${s.every === 1 ? "*" : `*/${s.every}`} * * *`;
    return s.cron.trim().replace(/\s+/g, " ");
}

// The preset a stored cron reads as; anything the presets cannot show stays a custom cron.
export function scheduleOf(cron: string): Schedule {
    const base: Schedule = { preset: "custom", hour: 4, minute: 0, days: [1], every: 6, cron };
    const fixed = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6](?:,[0-6])*)$/.exec(cron);
    if (fixed) {
        const [minute, hour] = [Number(fixed[1]), Number(fixed[2])];
        const dow = fixed[3] as string;
        if (minute > 59 || hour > 23) return base;
        if (dow === "*") return { ...base, preset: "daily", minute, hour };
        if (dow === "1-5") return { ...base, preset: "weekdays", minute, hour };
        const days = [...new Set(dow.split(",").map(Number))].sort();
        return { ...base, preset: "weekly", minute, hour, days };
    }
    const hourly = /^(\d{1,2}) \*(?:\/(\d{1,2}))? \* \* \*$/.exec(cron);
    const every = Number(hourly?.[2] ?? 1);
    if (hourly && Number(hourly[1]) < 60 && EVERY_HOURS.includes(every))
        return { ...base, preset: "hours", minute: Number(hourly[1]), every };
    return base;
}

function parsed(cron: string) {
    try {
        return parseCron(cron);
    } catch {
        return null;
    }
}

// shortcut: in the browser's time zone while the scheduler uses the server's, add the server's zone to the API when the panel is used from another zone.
export function upcoming(cron: string, from: Date, count: number): Date[] {
    const c = parsed(cron);
    const out: Date[] = [];
    if (!c) return out;
    for (let at = nextMatch(c, from); at && out.length < count; at = nextMatch(c, at)) out.push(at);
    return out;
}

// Every minute in [from, to) the cron matches; `from` on a whole minute.
export function between(cron: string, from: Date, to: Date): Date[] {
    const c = parsed(cron);
    const out: Date[] = [];
    if (!c) return out;
    for (const at = new Date(from); at < to; at.setMinutes(at.getMinutes() + 1))
        if (cronMatches(c, at)) out.push(new Date(at));
    return out;
}

// Entries of one day by start minute, side by side where they overlap: a lane each and the number
// of lanes of the overlapping group, so a group shares the column's width.
export function lanes<T>(
    entries: T[],
    minuteOf: (entry: T) => number,
    span: number,
): (T & { start: number; lane: number; count: number })[] {
    const placed: (T & { start: number; lane: number; count: number })[] = [];
    let group: (T & { start: number; lane: number })[] = [];
    let ends: number[] = [];
    const close = () => {
        for (const entry of group) placed.push({ ...entry, count: ends.length });
        group = [];
        ends = [];
    };
    for (const entry of [...entries].sort((a, b) => minuteOf(a) - minuteOf(b))) {
        const start = minuteOf(entry);
        if (ends.every((end) => end <= start)) close();
        let lane = ends.findIndex((end) => end <= start);
        if (lane < 0) lane = ends.push(0) - 1;
        ends[lane] = start + span;
        group.push({ ...entry, start, lane });
    }
    close();
    return placed;
}
