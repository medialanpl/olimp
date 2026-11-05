import { type ClassNameValue, twMerge } from "tailwind-merge";

// twMerge joins strings and arrays and skips falsy values itself, so no clsx.
export function cn(...inputs: ClassNameValue[]) {
    return twMerge(inputs);
}

// The theme's colours are oklch, which canvas renderers (three.js, xterm) cannot read; a canvas
// turns them into rgb.
export function themeColor(el: HTMLElement, variable: string, alpha = 1): string {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return `rgba(128, 128, 128, ${alpha})`;
    ctx.fillStyle = getComputedStyle(el).getPropertyValue(variable).trim() || "#888";
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
