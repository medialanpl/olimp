import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingHttpHeaders, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { openStore } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-web-"));
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const INDEX = "<!doctype html><title>OLIMP</title>";
const SCRIPT = "console.log('olimp');";

// A build as Vite leaves it: index.html, hashed files under assets/ and public files at the root.
function build(): string {
    const dir = mkdtempSync(join(root, "dist-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), INDEX);
    writeFileSync(join(dir, "assets", "index-B1x2c3d4.js"), SCRIPT);
    writeFileSync(join(dir, "assets", "index-D5e6f7g8.css"), "body{}");
    writeFileSync(join(dir, "favicon.svg"), "<svg/>");
    writeFileSync(join(root, "secret.txt"), "outside the build");
    return dir;
}

async function setup(webDir: string) {
    const home = mkdtempSync(join(root, "home-"));
    const store = await openStore(home);
    const server = createApi(store, { ...loadConfig({ OLIMP_HOME: home }), webDir });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const get = (
        path: string,
        headers: Record<string, string> = {},
    ): Promise<{ status: number; headers: IncomingHttpHeaders; text: string }> =>
        new Promise((resolve, reject) => {
            const req = request(
                {
                    host: "127.0.0.1",
                    port,
                    path,
                    headers: { host: `127.0.0.1:${port}`, ...headers },
                },
                (res) => {
                    let text = "";
                    res.on("data", (chunk) => {
                        text += chunk;
                    });
                    res.on("end", () =>
                        resolve({ status: res.statusCode ?? 0, headers: res.headers, text }),
                    );
                },
            );
            req.on("error", reject);
            req.end();
        });
    return { store, port, get };
}

test("the panel's index.html is served at / and never cached", async () => {
    const { get } = await setup(build());
    const index = await get("/");
    assert.equal(index.status, 200);
    assert.equal(index.text, INDEX);
    assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(index.headers["cache-control"], "no-store");
    const csp = String(index.headers["content-security-policy"]);
    assert.match(csp, /default-src 'self'/);
    // Images from nowhere but the panel and GitHub's avatar host.
    assert.match(csp, /img-src 'self' data: blob: https:\/\/avatars\.githubusercontent\.com;/);
    assert.equal(index.headers["x-content-type-options"], "nosniff");
});

test("hashed files are immutable, other public files revalidate", async () => {
    const { get } = await setup(build());
    const script = await get("/assets/index-B1x2c3d4.js");
    assert.equal(script.status, 200);
    assert.equal(script.text, SCRIPT);
    assert.equal(script.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal(script.headers["cache-control"], "public, max-age=31536000, immutable");
    const style = await get("/assets/index-D5e6f7g8.css");
    assert.equal(style.headers["content-type"], "text/css; charset=utf-8");
    const icon = await get("/favicon.svg");
    assert.equal(icon.headers["content-type"], "image/svg+xml");
    assert.equal(icon.headers["cache-control"], "no-cache");
});

test("panel routes fall back to index.html, missing files and paths outside are 404", async () => {
    const { get } = await setup(build());
    for (const path of [
        "/tasks",
        "/tasks/0123456789ab",
        "/repos/acme/demo",
        "/tasks?status=done",
    ]) {
        const page = await get(path);
        assert.equal(page.status, 200, path);
        assert.equal(page.text, INDEX, path);
    }
    for (const path of [
        "/assets/index-missing.js",
        "/missing.png",
        "/..%2fsecret.txt",
        "/assets/..%2f..%2fsecret.txt",
    ]) {
        const missing = await get(path);
        assert.equal(missing.status, 404, path);
        assert.doesNotMatch(missing.text, /outside the build/, path);
        assert.equal(JSON.parse(missing.text).code, "request.notFound", path);
    }
});

test("the API and /health answer as before next to the panel", async () => {
    const { get } = await setup(build());
    const tasks = await get("/api/tasks");
    assert.equal(tasks.status, 200);
    assert.equal(tasks.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(tasks.text), []);
    assert.deepEqual(JSON.parse((await get("/health")).text), { ok: true });
    const unknown = await get("/api/nothing");
    assert.equal(unknown.status, 404);
    assert.equal(JSON.parse(unknown.text).code, "request.notFound");
});

test("the panel keeps the host and origin checks", async () => {
    const { get } = await setup(build());
    const foreignHost = await get("/", { host: "evil.example" });
    assert.equal(foreignHost.status, 403);
    assert.equal(JSON.parse(foreignHost.text).code, "request.unknownHost");
    const foreignOrigin = await get("/tasks", { origin: "https://evil.example" });
    assert.equal(foreignOrigin.status, 403);
    assert.equal(JSON.parse(foreignOrigin.text).code, "request.foreignOrigin");
});

test("with accounts the panel's files need no token, the API still does", async () => {
    const { get, store } = await setup(build());
    await store.createUser({ name: "ada", role: "admin" }, "0".repeat(64), true);
    assert.equal((await get("/")).status, 200);
    assert.equal((await get("/tasks")).text, INDEX);
    assert.equal((await get("/assets/index-B1x2c3d4.js")).status, 200);
    const api = await get("/api/tasks");
    assert.equal(api.status, 401);
    assert.equal(JSON.parse(api.text).code, "auth.missingToken");
});

test("under pnpm dev the panel's pages go to Vite, the API stays", async () => {
    const home = mkdtempSync(join(root, "home-"));
    const server = createApi(await openStore(home), {
        ...loadConfig({ OLIMP_HOME: home, OLIMP_DEV_PANEL: "http://localhost:5175" }),
        webDir: build(),
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const page = await fetch(`http://127.0.0.1:${port}/tasks/new?repo=demo`, {
        redirect: "manual",
    });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get("location"), "http://localhost:5175/tasks/new?repo=demo");
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/tasks`)).status, 200);
});

test("without a build the API works and / says how to build the panel", async () => {
    const { get } = await setup(join(root, "never-built"));
    for (const locale of ["en", "pl"]) {
        const home = await get("/", { "accept-language": locale });
        assert.equal(home.status, 404);
        const body = JSON.parse(home.text);
        assert.equal(body.code, "panel.notBuilt");
        assert.match(body.error, /pnpm build/);
    }
    assert.equal(JSON.parse((await get("/tasks")).text).code, "request.notFound");
    assert.equal((await get("/api/tasks")).status, 200);
});
