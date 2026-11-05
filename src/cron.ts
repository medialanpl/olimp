export interface Cron {
    minute: Set<number>;
    hour: Set<number>;
    dayOfMonth: Set<number>;
    month: Set<number>;
    dayOfWeek: Set<number>;
    // Vixie cron: when both day fields are restricted, a day matching either one is enough.
    dayOfMonthAny: boolean;
    dayOfWeekAny: boolean;
}

const FIELDS = [
    ["minute", 0, 59],
    ["hour", 0, 23],
    ["day of month", 1, 31],
    ["month", 1, 12],
    ["day of week", 0, 7],
] as const;

const NUMBER = /^\d+$/;

function parseField(text: string, index: number): Set<number> {
    const [name, min, max] = FIELDS[index] as (typeof FIELDS)[number];
    const values = new Set<number>();
    const number = (part: string) => {
        if (!NUMBER.test(part)) throw new Error(`${name}: ${part} is not a number`);
        const value = Number(part);
        if (value < min || value > max)
            throw new Error(`${name}: ${value} is outside ${min}-${max}`);
        return value;
    };
    for (const item of text.split(",")) {
        const [range = "", step, ...rest] = item.split("/");
        if (rest.length || step === "") throw new Error(`${name}: bad step in ${item}`);
        let from: number;
        let to: number;
        if (range === "*") [from, to] = [min, max];
        else if (range.includes("-")) {
            const [a = "", b = "", ...more] = range.split("-");
            if (more.length) throw new Error(`${name}: bad range ${range}`);
            [from, to] = [number(a), number(b)];
            if (from > to) throw new Error(`${name}: range ${range} runs backwards`);
        } else {
            from = number(range);
            to = step === undefined ? from : max;
        }
        const by = step === undefined ? 1 : Number(step);
        if (!NUMBER.test(step ?? "1") || by < 1) throw new Error(`${name}: bad step ${step}`);
        for (let value = from; value <= to; value += by) values.add(value);
    }
    return values;
}

// Five fields: minute, hour, day of month, month, day of week (0 and 7 are Sunday).
export function parseCron(expression: string): Cron {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) throw new Error(`expected 5 fields, got ${fields.length}`);
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map(parseField) as Set<number>[];
    if (dayOfWeek?.delete(7)) dayOfWeek.add(0);
    return {
        minute: minute as Set<number>,
        hour: hour as Set<number>,
        dayOfMonth: dayOfMonth as Set<number>,
        month: month as Set<number>,
        dayOfWeek: dayOfWeek as Set<number>,
        dayOfMonthAny: fields[2]?.startsWith("*") ?? false,
        dayOfWeekAny: fields[4]?.startsWith("*") ?? false,
    };
}

export function isCron(expression: string): boolean {
    try {
        parseCron(expression);
        return true;
    } catch {
        return false;
    }
}

// Matches in the server's local time zone.
export function cronMatches(cron: Cron, at: Date): boolean {
    if (!cron.minute.has(at.getMinutes()) || !cron.hour.has(at.getHours())) return false;
    if (!cron.month.has(at.getMonth() + 1)) return false;
    const dom = cron.dayOfMonth.has(at.getDate());
    const dow = cron.dayOfWeek.has(at.getDay());
    if (cron.dayOfMonthAny || cron.dayOfWeekAny) return dom && dow;
    return dom || dow;
}

// The first minute after `from` the cron matches, looking a year ahead; null for none (e.g. 30 Feb).
export function nextMatch(cron: Cron, from: Date): Date | null {
    const at = new Date(from);
    at.setSeconds(0, 0);
    for (let minute = 0; minute < 366 * 1440; minute++) {
        at.setMinutes(at.getMinutes() + 1);
        if (cronMatches(cron, at)) return at;
    }
    return null;
}
