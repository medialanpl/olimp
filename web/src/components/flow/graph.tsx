import {
    BotIcon,
    CircleDotIcon,
    FlagIcon,
    GitBranchPlusIcon,
    GitCommitHorizontalIcon,
    GitCompareArrowsIcon,
    GitForkIcon,
    GitMergeIcon,
    GitPullRequestArrowIcon,
    GitPullRequestDraftIcon,
    HandIcon,
    ListChecksIcon,
    type LucideIcon,
    MessageCircleQuestionIcon,
    MessageSquareTextIcon,
    PlayIcon,
    PlusIcon,
    RepeatIcon,
    SplitIcon,
    SquareStackIcon,
    TimerIcon,
    UploadIcon,
    WebhookIcon,
    WorkflowIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import {
    Canvas,
    type CanvasEdge,
    curvePath,
    detourPath,
    type EdgeKind,
    useCanvasTools,
} from "@/components/flow/canvas";
import {
    isFailurePort,
    labelOf,
    layoutOf,
    NODE_CATALOG,
    nodeKey,
    portsOf,
    splitFrom,
} from "@/lib/flow";
import type { Category, Definition, Edge, GraphNode, NodeType, Point } from "@/lib/types";
import { cn } from "@/lib/utils";

const NODE_W = 272;
const NODE_H = 76;
const PORT_ROW = 22;
const TERM = 56;
const PAD = 48;

export const NODE_ICON: Record<NodeType, LucideIcon> = {
    start: PlayIcon,
    end: FlagIcon,
    loop: RepeatIcon,
    agent: BotIcon,
    check: ListChecksIcon,
    "gate.human": HandIcon,
    "ask-user": MessageCircleQuestionIcon,
    dispatch: SquareStackIcon,
    fork: GitForkIcon,
    join: GitMergeIcon,
    workflow: WorkflowIcon,
    if: SplitIcon,
    "git.commit": GitCommitHorizontalIcon,
    "git.push": UploadIcon,
    "git.sync-base": GitCompareArrowsIcon,
    "github.draft-pr": GitPullRequestDraftIcon,
    "github.pr-update": GitPullRequestArrowIcon,
    "github.pr-comment": MessageSquareTextIcon,
    "github.issue-comment": CircleDotIcon,
    "github.wait-ci": TimerIcon,
    "notify.webhook": WebhookIcon,
};

export const KNOWN_PORTS = new Set([
    "next",
    "done",
    "failed",
    "pass",
    "fail",
    "repeat",
    "exhausted",
    "approve",
    "reject",
    "answered",
    "timeout",
    "created",
    "green",
    "red",
    "nothing",
    "conflict",
    "true",
    "false",
]);

// Tailwind finds only whole class names, so every tone is spelled out.
export const CATEGORY_TONE: Record<Category, { tile: string; card: string; bar: string }> = {
    agents: {
        tile: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
        card: "border-violet-500/40",
        bar: "bg-violet-500",
    },
    flow: {
        tile: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
        card: "border-blue-500/40",
        bar: "bg-blue-500",
    },
    scripts: {
        tile: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
        card: "border-teal-500/40",
        bar: "bg-teal-500",
    },
    git: {
        tile: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
        card: "border-orange-500/40",
        bar: "bg-orange-500",
    },
};

export const toneOf = (type: NodeType) => CATEGORY_TONE[NODE_CATALOG[type].category];

const OK_PORTS = new Set(["done", "pass", "approve", "green", "created", "true", "answered"]);

export function usePortLabel() {
    const t = useTranslations("web");
    return (port: string) => (KNOWN_PORTS.has(port) ? t(`flow.port.${port as "next"}`) : port);
}

export function useNodeTitle() {
    const t = useTranslations("web");
    return (type: NodeType) => t(`flow.node.${nodeKey(type)}.label`);
}

export const portTone = (port: string) =>
    isFailurePort(port)
        ? { text: "text-destructive", dot: "bg-destructive" }
        : OK_PORTS.has(port)
          ? { text: "text-constructive", dot: "bg-constructive" }
          : { text: "text-muted-foreground", dot: "bg-muted-foreground" };

const terminal = (node: GraphNode) => node.type === "start" || node.type === "end";

function boxOf(node: GraphNode) {
    if (terminal(node)) return { w: TERM, h: TERM };
    return { w: NODE_W, h: Math.max(NODE_H, portsOf(node).length * PORT_ROW + 24) };
}

const portY = (i: number, n: number, h: number) => h / 2 + (i - (n - 1) / 2) * PORT_ROW;

function portPoint(pos: Point, node: GraphNode, port: string): Point {
    const { w, h } = boxOf(node);
    const ports = portsOf(node);
    return { x: pos.x + w, y: pos.y + portY(Math.max(0, ports.indexOf(port)), ports.length, h) };
}

const inputPoint = (pos: Point, node: GraphNode): Point => ({
    x: pos.x,
    y: pos.y + boxOf(node).h / 2,
});

const edgePath = (a: Point, b: Point) =>
    b.x > a.x + 24 ? curvePath(a, b) : detourPath(a, b, Math.max(a.y, b.y) + 110);

export interface NodeView {
    status?: ReactNode;
    below?: ReactNode;
    tone?: string;
    dim?: boolean;
    // Ports a run left the node by; the others are dimmed. None: all look active.
    taken?: Set<string>;
    // A problem the editor found on the node.
    problem?: boolean;
}

export interface GraphEditing {
    onMove: (id: string, at: Point) => void;
    // `to` null: a drop on the background disconnects the port.
    onConnect: (node: string, port: string, to: string | null) => void;
    onAddFromPort: (node: string, port: string) => void;
}

function useDrag(onMove: (dx: number, dy: number) => void, onClick: () => void) {
    const tools = useCanvasTools();
    const start = useRef<{ p: Point; moved: boolean } | null>(null);
    return {
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
            if (!tools || e.button !== 0) return;
            start.current = { p: tools.toWorld(e.clientX, e.clientY), moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
            const s = start.current;
            if (!s || !tools) return;
            const p = tools.toWorld(e.clientX, e.clientY);
            if (!s.moved && Math.hypot(p.x - s.p.x, p.y - s.p.y) < 4) return;
            if (!s.moved) tools.freeze();
            s.moved = true;
            onMove(p.x - s.p.x, p.y - s.p.y);
        },
        onPointerUp: () => {
            const s = start.current;
            start.current = null;
            if (s && !s.moved) onClick();
        },
    };
}

function PortHandle({
    node,
    port,
    point,
    wired,
    edit,
    onDrag,
    onDrop,
    onAdd,
}: {
    node: string;
    port: string;
    point: Point;
    wired: boolean;
    edit: boolean;
    onDrag: (p: Point | null) => void;
    onDrop: (p: Point) => void;
    onAdd: () => void;
}) {
    const t = useTranslations("web");
    const portLabel = usePortLabel();
    const tools = useCanvasTools();
    const tone = portTone(port);
    if (!edit)
        return (
            <span
                aria-hidden
                className={cn(
                    "absolute size-3 -translate-1/2 rounded-full ring-2 ring-card",
                    tone.dot,
                )}
                style={{ left: point.x, top: point.y }}
            />
        );
    return (
        <>
            <button
                type="button"
                aria-label={t("flow.connectPort", { port: portLabel(port), node })}
                className={cn(
                    "absolute size-3.5 -translate-1/2 cursor-crosshair rounded-full ring-2 ring-card outline-none transition-transform hover:scale-125 focus-visible:ring-ring",
                    tone.dot,
                )}
                style={{ left: point.x, top: point.y }}
                onPointerDown={(e) => {
                    if (!tools) return;
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    tools.freeze();
                    onDrag(tools.toWorld(e.clientX, e.clientY));
                }}
                onPointerMove={(e) => {
                    if (tools && e.currentTarget.hasPointerCapture(e.pointerId))
                        onDrag(tools.toWorld(e.clientX, e.clientY));
                }}
                onPointerUp={(e) => {
                    if (!tools) return;
                    onDrop(tools.toWorld(e.clientX, e.clientY));
                    onDrag(null);
                }}
            />
            {wired ? null : (
                <button
                    type="button"
                    aria-label={t("flow.addFromPort", { port: portLabel(port) })}
                    onClick={onAdd}
                    className="absolute flex size-5 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-sm outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    style={{ left: point.x + 14, top: point.y }}
                >
                    <PlusIcon className="size-3" />
                </button>
            )}
        </>
    );
}

function NodeBox({
    node,
    pos,
    view,
    selected,
    edit,
    wiredPorts,
    onSelect,
    onMove,
    onDragEdge,
    onDropEdge,
    onAddFromPort,
}: {
    node: GraphNode;
    pos: Point;
    view: NodeView;
    selected: boolean;
    edit: boolean;
    wiredPorts: Set<string>;
    onSelect: () => void;
    onMove: (at: Point) => void;
    onDragEdge: (port: string, p: Point | null) => void;
    onDropEdge: (port: string, p: Point) => void;
    onAddFromPort: (port: string) => void;
}) {
    const nodeTitle = useNodeTitle();
    const portLabel = usePortLabel();
    const { w, h } = boxOf(node);
    const origin = useRef(pos);
    const drag = useDrag(
        (dx, dy) =>
            onMove({
                x: Math.max(0, Math.round(origin.current.x + dx)),
                y: Math.max(0, Math.round(origin.current.y + dy)),
            }),
        onSelect,
    );
    const handlers = edit
        ? {
              ...drag,
              onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
                  origin.current = pos;
                  drag.onPointerDown(e);
              },
          }
        : { onClick: onSelect };
    const Icon = node.type === "agent" && node.skill ? GitBranchPlusIcon : NODE_ICON[node.type];
    const ports = portsOf(node);
    const kind = nodeTitle(node.type);
    const ring = cn(
        selected && "ring-2 ring-ring",
        view.problem && !selected && "ring-2 ring-warning/60",
        view.dim && "opacity-35",
    );
    return (
        <>
            {terminal(node) ? (
                <div
                    className="absolute flex flex-col items-center gap-1"
                    style={{ left: pos.x, top: pos.y, width: TERM }}
                >
                    <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${labelOf(node)}: ${kind}`}
                        {...handlers}
                        className={cn(
                            "relative flex size-14 touch-none items-center justify-center rounded-2xl border bg-card shadow-sm outline-none transition-[background-color,box-shadow,opacity] hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/60 [&_svg]:size-5",
                            node.type === "start"
                                ? "text-info"
                                : node.status === "failed"
                                  ? "text-destructive"
                                  : "text-constructive",
                            view.tone,
                            ring,
                        )}
                    >
                        <Icon />
                        {node.type === "end" ? (
                            <span
                                aria-hidden
                                className="absolute top-1/2 -left-1 h-4 w-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/70"
                            />
                        ) : null}
                    </button>
                    <span className="mt-1 max-w-40 truncate text-center text-xs font-medium">
                        {labelOf(node)}
                    </span>
                    {view.status ? (
                        <span className="w-40 text-center text-[11px] leading-tight text-muted-foreground">
                            {view.status}
                        </span>
                    ) : null}
                </div>
            ) : (
                <button
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${labelOf(node)}: ${kind}`}
                    {...handlers}
                    className={cn(
                        "absolute touch-none overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-[background-color,box-shadow,opacity] outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/60",
                        toneOf(node.type).card,
                        view.tone,
                        ring,
                    )}
                    style={{ left: pos.x, top: pos.y, width: w, height: h }}
                >
                    <span
                        aria-hidden
                        className={cn("absolute inset-x-0 top-0 h-1", toneOf(node.type).bar)}
                    />
                    <span
                        aria-hidden
                        className="absolute top-1/2 -left-1 h-4 w-1.5 -translate-y-1/2 rounded-full bg-muted-foreground/70"
                    />
                    <span className="flex h-full items-center gap-3 pr-20 pl-3">
                        <span
                            className={cn(
                                "flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4",
                                toneOf(node.type).tile,
                            )}
                        >
                            <Icon />
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                                {labelOf(node)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                                {kind}
                            </span>
                            {view.status ? (
                                <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
                                    {view.status}
                                </span>
                            ) : null}
                        </span>
                    </span>
                    {ports.map((port, i) => (
                        <span
                            key={port}
                            aria-hidden
                            className={cn(
                                "absolute right-4 max-w-16 -translate-y-1/2 truncate text-[11px] font-medium",
                                portTone(port).text,
                                view.taken && !view.taken.has(port) && "opacity-40",
                            )}
                            style={{ top: portY(i, ports.length, h) }}
                        >
                            {portLabel(port)}
                        </span>
                    ))}
                </button>
            )}
            {ports.map((port) => (
                <PortHandle
                    key={port}
                    node={node.id}
                    port={port}
                    point={portPoint(pos, node, port)}
                    wired={wiredPorts.has(port)}
                    edit={edit}
                    onDrag={(p) => onDragEdge(port, p)}
                    onDrop={(p) => onDropEdge(port, p)}
                    onAdd={() => onAddFromPort(port)}
                />
            ))}
            {view.below && !terminal(node) ? (
                <span
                    aria-hidden
                    className={cn(
                        "absolute text-center font-mono text-[11px] text-muted-foreground tabular-nums",
                        view.dim && "opacity-35",
                    )}
                    style={{ left: pos.x, top: pos.y + h + 8, width: w }}
                >
                    {view.below}
                </span>
            ) : null}
        </>
    );
}

export function FlowGraph({
    definition,
    views,
    edgeKind,
    selected,
    onSelect,
    edit,
    overlay,
    legend = true,
    pan = false,
    className,
    focusId,
}: {
    definition: Definition;
    views?: (node: GraphNode) => NodeView;
    edgeKind: (edge: Edge) => { kind: EdgeKind; dim?: boolean };
    selected: string | null;
    onSelect: (id: string) => void;
    edit?: GraphEditing;
    overlay?: ReactNode;
    legend?: boolean;
    pan?: boolean;
    className?: string;
    focusId?: string | null;
}) {
    const positions = useMemo(() => layoutOf(definition), [definition]);
    const [connecting, setConnecting] = useState<{ node: string; port: string; to: Point } | null>(
        null,
    );
    const at = (id: string) => positions[id] ?? { x: 0, y: 0 };
    const width =
        Math.max(0, ...definition.nodes.map((n) => at(n.id).x + boxOf(n).w)) +
        PAD +
        (edit ? 40 : 0);
    const height = Math.max(0, ...definition.nodes.map((n) => at(n.id).y + boxOf(n).h + 40)) + PAD;
    const edges: CanvasEdge[] = definition.edges.flatMap((e) => {
        const { node, port } = splitFrom(e.from);
        const from = definition.nodes.find((n) => n.id === node);
        const to = definition.nodes.find((n) => n.id === e.to);
        if (!from || !to) return [];
        return [
            {
                id: e.from,
                d: edgePath(portPoint(at(from.id), from, port), inputPoint(at(to.id), to)),
                ...edgeKind(e),
            },
        ];
    });
    if (connecting) {
        const from = definition.nodes.find((n) => n.id === connecting.node);
        if (from)
            edges.push({
                id: "connecting",
                d: curvePath(portPoint(at(from.id), from, connecting.port), connecting.to),
                kind: "running",
            });
    }
    const hit = (p: Point) =>
        definition.nodes.find((n) => {
            const pos = at(n.id);
            const { w, h } = boxOf(n);
            return p.x >= pos.x && p.x <= pos.x + w && p.y >= pos.y && p.y <= pos.y + h;
        });
    const focus = focusId ? at(focusId).x + NODE_W / 2 : width / 2;
    return (
        <Canvas
            width={width}
            height={height}
            focusX={focus}
            edges={edges}
            legend={legend}
            pan={pan}
            className={className}
            overlay={overlay}
        >
            {definition.nodes.map((node) => (
                <NodeBox
                    key={node.id}
                    node={node}
                    pos={at(node.id)}
                    view={views?.(node) ?? {}}
                    selected={selected === node.id}
                    edit={!!edit}
                    wiredPorts={
                        new Set(
                            definition.edges
                                .map((e) => splitFrom(e.from))
                                .filter((f) => f.node === node.id)
                                .map((f) => f.port),
                        )
                    }
                    onSelect={() => onSelect(node.id)}
                    onMove={(p) => edit?.onMove(node.id, p)}
                    onDragEdge={(port, p) =>
                        setConnecting(p ? { node: node.id, port, to: p } : null)
                    }
                    onDropEdge={(port, p) => {
                        const target = hit(p);
                        if (target?.id === node.id) return;
                        edit?.onConnect(
                            node.id,
                            port,
                            target && target.type !== "start" ? target.id : null,
                        );
                    }}
                    onAddFromPort={(port) => edit?.onAddFromPort(node.id, port)}
                />
            ))}
        </Canvas>
    );
}
