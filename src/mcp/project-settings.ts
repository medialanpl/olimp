import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AGENTS } from "../agents.ts";
import {
    AGENT_CONFIG_MAX,
    AREAS_MAX,
    COMMAND_MAX,
    COMMANDS_MAX,
    INSTRUCTIONS_MAX,
    ISSUE_LABEL_MAX,
    KEEP_WORKTREES_MAX,
    NAME_MAX,
    PR_LABELS_MAX,
    REF_MAX,
    SCRIPT_MAX,
    SCRIPT_NAME_MAX,
    SCRIPT_TIMEOUT_MAX_S,
    SECRET_NAME_MAX,
    SECRET_VALUE_MAX,
    WEBHOOK_URL_MAX,
    WORKTREE_SCRIPTS_MAX,
} from "../limits.ts";
import { type Call, id, loginName, model, perAgent, repo, repoPath } from "./shared.ts";

export function registerProjectSettingsTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_set_commands",
        {
            description:
                "Set the shell commands agents check their work with in the repository, " +
                "e.g. pnpm typecheck, pnpm lint, pnpm run test; replaces the current list. Every " +
                "prompt asks the agent to run them before it finishes. They do not limit the " +
                "shell: every agent may run any command (Codex inside its own sandbox).",
            inputSchema: {
                repo,
                commands: z
                    .array(z.string().min(1).max(COMMAND_MAX))
                    .min(1)
                    .max(COMMANDS_MAX)
                    .describe("One command each, without ; & | ` $ < > ( ) , * \\ or a line break"),
            },
        },
        ({ repo, ...body }) => call("PUT", repoPath(repo, "commands"), body),
    );
    server.registerTool(
        "olimp_clear_commands",
        {
            description:
                "Remove the repository's commands: prompts no longer ask agents to run them.",
            inputSchema: { repo },
        },
        ({ repo }) => call("DELETE", repoPath(repo, "commands")),
    );
    server.registerTool(
        "olimp_set_repo_agents",
        {
            description:
                "Set what the repository's tasks run on, replacing its earlier choice: the agent " +
                "of new tasks, the model per agent and the caller's login per agent by name " +
                "(see olimp_list_agents; each author needs a login of that name). Whatever is " +
                "left out takes the installation's defaults and the default login.",
            inputSchema: {
                repo,
                agent: z.enum(AGENTS).nullable().optional(),
                models: perAgent(model).optional(),
                logins: perAgent(loginName).optional(),
            },
        },
        ({ repo, ...body }) => call("PUT", repoPath(repo, "agents"), body),
    );
    const worktreeScripts = z
        .array(
            z.object({
                name: z.string().max(SCRIPT_NAME_MAX).optional(),
                command: z.string().min(1).max(SCRIPT_MAX),
                timeoutSeconds: z
                    .number()
                    .int()
                    .min(1)
                    .max(SCRIPT_TIMEOUT_MAX_S)
                    .nullable()
                    .optional()
                    .describe("Default 1800"),
            }),
        )
        .max(WORKTREE_SCRIPTS_MAX)
        .optional();
    server.registerTool(
        "olimp_update_repo_settings",
        {
            description:
                "Change a project's own settings; the fields left out stay. instructions: the " +
                "project's system prompt, read by every agent step of its new tasks and runs after " +
                "the global one (olimp_set_instructions) and winning over it; empty clears it. " +
                "workspace: where a task works when olimp_create_task does not say (worktree, " +
                "checkout: the project's own folder, one task at a time; null: a worktree). " +
                "keepWorktrees: how many finished job worktrees stay on disk (0 removes each " +
                "when its job ends; the branch always stays). worktreeScripts (admin only): Bash " +
                "scripts run as the OLIMP user in a job's worktree, in order: afterCreate before " +
                "its agent (a failure fails the job), beforeRemove before the worktree goes (a " +
                "failure keeps the folder); they get OLIMP_PROJECT_PATH, OLIMP_WORKTREE_PATH, " +
                "OLIMP_JOB_ID and OLIMP_BRANCH; checked with bash -n when saved; replaces both " +
                "lists. " +
                "defaultSkill: the skill the panel's composer preselects (olimp_list_skills). " +
                "teamSkills: false offers only the project's and HOME's own skills there. " +
                "draftPr: open pull requests as drafts. prLabels: labels on every pull request " +
                "OLIMP opens (made in the repository when missing). typeLabel: the agent names " +
                "the kind of change (fix, feat, docs, refactor, test, chore, perf) and its task's " +
                "pull request gets it as a label. autoMergeLabel (admin only): OLIMP merges its " +
                "own pull requests with this label once at least one check ran and every check " +
                "passed; null turns it off. memory: the knowledge base, off by default: on, its " +
                "agent steps get the olimp-memory MCP server, whose tools search and read the " +
                "project's memory and add notes and sections when the agent asks, and the memory " +
                "upkeep (weaving and lint) runs; off, agents rely on the repository's own files " +
                "(AGENTS.md, CLAUDE.md). areas: other projects whose memory is a knowledge area " +
                "of this one (a company's or a person's): with memory on, its agent steps read " +
                "and write their memory beside its own; replaces the list.",
            inputSchema: {
                repo,
                instructions: z.string().max(INSTRUCTIONS_MAX).optional(),
                workspace: z.enum(["worktree", "checkout"]).nullable().optional(),
                keepWorktrees: z.number().int().min(0).max(KEEP_WORKTREES_MAX).optional(),
                worktreeScripts: z
                    .object({ afterCreate: worktreeScripts, beforeRemove: worktreeScripts })
                    .optional(),
                defaultSkill: z.string().min(1).max(REF_MAX).nullable().optional(),
                teamSkills: z.boolean().optional(),
                draftPr: z.boolean().optional(),
                prLabels: z
                    .array(
                        z
                            .string()
                            .min(1)
                            .max(ISSUE_LABEL_MAX)
                            .regex(/^[^,]+$/),
                    )
                    .max(PR_LABELS_MAX)
                    .optional(),
                memory: z.boolean().optional(),
                areas: z
                    .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/))
                    .max(AREAS_MAX)
                    .optional(),
                typeLabel: z.boolean().optional(),
                autoMergeLabel: z
                    .string()
                    .min(1)
                    .max(ISSUE_LABEL_MAX)
                    .regex(/^[^,]+$/)
                    .nullable()
                    .optional(),
            },
        },
        ({ repo, ...body }) => call("PATCH", repoPath(repo, "settings"), body),
    );
    const secretName = z
        .string()
        .regex(new RegExp(`^[A-Za-z_]\\w{0,${SECRET_NAME_MAX - 1}}$`))
        .describe(`The name integrations refer to as \${NAME}`);
    server.registerTool(
        "olimp_list_secrets",
        {
            description:
                "List a project's secrets by name, never their values (admin only). A secret " +
                `fills the \${NAME} references of the project's integrations and wins over the ` +
                "OLIMP process's variable of that name.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", repoPath(repo, "secrets")),
    );
    server.registerTool(
        "olimp_set_secret",
        {
            description:
                "Add a project secret or replace its value (admin only). It is stored encrypted " +
                "and reaches an agent step only through an integration that refers to it. Names " +
                "of OLIMP_ and of variables agents get anyway (PATH, ANTHROPIC_API_KEY) are refused.",
            inputSchema: {
                repo,
                name: secretName,
                value: z.string().min(1).max(SECRET_VALUE_MAX),
            },
        },
        ({ repo, name, value }) => call("PUT", repoPath(repo, `secrets/${name}`), { value }),
    );
    server.registerTool(
        "olimp_delete_secret",
        {
            description: "Delete a project secret (admin only).",
            inputSchema: { repo, name: secretName },
        },
        ({ repo, name }) => call("DELETE", repoPath(repo, `secrets/${name}`)),
    );
    const webhookFields = {
        name: z.string().min(1).max(NAME_MAX),
        url: z
            .string()
            .url()
            .max(WEBHOOK_URL_MAX)
            .describe(
                "An https:// address: a Slack or Discord incoming webhook, an ntfy topic " +
                    "(https://ntfy.sh/TOPIC or a self-hosted server's), or your own",
            ),
        format: z
            .enum(["json", "slack", "discord", "ntfy"])
            .describe(
                "json: the job as JSON with a text line; slack and discord: their message; " +
                    "ntfy: a phone notification that opens the job",
            ),
        token: z
            .string()
            .max(SECRET_VALUE_MAX)
            .describe(
                "ntfy only: the access token of a protected topic, sent as a Bearer token and " +
                    "never shown again; an empty string removes it",
            ),
        events: z
            .array(z.enum(["done", "failed", "cancelled", "waiting"]))
            .min(1)
            .describe(
                "How a task or workflow run ended, or waiting: a run stopped at a gate or a " +
                    "question for a person; done and failed by default",
            ),
        enabled: z.boolean(),
        automations: z
            .boolean()
            .describe("Whether jobs an automation queued are sent too; true by default"),
    };
    const webhookId = id.describe("The webhook id from olimp_list_webhooks");
    server.registerTool(
        "olimp_list_webhooks",
        {
            description:
                "List a project's webhooks (admin only): name, format, events, the host of the " +
                "address (never the address, which holds its token), whether an ntfy token is " +
                "set and the last delivery since OLIMP started.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", repoPath(repo, "webhooks")),
    );
    server.registerTool(
        "olimp_add_webhook",
        {
            description:
                "Add a receiver of the project's job updates (admin only): when a task or workflow " +
                "run ends with one of the events, or a run waits for a person, OLIMP posts its " +
                "title, status and link there.",
            inputSchema: {
                repo,
                name: webhookFields.name,
                url: webhookFields.url,
                format: webhookFields.format.optional(),
                token: webhookFields.token.optional(),
                events: webhookFields.events.optional(),
                enabled: webhookFields.enabled.optional(),
                automations: webhookFields.automations.optional(),
            },
        },
        ({ repo, ...body }) => call("POST", repoPath(repo, "webhooks"), body),
    );
    server.registerTool(
        "olimp_update_webhook",
        {
            description: "Change a webhook (admin only); the fields left out stay.",
            inputSchema: {
                repo,
                id: webhookId,
                name: webhookFields.name.optional(),
                url: webhookFields.url.optional(),
                format: webhookFields.format.optional(),
                token: webhookFields.token.optional(),
                events: webhookFields.events.optional(),
                enabled: webhookFields.enabled.optional(),
                automations: webhookFields.automations.optional(),
            },
        },
        ({ repo, id, ...body }) => call("PATCH", repoPath(repo, `webhooks/${id}`), body),
    );
    server.registerTool(
        "olimp_delete_webhook",
        {
            description: "Delete a webhook (admin only).",
            inputSchema: { repo, id: webhookId },
        },
        ({ repo, id }) => call("DELETE", repoPath(repo, `webhooks/${id}`)),
    );
    server.registerTool(
        "olimp_test_webhook",
        {
            description:
                "Send a test message to a webhook (admin only) and show how the delivery went.",
            inputSchema: { repo, id: webhookId },
        },
        ({ repo, id }) => call("POST", repoPath(repo, `webhooks/${id}/test`)),
    );
    const configId = z
        .string()
        .regex(/^[a-z]+(\.[a-z]+)+$/)
        .describe("A file id from olimp_list_agent_config, e.g. claude.project.settings");
    server.registerTool(
        "olimp_list_agent_config",
        {
            description:
                "List the coding agents' own config files for a project: per " +
                "agent, its settings, MCP and memory files in the project's folder (project " +
                "scope, and the git-ignored local one; seeded files are copied into each job's " +
                "worktree) and in the caller's HOME (user scope), with whether each exists; and " +
                "mcpServers, the names of Claude's MCP servers in the caller's ~/.claude.json " +
                "(user scope, and the local one of the project's folder), never their entries.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", repoPath(repo, "agent-config")),
    );
    server.registerTool(
        "olimp_get_agent_config",
        {
            description: "Read one agent config file; empty content when it does not exist yet.",
            inputSchema: { repo, file: configId },
        },
        ({ repo, file }) => call("GET", repoPath(repo, `agent-config/${file}`)),
    );
    server.registerTool(
        "olimp_set_agent_config",
        {
            description:
                "Write one agent config file, creating it when missing; JSON files must parse. " +
                "A project file (admin only) changes the project's folder without a commit, so " +
                "tasks in worktrees see it only once it is committed on the base branch.",
            inputSchema: { repo, file: configId, content: z.string().max(AGENT_CONFIG_MAX) },
        },
        ({ repo, file, content }) =>
            call("PUT", repoPath(repo, `agent-config/${file}`), { content }),
    );
    server.registerTool(
        "olimp_list_worktrees",
        {
            description:
                "List the worktrees of a project's jobs on disk, newest first: the job, its " +
                "branch, whether it is still working, and when it last changed. Finished ones " +
                "stay only as many as the project keeps (olimp_update_repo_settings) or after a crash.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", repoPath(repo, "worktrees")),
    );
    server.registerTool(
        "olimp_reclaim_worktrees",
        {
            description:
                "Remove the project's finished worktrees beyond the ones it keeps (admin only), " +
                "their branches stay.",
            inputSchema: { repo },
        },
        ({ repo }) => call("POST", repoPath(repo, "worktrees/reclaim")),
    );
    server.registerTool(
        "olimp_remove_worktree",
        {
            description:
                "Remove a worktree of a job that is not working (admin only); its branch stays, " +
                "so the work can be recovered.",
            inputSchema: { repo, id: z.string().regex(/^[\w.-]{1,100}$/) },
        },
        ({ repo, id }) => call("DELETE", repoPath(repo, `worktrees/${id}`)),
    );
}
