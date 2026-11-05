import type {
    ColumnFiltersState,
    ColumnVisibilityState,
    RowData,
    SortingState,
} from "@tanstack/react-table";
import { flexRender, useTable } from "@tanstack/react-table";
import * as React from "react";
import { useNavigate } from "react-router";
import { type DataTableColumnDef, dataTableFeatures } from "@/components/ui/data-table-features";
import {
    DataTablePagination,
    type DataTablePaginationLabels,
} from "@/components/ui/data-table-pagination";
import {
    DataTableViewOptions,
    type DataTableViewOptionsLabels,
} from "@/components/ui/data-table-view-options";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

// Cells are transparent (the row gives the background), so the sticky column needs its own.
const stickyActionsColumnClass =
    "table-pin-shadow-right sticky right-0 z-10 w-9 p-0 border-l bg-background border-r group-hover:bg-muted group-has-aria-expanded:bg-muted group-data-[state=selected]:bg-muted transition-colors ";

export type DataTableLabels = {
    empty: string;
    search?: string;
    columns?: DataTableViewOptionsLabels;
    pagination: DataTablePaginationLabels;
};

type DataTableProps<TData extends RowData> = {
    columns: DataTableColumnDef<TData>[];
    data: TData[];
    labels: DataTableLabels;
    searchColumn?: string;
    columnLabels?: Record<string, string>;
    getRowHref?: (row: TData) => string;
    getRowId?: (row: TData) => string;
    initialColumnVisibility?: ColumnVisibilityState;
    initialPageSize?: number;
    pageSizeOptions?: number[];
    className?: string;
    toolbarStart?: React.ReactNode;
    toolbarEnd?: React.ReactNode;
};

export function DataTable<TData extends RowData>({
    columns,
    data,
    labels,
    searchColumn,
    columnLabels,
    getRowHref,
    getRowId,
    initialColumnVisibility,
    initialPageSize = 10,
    pageSizeOptions,
    className,
    toolbarStart,
    toolbarEnd,
}: DataTableProps<TData>) {
    const navigate = useNavigate();
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>(
        initialColumnVisibility ?? {},
    );

    const table = useTable({
        features: dataTableFeatures,
        data,
        columns,
        getRowId,
        state: { sorting, columnFilters, columnVisibility },
        initialState: {
            pagination: { pageIndex: 0, pageSize: initialPageSize },
            // What `table.resetColumnVisibility()` returns to.
            columnVisibility: initialColumnVisibility ?? {},
        },
        // Live updates replace `data` often; keep the reader on their page.
        autoResetPageIndex: false,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
    });

    const search = searchColumn ? table.getColumn(searchColumn) : undefined;
    const openRow = (row: TData) => {
        const href = getRowHref?.(row);
        if (href) navigate(href);
    };

    return (
        <div className={cn("flex flex-col gap-4", className)}>
            {(search || labels.columns || toolbarStart || toolbarEnd) && (
                <div className="flex flex-wrap items-center gap-2">
                    {search && (
                        <Input
                            type="search"
                            placeholder={labels.search}
                            aria-label={labels.search}
                            value={(search.getFilterValue() as string | undefined) ?? ""}
                            onChange={(event) => {
                                search.setFilterValue(event.target.value);
                                table.setPageIndex(0);
                            }}
                            className="h-9 w-full sm:w-56"
                        />
                    )}
                    {toolbarStart}
                    <div className="ml-auto flex items-center gap-2">
                        {toolbarEnd}
                        {labels.columns && (
                            <DataTableViewOptions
                                table={table}
                                labels={labels.columns}
                                columnLabels={columnLabels}
                            />
                        )}
                    </div>
                </div>
            )}
            <div className="overflow-hidden rounded-md border">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => (
                                    <TableHead
                                        key={header.id}
                                        colSpan={header.colSpan}
                                        className={cn(
                                            header.column.id === "actions" &&
                                                stickyActionsColumnClass,
                                        )}
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext(),
                                              )}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {table.getRowModel().rows.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    tabIndex={getRowHref ? 0 : undefined}
                                    className={cn(getRowHref && "cursor-pointer")}
                                    onClick={(event) => {
                                        if (isInteractiveTarget(event.target)) return;
                                        openRow(row.original);
                                    }}
                                    onKeyDown={(event) => {
                                        if (!getRowHref) return;
                                        if (event.target !== event.currentTarget) return;
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault();
                                            openRow(row.original);
                                        }
                                    }}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell
                                            key={cell.id}
                                            className={cn(
                                                cell.column.id === "actions" &&
                                                    stickyActionsColumnClass,
                                            )}
                                        >
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext(),
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center text-muted-foreground"
                                >
                                    {labels.empty}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
            <DataTablePagination
                table={table}
                labels={labels.pagination}
                pageSizeOptions={pageSizeOptions}
            />
        </div>
    );
}

function isInteractiveTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(
        target.closest(
            'a, button, input, select, textarea, [role="button"], [role="menuitem"], [data-row-action="true"]',
        ),
    );
}
