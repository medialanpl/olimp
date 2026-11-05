import { askAgent } from "./agent-step.ts";
import type { Config } from "./config.ts";
import { HttpError } from "./http.ts";
import { listSkills, type Skill } from "./skills.ts";
import type { Store } from "./store.ts";
import { type Definition, importWorkflow } from "./workflow-graph.ts";
import { parseDefinition } from "./workflows.ts";

const CATALOG_MAX = 6000;
const DESCRIPTION_MAX = 200;

// The skills the request names come first; descriptions are cut, and the catalog stops at
// CATALOG_MAX characters, so a large catalog does not crowd out the request.
export function skillCatalog(task: string, skills: Skill[]): string[] {
    const asked = task.toLowerCase();
    const named = (s: Skill) => asked.includes(s.name.toLowerCase()) || asked.includes(s.id);
    const lines: string[] = [];
    let size = 0;
    for (const s of [...skills.filter(named), ...skills.filter((s) => !named(s))]) {
        const about = s.description.replace(/\s+/g, " ").trim();
        const line = `- ${s.id}: ${about.length > DESCRIPTION_MAX ? `${about.slice(0, DESCRIPTION_MAX)}…` : about}`;
        if (size + line.length > CATALOG_MAX) break;
        lines.push(line);
        size += line.length + 1;
    }
    return lines;
}

// The planner: the agent proposes a short chain of steps, which becomes a linear graph.
const request = (task: string, skills: string[], commands: string[]) =>
    [
        "You plan workflows for OLIMP, a runner of coding agents. Answer with ONLY a JSON object:",
        '{"name": string, "description": string, "steps": [{"name": string, "prompt"?: string, ' +
            '"command"?: string, "skill"?: string}]}.',
        'Rules: a step has either "prompt" (an agent step) or "command" (a shell check that passes ' +
            "with exit code 0); put the {{task}} placeholder in agent prompts where the user's " +
            "request belongs; take skills only from the catalog; 1 to 5 steps, fewer is better; " +
            '"name" is a short kebab-case name for the whole workflow; "description" is one sentence.',
        "",
        "What the workflow should do:",
        task,
        "",
        "Skill catalog:",
        skills.length ? skills.join("\n") : "(none)",
        "",
        "Commands this repository runs to check its work:",
        commands.length ? commands.map((c) => `- ${c}`).join("\n") : "(none)",
    ].join("\n");

function jsonIn(answer: string): unknown {
    const start = answer.indexOf("{");
    const end = answer.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("the answer holds no JSON object");
    return JSON.parse(answer.slice(start, end + 1));
}

export async function buildWorkflow(
    store: Store,
    cfg: Config,
    home: string,
    author: string | null,
    repo: string,
    task: string,
): Promise<{ name: string; description: string; definition: Definition }> {
    const skills = skillCatalog(task, await listSkills(store, cfg, home));
    const commands = (await store.repo(repo))?.commands ?? [];
    let reason = "";
    // One more try on an answer that does not parse.
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const answer = await askAgent(
                store,
                cfg,
                author,
                repo,
                request(task, skills, commands),
            );
            const built = importWorkflow(jsonIn(answer));
            return {
                name: built.name.slice(0, 100) || "new-workflow",
                description: built.description.slice(0, 500),
                definition: parseDefinition(built.definition),
            };
        } catch (error) {
            reason = (error as Error).message;
        }
    }
    throw new HttpError(502, "workflow.buildFailed", { error: reason.slice(0, 300) });
}
