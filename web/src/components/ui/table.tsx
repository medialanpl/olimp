import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const ENABLE_TOP_SCROLLBAR = false;

function Table({ className, ...props }: React.ComponentProps<"table">) {
    const topScrollRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isSyncingRef = useRef(false);
    const [scrollWidth, setScrollWidth] = useState(0);
    const [showTopScroll, setShowTopScroll] = useState(false);

    const syncFrom = useCallback((source: HTMLDivElement, target: HTMLDivElement | null) => {
        if (isSyncingRef.current) {
            isSyncingRef.current = false;
            return;
        }
        if (!target) return;
        isSyncingRef.current = true;
        target.scrollLeft = source.scrollLeft;
    }, []);

    useEffect(() => {
        const container = containerRef.current;
        const table = container?.querySelector("table");
        if (!container || !table) return;

        const updateMeasurements = () => {
            setScrollWidth(container.scrollWidth);
            setShowTopScroll(container.scrollWidth > container.clientWidth + 1);
        };

        updateMeasurements();

        const resizeObserver = new ResizeObserver(updateMeasurements);
        resizeObserver.observe(container);
        resizeObserver.observe(table);

        return () => resizeObserver.disconnect();
    }, []);

    return (
        <div className="relative  min-w-0 ">
            {ENABLE_TOP_SCROLLBAR && showTopScroll && (
                <div
                    ref={topScrollRef}
                    onScroll={(event) => syncFrom(event.currentTarget, containerRef.current)}
                    className="w-full min-w-0 overflow-x-auto overflow-y-hidden"
                    aria-hidden="true"
                >
                    <div style={{ width: scrollWidth, height: 1 }} />
                </div>
            )}
            <div
                ref={containerRef}
                data-slot="table-container"
                onScroll={(event) => syncFrom(event.currentTarget, topScrollRef.current)}
                className="scroll-fade-x scroll-fade-24 relative w-full min-w-0 overflow-x-auto"
            >
                <table
                    data-slot="table"
                    className={cn(
                        "w-full caption-bottom text-sm [text-size-adjust:100%]",
                        className,
                    )}
                    {...props}
                />
            </div>
        </div>
    );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
    return (
        <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />
    );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
    return (
        <tbody
            data-slot="table-body"
            className={cn("[&_tr:last-child]:border-0", className)}
            {...props}
        />
    );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
    return (
        <tfoot
            data-slot="table-footer"
            className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
            {...props}
        />
    );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
    return (
        <tr
            data-slot="table-row"
            className={cn(
                "group border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
                className,
            )}
            {...props}
        />
    );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
    return (
        <th
            data-slot="table-head"
            className={cn(
                "h-10 text-xs px-2 font-medium text-left align-middle  whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
                className,
            )}
            {...props}
        />
    );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
    return (
        <td
            data-slot="table-cell"
            className={cn(
                "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
                className,
            )}
            {...props}
        />
    );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
    return (
        <caption
            data-slot="table-caption"
            className={cn("mt-4 text-sm text-muted-foreground", className)}
            {...props}
        />
    );
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
