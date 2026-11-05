import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";

// Where `pnpm build` puts the panel.
export const WEB_DIR = join(import.meta.dirname, "..", "web", "dist");

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json",
};

// The panel talks only to its own origin, images aside: GitHub serves the owners' avatars.
// Styles are inline in places (Radix positions popovers). It frames only the Preview's proxies.
const SECURITY = {
    "content-security-policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self'; object-src 'none'; " +
        "frame-src http://localhost:* http://127.0.0.1:*; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
};

export const isApiPath = (path: string) =>
    path === "/health" || path === "/api" || path.startsWith("/api/");

export const panelBuilt = (dir: string) => existsSync(join(dir, "index.html"));

async function file(dir: string, path: string): Promise<string | null> {
    let decoded: string;
    try {
        decoded = decodeURIComponent(path);
    } catch {
        return null;
    }
    if (decoded.includes("\0")) return null;
    const full = normalize(join(dir, decoded));
    if (full !== dir && !full.startsWith(`${dir}${sep}`)) return null;
    try {
        return (await stat(full)).isFile() ? full : null;
    } catch {
        return null;
    }
}

// A file of the build, or index.html for a panel route (a path whose last segment has no dot).
// Vite puts hashed files under assets/, so they never change; index.html is never cached.
// Returns false when nothing matches: the caller answers 404.
export async function servePanel(dir: string, path: string, res: ServerResponse): Promise<boolean> {
    const found = path === "/" ? null : await file(dir, path);
    const last = path.split("/").at(-1) ?? "";
    const target = found ?? (last.includes(".") ? null : join(dir, "index.html"));
    if (!target) return false;
    const body = await readFile(target);
    const cache = target.startsWith(`${join(dir, "assets")}${sep}`)
        ? "public, max-age=31536000, immutable"
        : target === join(dir, "index.html")
          ? "no-store"
          : "no-cache";
    res.writeHead(200, {
        "content-type": TYPES[extname(target)] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": cache,
        ...SECURITY,
    });
    res.end(body);
    return true;
}
