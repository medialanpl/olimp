import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// The ui-kit's SiteBanner without its Next-only parts (remembered dismissal, link CTA).
const tones = {
    muted: "bg-muted text-foreground",
    warning: "bg-warning/15 text-warning",
} as const;

export function SiteBanner({
    title,
    description,
    icon,
    tone = "muted",
    inset = false,
}: {
    title: string;
    description?: string;
    icon?: ReactNode;
    tone?: keyof typeof tones;
    inset?: boolean;
}) {
    return (
        <section aria-label={title}>
            <div
                className={cn(
                    "flex items-center gap-3 px-4 py-2.5 text-sm md:justify-center",
                    tones[tone],
                    inset && "rounded-xl",
                )}
            >
                {icon && (
                    <span aria-hidden="true" className="shrink-0 [&_svg]:size-4">
                        {icon}
                    </span>
                )}
                <p className="min-w-0 flex-1 md:flex-initial">
                    <span className="font-medium">{title}</span>
                    {description && <span className="opacity-80"> {description}</span>}
                </p>
            </div>
        </section>
    );
}
