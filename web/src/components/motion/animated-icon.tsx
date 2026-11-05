import type * as React from "react";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

const GEOMETRY_SELECTOR = "path, circle, ellipse, line, polyline, polygon, rect";

export type AnimatedIconProps = {
    children: React.ReactNode;
    preset?: "trace" | "orbit";
    className?: string;
};

export function AnimatedIcon({ children, preset = "trace", className }: AnimatedIconProps) {
    const measure = useCallback((node: HTMLSpanElement | null) => {
        if (!node) {
            return;
        }
        for (const shape of node.querySelectorAll<SVGGeometryElement>(GEOMETRY_SELECTOR)) {
            try {
                const length = shape.getTotalLength?.();
                if (length && length > 0) {
                    shape.style.setProperty("--stroke-len", length.toFixed(1));
                }
            } catch {
                return;
            }
        }
    }, []);

    return (
        <span
            ref={measure}
            className={cn("icon-stack shrink-0", preset === "orbit" && "icon-orbit", className)}
        >
            {children}
            <span aria-hidden="true" className="icon-trace">
                {children}
            </span>
        </span>
    );
}
