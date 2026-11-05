import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatedIcon } from "@/components/motion/animated-icon";
import { cn } from "@/lib/utils";

type GlassDrift = "a" | "b" | "c";

const DEPTH_LAYER_COUNT = 14;
const DEPTH_STEP_PX = 0.85;

// The walls stay darker than the face in both themes: with light from above, a lighter top reads as a hole.
const DEPTH_RAMPS = {
    dark: { surface: 0.5, deep: 0.34 },
    light: { surface: 0.44, deep: 0.32 },
} as const;

function wallLightness(ramp: (typeof DEPTH_RAMPS)[keyof typeof DEPTH_RAMPS], progress: number) {
    return ramp.surface + (ramp.deep - ramp.surface) * Math.sqrt(progress);
}

// Both lightnesses travel as CSS variables and .empty-glass-depth picks one, so a theme switch needs no render.
const DEPTH_LAYERS = Array.from({ length: DEPTH_LAYER_COUNT }, (_, position) => {
    const depth = DEPTH_LAYER_COUNT - position;
    const progress = depth / DEPTH_LAYER_COUNT;
    return {
        depth,
        darkColor: `oklch(${wallLightness(DEPTH_RAMPS.dark, progress).toFixed(3)} 0.006 70)`,
        lightColor: `oklch(${wallLightness(DEPTH_RAMPS.light, progress).toFixed(3)} 0.01 72)`,
        transform: `translateZ(calc(var(--glass-depth-scale, 1) * ${(-depth * DEPTH_STEP_PX).toFixed(2)}px))`,
    };
});

export function GlassMedia({
    className,
    drift = "a",
    children,
    ...props
}: React.ComponentProps<"div"> & { drift?: GlassDrift }) {
    const ref = useRef<HTMLDivElement>(null);
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        const node = ref.current;
        if (!node || typeof IntersectionObserver === "undefined") {
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            const entry = entries.at(-1);
            if (entry) {
                setPaused(!entry.isIntersecting);
            }
        });
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            data-paused={paused}
            data-drift={drift}
            className={cn(
                "empty-glass mb-2 size-20 shrink-0 [&_svg:not([class*='size-'])]:size-9",
                className,
            )}
            {...props}
        >
            <svg aria-hidden="true" className="empty-glass-defs size-0" width="0" height="0">
                <defs>
                    <linearGradient
                        id="glass-mark"
                        gradientUnits="userSpaceOnUse"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="24"
                    >
                        <stop offset="0%" stopColor="oklch(1 0 0)" />
                        <stop offset="38%" stopColor="oklch(0.93 0.004 70)" />
                        <stop offset="64%" stopColor="oklch(0.69 0.01 72)" />
                        <stop offset="100%" stopColor="oklch(0.9 0.006 72)" />
                    </linearGradient>
                    <linearGradient
                        id="glass-mark-light"
                        gradientUnits="userSpaceOnUse"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="24"
                    >
                        <stop offset="0%" stopColor="oklch(0.78 0.01 72)" />
                        <stop offset="38%" stopColor="oklch(0.73 0.012 73)" />
                        <stop offset="64%" stopColor="oklch(0.56 0.014 75)" />
                        <stop offset="100%" stopColor="oklch(0.7 0.012 75)" />
                    </linearGradient>
                </defs>
            </svg>
            <span aria-hidden="true" className="empty-glass-glow" />
            <span aria-hidden="true" className="empty-glass-ring" />
            <span aria-hidden="true" className="empty-glass-face" />
            <span className="empty-glass-mark">
                {DEPTH_LAYERS.map((layer) => (
                    <span
                        key={layer.depth}
                        aria-hidden="true"
                        className="empty-glass-depth"
                        style={
                            {
                                "--glass-depth-light": layer.lightColor,
                                "--glass-depth-dark": layer.darkColor,
                                transform: layer.transform,
                            } as React.CSSProperties
                        }
                    >
                        {children}
                    </span>
                ))}
                <AnimatedIcon preset="orbit">{children}</AnimatedIcon>
            </span>
        </div>
    );
}
