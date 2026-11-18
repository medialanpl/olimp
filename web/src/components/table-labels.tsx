import type { CellData, Column, RowData } from "@tanstack/react-table";
import { useTranslations } from "use-intl";
import { DataTableColumnHeader } from "@/components/ui/data-table-column-header";
import type { DataTableFeatures } from "@/components/ui/data-table-features";

export function useTableLabels() {
    const t = useTranslations("web");
    return {
        columns: {
            columns: t("table.columns"),
            search: t("table.columnsSearch"),
            empty: t("table.noResults"),
            reset: t("table.reset"),
        },
        pagination: {
            rowsPerPage: t("table.rowsPerPage"),
            page: t("table.page"),
            of: t("table.of"),
            firstPage: t("table.firstPage"),
            previousPage: t("table.previousPage"),
            nextPage: t("table.nextPage"),
            lastPage: t("table.lastPage"),
        },
    };
}

export function ColumnHead<TData extends RowData, TValue extends CellData>({
    column,
    title,
    end,
}: {
    column: Column<DataTableFeatures, TData, TValue>;
    title: string;
    end?: boolean;
}) {
    const t = useTranslations("web");
    return (
        <DataTableColumnHeader
            column={column}
            title={title}
            labels={{
                asc: t("table.asc"),
                desc: t("table.desc"),
                clearSort: t("table.clearSort"),
                hide: t("table.hide"),
            }}
            className={end ? "justify-end" : undefined}
        />
    );
}
