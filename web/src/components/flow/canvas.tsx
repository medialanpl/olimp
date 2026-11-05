import { MaximizeIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import {
    createContext,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Point } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAD = 48;
const ZOOM = { min: 0.3, max: 1.6, step: 1.2 };

export type EdgeKind = "done" | "running" | "pending" | "error" | "idle";
export interface CanvasEdge {
    id: string;
    d: string;
    kind: EdgeKind;
    dim?: boolean;
    label?: { at: Point; text: string; tone: string };
}

// Bézier curves as React Flow draws them.
export function curvePath(a: Point, b: Point): string {
    const c = Math.max(32, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + c} ${a.y}, ${b.x - c} ${b.y}, ${b.x} ${b.y}`;
}

// A connection back (a loop) goes round under the nodes and returns to the target's input.
export function detourPath(a: Point, b: Point, y: number): string {
    return `M ${a.x} ${a.y} C ${a.x + 56} ${a.y}, ${a.x + 56} ${y}, ${a.x + 112} ${y} L ${b.x - 112} ${y} C ${b.x - 56} ${y}, ${b.x - 56} ${b.y}, ${b.x} ${b.y}`;
}

export const EDGE: Record<EdgeKind, { stroke: string; width: number; dash?: string }> = {
    done: { stroke: "var(--info)", width: 2 },
    running: { stroke: "var(--info)", width: 2, dash: "6 5" },
    pending: { stroke: "var(--muted-foreground)", width: 1.5, dash: "4 5" },
    error: { stroke: "var(--destructive)", width: 2 },
    idle: { stroke: "var(--muted-foreground)", width: 1.5 },
};

type View = { x: number; y: number; k: number };

// The editor turns the pointer into canvas coordinates and stops the automatic fit while dragging.
const CanvasTools = createContext<{
    toWorld: (x: number, y: number) => Point;
    freeze: () => void;
} | null>(null);
export const useCanvasTools = () => useContext(CanvasTools);

const clampZoom = (k: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, k));

// On a narrow screen the whole graph would be unreadable: start at the focus in a readable scale.
const NARROW = 640;
const NARROW_ZOOM = 0.8;

function useCanvas(width: number, height: number, focusX: number, pan: boolean) {
    const box = useRef<HTMLDivElement>(null);
    const [view, setView] = useState<View>({ x: PAD, y: PAD, k: 1 });
    const auto = useRef(true);
    const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

    const fitAll = useCallback(() => {
        const el = box.current;
        if (!el) return;
        const k = clampZoom(
            Math.min(1, (el.clientWidth - PAD * 2) / width, (el.clientHeight - PAD) / height),
        );
        setView({
            k,
            x: (el.clientWidth - width * k) / 2,
            y: (el.clientHeight - height * k) / 2 + 12,
        });
    }, [width, height]);

    const fit = useCallback(() => {
        const el = box.current;
        if (!el) return;
        if (el.clientWidth >= NARROW) return fitAll();
        setView({
            k: NARROW_ZOOM,
            x: el.clientWidth / 2 - focusX * NARROW_ZOOM,
            y: (el.clientHeight - height * NARROW_ZOOM) / 2 + 12,
        });
    }, [fitAll, focusX, height]);

    useEffect(() => {
        const el = box.current;
        if (!el) return;
        if (auto.current) fit();
        const observer = new ResizeObserver(() => auto.current && fit());
        observer.observe(el);
        // A pinch on the touchpad and Ctrl+wheel zoom; the wheel alone pans a full-page canvas
        // and scrolls the page around an embedded one.
        const onWheel = (e: WheelEvent) => {
            // The side panels lie over the canvas and scroll on their own.
            if ((e.target as Element).closest("[role=dialog]")) return;
            if (!e.ctrlKey && !e.metaKey && !pan) return;
            e.preventDefault();
            auto.current = false;
            if (!e.ctrlKey && !e.metaKey) {
                setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
                return;
            }
            const rect = el.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            setView((v) => {
                const k = clampZoom(v.k * Math.exp(-e.deltaY * 0.01));
                return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
            });
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => {
            observer.disconnect();
            el.removeEventListener("wheel", onWheel);
        };
    }, [fit, pan]);

    const zoom = (factor: number) => {
        const el = box.current;
        if (!el) return;
        auto.current = false;
        const cx = el.clientWidth / 2;
        const cy = el.clientHeight / 2;
        setView((v) => {
            const k = clampZoom(v.k * factor);
            return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
        });
    };

    const handlers = {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
            if ((e.target as Element).closest("button, a, input, textarea, [role=dialog]")) return;
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
            const d = drag.current;
            if (!d) return;
            auto.current = false;
            setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        },
        onPointerUp: () => {
            drag.current = null;
        },
    };

    const toWorld = (clientX: number, clientY: number): Point => {
        const rect = box.current?.getBoundingClientRect();
        return {
            x: (clientX - (rect?.left ?? 0) - view.x) / view.k,
            y: (clientY - (rect?.top ?? 0) - view.y) / view.k,
        };
    };

    return {
        box,
        view,
        handlers,
        toWorld,
        freeze: () => {
            auto.current = false;
        },
        zoomIn: () => zoom(ZOOM.step),
        zoomOut: () => zoom(1 / ZOOM.step),
        fitAll: () => {
            auto.current = true;
            fitAll();
        },
    };
}

export function Hint({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export function Canvas({
    width,
    height,
    focusX,
    edges,
    children,
    overlay,
    legend = true,
    pan = false,
    className,
}: {
    width: number;
    height: number;
    focusX: number;
    edges: CanvasEdge[];
    children: ReactNode;
    overlay?: ReactNode;
    legend?: boolean;
    pan?: boolean;
    className?: string;
}) {
    const t = useTranslations("web");
    const ids = useId().replace(/:/g, "");
    const { box, view, handlers, zoomIn, zoomOut, fitAll, toWorld, freeze } = useCanvas(
        width,
        height,
        focusX,
        pan,
    );
    const [reduced, setReduced] = useState(false);
    useEffect(() => setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
    return (
        <div
            ref={box}
            {...handlers}
            className={cn(
                "relative cursor-grab touch-none overflow-hidden rounded-2xl border bg-[radial-gradient(color-mix(in_oklch,var(--muted-foreground)_35%,transparent)_1px,transparent_1px)] [background-size:18px_18px] select-none active:cursor-grabbing",
                className,
            )}
        >
            <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                    width,
                    height,
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
                }}
            >
                <svg
                    aria-hidden
                    className="absolute inset-0 overflow-visible"
                    width={width}
                    height={height}
                >
                    <defs>
                        {(Object.keys(EDGE) as EdgeKind[]).map((kind) => (
                            <marker
                                key={kind}
                                id={`${ids}-${kind}`}
                                viewBox="0 0 10 10"
                                refX="9"
                                refY="5"
                                markerWidth="7"
                                markerHeight="7"
                                orient="auto-start-reverse"
                            >
                                <path
                                    d="M 0 0 L 10 5 L 0 10 z"
                                    style={{ fill: EDGE[kind].stroke }}
                                />
                            </marker>
                        ))}
                    </defs>
                    {edges.map((edge) => {
                        const style = EDGE[edge.kind];
                        return (
                            <path
                                key={edge.id}
                                d={edge.d}
                                fill="none"
                                style={{ stroke: style.stroke }}
                                strokeWidth={style.width}
                                strokeDasharray={style.dash}
                                strokeLinecap="round"
                                opacity={edge.dim ? 0.3 : 1}
                                markerEnd={`url(#${ids}-${edge.kind})`}
                            >
                                {edge.kind === "running" && !reduced ? (
                                    <animate
                                        attributeName="stroke-dashoffset"
                                        from="22"
                                        to="0"
                                        dur="0.9s"
                                        repeatCount="indefinite"
                                    />
                                ) : null}
                            </path>
                        );
                    })}
                </svg>
                <CanvasTools.Provider value={{ toWorld, freeze }}>{children}</CanvasTools.Provider>
            </div>
            <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
                {(
                    [
                        [t("flow.zoomIn"), zoomIn, <PlusIcon key="in" />],
                        [t("flow.zoomOut"), zoomOut, <MinusIcon key="out" />],
                        [t("flow.fit"), fitAll, <MaximizeIcon key="fit" />],
                    ] as const
                ).map(([label, action, icon]) => (
                    <Hint key={label} label={label}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={label}
                            onClick={action}
                            className="rounded-none border-b last:border-b-0"
                        >
                            {icon}
                        </Button>
                    </Hint>
                ))}
            </div>
            {legend ? (
                <ul className="pointer-events-none absolute right-3 bottom-3 hidden flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm sm:flex">
                    {(
                        [
                            [t("flow.legend.done"), EDGE.done],
                            [t("flow.legend.running"), EDGE.running],
                            [t("flow.legend.pending"), EDGE.pending],
                            [t("flow.legend.error"), EDGE.error],
                        ] as const
                    ).map(([label, style]) => (
                        <li key={label} className="inline-flex items-center gap-1.5">
                            <svg aria-hidden width="18" height="6">
                                <line
                                    x1="1"
                                    y1="3"
                                    x2="17"
                                    y2="3"
                                    style={{ stroke: style.stroke }}
                                    strokeWidth={style.width}
                                    strokeDasharray={style.dash}
                                />
                            </svg>
                            {label}
                        </li>
                    ))}
                </ul>
            ) : null}
            {overlay}
        </div>
    );
}

export function SidePanel({
    title,
    subtitle,
    onClose,
    side = "right",
    children,
}: {
    title: string;
    subtitle?: ReactNode;
    onClose: () => void;
    side?: "left" | "right";
    children: ReactNode;
}) {
    const t = useTranslations("web");
    return (
        <aside
            role="dialog"
            aria-label={title}
            className={cn(
                "absolute inset-y-0 z-10 flex w-full cursor-default flex-col bg-card shadow-xl sm:w-96",
                side === "left" ? "left-0 border-r sm:w-80" : "right-0 border-l",
            )}
        >
            <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
                <div className="min-w-0">
                    <h2 className="truncate font-semibold">{title}</h2>
                    {subtitle ? (
                        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
                    ) : null}
                </div>
                <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("flow.closePanel")}
                    onClick={onClose}
                >
                    <XIcon />
                </Button>
            </div>
            <div className="scroll-fade flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {children}
            </div>
        </aside>
    );
}
