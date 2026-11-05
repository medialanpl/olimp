import type { IncomingMessage } from "node:http";
import { PROJECT_ID } from "../clones.ts";
import type { Config } from "../config.ts";
import { HttpError, readJson, requireAdmin, text } from "../http.ts";
import { localeFrom, t } from "../i18n.ts";
import {
    MEMORY_DESCRIPTION_MAX,
    MEMORY_MAX,
    MEMORY_PAGES_MAX,
    MEMORY_SECTION_MAX,
    MEMORY_SECTIONS_MAX,
    MEMORY_SLUG_MAX,
    MEMORY_SOURCES_MAX,
    NOTE_MAX,
    SEARCH_MIN,
    SOURCE_URL_MAX,
    TITLE_MAX,
} from "../limits.ts";
import {
    hasHeading,
    isMemoryKind,
    isSlug,
    memoryGraph,
    memorySize,
    NOTE_ID,
    oneLine,
    pageSize,
    searchMemory,
    stepOf,
} from "../memory.ts";
import { ingestPrompt, sourceNote } from "../memory-upkeep.ts";
import { projectAgent } from "../settings.ts";
import type { MemoryPage, NoteSource, Repo, Store, User } from "../store.ts";
import { attachUploads, fetchUpload, readUpload, type Upload } from "../uploads.ts";
import { type Answer, oneLineText, registered } from "./shared.ts";

// shortcut: notes older than the newest GRAPH_NOTES_MAX are labelled by id, raise it or look each up
// when memories outgrow it.
const GRAPH_NOTES_MAX = 2000;

// A change through the API: no task or step, on behalf of the caller.
const apiSource = (actor: User | null): NoteSource => ({
    task: null,
    run: null,
    node: null,
    author: actor?.id ?? null,
});

function versionOf(value: unknown): number {
    if (!Number.isInteger(value) || (value as number) < 1)
        throw new HttpError(400, "memory.invalidVersion");
    return value as number;
}

// Note ids of the repository, in the order given, each once.
async function sourcesOf(store: Store, repo: string, value: unknown): Promise<string[]> {
    if (value === undefined) return [];
    if (
        !Array.isArray(value) ||
        value.length > MEMORY_SOURCES_MAX ||
        !value.every((id) => typeof id === "string" && NOTE_ID.test(id))
    )
        throw new HttpError(400, "memory.invalidSources", { max: MEMORY_SOURCES_MAX });
    const ids = [...new Set(value as string[])];
    for (const note of ids)
        if ((await store.note(note))?.repo !== repo)
            throw new HttpError(400, "memory.unknownNote", { note, repo });
    return ids;
}

function sectionBody(value: unknown): string {
    const body = text(
        typeof value === "string" ? value.replace(/\r\n?/g, "\n") : value,
        "body",
        MEMORY_SECTION_MAX,
    );
    if (hasHeading(body)) throw new HttpError(400, "memory.headingInBody");
    return body;
}

// The memory with one page replaced (or added) must stay within MEMORY_MAX.
function checkSize(repo: string, pages: MemoryPage[], slug: string, size: number): void {
    const others = memorySize(pages.filter((p) => p.slug !== slug));
    if (others + size > MEMORY_MAX)
        throw new HttpError(400, "memory.tooLarge", { repo, max: MEMORY_MAX });
}

async function pagesRoute(
    store: Store,
    req: IncomingMessage,
    repo: string,
    rest: string,
    source: NoteSource,
): Promise<Answer | undefined> {
    const method = req.method;
    if (rest === "" && method === "GET") {
        const pages = await store.memoryPages(repo);
        const { total } = await store.unwovenNotes(repo, 0);
        const summary = ({ sections, ...page }: MemoryPage) => ({
            ...page,
            sections: sections.length,
        });
        return [
            200,
            {
                repo,
                hubs: pages.filter((p) => p.kind === "hub").map(summary),
                pages: pages.filter((p) => p.kind === "page").map(summary),
                unwoven: total,
            },
        ];
    }
    if (rest === "/pages" && method === "POST") {
        const body = await readJson(req);
        if (!isSlug(body.slug))
            throw new HttpError(400, "memory.invalidSlug", { max: MEMORY_SLUG_MAX });
        const input = { slug: body.slug, ...pageFields(body) };
        const pages = await store.memoryPages(repo);
        if (pages.length >= MEMORY_PAGES_MAX)
            throw new HttpError(400, "memory.tooManyPages", { repo, max: MEMORY_PAGES_MAX });
        checkSize(repo, pages, input.slug, pageSize({ ...input, sections: [] }));
        const page = await store.createMemoryPage(repo, input, source);
        if (!page) throw new HttpError(409, "memory.pageExists", { repo, page: input.slug });
        return [201, page];
    }
    const one = /^\/pages\/([^/]+)(\/sections(?:\/([^/]+))?)?$/.exec(rest);
    if (!one) return undefined;
    const slug = one[1] as string;
    const page = isSlug(slug) ? await store.memoryPage(repo, slug) : undefined;
    if (!page) throw new HttpError(404, "memory.pageNotFound", { repo, page: slug });
    if (!one[2]) {
        if (method === "GET") return [200, page];
        if (method !== "PATCH") return undefined;
        const body = await readJson(req);
        const version = versionOf(body.version);
        const input = { slug, ...pageFields(body, page) };
        const pages = await store.memoryPages(repo);
        checkSize(repo, pages, slug, pageSize({ ...input, sections: page.sections }));
        const updated = await store.updateMemoryPage(repo, input, version, source);
        if (!updated) throw new HttpError(409, "memory.pageConflict", { page: slug, version });
        return [200, updated];
    }
    if (!one[3] && method === "POST") {
        const body = await readJson(req);
        const heading = oneLineText(body.heading, "heading", TITLE_MAX);
        if (page.sections.some((s) => s.heading === heading))
            throw new HttpError(409, "memory.sectionExists", { page: slug, heading });
        if (page.sections.length >= MEMORY_SECTIONS_MAX)
            throw new HttpError(400, "memory.tooManySections", {
                page: slug,
                max: MEMORY_SECTIONS_MAX,
            });
        const input = {
            heading,
            body: sectionBody(body.body),
            sources: await sourcesOf(store, repo, body.sources),
        };
        const sections = [...page.sections, input];
        checkSize(repo, await store.memoryPages(repo), slug, pageSize({ ...page, sections }));
        const added = await store.addMemorySection(repo, slug, input, source);
        if (!added) throw new HttpError(409, "memory.sectionExists", { page: slug, heading });
        return [201, added];
    }
    if (one[3] && method === "PATCH") {
        let heading = one[3];
        try {
            heading = decodeURIComponent(heading);
        } catch {}
        const current = page.sections.find((s) => s.heading === heading);
        if (!current) throw new HttpError(404, "memory.sectionNotFound", { page: slug, heading });
        const body = await readJson(req);
        const version = versionOf(body.version);
        const input = {
            heading,
            body: body.body === undefined ? current.body : sectionBody(body.body),
            sources:
                body.sources === undefined
                    ? current.sources
                    : await sourcesOf(store, repo, body.sources),
        };
        const sections = page.sections.map((s) => (s.heading === heading ? input : s));
        checkSize(repo, await store.memoryPages(repo), slug, pageSize({ ...page, sections }));
        const updated = await store.updateMemorySection(repo, slug, input, version, source);
        if (!updated)
            throw new HttpError(409, "memory.sectionConflict", { page: slug, heading, version });
        return [200, updated];
    }
    return undefined;
}

// POST needs every field; PATCH keeps the stored ones it does not carry.
function pageFields(body: Record<string, unknown>, base?: MemoryPage) {
    const kind = base && body.kind === undefined ? base.kind : (body.kind ?? "page");
    if (!isMemoryKind(kind)) throw new HttpError(400, "memory.invalidKind");
    return {
        title:
            base && body.title === undefined
                ? base.title
                : oneLineText(body.title, "title", TITLE_MAX),
        description:
            base && body.description === undefined
                ? base.description
                : oneLineText(body.description, "description", MEMORY_DESCRIPTION_MAX),
        kind,
    };
}

// A file staged before, or what a link serves: OLIMP fetches the link itself, so only an admin may
// point it anywhere.
async function sourceOf(
    cfg: Config,
    actor: User | null,
    body: Record<string, unknown>,
): Promise<{ upload: Upload; origin: string }> {
    if ((body.url === undefined) === (body.upload === undefined))
        throw new HttpError(400, "memory.sourceMissing");
    if (body.upload !== undefined) {
        const upload = typeof body.upload === "string" ? readUpload(cfg, body.upload) : null;
        if (!upload)
            throw new HttpError(400, "task.uploadExpired", { upload: String(body.upload) });
        return { upload, origin: upload.name };
    }
    requireAdmin(actor);
    const href = typeof body.url === "string" ? body.url.trim() : "";
    const url = href.length <= SOURCE_URL_MAX && URL.canParse(href) ? new URL(href) : null;
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:"))
        throw new HttpError(400, "memory.invalidSourceUrl", { max: SOURCE_URL_MAX });
    return { upload: await fetchUpload(cfg, url), origin: url.href };
}

const MEMORY_PATH = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/memory(\/.*)?$/;

// Writes have the caller as their source, or the agent step whose token signed the request.
export async function memoryRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    url: URL,
    actor: User | null,
    source = apiSource(actor),
): Promise<Answer | undefined> {
    const path = url.pathname;
    const method = req.method;
    const memory = MEMORY_PATH.exec(path);
    if (memory) {
        const repo = memory[1] as string;
        const project = await store.repo(repo);
        if (!project) throw new HttpError(404, "repo.notRegistered", { repo });
        if (memory[2] === "/unwoven" && method === "GET")
            return [
                200,
                await store.unwovenNotes(
                    repo,
                    undefined,
                    url.searchParams.get("oldest") === "true",
                ),
            ];
        if (memory[2] === "/search" && method === "GET") {
            const query = oneLine(url.searchParams.get("q") ?? "");
            if (query.length < SEARCH_MIN || query.length > TITLE_MAX)
                throw new HttpError(400, "memory.invalidQuery", {
                    min: SEARCH_MIN,
                    max: TITLE_MAX,
                });
            return [200, searchMemory(await store.memoryPages(repo), query)];
        }
        if (memory[2] === "/graph" && method === "GET") {
            const [pages, notes, unwoven] = await Promise.all([
                store.memoryPages(repo),
                store.notes(repo, GRAPH_NOTES_MAX),
                store.unwovenNotes(repo, 0),
            ]);
            return [200, memoryGraph(repo, pages, notes, unwoven.total)];
        }
        if (memory[2] === "/sources" && method === "POST") {
            // The ingest task's agent writes through the knowledge base's tools.
            if (!project.settings.memory) throw new HttpError(409, "memory.off", { repo });
            const { upload, origin } = await sourceOf(cfg, actor, await readJson(req));
            const [note] = await store.addNotes(repo, [sourceNote(origin, upload)], source);
            const locale = localeFrom(req.headers["accept-language"]);
            const task = await store.createTask({
                repo,
                title: t(locale, "memory.ingestTitle", { name: upload.name }),
                body: ingestPrompt(note?.id as string, origin),
                agent: await projectAgent(store, (await store.repo(repo)) as Repo),
                attachments: [upload.name],
                author: actor?.id ?? null,
            });
            attachUploads(cfg, task.id, [upload], [upload.name]);
            return [201, { note, task }];
        }
        const answer = await pagesRoute(store, req, repo, memory[2] ?? "", source);
        if (answer) return answer;
    }
    if (path === "/api/notes") {
        if (method === "GET") {
            const repo = url.searchParams.get("repo");
            if (repo !== null && !PROJECT_ID.test(repo)) throw new HttpError(400, "repo.invalidId");
            return [200, await store.notes(repo)];
        }
        if (method === "POST") {
            const body = await readJson(req);
            const repo = await registered(store, body.repo);
            const note = text(body.text, "text", NOTE_MAX);
            return [201, (await store.addNotes(repo, [note], source))[0]];
        }
    }
    const noteId = /^\/api\/notes\/([0-9a-f]{12})$/.exec(path);
    if (noteId && method === "DELETE") {
        const note = await store.note(noteId[1] as string);
        if (!note) throw new HttpError(404, "note.notFound", { note: noteId[1] as string });
        await store.deleteNote(note.id);
        return [200, note];
    }
    return undefined;
}

const notFound = () => {
    throw new HttpError(404, "request.notFound");
};

// The agent of a step, through its olimp-memory tools, with the token issued for that step: no
// account, and only the memory and notes of the step's project and its knowledge areas.
export async function stepMemoryRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
): Promise<Answer> {
    const token = req.headers["x-olimp-step"];
    const step = typeof token === "string" ? stepOf(token) : null;
    if (!step) throw new HttpError(401, "memory.invalidStepToken");
    const url = new URL(req.url ?? "/", "http://localhost");
    const reaches = (repo: unknown) => typeof repo === "string" && step.repos.includes(repo);
    const memory = MEMORY_PATH.exec(url.pathname);
    if (memory && reaches(memory[1]) && memory[2] !== "/sources" && memory[2] !== "/graph")
        return (await memoryRoute(store, cfg, req, url, null, step.source)) ?? notFound();
    if (
        url.pathname === "/api/notes" &&
        req.method === "GET" &&
        reaches(url.searchParams.get("repo"))
    )
        return [200, await store.notes(url.searchParams.get("repo"))];
    if (url.pathname === "/api/notes" && req.method === "POST") {
        const body = await readJson(req);
        if (reaches(body.repo)) {
            const note = text(body.text, "text", NOTE_MAX);
            return [201, (await store.addNotes(body.repo as string, [note], step.source))[0]];
        }
    }
    throw new HttpError(403, "memory.stepForbidden", { repos: step.repos.join(", ") });
}
