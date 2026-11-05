import {
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronsLeftIcon,
    ChevronsRightIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type PaginationControlsLabels = {
    rowsPerPage: string;
    page: string;
    of: string;
    firstPage: string;
    previousPage: string;
    nextPage: string;
    lastPage: string;
};

export function PaginationControls({
    page,
    pageCount,
    pageSize,
    pageSizeOptions = [10, 20, 50],
    onPageChange,
    onPageSizeChange,
    labels,
    className,
}: {
    page: number;
    pageCount: number;
    pageSize: number;
    pageSizeOptions?: number[];
    onPageChange: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
    labels: PaginationControlsLabels;
    className?: string;
}) {
    const pages = Math.max(1, pageCount);
    const canPrevious = page > 1;
    const canNext = page < pages;

    return (
        <div
            className={cn(
                "flex grow flex-col justify-between gap-3 sm:flex-row sm:items-center sm:gap-6 lg:gap-8",
                className,
            )}
        >
            {onPageSizeChange ? (
                <div className="flex items-center justify-between gap-2 sm:justify-start">
                    <p className="font-medium text-sm">{labels.rowsPerPage}</p>
                    <Select
                        value={`${pageSize}`}
                        onValueChange={(value) => onPageSizeChange(Number(value))}
                    >
                        <SelectTrigger className="h-9 w-20" aria-label={labels.rowsPerPage}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent side="top">
                            {pageSizeOptions.map((size) => (
                                <SelectItem key={size} value={`${size}`}>
                                    {size}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            ) : (
                <span />
            )}
            <div className="flex items-center justify-between gap-1 sm:justify-center">
                <div className="flex items-center gap-1">
                    <Button
                        variant="outline"
                        size="icon"
                        className="hidden p-0 lg:flex"
                        onClick={() => onPageChange(1)}
                        disabled={!canPrevious}
                    >
                        <span className="sr-only">{labels.firstPage}</span>
                        <ChevronsLeftIcon />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="p-0"
                        onClick={() => onPageChange(page - 1)}
                        disabled={!canPrevious}
                    >
                        <span className="sr-only">{labels.previousPage}</span>
                        <ChevronLeftIcon />
                    </Button>
                </div>
                <div className="flex-1 text-center font-medium text-sm tabular-nums sm:w-28 sm:flex-none">
                    {labels.page} {page} {labels.of} {pages}
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="outline"
                        size="icon"
                        className="p-0"
                        onClick={() => onPageChange(page + 1)}
                        disabled={!canNext}
                    >
                        <span className="sr-only">{labels.nextPage}</span>
                        <ChevronRightIcon />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="hidden p-0 lg:flex"
                        onClick={() => onPageChange(pages)}
                        disabled={!canNext}
                    >
                        <span className="sr-only">{labels.lastPage}</span>
                        <ChevronsRightIcon />
                    </Button>
                </div>
            </div>
        </div>
    );
}
