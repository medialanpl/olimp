import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
    "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-2xl border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5",
    {
        variants: {
            variant: {
                default: "bg-card text-card-foreground border-border",
                info: "border-info/30 bg-info/10 text-foreground [&>svg]:text-info",
                destructive:
                    "border-destructive/40 bg-destructive/10 text-destructive [&>svg]:text-destructive dark:border-destructive/50 dark:bg-destructive/15",
                warning:
                    "border-amber-500/40 bg-amber-500/10 text-amber-700 [&>svg]:text-amber-600 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300 dark:[&>svg]:text-amber-400",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

function Alert({
    className,
    variant,
    ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
    return (
        <div
            data-slot="alert"
            role="alert"
            className={cn(alertVariants({ variant }), className)}
            {...props}
        />
    );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-title"
            className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
            {...props}
        />
    );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-description"
            className={cn(
                "col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
                "text-current/80",
                className,
            )}
            {...props}
        />
    );
}

export { Alert, AlertDescription, AlertTitle };
