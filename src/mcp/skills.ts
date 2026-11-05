import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NAME_MAX, REF_MAX, SKILL_TEXT_MAX } from "../limits.ts";
import { type Call, githubRepo, repo } from "./shared.ts";

export function registerSkillTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_add_skill_source",
        {
            description:
                "Register a GitHub repository of skills (skills/<name>/SKILL.md, the skills.sh " +
                "layout); OLIMP clones it with the user's gh login and reads the given branch, " +
                "the repository's default one when omitted. Registering it again changes the branch.",
            inputSchema: {
                repo: z.string().describe("GitHub repository as owner/name or a GitHub address"),
                branch: z.string().optional().describe("Branch to read skills from"),
            },
        },
        (args) => call("POST", "/api/skill-sources", args),
    );
    server.registerTool(
        "olimp_search_skills",
        {
            description:
                "Search the skills.sh directory. Each hit's source is the GitHub repository to " +
                "register with olimp_add_skill_source, and its id the skill to give a task after that.",
            inputSchema: {
                query: z.string().min(2).describe("Search text, at least 2 characters"),
            },
        },
        ({ query }) => call("GET", `/api/skill-search?${new URLSearchParams({ q: query })}`),
    );
    server.registerTool(
        "olimp_list_skill_sources",
        { description: "List the registered skill repositories." },
        () => call("GET", "/api/skill-sources"),
    );
    server.registerTool(
        "olimp_refresh_skill_sources",
        {
            description:
                "Fetch every registered skill repository now, so olimp_list_skills shows skills " +
                "added or changed there since. Fails naming the sources that could not be fetched.",
        },
        () => call("POST", "/api/skill-sources/refresh"),
    );
    server.registerTool(
        "olimp_remove_skill_source",
        {
            description:
                "Unregister a skill repository and delete its clone. Tasks and automations " +
                "with one of its skills keep it, and running them then fails.",
            inputSchema: { repo: githubRepo },
        },
        ({ repo }) => call("DELETE", `/api/skill-sources/${repo}`),
    );
    server.registerTool(
        "olimp_list_skills",
        {
            description:
                "List skills from all registered sources as last fetched (olimp_refresh_skill_sources " +
                "fetches them): id, name, description, source. Then the caller's own skills in its agents' HOME (~/.claude/skills, ids " +
                "~/name) and the ones synced from claude.ai (ids claude.ai/name). With repo, the " +
                "skills that repository keeps itself (in .claude/skills, .agents/skills or skills) " +
                'come first, with ids ./name and source ".".',
            inputSchema: { repo: repo.optional() },
        },
        ({ repo }) =>
            call("GET", repo ? `/api/skills?repo=${encodeURIComponent(repo)}` : "/api/skills"),
    );
    const skillName = z
        .string()
        .regex(/^\w[\w.-]*$/)
        .max(NAME_MAX)
        .describe("Skill folder name");
    const skillContent = z
        .string()
        .max(SKILL_TEXT_MAX)
        .describe("The whole SKILL.md, with name and description in the frontmatter");
    server.registerTool(
        "olimp_create_own_skill",
        {
            description:
                "Create a skill of the caller's own in its agents' HOME (~/.claude/skills/<name>), " +
                "usable in every project as ~/name; refused when it exists.",
            inputSchema: { name: skillName, content: skillContent },
        },
        (args) => call("POST", "/api/own-skills", args),
    );
    server.registerTool(
        "olimp_update_own_skill",
        {
            description: "Replace the SKILL.md of one of the caller's own skills (~/name).",
            inputSchema: { name: skillName, content: skillContent },
        },
        ({ name, content }) => call("PUT", `/api/own-skills/${name}`, { content }),
    );
    server.registerTool(
        "olimp_delete_own_skill",
        {
            description:
                "Delete one of the caller's own skills (~/name) with its folder. Tasks and " +
                "automations that name it keep it, and running them then fails.",
            inputSchema: { name: skillName },
        },
        ({ name }) => call("DELETE", `/api/own-skills/${name}`),
    );
    server.registerTool(
        "olimp_read_skill",
        {
            description:
                "Read a skill's SKILL.md: ref is an id from olimp_list_skills; a ./name skill " +
                "needs its repo.",
            inputSchema: { ref: z.string().max(REF_MAX), repo: repo.optional() },
        },
        ({ ref, repo }) =>
            call("GET", `/api/skill?${new URLSearchParams({ ref, ...(repo ? { repo } : {}) })}`),
    );
}
