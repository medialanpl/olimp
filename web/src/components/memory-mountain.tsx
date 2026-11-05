import ForceGraph3D, { type ForceGraph3DInstance } from "3d-force-graph";
import { ScanIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { mountainLayout, type Peak, type PeakKind } from "@/lib/mountain";
import type { MemoryGraph } from "@/lib/types";
import { cn, themeColor } from "@/lib/utils";

type Link = { source: string | Peak; target: string | Peak; ring: boolean };
type Controls = {
    autoRotate: boolean;
    autoRotateSpeed: number;
    target: { x: number; y: number; z: number };
    addEventListener(type: string, listener: () => void): void;
};
type Palette = Record<PeakKind | "active" | "link" | "hot" | "contour" | "pulse", string>;
type Point = { x: number; y: number; z: number };

const SIZE: Record<PeakKind, number> = { summit: 14, hub: 6, page: 2.5, note: 0.5, scree: 0.3 };
const ACTIVE_SIZE = 5;
const IDLE_ROTATE_AFTER_MS = 15_000;
const FLIGHT_MS = 1400;
const ZOOM_MS = 300;
const ZOOM_STEP = 1.4;
// How far the camera stays from an open node: a hub keeps the pages it links in the frame.
const VIEW: Partial<Record<PeakKind, number>> = { summit: 360, hub: 300, page: 200 };
const PULSE_EVERY_MS = 140;

// Where each project's camera was, so the mountain comes back as it was left.
const views = new Map<string, { at: Point; look: Point }>();

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const endId = (end: string | Peak) => (typeof end === "object" ? end.id : end);

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The memory as a mountain in 3D: the project on top, hubs, pages and at the foot the notes they
// rest on. The links draw its shape, it turns slowly, pulses climb from the notes to the top, and
// the open page is its one ochre node, as the active segment of the OLIMP mark. Search hits keep
// their names on screen while the rest dims, as in Jarvis.
export default function MemoryMountain({
    repo,
    graph,
    selected,
    found,
    label,
    className,
}: {
    repo: string;
    graph: MemoryGraph;
    selected: string | null;
    // Slugs of the search hits; null when nothing is searched.
    found: string[] | null;
    label: string;
    className?: string;
}) {
    const box = useRef<HTMLDivElement>(null);
    const names = useRef<HTMLDivElement>(null);
    const scene = useRef<{
        fg: ForceGraph3DInstance<Peak, Link>;
        color: Palette;
        flyTo: (id: string, ms?: number) => void;
        zoom: (factor: number) => void;
        fit: (ms?: number) => void;
    } | null>(null);
    const t = useTranslations("web");
    const active = useRef<string | null>(null);
    const hits = useRef<Set<string> | null>(null);
    const navigate = useNavigate();
    // navigate changes with every address; the scene reads it here instead of being built again.
    const go = useRef(navigate);
    go.current = navigate;
    active.current = selected && `page:${selected}`;
    hits.current = found && new Set(found.map((slug) => `page:${slug}`));

    useEffect(() => {
        const el = box.current;
        const layer = names.current;
        if (!el || !layer) return;
        const layout = mountainLayout(graph);
        let color = palette(el);
        // The library adds its own fields to nodes and links, so it gets copies; fx/fy/fz pin them.
        const nodes = layout.nodes.map((n) => ({ ...n, fx: n.x, fy: n.y, fz: n.z }));
        const fg = (
            new ForceGraph3D(el, { controlType: "orbit" }) as unknown as ForceGraph3DInstance<
                Peak,
                Link
            >
        )
            .backgroundColor("rgba(0,0,0,0)")
            .showNavInfo(false)
            .width(el.clientWidth)
            .height(el.clientHeight)
            .nodeRelSize(3)
            .nodeOpacity(0.95)
            .nodeResolution(16)
            .nodeLabel((n) => (n.label ? escapeHtml(n.label) : ""))
            .linkOpacity(1)
            .linkDirectionalParticleWidth(1.4)
            .linkDirectionalParticleSpeed(0.01)
            .linkDirectionalParticleColor(() => color.pulse)
            .cooldownTicks(0)
            // Nodes are pinned to the mountain; dragging one also threw in the library's controls.
            .enableNodeDrag(false)
            .onNodeHover((n) => {
                el.style.cursor = n?.id.startsWith("page:") ? "pointer" : "";
            })
            .onNodeClick((n) => {
                if (n.id.startsWith("page:"))
                    go.current(`/project/${repo}/memory/${n.id.slice("page:".length)}`);
            })
            .graphData({
                nodes,
                links: [
                    ...layout.links.map((l) => ({ ...l, ring: false })),
                    ...layout.rings.map((l) => ({ ...l, ring: true })),
                ],
            });
        const still = reducedMotion();
        const controls = fg.controls() as unknown as Controls;
        controls.autoRotate = !still;
        controls.autoRotateSpeed = 0.6;
        let idle: ReturnType<typeof setTimeout> | undefined;
        let flight = 0;
        const pause = () => {
            controls.autoRotate = false;
            clearTimeout(idle);
            idle = setTimeout(() => {
                controls.autoRotate = !reducedMotion();
            }, IDLE_ROTATE_AFTER_MS);
        };
        controls.addEventListener("start", () => {
            cancelAnimationFrame(flight);
            pause();
        });
        // Around the mountain's axis rather than straight: the library's own tween cut through the
        // mountain on the way to its far side.
        const fly = (to: Point, look: Point, ms: number) => {
            cancelAnimationFrame(flight);
            if (!ms || reducedMotion()) return void fg.cameraPosition(to, look);
            pause();
            const from = fg.cameraPosition();
            const seen = { ...controls.target };
            const a0 = Math.atan2(from.x, from.z);
            const r0 = Math.hypot(from.x, from.z);
            const r1 = Math.hypot(to.x, to.z);
            let a1 = Math.atan2(to.x, to.z);
            if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
            else if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
            const start = performance.now();
            const step = (now: number) => {
                const k = Math.min(1, (now - start) / ms);
                const e = k < 0.5 ? 4 * k ** 3 : 1 - (2 - 2 * k) ** 3 / 2;
                const a = a0 + (a1 - a0) * e;
                const r = r0 + (r1 - r0) * e;
                const mix = (p: number, q: number) => p + (q - p) * e;
                fg.cameraPosition(
                    { x: r * Math.sin(a), y: mix(from.y, to.y), z: r * Math.cos(a) },
                    { x: mix(seen.x, look.x), y: mix(seen.y, look.y), z: mix(seen.z, look.z) },
                );
                if (k < 1) flight = requestAnimationFrame(step);
            };
            flight = requestAnimationFrame(step);
        };
        // From the front and a little above, as close as the whole mountain allows in this frame;
        // the library's zoomToFit missed with pinned nodes and no simulation ticks.
        const camera = fg.camera() as unknown as { fov: number };
        const target = { x: 0, y: -layout.height * 0.15, z: 0 };
        const fit = (ms = 0) => {
            const half = Math.tan((camera.fov * Math.PI) / 360);
            const aspect = el.clientWidth / Math.max(el.clientHeight, 1);
            // Seen from above, the near side of the foot ring drops below the foot itself.
            const tall = (layout.height + layout.radius * 0.7 + 120) / 2 / half;
            const wide = (layout.radius * 2.7 + 60) / 2 / (half * aspect);
            const distance = Math.max(tall, wide);
            fly({ x: 0, y: distance * 0.3, z: distance }, target, ms);
        };
        const saved = views.get(repo);
        if (saved) fly(saved.at, saved.look, 0);
        else fit();
        // Out from the axis on the node's side and a little above it, looking at it, as Jarvis's
        // camera flies to a note; a node on the axis is seen from where the camera already is.
        const flyTo = (id: string, ms = FLIGHT_MS) => {
            const node = nodes.find((n) => n.id === id);
            if (!node) return;
            const at = fg.cameraPosition();
            const side =
                Math.hypot(node.x, node.z) > 1
                    ? Math.atan2(node.x, node.z)
                    : Math.atan2(at.x, at.z);
            const away = VIEW[node.kind] ?? VIEW.page ?? 0;
            const to = {
                x: node.x + away * Math.sin(side),
                y: node.y + away * 0.35,
                z: node.z + away * Math.cos(side),
            };
            fly(to, { x: node.x, y: node.y, z: node.z }, ms);
        };
        // Towards the point the camera orbits, or away from it.
        const zoom = (factor: number) => {
            const at = fg.cameraPosition();
            const { x, y, z } = controls.target;
            const to = {
                x: x + (at.x - x) * factor,
                y: y + (at.y - y) * factor,
                z: z + (at.z - z) * factor,
            };
            fly(to, { x, y, z }, ZOOM_MS);
        };
        scene.current = { fg, color, flyTo, zoom, fit };
        paint(fg, color, active.current, hits.current);
        const pulses = still
            ? undefined
            : setInterval(() => {
                  const links = fg.graphData().links.filter((l) => !l.ring);
                  const next = links[Math.floor(Math.random() * links.length)];
                  if (next) fg.emitParticle(next);
              }, PULSE_EVERY_MS);

        // The summit, the hubs and the open page keep their names on screen; the rest on hover.
        const named = nodes.filter((n) => n.kind === "summit" || n.kind === "hub");
        const tag = (kind: PeakKind) => {
            const div = document.createElement("div");
            div.className = cn(
                "absolute top-0 left-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-foreground",
                kind === "summit" ? "text-sm font-semibold" : "text-xs font-medium",
                kind === "page" && "border bg-background/80 shadow-whisper backdrop-blur",
            );
            layer.append(div);
            return div;
        };
        const tags = named.map((n) => {
            const div = tag(n.kind);
            div.textContent = n.label;
            return div;
        });
        const pages = nodes.filter((n) => n.kind === "page");
        const pageTags = pages.map((n) => {
            const div = tag("hub");
            div.textContent = n.label;
            return div;
        });
        const open = tag("page");
        let frame = 0;
        const place = () => {
            named.forEach((n, i) => {
                const { x, y } = fg.graph2ScreenCoords(n.x, n.y, n.z);
                const div = tags[i];
                if (!div) return;
                // The open hub is named once, by the open page's tag below it.
                div.hidden = n.id === active.current;
                div.style.transform = `translate(${x}px, ${y - 30}px) translateX(-50%)`;
            });
            pages.forEach((n, i) => {
                const div = pageTags[i];
                if (!div) return;
                div.hidden = !hits.current?.has(n.id) || n.id === active.current;
                if (div.hidden) return;
                const { x, y } = fg.graph2ScreenCoords(n.x, n.y, n.z);
                div.style.transform = `translate(${x}px, ${y - 24}px) translateX(-50%)`;
            });
            const page = nodes.find((n) => n.id === active.current);
            open.hidden = !page;
            if (page) {
                const { x, y } = fg.graph2ScreenCoords(page.x, page.y, page.z);
                open.textContent = page.label;
                open.style.transform = `translate(${x}px, ${y + 12}px) translateX(-50%)`;
            }
            frame = requestAnimationFrame(place);
        };
        frame = requestAnimationFrame(place);
        // A theme switch while the page is open repaints the mountain in the new colours.
        const theme = new MutationObserver(() => {
            color = palette(el);
            scene.current = { fg, color, flyTo, zoom, fit };
            paint(fg, color, active.current, hits.current);
        });
        theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        // Its first call, once the box has its size, flies to the open page from where the camera
        // was left (or from the whole mountain); later ones keep the open page in the frame.
        let sized = false;
        const resize = new ResizeObserver(() => {
            fg.width(el.clientWidth).height(el.clientHeight);
            if (sized ? !active.current : !saved) fit();
            if (active.current) flyTo(active.current, sized ? 0 : FLIGHT_MS);
            sized = true;
        });
        resize.observe(el);
        return () => {
            resize.disconnect();
            theme.disconnect();
            cancelAnimationFrame(frame);
            clearInterval(pulses);
            cancelAnimationFrame(flight);
            clearTimeout(idle);
            const at = fg.cameraPosition();
            views.set(repo, { at: { x: at.x, y: at.y, z: at.z }, look: { ...controls.target } });
            scene.current = null;
            fg._destructor();
            layer.replaceChildren();
        };
    }, [graph, repo]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: the refs follow `selected` and `found`, read here.
    useEffect(() => {
        if (scene.current)
            paint(scene.current.fg, scene.current.color, active.current, hits.current);
    }, [selected, found]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: the ref follows `selected`, read here.
    useEffect(() => {
        if (active.current) scene.current?.flyTo(active.current);
    }, [selected]);

    return (
        <div className={cn("relative", className)}>
            <div ref={box} role="img" aria-label={label} className="absolute inset-0" />
            <div ref={names} className="pointer-events-none absolute inset-0 overflow-hidden" />
            <div className="absolute right-3 bottom-3 flex flex-col gap-1">
                {(
                    [
                        [t("memory.zoomIn"), ZoomInIcon, () => scene.current?.zoom(1 / ZOOM_STEP)],
                        [t("memory.zoomOut"), ZoomOutIcon, () => scene.current?.zoom(ZOOM_STEP)],
                        [t("memory.zoomFit"), ScanIcon, () => scene.current?.fit(FLIGHT_MS)],
                    ] as const
                ).map(([name, Icon, onClick]) => (
                    <Tooltip key={name}>
                        <TooltipTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label={name}
                                onClick={onClick}
                                className="bg-background/80 text-muted-foreground backdrop-blur hover:text-foreground"
                            >
                                <Icon />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="left">{name}</TooltipContent>
                    </Tooltip>
                ))}
            </div>
        </div>
    );
}

const palette = (el: HTMLElement): Palette => ({
    summit: themeColor(el, "--foreground"),
    hub: themeColor(el, "--foreground", 0.9),
    page: themeColor(el, "--foreground", 0.65),
    note: themeColor(el, "--muted-foreground"),
    scree: themeColor(el, "--muted-foreground", 0.35),
    active: themeColor(el, "--brand"),
    link: themeColor(el, "--muted-foreground", 0.32),
    hot: themeColor(el, "--brand", 0.7),
    contour: themeColor(el, "--muted-foreground", 0.14),
    pulse: themeColor(el, "--foreground", 0.8),
});

// The open page and the links that reach it take the ochre; the rest stays grey. During a search
// the hits stand out and the rest drops to a third of its size, except the summit.
function paint(
    fg: ForceGraph3DInstance<Peak, Link>,
    color: Palette,
    active: string | null,
    hits: Set<string> | null,
) {
    const dim = (n: Peak) => !!hits && n.kind !== "summit" && n.id !== active && !hits.has(n.id);
    fg.nodeColor((n) =>
        n.id === active
            ? color.active
            : hits?.has(n.id)
              ? color.summit
              : dim(n)
                ? color.contour
                : color[n.kind],
    )
        .nodeVal((n) =>
            n.id === active
                ? ACTIVE_SIZE
                : hits?.has(n.id)
                  ? SIZE.hub
                  : SIZE[n.kind] / (dim(n) ? 3 : 1),
        )
        .linkColor((l) =>
            l.ring
                ? color.contour
                : active && (endId(l.source) === active || endId(l.target) === active)
                  ? color.hot
                  : hits
                    ? color.contour
                    : color.link,
        );
}
