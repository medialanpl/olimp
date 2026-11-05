import { LockIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMe } from "@/lib/auth";

// Without accounts everyone is an admin.
export function useIsAdmin(): boolean {
    const me = useMe();
    return !me || me.role === "admin";
}

export function Section({
    title,
    description,
    action,
    children,
    className,
}: {
    title: ReactNode;
    description?: ReactNode;
    action?: ReactNode;
    children: ReactNode;
    className?: string;
}) {
    return (
        <Card className={className}>
            <CardHeader className="flex flex-row flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                    <CardTitle>{title}</CardTitle>
                    {description && <CardDescription>{description}</CardDescription>}
                </div>
                {action}
            </CardHeader>
            <CardContent>{children}</CardContent>
        </Card>
    );
}

export function AdminOnly() {
    const t = useTranslations("web");
    return (
        <EmptyState
            icon={<LockIcon />}
            title={t("repo.adminOnlyTitle")}
            description={t("repo.adminOnly")}
        />
    );
}

// The panel's inline confirmation: a first click asks, the second one deletes.
export function ConfirmDelete({
    label,
    question,
    pending,
    onConfirm,
    size = "sm",
}: {
    label: string;
    question: string;
    pending: boolean;
    onConfirm: () => void;
    size?: "sm" | "icon-sm";
}) {
    const t = useTranslations("web");
    const [asking, setAsking] = useState(false);
    if (!asking)
        return (
            <Button
                variant="ghost"
                size={size}
                className="text-muted-foreground hover:text-destructive"
                aria-label={label}
                title={label}
                onClick={() => setAsking(true)}
            >
                <Trash2Icon />
                {size === "sm" && label}
            </Button>
        );
    return (
        <div className="flex w-full flex-wrap items-center gap-3 rounded-lg bg-destructive/5 p-3 text-sm">
            <p className="min-w-0 flex-1">{question}</p>
            <Button variant="destructive" size="sm" disabled={pending} onClick={onConfirm}>
                <Trash2Icon />
                {label}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
                {t("common.cancel")}
            </Button>
        </div>
    );
}
