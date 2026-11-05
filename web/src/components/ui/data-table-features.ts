import {
    type CellData,
    type ColumnDef,
    columnFilteringFeature,
    columnVisibilityFeature,
    createFilteredRowModel,
    createPaginatedRowModel,
    createSortedRowModel,
    filterFn_arrIncludes,
    filterFn_equals,
    filterFn_includesString,
    filterFn_inDateRange,
    filterFn_inNumberRange,
    filterFn_weakEquals,
    type ReactTable,
    type RowData,
    rowPaginationFeature,
    rowSelectionFeature,
    rowSortingFeature,
    sortFn_alphanumeric,
    sortFn_basic,
    sortFn_datetime,
    sortFn_text,
    tableFeatures,
} from "@tanstack/react-table";

// TanStack Table v9 registers features and `filterFns`/`sortFns` up front: without an entry a
// filter or sort silently does nothing.
export const dataTableFeatures = tableFeatures({
    columnFilteringFeature,
    columnVisibilityFeature,
    rowPaginationFeature,
    rowSelectionFeature,
    rowSortingFeature,
    filteredRowModel: createFilteredRowModel(),
    sortedRowModel: createSortedRowModel(),
    paginatedRowModel: createPaginatedRowModel(),
    filterFns: {
        arrIncludes: filterFn_arrIncludes,
        equals: filterFn_equals,
        inDateRange: filterFn_inDateRange,
        includesString: filterFn_includesString,
        inNumberRange: filterFn_inNumberRange,
        weakEquals: filterFn_weakEquals,
    },
    sortFns: {
        alphanumeric: sortFn_alphanumeric,
        basic: sortFn_basic,
        datetime: sortFn_datetime,
        text: sortFn_text,
    },
});

export type DataTableFeatures = typeof dataTableFeatures;

// v8's `ColumnDef<TData>`: v9 takes the feature set as the first type argument.
export type DataTableColumnDef<
    TData extends RowData,
    TValue extends CellData = CellData,
> = ColumnDef<DataTableFeatures, TData, TValue>;

export type DataTableInstance<TData extends RowData> = ReactTable<DataTableFeatures, TData>;
