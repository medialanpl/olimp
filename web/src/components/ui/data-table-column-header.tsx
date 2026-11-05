import type { CellData, Column, RowData } from "@tanstack/react-table";
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    CheckIcon,
    EyeOffIcon,
    XIcon,
} from "lucide-react";
import type { DataTableFeatures } from "@/components/ui/data-table-features";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type DataTableColumnHeaderLabels = {
    asc: string;
    desc: string;
    clearSort: string;
    hide: string;
};

type DataTableColumnHeaderProps<TData extends RowData, TValue extends CellData> = {
    column: Column<DataTableFeatures, TData, TValue>;
    title: string;
    labels: DataTableColumnHeaderLabels;
    className?: string;
};

export function DataTableColumnHeader<TData extends RowData, TValue extends CellData>({
    column,
    title,
    labels,
    className,
}: DataTableColumnHeaderProps<TData, TValue>) {
    if (!column.getCanSort()) {
        return <div className={cn(className)}>{title}</div>;
    }

    const sorted = column.getIsSorted();

    return (
        <div className={cn("flex items-center gap-2 text-xs", className)}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <div className="flex gap-1 items-center cursor-pointer data-[state=open]:text-primary [&_svg:not([class*='size-'])]:size-4">
                        <span>{title}</span>
                        {sorted === "desc" ? (
                            <ArrowDownIcon data-icon="inline-end" />
                        ) : sorted === "asc" ? (
                            <ArrowUpIcon data-icon="inline-end" />
                        ) : (
                            <ArrowUpDownIcon data-icon="inline-end" />
                        )}
                    </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
                        <ArrowUpIcon />
                        {labels.asc}
                        {sorted === "asc" && (
                            <CheckIcon data-icon="inline-end" className="ml-auto" />
                        )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
                        <ArrowDownIcon />
                        {labels.desc}
                        {sorted === "desc" && (
                            <CheckIcon data-icon="inline-end" className="ml-auto" />
                        )}
                    </DropdownMenuItem>
                    {sorted !== false && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => column.clearSorting()}>
                                <XIcon />
                                {labels.clearSort}
                            </DropdownMenuItem>
                        </>
                    )}
                    {column.getCanHide() && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => column.toggleVisibility(false)}>
                                <EyeOffIcon />
                                {labels.hide}
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
