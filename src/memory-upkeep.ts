import { projectAgent } from "./settings.ts";
import type { Automation, Builtin, Repo, Store } from "./store.ts";
import type { Upload } from "./uploads.ts";

const DAY = 24 * 60 * 60_000;
// Jarvis raises the same alarm: more than 10 unwoven notes, or the oldest older than a week.
export const WEAVE_BACKLOG = 10;
export const WEAVE_AGE_MS = 7 * DAY;

const TOOLS_ONLY =
    "Work only through the olimp-memory tools: change no file in this checkout and add no notes, " +
    "what you learn goes straight into the sections.";

const WEAVE =
    "Weave this project's unwoven notes into its memory. olimp_list_unwoven_notes with oldest: " +
    "true lists the oldest notes no section cites yet. For each note:\n\n" +
    "- Put its lasting knowledge where it belongs: rewrite the section it changes so that it " +
    "says what is true now (read the page with olimp_get_memory_page, then " +
    "olimp_update_memory_section with the version you read; do not just append), add a section " +
    "to the page it fits (olimp_add_memory_section), or add a page (olimp_create_memory_page) " +
    "and link it from a hub as [[slug]].\n" +
    "- Name the note in that section's sources, so it counts as woven.\n" +
    "- A note with nothing lasting (a state that changes, a one-off, something the memory already " +
    "says, or something wrong): name it in the sources of the section it confirms, or in a " +
    "section named for the current month (`YYYY-MM`) on page `set-aside`, with one line on " +
    "why.\n\n" +
    "Check a claim against the code in this checkout before you write it as a fact. " +
    `${TOOLS_ONLY} End with a short summary: notes woven, pages and sections changed, notes set aside.`;

const LINT =
    "Check the health of this project's memory and fix what you can: read its map " +
    "(olimp_get_memory_map) and each page (olimp_get_memory_page), and change sections and pages " +
    "with the version you read.\n\n" +
    "- Sections that contradict each other: keep what the code in this checkout shows now; when " +
    "you cannot tell, add the question to the page's section of open questions.\n" +
    "- Claims the code no longer bears out: correct them.\n" +
    "- Knowledge repeated on several pages: keep it in one section and point to it from the others.\n" +
    "- Pages no hub links to: link them from the hub they belong to, or add a hub.\n" +
    "- [[slug]] links to pages that do not exist: fix the link or drop it.\n" +
    "- Sections without sources: name the notes they rest on, if there are any.\n\n" +
    "Do not drop knowledge you are not sure is wrong. " +
    `${TOOLS_ONLY} End with a short report: what you fixed and what needs a person.`;

// A source a person added: the note that records it comes first, so every section can cite it.
export const ingestPrompt = (note: string, origin: string) =>
    `Ingest a source into this project's memory: ${origin}. Its content is the file attached ` +
    `to this task, and note ${note} records it.\n\n` +
    "- Read the source whole and the memory's map (olimp_get_memory_map), then put the source's " +
    "lasting knowledge where it belongs: update the sections it changes so that they say what is " +
    "true now, add sections to the pages it fits, or add pages and link them from a hub as " +
    "[[slug]].\n" +
    `- Name note ${note} in the sources of every section you write from the source.\n` +
    "- Where the source contradicts the memory or the code in this checkout, add the question to " +
    "the page's section of open questions instead of picking a side.\n\n" +
    `${TOOLS_ONLY} End with a short summary: what the source is, pages and sections changed, ` +
    "open questions.";

export const sourceNote = (origin: string, upload: Upload) =>
    `Source: ${origin} (${upload.mediaType}, ${Math.ceil(upload.bytes / 1024)} KiB), added for ` +
    `ingest; its file ${upload.name} is attached to the ingest task.`;

// Names are a fallback for the API and MCP; the panel shows them from its catalogs.
export const UPKEEP: Record<Builtin, { name: string; cron: string; body: string }> = {
    weave: { name: "Memory weaving", cron: "0 3 * * *", body: WEAVE },
    lint: { name: "Memory lint", cron: "0 4 * * 0", body: LINT },
};

// Gives a project with a knowledge base the memory upkeep it lacks, turned on; one turned off or
// changed stays so.
export async function ensureUpkeep(store: Store, repo: Repo): Promise<void> {
    if (!repo.settings.memory) return;
    const have = new Set(
        (await store.automations()).filter((a) => a.repo === repo.id).map((a) => a.builtin),
    );
    for (const [kind, { name, cron, body }] of Object.entries(UPKEEP)) {
        if (have.has(kind as Builtin)) continue;
        const agent = await projectAgent(store, repo);
        const input = { name, cron, body, title: name, agent, repo: repo.id, enabled: true };
        await store.createAutomation(
            { ...input, workflow: null, skill: null, integrations: [] },
            null,
            kind as Builtin,
        );
    }
}

// On its schedule a built-in automation runs only when there is work, so a quiet project costs
// nothing; "Run now" always runs it.
export async function upkeepDue(store: Store, a: Automation, at: Date): Promise<boolean> {
    if (!a.repo || !(await store.repo(a.repo))?.settings.memory) return false;
    if (a.builtin === "weave") {
        const { total, notes } = await store.unwovenNotes(a.repo, 1, true);
        const oldest = notes[0];
        return (
            total > WEAVE_BACKLOG ||
            (!!oldest && at.getTime() - Date.parse(oldest.createdAt) > WEAVE_AGE_MS)
        );
    }
    // A lint's own fixes are a change too, so one more lint follows a lint that fixed something.
    const since = a.lastRunAt ?? "";
    return (await store.memoryPages(a.repo)).some(
        (p) => p.updatedAt > since || p.sections.some((s) => s.updatedAt > since),
    );
}
