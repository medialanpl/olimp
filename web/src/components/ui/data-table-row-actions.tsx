import { MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

// `data-row-action="true"` tells `DataTable` that a click in the menu must not open the row.
export function DataTableRowActions({
    label,
    children,
    align = "end",
    disabled,
    busy,
    onCloseAutoFocus,
}: {
    label: string;
    children: ReactNode;
    align?: "start" | "center" | "end";
    disabled?: boolean;
    busy?: boolean;
    onCloseAutoFocus?: ComponentProps<typeof DropdownMenuContent>["onCloseAutoFocus"];
}) {
    return (
        <div className="flex justify-end p-1" data-row-action="true">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={disabled}>
                        {busy ? <Spinner /> : <MoreHorizontalIcon />}
                        <span className="sr-only">{label}</span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={align} onCloseAutoFocus={onCloseAutoFocus}>
                    {children}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
