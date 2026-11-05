import type { ReactNode } from "react";
import { Loading } from "@/components/page";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Keys for repeated placeholders: a number of its own, so no array index becomes a key.
export const times = (count: number) => Array.from({ length: count }, (_, n) => n);

const WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-full", "w-2/3"];

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
    return (
        <div className={cn("space-y-2", className)}>
            {times(lines).map((line) => (
                <Skeleton
                    key={line}
                    className={cn("h-4", line === lines - 1 ? "w-1/2" : WIDTHS[line % 5])}
                />
            ))}
        </div>
    );
}

export function PageHeaderSkeleton({
    description = true,
    actions = 0,
}: {
    description?: boolean;
    actions?: number;
}) {
    return (
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
                <Skeleton className="h-7 w-48 sm:h-8" />
                {description && <Skeleton className="h-4 w-80 max-w-full" />}
            </div>
            {actions > 0 && (
                <div className="flex shrink-0 gap-2">
                    {times(actions).map((action) => (
                        <Skeleton key={action} className="h-9 w-28 rounded-4xl" />
                    ))}
                </div>
            )}
        </div>
    );
}

// The DataTable: its toolbar, the bordered table with a header row, then the rows; className
// goes to the table's frame.
export function TableSkeleton({
    columns = 4,
    rows = 5,
    toolbar = true,
    className,
}: {
    columns?: number;
    rows?: number;
    toolbar?: boolean;
    className?: string;
}) {
    return (
        <div className="flex flex-col gap-4">
            {toolbar && (
                <div className="flex items-center gap-2">
                    <Skeleton className="h-9 w-full rounded-3xl sm:w-56" />
                    <Skeleton className="ml-auto h-9 w-24 rounded-4xl" />
                </div>
            )}
            <div className={cn("overflow-hidden rounded-md border", className)}>
                <div className="flex h-10 items-center gap-6 border-b px-2">
                    {times(columns).map((column) => (
                        <Skeleton key={column} className="h-3 flex-1 first:flex-[2]" />
                    ))}
                </div>
                {times(rows).map((row) => (
                    <div
                        key={row}
                        className="flex h-12 items-center gap-6 border-b px-2 last:border-0"
                    >
                        {times(columns).map((column) => (
                            <Skeleton key={column} className="h-4 flex-1 first:flex-[2]" />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

// A labelled form control: the label, then an input, select or button of the default height.
export function FieldSkeleton({ className }: { className?: string }) {
    return (
        <div className={cn("space-y-2", className)}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-full rounded-3xl" />
        </div>
    );
}

// The Stat tile of page.tsx, with its note when the tile has one.
export function StatSkeleton({ hint = false }: { hint?: boolean }) {
    return (
        <Card className="gap-1 py-4">
            <CardHeader className="gap-2 px-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
            </CardHeader>
            {hint && (
                <CardContent className="px-4">
                    <Skeleton className="h-3 w-32" />
                </CardContent>
            )}
        </Card>
    );
}

// A card with a title, a description and lines of content; children replace the lines.
export function CardSkeleton({
    lines = 3,
    description = true,
    className,
    children,
}: {
    lines?: number;
    description?: boolean;
    className?: string;
    children?: ReactNode;
}) {
    return (
        <Card className={className}>
            <CardHeader className="gap-2">
                <Skeleton className="h-5 w-40" />
                {description && <Skeleton className="h-4 w-64 max-w-full" />}
            </CardHeader>
            <CardContent>{children ?? <SkeletonText lines={lines} />}</CardContent>
        </Card>
    );
}

// The JobPage shell of a task or a run: the header, the underlined tabs, then the first tab.
export function JobPageSkeleton() {
    return (
        <Loading className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 space-y-3 border-b px-4 pt-3 md:px-6">
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <Skeleton className="h-7 w-72 max-w-full" />
                        <Skeleton className="h-5 w-20" />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex gap-2">
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-5 w-32" />
                        </div>
                        <Skeleton className="h-4 w-40" />
                    </div>
                </div>
                <div className="flex gap-5 pb-2">
                    {times(4).map((tab) => (
                        <Skeleton key={tab} className="h-5 w-16" />
                    ))}
                </div>
            </div>
            <div className="space-y-4 px-4 py-5 md:px-6">
                <SkeletonText lines={4} />
                <SkeletonText lines={3} />
            </div>
        </Loading>
    );
}

// The compare page: the header, then a card per variant; in its own chunk, so it lives here.
export function CompareSkeleton() {
    return (
        <Loading>
            <PageHeaderSkeleton />
            <div className="grid gap-4 lg:grid-cols-2">
                <CardSkeleton lines={6} />
                <CardSkeleton lines={6} />
            </div>
        </Loading>
    );
}

// A task's terminal: its tab strip over the shell; the panel's chunk shows it before xterm loads.
export function TerminalSkeleton() {
    return (
        <Loading className="flex h-[calc(100dvh-13rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
                <Skeleton className="size-4" />
                <Skeleton className="h-6 w-28 rounded-md" />
                <Skeleton className="size-6 rounded-4xl" />
                <Skeleton className="ml-auto h-4 w-64" />
                <Skeleton className="h-6 w-16 rounded-4xl" />
            </div>
            <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-96 max-w-full" />
                <Skeleton className="h-4 w-48" />
            </div>
        </Loading>
    );
}
