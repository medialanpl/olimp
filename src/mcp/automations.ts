import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CRON_MAX, NAME_MAX, REF_MAX, TASK_BODY_MAX, TITLE_MAX } from "../limits.ts";
import { agent, type Call, id, integrations, repo, skill } from "./shared.ts";

const cron = z
    .string()
    .max(CRON_MAX)
    .describe(
        "Five-field cron in the server's local time: minute hour day-of-month month " +
            "day-of-week (0 and 7 are Sunday); *, lists, ranges and steps, e.g. '30 6 * * 1-5'",
    );

export function registerAutomationTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_list_automations",
        {
            description:
                "List automations: schedule, task template or workflow, enabled, last run. " +
                "builtin marks the memory upkeep every project gets (weave, lint): it runs on " +
                "its schedule only when there is work, and it can be turned off or changed but " +
                "not deleted, renamed or moved.",
        },
        () => call("GET", "/api/automations"),
    );
    server.registerTool(
        "olimp_get_automation",
        { description: "Show one automation.", inputSchema: { id } },
        ({ id }) => call("GET", `/api/automations/${id}`),
    );
    const workflowRef = z
        .string()
        .max(REF_MAX)
        .describe(
            "Workflow id to run instead of a task template (repo, title, body, agent, skill, " +
                "integrations)",
        );
    server.registerTool(
        "olimp_create_automation",
        {
            description:
                "Create an automation that queues on a cron schedule either a task (repo and " +
                "title required) or a run of a workflow (workflow), never both.",
            inputSchema: {
                name: z.string().min(1).max(NAME_MAX),
                cron,
                workflow: workflowRef.optional(),
                repo: repo.optional(),
                title: z.string().min(1).max(TITLE_MAX).optional(),
                body: z.string().max(TASK_BODY_MAX).optional(),
                agent: agent.optional(),
                skill: skill.optional(),
                integrations: integrations.optional(),
                enabled: z.boolean().optional().describe("true by default"),
            },
        },
        (args) => call("POST", "/api/automations", args),
    );
    server.registerTool(
        "olimp_update_automation",
        {
            description:
                "Change an automation: only the given fields change; enabled turns it on or off, " +
                "skill null removes the skill. workflow switches it to a workflow and drops the " +
                "task template; workflow null switches back and needs repo and title.",
            inputSchema: {
                id,
                name: z.string().min(1).max(NAME_MAX).optional(),
                cron: cron.optional(),
                workflow: workflowRef.nullable().optional(),
                repo: repo.optional(),
                title: z.string().min(1).max(TITLE_MAX).optional(),
                body: z.string().max(TASK_BODY_MAX).optional(),
                agent: agent.optional(),
                skill: skill.nullable().optional(),
                integrations: integrations.optional(),
                enabled: z.boolean().optional(),
            },
        },
        ({ id, ...patch }) => call("PATCH", `/api/automations/${id}`, patch),
    );
    server.registerTool(
        "olimp_delete_automation",
        {
            description: "Delete an automation; tasks it queued keep its id.",
            inputSchema: { id },
        },
        ({ id }) => call("DELETE", `/api/automations/${id}`),
    );
    server.registerTool(
        "olimp_run_automation",
        {
            description: "Queue the automation's task now, outside its schedule.",
            inputSchema: { id },
        },
        ({ id }) => call("POST", `/api/automations/${id}/run`),
    );
}
