import type { RowData } from "@tanstack/react-table";
import type { DataTableInstance } from "@/components/ui/data-table-features";
import {
    PaginationControls,
    type PaginationControlsLabels,
} from "@/components/ui/pagination-controls";

export type DataTablePaginationLabels = PaginationControlsLabels & {
    selectedRows?: string;
};

type DataTablePaginationProps<TData extends RowData> = {
    table: DataTableInstance<TData>;
    labels: DataTablePaginationLabels;
    pageSizeOptions?: number[];
};

export function DataTablePagination<TData extends RowData>({
    table,
    labels,
    pageSizeOptions = [10, 20, 50],
}: DataTablePaginationProps<TData>) {
    const selectedRows = table.getFilteredSelectedRowModel().rows.length;
    const filteredRows = table.getFilteredRowModel().rows.length;
    const pageCount = table.getPageCount();
    return (
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            {labels.selectedRows ? (
                <div className="text-muted-foreground text-sm">
                    {labels.selectedRows
                        .replace("{selected}", String(selectedRows))
                        .replace("{total}", String(filteredRows))}
                </div>
            ) : null}
            <PaginationControls
                page={table.state.pagination.pageIndex + 1}
                pageCount={pageCount}
                pageSize={table.state.pagination.pageSize}
                pageSizeOptions={pageSizeOptions}
                onPageChange={(nextPage) => table.setPageIndex(nextPage - 1)}
                onPageSizeChange={(nextPageSize) => table.setPageSize(nextPageSize)}
                labels={labels}
            />
        </div>
    );
}
