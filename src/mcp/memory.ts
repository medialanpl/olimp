import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    MEMORY_DESCRIPTION_MAX,
    MEMORY_SEARCH_HITS,
    MEMORY_SECTION_MAX,
    MEMORY_SLUG_MAX,
    MEMORY_SOURCES_MAX,
    NOTE_MAX,
    SEARCH_MIN,
    SOURCE_URL_MAX,
    TITLE_MAX,
} from "../limits.ts";
import { type Call, id, repo, repoPath } from "./shared.ts";

const slug = z
    .string()
    .max(MEMORY_SLUG_MAX)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .describe("Memory page slug: lowercase letters, digits and single hyphens");

// An agent step gets the tools for its project's memory and notes only (`step`).
export function registerMemoryTools(server: McpServer, call: Call, step = false): void {
    server.registerTool(
        "olimp_list_notes",
        {
            description:
                "List notes, newest first (up to 500): text, repository, source (task, or " +
                "workflow run and node; all null for a note added by hand) and time. Notes are " +
                "the raw sources of a repository's memory; agent steps add new ones.",
            inputSchema: { repo: repo.optional().describe("Only notes of this repository") },
        },
        ({ repo }) =>
            call("GET", repo ? `/api/notes?repo=${encodeURIComponent(repo)}` : "/api/notes"),
    );
    server.registerTool(
        "olimp_add_note",
        {
            description:
                "Add a note to a registered repository; later agent steps there see it as data.",
            inputSchema: { repo, text: z.string().min(1).max(NOTE_MAX) },
        },
        (args) => call("POST", "/api/notes", args),
    );
    if (!step)
        server.registerTool(
            "olimp_delete_note",
            {
                description: "Delete one note, e.g. a wrong or misleading one.",
                inputSchema: { id },
            },
            ({ id }) => call("DELETE", `/api/notes/${id}`),
        );
    const memoryPath = (repo: string, rest = "") => repoPath(repo, `memory${rest}`);
    const pageFields = {
        title: z.string().min(1).max(TITLE_MAX),
        description: z
            .string()
            .min(1)
            .max(MEMORY_DESCRIPTION_MAX)
            .describe("One sentence on what the page holds; the map shows it"),
        kind: z
            .enum(["page", "hub"])
            .describe("hub: a page whose sections lead to other pages with [[slug]] links"),
    };
    const version = z
        .number()
        .int()
        .min(1)
        .describe("The version you read; a change made since then refuses the write");
    const heading = z.string().min(1).max(TITLE_MAX).describe("The section's heading");
    const sectionBody = z
        .string()
        .min(1)
        .max(MEMORY_SECTION_MAX)
        .describe("The section's text (markdown without ## headings)");
    const sources = z
        .array(id)
        .max(MEMORY_SOURCES_MAX)
        .describe("Ids of the repository's notes the section rests on (see olimp_list_notes)");
    server.registerTool(
        "olimp_get_memory_map",
        {
            description:
                "Show the map of a repository's memory: its hubs and pages (slug, title, " +
                "description, version, number of sections, last change) and how many notes no " +
                "section cites yet.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", memoryPath(repo)),
    );
    server.registerTool(
        "olimp_get_memory_page",
        {
            description:
                "Read one memory page with its sections in order: heading, text, cited note ids, " +
                "version and who changed it last (task, workflow run and node, or none for the API).",
            inputSchema: { repo, slug },
        },
        ({ repo, slug }) => call("GET", memoryPath(repo, `/pages/${slug}`)),
    );
    server.registerTool(
        "olimp_search_memory",
        {
            description:
                "Search a repository's memory: page titles and descriptions, section headings and " +
                "texts. Every word must occur; hits are ranked (title, then heading, then text) " +
                "with the page slug, the section heading (null for a hit on the page itself) and " +
                `a snippet around the match; the best ${MEMORY_SEARCH_HITS} and the total number of hits.`,
            inputSchema: {
                repo,
                query: z.string().min(SEARCH_MIN).max(TITLE_MAX).describe("Words to look for"),
            },
        },
        ({ repo, query }) =>
            call("GET", memoryPath(repo, `/search?${new URLSearchParams({ q: query })}`)),
    );
    server.registerTool(
        "olimp_create_memory_page",
        {
            description:
                "Create a memory page or hub in a registered repository, without sections.",
            inputSchema: { repo, slug, ...pageFields, kind: pageFields.kind.optional() },
        },
        ({ repo, ...body }) => call("POST", memoryPath(repo, "/pages"), body),
    );
    server.registerTool(
        "olimp_update_memory_page",
        {
            description:
                "Change a page's title, description or kind; the given fields change. Refused " +
                "when the page changed after the version you read.",
            inputSchema: {
                repo,
                slug,
                version,
                title: pageFields.title.optional(),
                description: pageFields.description.optional(),
                kind: pageFields.kind.optional(),
            },
        },
        ({ repo, slug, ...body }) => call("PATCH", memoryPath(repo, `/pages/${slug}`), body),
    );
    server.registerTool(
        "olimp_add_memory_section",
        {
            description: "Add a section at the end of a memory page.",
            inputSchema: { repo, slug, heading, body: sectionBody, sources: sources.optional() },
        },
        ({ repo, slug, ...body }) =>
            call("POST", memoryPath(repo, `/pages/${slug}/sections`), body),
    );
    server.registerTool(
        "olimp_update_memory_section",
        {
            description:
                "Change a section's text or cited notes; the given fields change, the heading " +
                "stays. Refused when the section changed after the version you read.",
            inputSchema: {
                repo,
                slug,
                heading,
                version,
                body: sectionBody.optional(),
                sources: sources.optional(),
            },
        },
        ({ repo, slug, heading, ...body }) =>
            call(
                "PATCH",
                memoryPath(repo, `/pages/${slug}/sections/${encodeURIComponent(heading)}`),
                body,
            ),
    );
    server.registerTool(
        "olimp_list_unwoven_notes",
        {
            description:
                "List the notes of a repository that no memory section cites yet, newest first " +
                "(oldest first with oldest: true; up to 500), with their total.",
            inputSchema: { repo, oldest: z.boolean().optional() },
        },
        ({ repo, oldest }) =>
            call("GET", memoryPath(repo, oldest ? "/unwoven?oldest=true" : "/unwoven")),
    );
    if (step) return;
    server.registerTool(
        "olimp_get_memory_graph",
        {
            description:
                "Show a repository's memory as a graph, as the panel draws its mountain: nodes " +
                "(summit: the repository; hub and page: memory pages by page:<slug>; note: a note " +
                "a section cites, by note:<id>, with its text) and edges (summit to each hub and " +
                "to each page no hub links, hub to the pages it links as [[slug]], page to the " +
                "notes its sections cite), and how many notes are unwoven.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", memoryPath(repo, "/graph")),
    );
    server.registerTool(
        "olimp_add_memory_source",
        {
            description:
                "Add a source to a repository's memory, a file uploaded with olimp_upload_file or " +
                "a link OLIMP fetches (admins only; text, JSON, XML or PDF, at most 5 MB). OLIMP " +
                "stores a note that records the source and queues a task in which the project's " +
                "agent reads it and weaves it into the memory, citing that note. Returns both. " +
                "Needs the project's knowledge base on (memory in olimp_update_repo_settings).",
            inputSchema: {
                repo,
                url: z.string().url().max(SOURCE_URL_MAX).optional(),
                upload: z
                    .string()
                    .regex(/^[0-9a-f]{24}$/)
                    .optional()
                    .describe("Upload id from olimp_upload_file"),
            },
        },
        ({ repo, ...body }) => call("POST", memoryPath(repo, "/sources"), body),
    );
}
