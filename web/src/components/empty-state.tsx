import type { ReactNode } from "react";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
    title: string;
    description?: ReactNode;
    icon?: ReactNode;
    variant?: "dashed" | "plain";
    iconStyle?: "glass" | "plain";
    children?: ReactNode;
    className?: string;
};

export function EmptyState({
    title,
    description,
    icon,
    variant = "dashed",
    iconStyle = "glass",
    children,
    className,
}: EmptyStateProps) {
    return (
        <Empty className={cn(variant === "dashed" && "border", className)}>
            <EmptyHeader>
                {icon && (
                    <EmptyMedia
                        variant={iconStyle === "glass" ? "icon" : "default"}
                        className={cn(
                            iconStyle === "plain" && "text-muted-foreground [&_svg]:size-8",
                        )}
                    >
                        {icon}
                    </EmptyMedia>
                )}
                <EmptyTitle>{title}</EmptyTitle>
                {description && <EmptyDescription>{description}</EmptyDescription>}
            </EmptyHeader>
            {children && <EmptyContent>{children}</EmptyContent>}
        </Empty>
    );
}
