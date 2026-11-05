import { useTranslations } from "use-intl";
import { LanguageSelect } from "@/components/language-select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { THEMES, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// Light from the palette, dark from the panel's own .dark tokens: both previews read true in either theme.
const LOOK = {
    light: { frame: "bg-(--taupe)", block: "bg-(--eggshell)", line: "bg-(--stone)" },
    dark: { frame: "dark bg-sidebar", block: "bg-card", line: "bg-muted-foreground/40" },
} as const;

// Corivo's theme thumbnail: a heading row and two rows with an avatar.
function Preview({ mode, className }: { mode: keyof typeof LOOK; className?: string }) {
    const look = LOOK[mode];
    return (
        <span className={cn("flex h-full flex-col gap-1 rounded-md p-1", look.frame, className)}>
            {[["w-3/5", "w-4/5"], ["w-5/6"], ["w-4/5"]].map((lines, row) => (
                <span
                    key={lines.join()}
                    className={cn("flex flex-1 items-center gap-1.5 rounded-sm", look.block)}
                >
                    {row > 0 && <span className={cn("ml-1 size-2.5 rounded-full", look.line)} />}
                    <span className="flex flex-1 flex-col gap-0.5 px-1">
                        {lines.map((width) => (
                            <span
                                key={width}
                                className={cn("h-1 rounded-full", width, look.line)}
                            />
                        ))}
                    </span>
                </span>
            ))}
        </span>
    );
}

export function Appearance() {
    const t = useTranslations("web");
    const { theme, setTheme } = useTheme();
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <Card>
                <CardHeader>
                    <CardTitle>{t("header.theme")}</CardTitle>
                    <CardDescription>{t("settings.themeHint")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    {THEMES.map((value) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={theme === value}
                            onClick={() => setTheme(value)}
                            className={cn(
                                "flex w-32 flex-col items-center gap-2 rounded-lg border bg-background p-1.5 pb-2 text-xs font-medium transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-36",
                                theme === value
                                    ? "border-primary text-foreground ring-2 ring-primary/25"
                                    : "text-muted-foreground",
                            )}
                        >
                            <span className="block aspect-[1.28] w-full rounded-md border bg-background p-1 shadow-sm">
                                {value === "system" ? (
                                    <span className="grid h-full grid-cols-2">
                                        <Preview mode="light" className="rounded-r-none" />
                                        <Preview mode="dark" className="rounded-l-none" />
                                    </span>
                                ) : (
                                    <Preview mode={value} />
                                )}
                            </span>
                            {t(`theme.${value}`)}
                        </button>
                    ))}
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>{t("header.language")}</CardTitle>
                    <CardDescription>{t("settings.languageHint")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <LanguageSelect className="w-40" />
                </CardContent>
            </Card>
        </div>
    );
}
