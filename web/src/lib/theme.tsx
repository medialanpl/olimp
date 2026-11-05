import { createContext, type ReactNode, use, useEffect, useMemo, useState } from "react";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
const THEME_KEY = "olimp.theme";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({
    theme: "system",
    setTheme: () => {},
});

export const useTheme = () => use(ThemeContext);

const dark = window.matchMedia("(prefers-color-scheme: dark)");

function apply(theme: Theme): void {
    const isDark = theme === "dark" || (theme === "system" && dark.matches);
    document.documentElement.classList.toggle("dark", isDark);
}

export function savedTheme(): Theme {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.includes(saved as Theme) ? (saved as Theme) : "system";
}

// Called before the first render, so the page never flashes in the wrong theme.
export const applySavedTheme = () => apply(savedTheme());

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState(savedTheme);
    useEffect(() => {
        apply(theme);
        if (theme !== "system") return;
        const follow = () => apply("system");
        dark.addEventListener("change", follow);
        return () => dark.removeEventListener("change", follow);
    }, [theme]);
    const value = useMemo(
        () => ({
            theme,
            setTheme: (next: Theme) => {
                localStorage.setItem(THEME_KEY, next);
                setThemeState(next);
            },
        }),
        [theme],
    );
    return <ThemeContext value={value}>{children}</ThemeContext>;
}
