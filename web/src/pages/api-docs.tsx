import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ErrorState, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenApi } from "@/lib/queries";
import { MOD } from "@/lib/shortcuts";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import symbol from "../../../docs/brand/olimp-symbol.svg";
import symbolReversed from "../../../docs/brand/olimp-symbol-reversed.svg";

// The panel's colours and fonts in Scalar's variables, so the reference reads as part of OLIMP.
const OLIMP_THEME = `.light-mode, .dark-mode {
    --scalar-font: "Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif;
    --scalar-font-code: "Geist Mono", ui-monospace, Menlo, Consolas, monospace;
    --scalar-background-1: var(--background);
    --scalar-background-2: var(--card);
    --scalar-background-3: var(--muted);
    --scalar-background-accent: color-mix(in oklab, var(--brand) 12%, transparent);
    --scalar-color-1: var(--foreground);
    --scalar-color-2: var(--muted-foreground);
    --scalar-color-3: var(--muted-foreground);
    --scalar-color-accent: var(--brand);
    --scalar-border-color: var(--border);
    --scalar-sidebar-background-1: var(--sidebar);
    --scalar-sidebar-border-color: var(--border);
    --scalar-sidebar-item-active-background: var(--accent);
    --scalar-sidebar-search-background: var(--background);
    --scalar-sidebar-search-border-color: var(--border);
    --scalar-radius: calc(var(--radius) - 2px);
}
/* Scalar sizes its sticky sidebar to the window; here it lives in the panel's inset. */
.scalar-app.scalar-api-reference.references-layout {
    --full-height: calc(100dvh - 2.25rem);
}
@media (min-width: 64rem) {
    .scalar-app.scalar-api-reference.references-layout {
        --full-height: calc(100dvh - 1rem);
    }
}
.scalar-app .sidebar-heading-type {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2.75rem;
    height: 1rem;
    padding: 0 0.375rem;
    border-radius: calc(var(--radius) - 4px);
    background: color-mix(in oklab, var(--method-color) 15%, transparent);
    color: var(--method-color);
    font: 600 0.625rem/1 var(--scalar-font-code);
    letter-spacing: 0.02em;
}
.scalar-app .badge {
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1rem;
}
.scalar-app .t-doc__sidebar span:has(> kbd) {
    border: 0;
    padding: 0;
}
.scalar-app kbd {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    height: 1.25rem;
    padding: 0 0.25rem;
    border-radius: calc(var(--radius) - 6px);
    background: var(--muted);
    color: var(--muted-foreground);
    font: 500 0.75rem/1 var(--scalar-font);
    text-transform: capitalize;
}
.scalar-app kbd > span[aria-hidden="true"] {
    font-size: 0;
}
.scalar-app kbd > span[aria-hidden="true"]::before {
    content: var(--olimp-mod);
    font-size: 0.75rem;
}
/* The introduction: the mark beside the title, the versions under it. */
.scalar-app .section-content:has(> .flex > .badge) {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 1.25rem;
    align-items: center;
}
.scalar-app .section-content:has(> .flex > .badge)::before {
    content: "";
    grid-row: 1 / span 2;
    width: 4.5rem;
    height: 4.5rem;
    background: url("${symbol}") center / contain no-repeat;
}
.dark-mode .scalar-app .section-content:has(> .flex > .badge)::before {
    background-image: url("${symbolReversed}");
}
.scalar-app .section-content:has(> .flex > .badge) > .section-header-wrapper {
    grid-column: 2;
    grid-row: 1;
    align-self: end;
}
.scalar-app .section-content:has(> .flex > .badge) > .section-header-wrapper .section-header {
    margin-bottom: 0;
}
.scalar-app .section-content:has(> .flex > .badge) > .flex {
    grid-column: 2;
    grid-row: 2;
    align-self: start;
    margin-top: 0.75rem;
}
.scalar-app .section-content:has(> .flex > .badge) > .section-columns {
    grid-column: 1 / -1;
    margin-top: 2.5rem;
}`;

function ReferenceSkeleton() {
    return (
        <Loading className="flex min-h-0 flex-1">
            <div className="hidden w-72 shrink-0 space-y-3 border-r bg-sidebar p-4 md:block">
                <Skeleton className="h-8 w-full" />
                {times(14).map((i) => (
                    <Skeleton key={i} className={cn("h-4", i % 4 ? "ml-3 w-40" : "w-28")} />
                ))}
            </div>
            <div className="flex-1 space-y-4 p-6 md:p-10">
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-4 w-full max-w-2xl" />
                <Skeleton className="h-4 w-2/3 max-w-xl" />
                <Skeleton className="mt-8 h-40 w-full max-w-3xl" />
                <Skeleton className="h-40 w-full max-w-3xl" />
            </div>
        </Loading>
    );
}

export function ApiDocsPage() {
    const spec = useOpenApi();
    const { theme } = useTheme();
    const host = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState<unknown>(null);

    // Scalar is a few hundred kB, so it loads only with this page; a theme change mounts it again.
    useEffect(() => {
        const element = host.current;
        if (!spec.data || !element) return;
        let gone = false;
        let destroy = () => {};
        Promise.all([import("@scalar/api-reference"), import("@scalar/api-reference/style.css")])
            .then(([{ createApiReference }]) => {
                if (gone) return;
                const dark =
                    theme === "dark" ||
                    (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
                ({ destroy } = createApiReference(element, {
                    // This instance's address, so the examples are ready to paste.
                    content: { ...spec.data, servers: [{ url: location.origin }] },
                    forceDarkModeState: dark ? "dark" : "light",
                    hideDarkModeToggle: true,
                    withDefaultFonts: false,
                    hideClientButton: true,
                    showDeveloperTools: "never",
                    telemetry: false,
                    // Its chat would send the description to Scalar's servers.
                    agent: { disabled: true },
                    documentDownloadType: "json",
                    hideModels: true,
                    customCss: OLIMP_THEME,
                    onLoaded: () => setReady(true),
                }));
            })
            .catch(setFailed);
        return () => {
            gone = true;
            destroy();
        };
    }, [spec.data, theme]);

    // Here the search shortcut searches the reference: the panel's palette leaves a handled key alone.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "k") e.preventDefault();
        };
        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, []);

    const error = spec.error ?? failed;
    if (error)
        return (
            <div className="p-4 md:p-6">
                <ErrorState error={error} onRetry={() => void spec.refetch()} />
            </div>
        );
    return (
        <div className="isolate min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            {!ready && <ReferenceSkeleton />}
            <div
                ref={host}
                className={cn(!ready && "hidden")}
                style={{ "--olimp-mod": JSON.stringify(MOD) } as CSSProperties}
            />
        </div>
    );
}
