import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { AGENT_PATH, closeAllPreviews, injectAgent, parseTarget } from "../src/preview.ts";
import { openStore } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-preview-"));
const servers: Server[] = [];
after(() => {
    closeAllPreviews();
    for (const server of servers) {
        server.closeAllConnections();
        server.close();
    }
    rmSync(root, { recursive: true, force: true });
});
const parent = "http://localhost:5175";

test("a preview's address is an http one on this machine, as typed", () => {
    const cases: [string, string | null][] = [
        ["3000", "http://localhost:3000/"],
        ["localhost:5173/admin?x=1", "http://localhost:5173/admin?x=1"],
        ["http://0.0.0.0:8080", "http://localhost:8080/"],
        ["http://127.0.0.1:4000/", "http://127.0.0.1:4000/"],
        ["https://localhost:3000", null],
        ["http://example.com", null],
        ["http://user:pw@localhost:3000", null],
        ["file:///etc/passwd", null],
    ];
    for (const [typed, url] of cases) assert.equal(parseTarget(typed)?.href ?? null, url, typed);
    assert.equal(
        injectAgent('<html><head lang="x"><title>A</title>'),
        `<html><head lang="x"><script src="${AGENT_PATH}"></script><title>A</title>`,
    );
    assert.equal(injectAgent("<p>hi</p>"), `<script src="${AGENT_PATH}"></script><p>hi</p>`);
});

async function listen(server: Server): Promise<number> {
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return (server.address() as AddressInfo).port;
}

async function setup() {
    const home = mkdtempSync(join(root, "home-"));
    const store = await openStore(home);
    const port = await listen(createApi(store, loadConfig({ OLIMP_HOME: home })));
    const open = async (url: string) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/preview`, {
            method: "POST",
            headers: { host: `127.0.0.1:${port}`, "content-type": "application/json" },
            body: JSON.stringify({ url, parent }),
        });
        return { status: res.status, json: (await res.json()) as Record<string, string> };
    };
    return { port, open };
}

test("the proxy frames the app for the panel, adds its script and splices the hot reload", async () => {
    const app = createServer((req, res) => {
        if (req.url === "/away") {
            res.writeHead(302, { location: `http://localhost:${appPort}/home` });
            return void res.end();
        }
        res.writeHead(200, {
            "content-type": "text/html",
            "x-frame-options": "DENY",
            "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
        });
        res.end(`<html><head></head><body>host ${req.headers.host}</body></html>`);
    });
    app.on("upgrade", (_req, socket) => {
        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n");
        socket.on("data", (data) => socket.write(data));
        socket.on("end", () => socket.destroy());
    });
    const appPort = await listen(app);
    const { open } = await setup();
    const opened = await open(`localhost:${appPort}/page`);
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    const { origin, url } = opened.json as { origin: string; url: string };
    assert.match(origin, /^http:\/\/localhost:\d+$/);
    assert.equal(url, `${origin}/page`);
    assert.equal((await open(`localhost:${appPort}`)).json.origin, origin);

    const page = await fetch(url);
    const html = await page.text();
    assert.ok(html.includes(`<head><script src="${AGENT_PATH}"></script>`), html);
    assert.ok(html.includes(`host localhost:${appPort}`), "the app sees its own host");
    assert.equal(page.headers.get("x-frame-options"), null);
    assert.equal(
        page.headers.get("content-security-policy"),
        `default-src 'self'; frame-ancestors ${parent}`,
    );
    const away = await fetch(`${origin}/away`, { redirect: "manual" });
    assert.equal(away.headers.get("location"), `${origin}/home`);
    const script = await (await fetch(`${origin}${AGENT_PATH}`)).text();
    assert.ok(script.includes(JSON.stringify(parent)));

    const echoed = await new Promise<string>((resolve, reject) => {
        const socket = connect(Number(new URL(origin).port), "127.0.0.1");
        let seen = "";
        socket.on("data", (data) => {
            seen += data;
            if (seen.includes("ping")) {
                socket.destroy();
                resolve(seen);
            } else if (seen.includes("101")) socket.write("ping");
        });
        socket.on("error", reject);
        socket.write(
            "GET /hmr HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        );
    });
    assert.ok(echoed.startsWith("HTTP/1.1 101"));

    // An app that does not answer gets a page whose script tells the panel so.
    const down = createServer();
    const downPort = await listen(down);
    down.close();
    const gone = await open(`127.0.0.1:${downPort}`);
    const answer = await fetch(gone.json.url as string);
    assert.equal(answer.status, 502);
    assert.ok((await answer.text()).includes(`${AGENT_PATH}?down=1`));
});

test("only an app on this machine is previewed, never OLIMP itself", async () => {
    const { port, open } = await setup();
    for (const [url, code] of [
        ["https://example.com", "preview.invalidUrl"],
        [`127.0.0.1:${port}`, "preview.olimp"],
    ]) {
        const refused = await open(url);
        assert.deepEqual([refused.status, refused.json.code], [400, code], url);
    }
});
