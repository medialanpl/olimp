import { CheckIcon, CircleDashedIcon, HandIcon, LoaderIcon, SquareIcon, XIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/types";

const LOOK = {
    queued: { variant: "secondary", Icon: CircleDashedIcon },
    running: { variant: "progress", Icon: LoaderIcon },
    waiting: { variant: "info", Icon: HandIcon },
    done: { variant: "constructive", Icon: CheckIcon },
    failed: { variant: "destructive", Icon: XIcon },
    cancelled: { variant: "outline", Icon: SquareIcon },
} as const;

export function StatusBadge({ status }: { status: RunStatus }) {
    const t = useTranslations("web");
    const { variant, Icon } = LOOK[status];
    return (
        <Badge variant={variant}>
            <Icon
                className={status === "running" ? "animate-spin motion-reduce:animate-none" : ""}
            />
            {t(`status.${status}`)}
        </Badge>
    );
}
