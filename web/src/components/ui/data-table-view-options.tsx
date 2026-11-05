import type { RowData } from "@tanstack/react-table";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command";
import type { DataTableInstance } from "@/components/ui/data-table-features";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type DataTableViewOptionsLabels = {
    columns: string;
    search: string;
    empty: string;
    reset: string;
};

type DataTableViewOptionsProps<TData extends RowData> = {
    table: DataTableInstance<TData>;
    labels: DataTableViewOptionsLabels;
    columnLabels?: Record<string, string>;
};

export function DataTableViewOptions<TData extends RowData>({
    table,
    labels,
    columnLabels,
}: DataTableViewOptionsProps<TData>) {
    const columns = table.getAllColumns().filter((column) => column.getCanHide());
    const hasHiddenColumn = columns.some((column) => !column.getIsVisible());

    if (columns.length === 0) return null;

    return (
        <Popover>
            <Tooltip>
                <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                        <Button variant="outline" size="icon" className="hidden lg:inline-flex">
                            <SlidersHorizontalIcon />
                            <span className="sr-only">{labels.columns}</span>
                        </Button>
                    </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>{labels.columns}</TooltipContent>
            </Tooltip>
            <PopoverContent align="end" className="w-48 p-0">
                <Command>
                    <CommandInput placeholder={labels.search} />
                    <CommandList>
                        <CommandEmpty>{labels.empty}</CommandEmpty>
                        <CommandGroup>
                            {columns.map((column) => {
                                const isVisible = column.getIsVisible();
                                return (
                                    <CommandItem
                                        key={column.id}
                                        value={columnLabels?.[column.id] ?? column.id}
                                        onSelect={() => column.toggleVisibility(!isVisible)}
                                        data-checked={isVisible}
                                    >
                                        <span className="truncate">
                                            {columnLabels?.[column.id] ?? column.id}
                                        </span>
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                        {hasHiddenColumn && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={() => table.resetColumnVisibility()}
                                        className="justify-center text-center"
                                    >
                                        {labels.reset}
                                    </CommandItem>
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
