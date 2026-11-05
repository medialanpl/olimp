import { cn } from "@/lib/utils";
import horizontal from "../../../docs/brand/olimp-horizontal.svg";
import horizontalReversed from "../../../docs/brand/olimp-horizontal-reversed.svg";

const RING =
    "M162.57 29.91A104 104 0 1 1 93.43 29.91L103.84 68.74A64 64 0 0 0 66.45 145.55L128 84L189.55 145.55A64 64 0 0 0 152.16 68.74Z";
const ACTIVE = "M108.89 25.77A104 104 0 0 1 147.11 25.77L136.71 64.60A64 64 0 0 0 119.29 64.60Z";
const ANGLES = Array.from({ length: 12 }, (_, i) => i * 30);
const SEGMENT = "M105.94 26.37A104 104 0 0 1 150.06 26.37L141.76 57.33A72 72 0 0 0 114.24 57.33Z";
const PEAK = "M67.31 140.69L128 80L188.69 140.69A62 62 0 0 1 67.31 140.69Z";

// The medium cut of the mark (docs/brand/olimp-symbol-medium.svg): the ring in the text colour,
// so it follows the theme, and the one ochre segment.
export function OlimpMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 256 256" aria-hidden="true" className={cn("size-7", className)}>
            <path fill="currentColor" d={RING} />
            <path className="fill-brand" d={ACTIVE} />
        </svg>
    );
}

// docs/brand/olimp-loader.svg: the ochre segment steps around twelve grey ones.
export function OlimpLoader({ className, label }: { className?: string; label: string }) {
    return (
        <svg
            viewBox="0 0 256 256"
            role="img"
            aria-label={label}
            className={cn("size-10", className)}
        >
            <g className="fill-muted-foreground/40">
                {ANGLES.map((angle) => (
                    <path
                        key={angle}
                        d={SEGMENT}
                        transform={angle ? `rotate(${angle} 128 128)` : undefined}
                    />
                ))}
                <path d={PEAK} />
            </g>
            <path className="olimp-orbit fill-brand" d={SEGMENT} />
        </svg>
    );
}

// The horizontal lockup from docs/brand; the reversed file on dark, since its geometry differs.
export function OlimpLogo({ className }: { className?: string }) {
    return (
        <>
            <img src={horizontal} alt="OLIMP" className={cn("w-auto dark:hidden", className)} />
            <img
                src={horizontalReversed}
                alt="OLIMP"
                className={cn("hidden w-auto dark:block", className)}
            />
        </>
    );
}
