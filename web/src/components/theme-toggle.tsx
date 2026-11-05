import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { THEMES, type Theme, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ICONS: Record<Theme, typeof SunIcon> = {
    system: MonitorIcon,
    light: SunIcon,
    dark: MoonIcon,
};

// System, light or dark as three icons, kept in this browser.
export function ThemeToggle({ className }: { className?: string }) {
    const t = useTranslations("web");
    const { theme, setTheme } = useTheme();
    return (
        <ToggleGroup
            type="single"
            value={theme}
            onValueChange={(v) => v && setTheme(v as Theme)}
            aria-label={t("header.theme")}
            className={cn("w-fit border", className)}
        >
            {THEMES.map((value) => {
                const Icon = ICONS[value];
                return (
                    <ToggleGroupItem
                        key={value}
                        value={value}
                        aria-label={t(`theme.${value}`)}
                        title={t(`theme.${value}`)}
                        className="size-8"
                    >
                        <Icon />
                    </ToggleGroupItem>
                );
            })}
        </ToggleGroup>
    );
}
