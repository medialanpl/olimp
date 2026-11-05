import { useFormatter, useNow } from "use-intl";

export function useFormat() {
    const format = useFormatter();
    const now = useNow({ updateInterval: 30_000 });
    return {
        cost: (usd: number | null | undefined) =>
            usd === null || usd === undefined
                ? "–"
                : format.number(usd, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: usd < 1 ? 4 : 2,
                  }),
        count: (value: number | null | undefined) =>
            value === null || value === undefined
                ? "–"
                : format.number(value, { notation: value >= 10_000 ? "compact" : "standard" }),
        duration: (ms: number | null | undefined) => {
            if (ms === null || ms === undefined) return "–";
            const seconds = Math.round(ms / 1000);
            const unit = (value: number, name: "hour" | "minute" | "second") =>
                format.number(value, { style: "unit", unit: name, unitDisplay: "narrow" });
            if (seconds < 60) return unit(seconds, "second");
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return `${unit(minutes, "minute")} ${unit(seconds % 60, "second")}`;
            return `${unit(Math.floor(minutes / 60), "hour")} ${unit(minutes % 60, "minute")}`;
        },
        bytes: (value: number) => {
            const power = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : 1;
            return format.number(Math.max(1, value) / 1024 ** power, {
                style: "unit",
                unit: (["kilobyte", "megabyte", "gigabyte"] as const)[power - 1],
                maximumFractionDigits: power === 3 ? 1 : 0,
            });
        },
        // `now` re-renders every 30 s but lags in between, so a moment ago would read as the future.
        relative: (iso: string) =>
            format.relativeTime(new Date(iso), Math.max(now.getTime(), Date.now())),
        dateTime: (iso: string) =>
            format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" }),
        time: (iso: string) =>
            format.dateTime(new Date(iso), {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }),
    };
}

export const shortId = (id: string) => id.slice(0, 7);

// Time between two ISO times, for steps without a reported duration.
export const elapsed = (from: string, to: string | null) =>
    (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
