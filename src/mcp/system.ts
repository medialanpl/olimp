import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
    COST_DAYS_MAX,
    COST_GROUPS,
    EMAIL_MAX,
    EVENT_WATCH_MAX,
    EVENT_WATCH_SECONDS_MAX,
    INSTRUCTIONS_MAX,
    PARALLEL_MAX,
    PATH_MAX,
    TEMPLATE_LABEL_MAX,
    TEMPLATE_TEXT_MAX,
    TEMPLATES_MAX,
    TIMEOUT_MAX_MIN,
} from "../limits.ts";
import type { Call } from "./shared.ts";

export function registerSystemTools(
    server: McpServer,
    call: Call,
    watch: (seconds: number, max: number) => Promise<CallToolResult>,
): void {
    server.registerTool(
        "olimp_get_machine",
        {
            description:
                "Show the machine OLIMP runs on: host, system user, CPU use, memory, load average, " +
                "cores, and OLIMP's own memory, uptime and running jobs.",
        },
        () => call("GET", "/api/machine"),
    );
    server.registerTool(
        "olimp_get_version",
        {
            description:
                "Show OLIMP's version, the git checkout it runs from (commit, branch, uncommitted " +
                "changes) and the last check for updates on origin.",
        },
        () => call("GET", "/api/version"),
    );
    server.registerTool(
        "olimp_check_update",
        {
            description:
                "Fetch origin and count the commits the checkout is behind and ahead (admin only).",
        },
        () => call("POST", "/api/version/check", {}),
    );
    server.registerTool(
        "olimp_update",
        {
            description:
                "Update OLIMP from origin and restart it (admin only): pull, pnpm install and " +
                "build, then a new process. Refused while jobs run, with uncommitted changes or " +
                "own commits in the checkout, or when it is up to date. The API is down for a few " +
                "seconds; ongoing MCP calls fail meanwhile.",
        },
        () => call("POST", "/api/version/update", {}),
    );
    server.registerTool(
        "olimp_get_settings",
        {
            description:
                "Show the installation's settings in force, their defaults from the environment and " +
                "which ones were saved: maxParallel (jobs at once), taskTimeoutMin (agent time " +
                "limit), projectsDir (where new and cloned projects go), browseRoot (where the " +
                "folder picker starts).",
        },
        () => call("GET", "/api/settings"),
    );
    server.registerTool(
        "olimp_update_settings",
        {
            description:
                "Save settings (admin only); they apply at once. null goes back to the default " +
                "from the environment. Folders must exist and be writable.",
            inputSchema: {
                maxParallel: z.number().int().min(1).max(PARALLEL_MAX).nullable().optional(),
                taskTimeoutMin: z.number().int().min(1).max(TIMEOUT_MAX_MIN).nullable().optional(),
                projectsDir: z.string().max(PATH_MAX).nullable().optional(),
                browseRoot: z.string().max(PATH_MAX).nullable().optional(),
            },
        },
        (args) => call("PUT", "/api/settings", args),
    );
    server.registerTool(
        "olimp_get_mail",
        {
            description:
                "Show the SMTP server OLIMP sends invitations, password resets and sign-in codes " +
                "through (admin only): the one saved in the panel or, without it, OLIMP_SMTP_URL " +
                "and OLIMP_MAIL_FROM. The password is never shown, only whether there is one.",
        },
        () => call("GET", "/api/mail"),
    );
    server.registerTool(
        "olimp_update_mail",
        {
            description:
                "Save the SMTP server (admin only); it replaces the environment's at once. secure " +
                "is TLS from the first byte (usually port 465), otherwise STARTTLS. Leave password " +
                "out to keep the one in force; an empty one signs in without it.",
            inputSchema: {
                host: z.string().max(253),
                port: z.number().int().min(1).max(65_535),
                secure: z.boolean(),
                user: z.string().max(254).optional(),
                password: z.string().max(1024).optional(),
                from: z.string().max(320),
            },
        },
        (args) => call("PUT", "/api/mail", args),
    );
    server.registerTool(
        "olimp_reset_mail",
        {
            description:
                "Forget the SMTP server saved in the panel (admin only): OLIMP_SMTP_URL and " +
                "OLIMP_MAIL_FROM apply again.",
        },
        () => call("DELETE", "/api/mail"),
    );
    server.registerTool(
        "olimp_send_test_mail",
        {
            description:
                "Send a test e-mail through the SMTP server in force, to `to` or the caller's own " +
                "address (admin only).",
            inputSchema: { to: z.string().max(EMAIL_MAX).optional() },
        },
        (args) => call("POST", "/api/mail/test", args),
    );
    server.registerTool(
        "olimp_get_prompt_templates",
        {
            description:
                "Show the saved prompt templates of the task composer, or null while the panel's " +
                "built-in ones apply.",
            inputSchema: {},
        },
        () => call("GET", "/api/prompt-templates"),
    );
    server.registerTool(
        "olimp_set_prompt_templates",
        {
            description:
                "Replace the prompt templates of the task composer; null brings back the panel's " +
                "built-in ones.",
            inputSchema: {
                templates: z
                    .array(
                        z.object({
                            id: z.string().regex(/^[\w-]{1,40}$/),
                            label: z.string().min(1).max(TEMPLATE_LABEL_MAX),
                            text: z.string().min(1).max(TEMPLATE_TEXT_MAX),
                        }),
                    )
                    .max(TEMPLATES_MAX)
                    .nullable(),
            },
        },
        ({ templates }) => call("PUT", "/api/prompt-templates", { templates }),
    );
    server.registerTool(
        "olimp_get_instructions",
        {
            description:
                "Show the global system prompt every agent step of every project reads first; " +
                "an empty string when none is set.",
            inputSchema: {},
        },
        () => call("GET", "/api/instructions"),
    );
    server.registerTool(
        "olimp_set_instructions",
        {
            description:
                "Replace the global system prompt (admin only). It applies to agent steps that " +
                "start afterwards; the repository's own AGENTS.md or CLAUDE.md wins where they " +
                "conflict. An empty string clears it.",
            inputSchema: { instructions: z.string().max(INSTRUCTIONS_MAX) },
        },
        ({ instructions }) => call("PUT", "/api/instructions", { instructions }),
    );
    server.registerTool(
        "olimp_get_costs",
        {
            description:
                "Report agent usage of tasks and workflow runs queued in the last days: jobs, " +
                "cost in USD, turns, input and output tokens and time, in total and by UTC day, " +
                "repository, agent (workflow for a run) or author. Codex, Cursor and Copilot report " +
                "no cost: such jobs count as unpriced.",
            inputSchema: {
                by: z.enum(COST_GROUPS).optional().describe("day by default"),
                days: z
                    .number()
                    .int()
                    .min(1)
                    .max(COST_DAYS_MAX)
                    .optional()
                    .describe("30 by default"),
            },
        },
        ({ by, days }) => {
            const query = new URLSearchParams();
            if (by) query.set("by", by);
            if (days) query.set("days", String(days));
            return call("GET", `/api/costs${query.size ? `?${query}` : ""}`);
        },
    );
    server.registerTool(
        "olimp_watch_events",
        {
            description:
                "Listen to OLIMP's live events for a while and return them in order: changes of " +
                "tasks (type task) and workflow runs (type run), and agent events of running " +
                "steps (type agent). Ends after the given seconds or events.",
            inputSchema: {
                seconds: z
                    .number()
                    .int()
                    .min(1)
                    .max(EVENT_WATCH_SECONDS_MAX)
                    .optional()
                    .describe("10 by default"),
                max: z
                    .number()
                    .int()
                    .min(1)
                    .max(EVENT_WATCH_MAX)
                    .optional()
                    .describe("Stop after this many events; 50 by default"),
            },
        },
        ({ seconds, max }) => watch(seconds ?? 10, max ?? 50),
    );
}
