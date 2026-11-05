import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { IN_FLIGHT_MAX, SUBTASKS_MAX } from "../dispatch.ts";
import {
    ATTACHMENTS_MAX,
    COMMITS_MAX,
    FILE_MAX,
    PATH_MAX,
    REF_MAX,
    TASK_BODY_MAX,
    TITLE_MAX,
    TREE_FILES_MAX,
    UPLOAD_MAX,
    VARIANTS_MAX,
} from "../limits.ts";
import { EVENT_RETENTION_DAYS } from "../trace.ts";
import { agent, type Call, changesNote, id, integrations, model, repo, skill } from "./shared.ts";

const attachments = z
    .array(z.string().regex(/^[0-9a-f]{24}$/))
    .max(ATTACHMENTS_MAX)
    .describe("Upload ids from olimp_upload_file");

export function registerTaskTools(
    server: McpServer,
    call: Call,
    file: (path: string) => Promise<CallToolResult>,
): void {
    server.registerTool(
        "olimp_create_task",
        {
            description:
                "Queue a task: an agent changes the repository and OLIMP opens a pull request. " +
                `With variants 2 or ${VARIANTS_MAX}, as many tasks of one prompt run, each in its ` +
                "own worktree (B leans to a minimal change, C to a thorough one), and the reply is " +
                "{group, tasks}: compare them, then olimp_pick_variant keeps one.",
            inputSchema: {
                repo,
                title: z.string().min(1).max(TITLE_MAX),
                body: z.string().max(TASK_BODY_MAX).optional(),
                agent: agent.optional(),
                model: model.optional(),
                skill: skill.optional(),
                integrations: integrations.optional(),
                attachments: attachments.optional(),
                variants: z.number().int().min(1).max(VARIANTS_MAX).optional(),
                dispatch: z
                    .union([
                        z.boolean(),
                        z.object({
                            maxSubtasks: z.number().int().min(1).max(SUBTASKS_MAX).optional(),
                            inFlight: z.number().int().min(1).max(IN_FLIGHT_MAX).optional(),
                            agent: agent
                                .optional()
                                .describe("The subtasks' agent; the task's by default"),
                            model: model
                                .optional()
                                .describe("The subtasks' model; the task's by default"),
                            budgetUsd: z
                                .number()
                                .positive()
                                .max(1000)
                                .optional()
                                .describe(
                                    "What one subtask should cost at most, told to the agent",
                                ),
                        }),
                    ])
                    .optional()
                    .describe(
                        "Let the agent split the task into subtasks (true: up to " +
                            `${SUBTASKS_MAX}, ${IN_FLIGHT_MAX} at once); they run after it on its ` +
                            "branch, then a step of its thread merges them",
                    ),
                worktree: z
                    .boolean()
                    .optional()
                    .describe(
                        "false: work in the project's own checkout, one such task at a time, " +
                            "instead of a worktree of its own; without newBranch the changes stay " +
                            "uncommitted there for review. Not with variants or dispatch",
                    ),
                newBranch: z
                    .boolean()
                    .optional()
                    .describe(
                        "With worktree false: switch the checkout to a new branch from the base " +
                            "first, commit there and open a pull request",
                    ),
                branch: z
                    .string()
                    .max(REF_MAX)
                    .optional()
                    .describe("The new branch's name; olimp/<task id> by default"),
            },
        },
        (args) => call("POST", "/api/tasks", args),
    );
    server.registerTool(
        "olimp_list_subtasks",
        {
            description:
                "List the subtasks a dispatched task's agent added, oldest first, with status, " +
                "branch and answer; the task's dispatchMerge names the step that merges them.",
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/tasks/${id}/subtasks`),
    );
    server.registerTool(
        "olimp_upload_file",
        {
            description:
                "Stage a file to attach to a task (olimp_create_task or olimp_continue_task " +
                `attachments): at most ${UPLOAD_MAX / 1024 / 1024} MB, kept for a day until used. ` +
                "The agent reads it from OLIMP's folder by path. Replies with its upload id.",
            inputSchema: {
                name: z.string().min(1).max(PATH_MAX).describe("File name, e.g. screenshot.png"),
                data: z.string().describe("The file's content in base64"),
                mediaType: z.string().max(100).optional().describe("e.g. image/png"),
            },
        },
        (args) => call("POST", "/api/uploads", args),
    );
    server.registerTool(
        "olimp_get_task_attachment",
        {
            description:
                "Read a file attached to a task, by a name from the task's attachments: an image " +
                "comes as an image, anything else as {mediaType, data} in base64.",
            inputSchema: { id, name: z.string().min(1).max(PATH_MAX) },
        },
        ({ id, name }) => file(`/api/tasks/${id}/attachments/${encodeURIComponent(name)}`),
    );
    server.registerTool(
        "olimp_get_variants",
        {
            description:
                "Show the variants of one prompt (a group from olimp_create_task with variants): " +
                "each task with its status, usage, lines changed and answer.",
            inputSchema: { group: id.describe("The group id") },
        },
        ({ group }) => call("GET", `/api/task-groups/${group}`),
    );
    server.registerTool(
        "olimp_pick_variant",
        {
            description:
                "Keep one variant once all have finished: every other one is archived, its pull " +
                "request closed with its branch deleted (a local project's branch is deleted).",
            inputSchema: { group: id.describe("The group id"), task: id.describe("The winner") },
        },
        ({ group, task }) => call("POST", `/api/task-groups/${group}/pick`, { task }),
    );
    server.registerTool(
        "olimp_list_tasks",
        { description: "List recent OLIMP tasks with their status and pull request." },
        () => call("GET", "/api/tasks"),
    );
    server.registerTool(
        "olimp_get_task",
        {
            description: "Show one OLIMP task: status, branch, pull request, error and agent log.",
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/tasks/${id}`),
    );
    server.registerTool(
        "olimp_get_task_trace",
        {
            description:
                "Show the trace of a task's agent step in order: the whole prompt OLIMP sent and " +
                "the command that started the agent (environment values only where they hold no " +
                "secret), what Claude loaded (session), messages, tool calls with their whole " +
                "input and output (an edit as - and + lines), the result with turns, cost and " +
                "tokens, and errors; every event's whole content is in `detail`. " +
                `Events are kept for ${EVENT_RETENTION_DAYS} days.`,
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/tasks/${id}/trace`),
    );
    server.registerTool(
        "olimp_get_task_changes",
        {
            description: `${changesNote("task")} A continuation shows its whole thread's branch.`,
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/tasks/${id}/changes`),
    );
    server.registerTool(
        "olimp_list_task_commits",
        {
            description:
                "List the commits a task's branch adds to the default branch, newest first, as " +
                `OLIMP's clone has them (nothing is fetched): sha, parents, refs, author, email, date, title and body, at ` +
                `most ${COMMITS_MAX} (truncated says so). head is null while nothing was pushed.`,
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/tasks/${id}/commits`),
    );
    server.registerTool(
        "olimp_get_task_commit",
        {
            description:
                "Show one commit of a task's branch: its message, changed files and diff, cut as " +
                "in olimp_get_task_changes. Only the branch's own commits, not the rest of history.",
            inputSchema: {
                id,
                sha: z
                    .string()
                    .regex(/^[0-9a-f]{7,40}$/)
                    .describe("Commit sha, full or abbreviated"),
            },
        },
        ({ id, sha }) => call("GET", `/api/tasks/${id}/commits/${sha}`),
    );
    server.registerTool(
        "olimp_list_task_files",
        {
            description:
                "List every file at the head of a task's branch, paths from the repository root, " +
                `at most ${TREE_FILES_MAX} (truncated says so). head is null while nothing was pushed.`,
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/tasks/${id}/files`),
    );
    server.registerTool(
        "olimp_get_task_file",
        {
            description:
                "Read one file at the head of a task's branch: size, whether it is binary (then " +
                "without content, except an image: its media type in image and base64 content) " +
                `and its text, cut at ${FILE_MAX} characters (truncated says so).`,
            inputSchema: {
                id,
                path: z
                    .string()
                    .min(1)
                    .max(PATH_MAX)
                    .describe("Path from the repository root, as olimp_list_task_files lists it"),
            },
        },
        ({ id, path }) => call("GET", `/api/tasks/${id}/files?path=${encodeURIComponent(path)}`),
    );
    server.registerTool(
        "olimp_get_task_thread",
        {
            description:
                "Show the whole thread of a task, oldest first: the first task and every " +
                "continuation, each with its request, answer, status and usage.",
            inputSchema: { id: id.describe("Any task of the thread") },
        },
        ({ id }) => call("GET", `/api/tasks/${id}/thread`),
    );
    server.registerTool(
        "olimp_cancel_task",
        {
            description:
                "Cancel a task: a queued one never starts; a running one has its agent stopped " +
                "(SIGTERM, then SIGKILL), its worktree removed and its notes and memory kept, as " +
                "after a failure. Replies with the task once it is cancelled.",
            inputSchema: { id },
        },
        ({ id }) => call("POST", `/api/tasks/${id}/cancel`),
    );
    server.registerTool(
        "olimp_archive_task",
        {
            description:
                "Archive a finished task: it leaves the active task lists and the panel's recent " +
                "tasks; its branch, pull request, trace and notes stay. olimp_unarchive_task " +
                "restores it. Replies with the task, archivedAt set.",
            inputSchema: { id },
        },
        ({ id }) => call("PUT", `/api/tasks/${id}/archive`),
    );
    server.registerTool(
        "olimp_unarchive_task",
        {
            description: "Restore an archived task to the active lists. Replies with the task.",
            inputSchema: { id },
        },
        ({ id }) => call("DELETE", `/api/tasks/${id}/archive`),
    );
    server.registerTool(
        "olimp_pin_task",
        {
            description:
                "Pin a task for the calling account (for the installation while there are no " +
                "accounts): pinned tasks stay on top of the panel's recent tasks. Replies with the " +
                "account's pinned task ids, in the order they were pinned.",
            inputSchema: { id },
        },
        ({ id }) => call("PUT", `/api/tasks/${id}/pin`),
    );
    server.registerTool(
        "olimp_unpin_task",
        {
            description: "Unpin a task for the calling account. Replies with its pinned task ids.",
            inputSchema: { id },
        },
        ({ id }) => call("DELETE", `/api/tasks/${id}/pin`),
    );
    server.registerTool(
        "olimp_list_pins",
        {
            description:
                "List the ids of the tasks the calling account pinned, in the order they were " +
                "pinned (olimp_get_task reads one).",
        },
        () => call("GET", "/api/pins"),
    );
    const marks = [
        ["task", "tasks", "olimp_mark_task_read", "olimp_mark_task_unread"],
        ["workflow run", "workflow-runs", "olimp_mark_run_read", "olimp_mark_run_unread"],
    ] as const;
    for (const [what, route, read, unread] of marks) {
        server.registerTool(
            read,
            {
                description:
                    `Mark a finished ${what} as read for the calling account (for the ` +
                    "installation while there are no accounts). Replies with the ids of the tasks " +
                    "and runs the account has read.",
                inputSchema: { id },
            },
            ({ id }) => call("PUT", `/api/${route}/${id}/read`),
        );
        server.registerTool(
            unread,
            {
                description: `Mark a ${what} as unread again for the calling account. Replies with what it has read.`,
                inputSchema: { id },
            },
            ({ id }) => call("DELETE", `/api/${route}/${id}/read`),
        );
    }
    server.registerTool(
        "olimp_list_reads",
        {
            description:
                "List the ids of the tasks and workflow runs the calling account has read: " +
                "{ tasks, runs }. A finished one missing here is unread.",
        },
        () => call("GET", "/api/reads"),
    );
    server.registerTool(
        "olimp_retry_task",
        {
            description:
                "Queue a finished task again as a new task with the same template (repository, " +
                "title, body, agent, skill, integrations), linked by retryOf, on your behalf.",
            inputSchema: { id },
        },
        ({ id }) => call("POST", `/api/tasks/${id}/retry`),
    );
    server.registerTool(
        "olimp_continue_task",
        {
            description:
                "Continue a task's thread with a new request: a new task on the same branch, " +
                "whose agent sees the earlier tasks of the thread (titles, requests, answers) as " +
                "context. Its changes go to the thread's pull request, or open one if the thread " +
                "has none yet.",
            inputSchema: {
                id: id.describe("Any task of the thread"),
                body: z.string().min(1).max(TASK_BODY_MAX).describe("What to do next"),
                model: model.optional().describe("By default the model the thread used"),
                attachments: attachments.optional(),
                title: z
                    .string()
                    .min(1)
                    .max(TITLE_MAX)
                    .optional()
                    .describe("The title of the task continued by default"),
            },
        },
        ({ id, ...body }) => call("POST", `/api/tasks/${id}/continue`, body),
    );
}
