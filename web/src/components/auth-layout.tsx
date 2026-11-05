import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { LanguageSelect } from "@/components/language-select";
import { OlimpLogo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import symbol from "../../../docs/brand/olimp-symbol.svg";
import symbolReversed from "../../../docs/brand/olimp-symbol-reversed.svg";

// The panel beside the form, as in Corivo, cut down to the symbol and one line.
function PitchPanel() {
    const t = useTranslations("web");
    return (
        <aside className="m-3 hidden flex-col justify-end gap-8 rounded-3xl bg-muted p-10 lg:flex xl:p-14">
            <img src={symbol} alt="" className="size-28 dark:hidden" />
            <img src={symbolReversed} alt="" className="hidden size-28 dark:block" />
            <h2 className="max-w-md text-3xl font-semibold tracking-tight text-balance xl:text-4xl">
                {t("login.pitch")}
            </h2>
        </aside>
    );
}

// Corivo's sign-in screens: the form on the left with the logo, language and theme above it, the
// pitch panel on the right from 1024 px.
export function AuthLayout({ children }: { children: ReactNode }) {
    return (
        <div className="grid min-h-svh bg-background lg:grid-cols-2">
            <div className="flex flex-col gap-4 p-6 md:p-10">
                <div className="flex items-center justify-between gap-2">
                    <OlimpLogo className="h-10" />
                    <div className="flex items-center gap-2">
                        <LanguageSelect className="w-36" />
                        <ThemeToggle />
                    </div>
                </div>
                <main className="flex flex-1 items-center justify-center">
                    <div className="w-full max-w-md">{children}</div>
                </main>
            </div>
            <PitchPanel />
        </div>
    );
}

// The heading of one screen: a title and a line under it.
export function AuthHeading({ title, description }: { title: string; description?: string }) {
    return (
        <div className="mb-6 space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
    );
}
