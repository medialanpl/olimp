import {
    createServer,
    type IncomingMessage,
    type OutgoingHttpHeaders,
    request,
    type Server,
    type ServerResponse,
} from "node:http";
import { type AddressInfo, connect, type Socket } from "node:net";

// The panel's preview of an app a task runs (a dev server on this machine). Each app gets a proxy
// on a port of its own, so its code runs in an origin apart from the panel's and never reaches
// the panel's session; the proxy lets the panel frame it and adds a script that reports where
// the page is and lets a person pick an element to show the agent.

export const AGENT_PATH = "/__olimp_preview__.js";
const PROXIES_MAX = 8;
const IDLE_MS = 30 * 60_000;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

// An http address on this machine, as typed: `3000`, `localhost:3000/path` or a whole URL.
export function parseTarget(raw: string): URL | null {
    const typed = raw.trim();
    let url: URL;
    try {
        url = new URL(
            /^\d{2,5}$/.test(typed)
                ? `http://localhost:${typed}`
                : /^[a-z][a-z+.-]*:\/\//i.test(typed)
                  ? typed
                  : `http://${typed}`,
        );
    } catch {
        return null;
    }
    if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || url.username || url.password)
        return null;
    if (url.hostname === "0.0.0.0") url.hostname = "localhost";
    return url;
}

// Where the script goes: as early as the parser allows, before the app's own scripts can throw.
export function injectAgent(html: string): string {
    const tag = `<script src="${AGENT_PATH}"></script>`;
    const head = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html);
    if (!head) return tag + html;
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
}

// The app may forbid framing; only the panel's origin is let in, the rest of its policy stays.
export function allowFraming(headers: OutgoingHttpHeaders, parent: string): void {
    delete headers["x-frame-options"];
    for (const name of ["content-security-policy", "content-security-policy-report-only"]) {
        const value = headers[name];
        if (value === undefined) continue;
        const policies = (Array.isArray(value) ? value : [String(value)]).map((policy) =>
            policy
                .split(";")
                .map((d) => d.trim())
                .filter((d) => d && !/^frame-ancestors\b/i.test(d))
                .concat(`frame-ancestors ${parent}`)
                .join("; "),
        );
        headers[name] = policies;
    }
}

interface Proxy {
    server: Server;
    origin: string;
    target: URL;
    parent: string;
    used: number;
    sockets: number;
}

const proxies = new Map<string, Proxy>();
let sweeper: ReturnType<typeof setInterval> | null = null;

// The panel's origin and the app's real one, so addresses name the dev server, not the proxy.
export function agentScript(parent: string, upstream: string, down: boolean): string {
    return `(function(){
var parent=${JSON.stringify(parent)},upstream=${JSON.stringify(upstream)};
if(window.top===window||window.__olimpPreview)return;window.__olimpPreview=1;
function post(m){m.source="olimp-preview";try{window.parent.postMessage(m,parent)}catch(e){}}
${down ? 'post({type:"unreachable"});return;' : ""}
function here(){return upstream+location.pathname+location.search+location.hash}
function report(how){post({type:"location",url:here(),title:document.title,how:how})}
["pushState","replaceState"].forEach(function(n){var o=history[n];history[n]=function(){var r=o.apply(this,arguments);report(n==="pushState"?"push":"replace");return r}});
addEventListener("popstate",function(){report("pop")});addEventListener("hashchange",function(){report("pop")});
if(document.readyState==="loading")addEventListener("DOMContentLoaded",function(){report("load")});else report("load");
var picking=false,box=null;
function esc(s){return window.CSS&&CSS.escape?CSS.escape(s):s}
function selector(el){var parts=[];while(el&&el.nodeType===1&&parts.length<6){if(el.id){parts.unshift("#"+esc(el.id));break}
var part=el.tagName.toLowerCase()+[].slice.call(el.classList,0,2).map(function(c){return "."+esc(c)}).join("");var p=el.parentElement;
if(p){var same=[].filter.call(p.children,function(c){return c.tagName===el.tagName});if(same.length>1)part+=":nth-of-type("+(same.indexOf(el)+1)+")"}
parts.unshift(part);el=p}return parts.join(" > ")}
function place(el){var r=el.getBoundingClientRect();box.style.left=r.left+"px";box.style.top=r.top+"px";box.style.width=r.width+"px";box.style.height=r.height+"px"}
function move(e){if(e.target&&e.target.getBoundingClientRect)place(e.target)}
function block(e){e.preventDefault();e.stopPropagation()}
function pick(e){block(e);var el=e.target;post({type:"picked",selector:selector(el),html:(el.outerHTML||"").slice(0,1500),text:(el.innerText||"").trim().slice(0,200),url:here()})}
function key(e){if(e.key==="Escape"){stop();post({type:"pickEnd"})}}
var blocked=["mousedown","mouseup","pointerdown","pointerup"];
function start(){if(picking)return;picking=true;box=document.createElement("div");
box.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #c9922e;background:rgba(201,146,46,.15);border-radius:4px";
document.documentElement.appendChild(box);addEventListener("mousemove",move,true);addEventListener("click",pick,true);addEventListener("keydown",key,true);
blocked.forEach(function(t){addEventListener(t,block,true)});document.documentElement.style.cursor="crosshair"}
function stop(){if(!picking)return;picking=false;box&&box.remove();removeEventListener("mousemove",move,true);removeEventListener("click",pick,true);
removeEventListener("keydown",key,true);blocked.forEach(function(t){removeEventListener(t,block,true)});document.documentElement.style.cursor=""}
addEventListener("message",function(e){var d=e.data;if(e.origin!==parent||!d||d.source!=="olimp-panel")return;
if(d.type==="pick")d.on?start():stop();else if(d.type==="go")history.go(d.delta);else if(d.type==="reload")location.reload()});
})();`;
}

const swap = (value: string, from: string, to: string) =>
    value.startsWith(from) ? to + value.slice(from.length) : value;

function handle(proxy: Proxy, req: IncomingMessage, res: ServerResponse) {
    proxy.used = Date.now();
    const { target, origin, parent } = proxy;
    if (req.url?.split("?")[0] === AGENT_PATH) {
        res.writeHead(200, {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "no-store",
        });
        res.end(agentScript(parent, target.origin, req.url.includes("down=1")));
        return;
    }
    const headers = {
        ...req.headers,
        host: target.host,
        origin: req.headers.origin && swap(req.headers.origin, origin, target.origin),
        referer: req.headers.referer && swap(req.headers.referer, origin, target.origin),
        // The page is rewritten to add the script, so it must come uncompressed.
        "accept-encoding": "identity",
    };
    for (const name of ["origin", "referer"] as const) if (!headers[name]) delete headers[name];
    const upstream = request(
        {
            host: target.hostname.replace(/^\[|\]$/g, ""),
            port: Number(target.port || 80),
            method: req.method,
            path: req.url,
            headers,
        },
        (answer) => {
            const out: OutgoingHttpHeaders = { ...answer.headers };
            allowFraming(out, parent);
            if (typeof out.location === "string")
                out.location = swap(out.location, target.origin, origin);
            const status = answer.statusCode ?? 502;
            if (!String(out["content-type"] ?? "").includes("text/html")) {
                res.writeHead(status, out);
                answer.pipe(res);
                return;
            }
            const chunks: Buffer[] = [];
            answer.on("data", (chunk: Buffer) => chunks.push(chunk));
            answer.on("end", () => {
                delete out["content-length"];
                res.writeHead(status, out);
                res.end(injectAgent(Buffer.concat(chunks).toString("utf8")));
            });
            answer.on("error", () => res.destroy());
        },
    );
    upstream.on("error", () => {
        if (res.headersSent) return void res.destroy();
        // The panel says it in the person's language: the script tells it nothing answers.
        res.writeHead(502, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
        });
        res.end(
            `<!doctype html><meta charset="utf-8"><script src="${AGENT_PATH}?down=1"></script>`,
        );
    });
    req.pipe(upstream);
}

// A dev server's hot reload is a WebSocket: spliced through byte for byte.
function upgrade(proxy: Proxy, req: IncomingMessage, socket: Socket, head: Buffer) {
    const { target, origin } = proxy;
    proxy.sockets++;
    const upstream = connect({
        host: target.hostname.replace(/^\[|\]$/g, ""),
        port: Number(target.port || 80),
    });
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i] as string;
        const value = req.rawHeaders[i + 1] as string;
        const lower = name.toLowerCase();
        lines.push(
            `${name}: ${lower === "host" ? target.host : lower === "origin" ? swap(value, origin, target.origin) : value}`,
        );
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    upstream.pipe(socket).pipe(upstream);
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        proxy.sockets--;
        proxy.used = Date.now();
        upstream.destroy();
        socket.destroy();
    };
    for (const side of [upstream, socket]) {
        side.on("error", close);
        side.on("close", close);
    }
}

function closeProxy(key: string) {
    const proxy = proxies.get(key);
    if (!proxy) return;
    proxies.delete(key);
    proxy.server.closeAllConnections();
    proxy.server.close();
}

function sweep() {
    for (const [key, proxy] of proxies)
        if (!proxy.sockets && Date.now() - proxy.used > IDLE_MS) closeProxy(key);
    if (!proxies.size && sweeper) {
        clearInterval(sweeper);
        sweeper = null;
    }
}

// The proxy for an app, opened the first time it is asked for and kept while it is used. The
// origin keeps the host name typed: cookies go by host, not port, so the app keeps its session.
export async function openPreview(target: URL, parent: string): Promise<string> {
    const key = `${target.origin} ${parent}`;
    const known = proxies.get(key);
    if (known) {
        known.used = Date.now();
        return known.origin;
    }
    if (proxies.size >= PROXIES_MAX) {
        const oldest = [...proxies].sort((a, b) => a[1].used - b[1].used)[0];
        if (oldest) closeProxy(oldest[0]);
    }
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const host = target.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost";
    const proxy: Proxy = {
        server,
        origin: `http://${host}:${port}`,
        target,
        parent,
        used: Date.now(),
        sockets: 0,
    };
    server
        .on("upgrade", (incoming, socket, head) => upgrade(proxy, incoming, socket as Socket, head))
        .on("request", (incoming, reply) => handle(proxy, incoming, reply));
    proxies.set(key, proxy);
    sweeper ??= setInterval(sweep, 60_000);
    sweeper.unref();
    return proxy.origin;
}

export function closeAllPreviews(): void {
    for (const key of [...proxies.keys()]) closeProxy(key);
}
