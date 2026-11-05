import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// The API of `pnpm dev`; OLIMP_URL or OLIMP_PORT point the panel at another one, e.g. the service.
const api = process.env.OLIMP_URL ?? `http://127.0.0.1:${process.env.OLIMP_PORT ?? 4851}`;

// The API accepts only loopback hosts and its own origin: the dev server's origin is dropped, the
// host becomes the API's.
const proxy: ProxyOptions = {
    target: api,
    changeOrigin: true,
    configure: (server) => server.on("proxyReq", (req) => req.removeHeader("origin")),
};

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: { port: 5173, proxy: { "/api": proxy, "/health": proxy } },
    // One bundle of about 180 kB gzipped, cached as immutable: no code splitting needed yet.
    build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 800 },
});
