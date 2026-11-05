import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Corivo's ExternalValueLink: underlined primary text with an arrow, opened in a new tab.
export function ExternalLink({
    href,
    children,
    className,
}: {
    href: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
                "inline-flex items-center gap-1 text-primary underline underline-offset-2",
                className,
            )}
        >
            {children}
            <ArrowUpRightIcon aria-hidden className="size-4 shrink-0" />
        </a>
    );
}
