import type { IncomingMessage } from "node:http";
import type { Config } from "../config.ts";
import { HttpError, readJson, text } from "../http.ts";
import { SOURCE_URL_MAX } from "../limits.ts";
import { openPreview, parseTarget } from "../preview.ts";
import type { Answer } from "./shared.ts";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]):\d+$/;

// A proxy for the panel's Preview of an app on this machine. REST only, like the terminal: it is
// the panel's. The app's address is local to OLIMP's machine, so a panel reached through a public
// host could not load it; and OLIMP itself (the API, the dev panel) is never mirrored, since its
// own origin check would then see the proxy's.
export async function previewRoute(
    cfg: Config,
    req: IncomingMessage,
    path: string,
): Promise<Answer | undefined> {
    if (path !== "/api/preview" || req.method !== "POST") return undefined;
    if (!LOCAL_HOST.test(req.headers.host ?? "")) throw new HttpError(409, "preview.remote");
    const body = await readJson(req);
    const target = parseTarget(text(body.url, "url", SOURCE_URL_MAX));
    if (!target) throw new HttpError(400, "preview.invalidUrl");
    const parent = parseTarget(text(body.parent, "parent", SOURCE_URL_MAX));
    if (!parent) throw new HttpError(400, "preview.invalidParent");
    const own = [cfg.port, req.socket.localPort, cfg.devPanel ? new URL(cfg.devPanel).port : null];
    if (own.map(String).includes(target.port || "80")) throw new HttpError(400, "preview.olimp");
    const origin = await openPreview(target, parent.origin);
    return [
        200,
        { origin, target: target.origin, url: `${origin}${target.pathname}${target.search}` },
    ];
}
