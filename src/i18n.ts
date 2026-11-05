import en from "../messages/en.json" with { type: "json" };
import pl from "../messages/pl.json" with { type: "json" };

export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

type Messages = typeof en;
type Keys<T> = {
    [K in keyof T & string]: T[K] extends string ? K : `${K}.${Keys<T[K]>}`;
}[keyof T & string];
export type MessageKey = Keys<Messages>;
export type Params = Record<string, string | number>;

const catalogs: Record<Locale, Messages> = { en, pl };

export const isLocale = (value: unknown): value is Locale =>
    (LOCALES as readonly unknown[]).includes(value);

export function t(locale: Locale, key: MessageKey, params: Params = {}): string {
    let node: unknown = catalogs[locale];
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    if (typeof node !== "string") throw new Error(`missing message ${locale}:${key}`);
    return node.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
    );
}

export function localeFrom(acceptLanguage: string | undefined): Locale {
    const ranked = (acceptLanguage ?? "")
        .split(",")
        .map((part) => {
            const [tag = "", ...rest] = part.trim().split(";");
            const q = rest.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
            return { lang: tag.trim().toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
        })
        .filter((entry) => entry.q > 0)
        .sort((a, b) => b.q - a.q);
    return ranked.map((entry) => entry.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
