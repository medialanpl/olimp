import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardAction,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
    title,
    description,
    actions,
    children,
}: {
    title: ReactNode;
    description?: ReactNode;
    actions?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
                <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
                    {title}
                </h1>
                {description && (
                    <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
                )}
                {children}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

// The skeleton of the UI being loaded (web/src/components/skeletons.tsx), announced as loading.
export function Loading({ className, children }: { className?: string; children: ReactNode }) {
    const t = useTranslations("web");
    return (
        <div role="status" aria-busy="true" className={className}>
            <span className="sr-only">{t("common.loading")}</span>
            {children}
        </div>
    );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const t = useTranslations("web");
    return (
        <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("common.error")}</AlertTitle>
            <AlertDescription>
                <p>{error instanceof Error ? error.message : String(error)}</p>
                {onRetry && (
                    <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
                        {t("common.retry")}
                    </Button>
                )}
            </AlertDescription>
        </Alert>
    );
}

// A label and its value in a detail header.
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate text-sm font-medium">{children}</dd>
        </div>
    );
}

// An error of a mutation, shown next to its form.
export function FormError({ error }: { error: unknown }) {
    if (!error) return null;
    return (
        <p role="alert" className="text-sm text-destructive">
            {error instanceof Error ? error.message : String(error)}
        </p>
    );
}

// A number tile with an optional note under it; with `to` the whole tile is the link.
export function Stat({
    label,
    value,
    hint,
    action,
    icon,
    tone,
    to,
}: {
    label: string;
    value: ReactNode;
    hint?: string;
    action?: ReactNode;
    icon?: ReactNode;
    tone?: string;
    to?: string;
}) {
    const card = (
        <Card
            className={cn(
                "gap-1 py-4",
                to && "h-full transition-shadow group-hover/stat:ring-foreground/25",
            )}
        >
            <CardHeader className="px-4">
                <CardDescription>{label}</CardDescription>
                {icon && (
                    <CardAction
                        aria-hidden
                        className={cn("rounded-md bg-muted p-1.5 [&_svg]:size-4", tone)}
                    >
                        {icon}
                    </CardAction>
                )}
                <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
            </CardHeader>
            {(hint || action) && (
                <CardContent className="space-y-1 px-4 text-xs text-muted-foreground">
                    {hint && <p>{hint}</p>}
                    {action && <div className="pt-2">{action}</div>}
                </CardContent>
            )}
        </Card>
    );
    return to ? (
        <Link
            to={to}
            className="group/stat rounded-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
            {card}
        </Link>
    ) : (
        card
    );
}

// Tabs as an underline, as on the task page; the kit's TabsList needs UNDERLINE_TABS with it.
export const UNDERLINE_TABS = "h-auto w-full justify-start gap-5 rounded-none bg-transparent p-0";
export const UNDERLINE_TAB =
    "flex-none rounded-none border-0 border-b-2 border-transparent px-0 pb-2 transition-colors data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground dark:data-[state=active]:bg-transparent not-data-[state=active]:hover:border-muted-foreground/40 not-data-[state=active]:hover:bg-transparent not-data-[state=active]:hover:text-foreground focus-visible:ring-0 focus-visible:outline-none focus-visible:border-ring";
