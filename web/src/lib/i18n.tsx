import { createContext, type ReactNode, use, useEffect, useMemo, useState } from "react";
import { IntlProvider } from "use-intl";
import en from "../../../messages/en.json";
import pl from "../../../messages/pl.json";
import { setApiLocale } from "./api";

// The same catalogs as the API's; the panel's texts are under `web`.
export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];
const catalogs: Record<Locale, typeof en> = { en, pl };
const LOCALE_KEY = "olimp.locale";

declare module "use-intl" {
    interface AppConfig {
        Locale: Locale;
        Messages: typeof en;
    }
}

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

function initialLocale(): Locale {
    const saved = localStorage.getItem(LOCALE_KEY);
    if (isLocale(saved)) return saved;
    const browser = navigator.languages.map((lang) => lang.toLowerCase().split("-")[0]);
    return browser.find(isLocale) ?? "en";
}

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({
    locale: "en",
    setLocale: () => {},
});

export const useLocale = () => use(LocaleContext);

export function LocaleProvider({ children }: { children: ReactNode }) {
    const [locale, setLocaleState] = useState(() => {
        const first = initialLocale();
        setApiLocale(first);
        return first;
    });
    const value = useMemo(
        () => ({
            locale,
            setLocale: (next: Locale) => {
                localStorage.setItem(LOCALE_KEY, next);
                setApiLocale(next);
                setLocaleState(next);
            },
        }),
        [locale],
    );
    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);
    return (
        <LocaleContext value={value}>
            <IntlProvider
                locale={locale}
                messages={catalogs[locale]}
                timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
            >
                {children}
            </IntlProvider>
        </LocaleContext>
    );
}
