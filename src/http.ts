import type { IncomingMessage } from "node:http";
import type { MessageKey, Params } from "./i18n.ts";
import type { User } from "./store.ts";

const BODY_MAX = 1024 * 1024;

export class HttpError extends Error {
    readonly status: number;
    readonly code: MessageKey;
    readonly params: Params;
    constructor(status: number, code: MessageKey, params: Params = {}) {
        super(code);
        this.status = status;
        this.code = code;
        this.params = params;
    }
}

// A route's answer that is a file, not JSON.
export class FileBody {
    readonly data: Buffer;
    readonly type: string;
    readonly disposition: string;
    constructor(data: Buffer, type: string, disposition: string) {
        this.data = data;
        this.type = type;
        this.disposition = disposition;
    }
}

export async function readJson(
    req: IncomingMessage,
    max = BODY_MAX,
): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        // Leaving the loop resets the connection before the client reads the 413, so a body a
        // little over the limit is read to its end; one far over it is cut off.
        if (size > max * 4) throw new HttpError(413, "request.bodyTooLarge");
        if (size <= max) chunks.push(chunk as Buffer);
    }
    if (size > max) throw new HttpError(413, "request.bodyTooLarge");
    try {
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        if (value && typeof value === "object" && !Array.isArray(value))
            return value as Record<string, unknown>;
    } catch {}
    throw new HttpError(400, "request.invalidJson");
}

export function text(value: unknown, field: string, max: number, required = true): string {
    if (value === undefined && !required) return "";
    if (typeof value !== "string" || (required && !value.trim()) || value.length > max)
        throw new HttpError(400, "field.invalidText", { field, max });
    return value.trim();
}

// Without accounts there is no caller and everyone may do everything.
export function requireAdmin(actor: User | null): void {
    if (actor && actor.role !== "admin") throw new HttpError(403, "auth.adminOnly");
}
