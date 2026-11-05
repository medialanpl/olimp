import { randomBytes } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "./config.ts";
import { HttpError } from "./http.ts";
import { ATTACHMENT_NAME_MAX, SOURCE_FETCH_MS, UPLOAD_MAX, UPLOAD_TTL_MS } from "./limits.ts";

export interface Upload {
    id: string;
    name: string;
    mediaType: string;
    bytes: number;
}

export const UPLOAD_ID = /^[0-9a-f]{24}$/;

const uploadsDir = (cfg: Config) => join(cfg.home, "uploads");
export const attachmentsDir = (cfg: Config, task: string) => join(cfg.home, "attachments", task);

// A file name the agent and the disk both take as is: no folders, no control characters.
export function safeName(name: string): string {
    const clean = basename(name.replaceAll("\\", "/"))
        .replace(/[^\p{L}\p{N}._ -]/gu, "_")
        .replace(/^[.\s]+/, "")
        .trim()
        .slice(0, ATTACHMENT_NAME_MAX);
    return clean || "file";
}

function prune(dir: string): void {
    const cutoff = Date.now() - UPLOAD_TTL_MS;
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).mtimeMs < cutoff) rmSync(path, { force: true });
    }
}

// Staged when the file is attached in the panel, so sending the task does not wait for it.
export function saveUpload(cfg: Config, name: string, mediaType: string, data: Buffer): Upload {
    const dir = uploadsDir(cfg);
    mkdirSync(dir, { recursive: true });
    prune(dir);
    const upload = {
        id: randomBytes(12).toString("hex"),
        name: safeName(name),
        mediaType,
        bytes: data.length,
    };
    writeFileSync(join(dir, upload.id), data);
    writeFileSync(join(dir, `${upload.id}.json`), JSON.stringify(upload));
    return upload;
}

// What an agent can read from a link: text of any kind, JSON, XML and PDF.
const SOURCE_TYPE = /^(text\/[\w.+-]+|application\/(pdf|json|xml|xhtml\+xml))$/;
const EXTENSION: Record<string, string> = {
    "text/html": ".html",
    "application/xhtml+xml": ".html",
    "text/markdown": ".md",
    "text/plain": ".txt",
    "application/pdf": ".pdf",
    "application/json": ".json",
    "application/xml": ".xml",
};

// Stages what a link serves as an upload, at most UPLOAD_MAX bytes, named after its last path part.
export async function fetchUpload(cfg: Config, url: URL): Promise<Upload> {
    const failed = (error: string) =>
        new HttpError(502, "memory.sourceFetch", { url: url.href, error });
    const res = await fetch(url, { signal: AbortSignal.timeout(SOURCE_FETCH_MS) }).catch(
        (error: Error) => {
            throw failed(error.message);
        },
    );
    if (!res.ok || !res.body) throw failed(`HTTP ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!SOURCE_TYPE.test(type)) {
        await res.body.cancel();
        throw new HttpError(400, "memory.sourceType", { url: url.href, type: type || "?" });
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of res.body) {
        bytes += chunk.length;
        if (bytes > UPLOAD_MAX)
            throw new HttpError(413, "memory.sourceTooLarge", { max: UPLOAD_MAX / 1024 / 1024 });
        chunks.push(Buffer.from(chunk));
    }
    const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
    const stem = last || url.hostname;
    const ext = EXTENSION[type] ?? ".txt";
    return saveUpload(
        cfg,
        stem.includes(".") ? stem : `${stem}${ext}`,
        type,
        Buffer.concat(chunks),
    );
}

export function readUpload(cfg: Config, id: string): Upload | null {
    if (!UPLOAD_ID.test(id)) return null;
    const meta = join(uploadsDir(cfg), `${id}.json`);
    if (!existsSync(meta) || !existsSync(join(uploadsDir(cfg), id))) return null;
    return JSON.parse(readFileSync(meta, "utf8")) as Upload;
}

// Names unique within one task, in the order given: a second "a.png" becomes "a-2.png".
export function uniqueNames(names: string[]): string[] {
    const taken = new Set<string>();
    return names.map((name) => {
        const dot = name.lastIndexOf(".");
        const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
        let candidate = name;
        for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
        taken.add(candidate.toLowerCase());
        return candidate;
    });
}

// Moves the staged files to the task; the uploads are gone afterwards.
export function attachUploads(cfg: Config, task: string, uploads: Upload[], names: string[]): void {
    const dir = attachmentsDir(cfg, task);
    mkdirSync(dir, { recursive: true });
    uploads.forEach((upload, i) => {
        renameSync(join(uploadsDir(cfg), upload.id), join(dir, names[i] as string));
        rmSync(join(uploadsDir(cfg), `${upload.id}.json`), { force: true });
    });
}

// Another variant of the same prompt gets its own copy of the first variant's files.
export function copyAttachments(cfg: Config, from: string, to: string, names: string[]): void {
    const dir = attachmentsDir(cfg, to);
    mkdirSync(dir, { recursive: true });
    for (const name of names) copyFileSync(join(attachmentsDir(cfg, from), name), join(dir, name));
}

// Raster images are shown in the panel; anything else is downloaded, so no SVG or HTML ever runs
// on the panel's origin.
const INLINE: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};

export function attachmentType(name: string): { type: string; inline: boolean } {
    const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
    const image = INLINE[ext];
    return image
        ? { type: image, inline: true }
        : { type: "application/octet-stream", inline: false };
}
