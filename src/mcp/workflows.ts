import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    BUILD_REQUEST_MAX,
    NAME_MAX,
    TASK_BODY_MAX,
    TITLE_MAX,
    WORKFLOW_DESCRIPTION_MAX,
} from "../limits.ts";
import { EVENT_RETENTION_DAYS } from "../trace.ts";
import { NODE_ID } from "../workflow-graph.ts";
import { type Call, changesNote, id, repo } from "./shared.ts";

// A guide to the node types for agents; the API validates every field.
const NODE_GUIDE = [
    "start → next. The single entry; {{task}} in any text field is the request the run was given",
    "end {status: success|failed} closes the run with that status",
    "loop {max: 1..20} → repeat, exhausted. Leaves by repeat until it was entered more than max " +
        "times; a cycle is allowed only through a loop",
    "agent {prompt, skill?, agent?, model?, integrations?, allowedTools?, bashAllowlist?, verdicts?, " +
        "session.continue?, review?, budgetUsd?} → done, failed (with verdicts: one port per verdict " +
        "plus failed). Runs an agent in the run's worktree; outputs summary, verdict, costUsd, status",
    "check {command, retryOn?} → pass, fail. A shell command in the worktree; outputs exitCode, output",
    "if {condition} → true, false. condition is one of {kind: diff-lines|diff-files, op, value}, " +
        "{kind: paths-changed, glob}, {kind: output, ref: <node>.<output>, op, value}, " +
        "{kind: branch, op: equals|matches, value}",
    "gate.human {message, timeoutMs?} → approve, reject, plus timeout when it has one",
    "ask-user {question, options?, timeoutMs?} → answered, plus timeout when it has one; output answer",
    "dispatch {prompt, agent?, model?, budgetUsd?} → done, failed. A subtask from the run's branch",
    "fork {branches: 2..4} → 1..n. Each port leads to one agent that runs as a subtask, all at once; " +
        "their done and failed ports all lead into the same join {wait: all|any} → done, failed",
    "workflow {workflow: the id of another workflow of this repository, prompt?} → done, failed",
    "git.commit {message} → done, nothing, failed. git.push → done, failed. " +
        "git.sync-base → done, conflict, failed",
    "github.draft-pr {title?, draft?} → created, failed. github.pr-update {ready?, addLabels?, " +
        "reviewers?}, github.pr-comment {body} and github.issue-comment {issue?, body} → done, failed. " +
        "github.wait-ci {timeoutMs, pollMs} → green, red, timeout, failed",
    `notify.webhook {url: HTTPS or \${SECRET}, body?} → done, failed. Sends a JSON POST`,
].join(". ");

// Only id, type and name are checked here; the API reads and validates the other fields.
const graphNode = z.looseObject({
    type: z.string(),
    id: z.string().regex(NODE_ID),
    name: z.string().max(TITLE_MAX).optional(),
});
const graphEdge = z.object({ to: z.string(), from: z.string().describe("<node>.<port>") });
const coordinate = z.number();
const position = z.object({ x: coordinate, y: coordinate });
const canvas = z
    .record(z.string(), position)
    .describe("Positions of the nodes on the panel's canvas");

const definition = z
    .object({
        nodes: z
            .array(graphNode)
            .describe(`At most 50 nodes, one of them the start. Node types: ${NODE_GUIDE}`),
        edges: z
            .array(graphEdge)
            .describe(
                "Each edge leads from an output port of a node to another node. A port with no " +
                    "edge ends the run, as failed for failed, fail, exhausted, reject, red, " +
                    "timeout and conflict and as done for any other port. Text fields can read " +
                    "an earlier node's output as {{nodes.<id>.<output>}}.",
            ),
        layout: canvas.optional(),
    })
    .describe("The workflow as a graph of nodes and edges");

const workflowName = z.string().min(1).max(NAME_MAX);
const workflowDescription = z.string().max(WORKFLOW_DESCRIPTION_MAX).optional();

export function registerWorkflowTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_list_workflows",
        { description: "List workflows: name, description, repository and graph definition." },
        () => call("GET", "/api/workflows"),
    );
    server.registerTool(
        "olimp_create_workflow",
        {
            description:
                "Create a workflow: a graph of agents, checks, conditions, loops, gates, " +
                "subtasks and git/GitHub steps that runs in one worktree on one branch, each " +
                "step seeing the changes of the steps before it.",
            inputSchema: {
                name: workflowName,
                description: workflowDescription,
                repo,
                definition,
            },
        },
        (args) => call("POST", "/api/workflows", args),
    );
    server.registerTool(
        "olimp_get_workflow",
        { description: "Show one workflow with its definition.", inputSchema: { id } },
        ({ id }) => call("GET", `/api/workflows/${id}`),
    );
    server.registerTool(
        "olimp_update_workflow",
        {
            description:
                "Change a workflow: only the given fields change; definition replaces the whole " +
                "graph. Queued and running runs keep the definition they started with.",
            inputSchema: {
                id,
                name: workflowName.optional(),
                description: workflowDescription,
                repo: repo.optional(),
                definition: definition.optional(),
            },
        },
        ({ id, ...patch }) => call("PATCH", `/api/workflows/${id}`, patch),
    );
    server.registerTool(
        "olimp_delete_workflow",
        {
            description:
                "Delete a workflow; refused while an automation uses it. Its runs stay listed.",
            inputSchema: { id },
        },
        ({ id }) => call("DELETE", `/api/workflows/${id}`),
    );
    server.registerTool(
        "olimp_run_workflow",
        {
            description:
                "Queue a run of the workflow now. input is the request for this run; every agent " +
                "step reads it after its own instructions.",
            inputSchema: { id, input: z.string().max(TASK_BODY_MAX).optional() },
        },
        ({ id, input }) => call("POST", `/api/workflows/${id}/run`, { input }),
    );
    server.registerTool(
        "olimp_build_workflow",
        {
            description:
                "Have the repository's agent plan a workflow from a description of what it should " +
                "do: returns name, description and definition, not saved " +
                "(olimp_create_workflow saves it). One paid agent call.",
            inputSchema: { repo, request: z.string().min(1).max(BUILD_REQUEST_MAX) },
        },
        (args) => call("POST", "/api/workflows/build", args),
    );
    server.registerTool(
        "olimp_list_workflow_runs",
        {
            description:
                "List recent workflow runs: status, current node, branch, pull request, error.",
        },
        () => call("GET", "/api/workflow-runs"),
    );
    server.registerTool(
        "olimp_get_workflow_run",
        {
            description:
                "Show one workflow run with the state of every step it reached: status, start, " +
                "end, log tail and error.",
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/workflow-runs/${id}`),
    );
    server.registerTool(
        "olimp_get_workflow_run_trace",
        {
            description:
                "Show the trace of every agent step of a workflow run in order, each event with " +
                `its node. Events are kept for ${EVENT_RETENTION_DAYS} days.`,
            inputSchema: { id },
        },
        ({ id }) => call("GET", `/api/workflow-runs/${id}/trace`),
    );
    server.registerTool(
        "olimp_get_workflow_run_changes",
        { description: changesNote("workflow run"), inputSchema: { id } },
        ({ id }) => call("GET", `/api/workflow-runs/${id}/changes`),
    );
    server.registerTool(
        "olimp_cancel_workflow_run",
        {
            description:
                "Cancel a workflow run: a queued one never starts; a running one has its agent " +
                "stopped, its step and the run marked cancelled and its worktree removed; a " +
                "waiting one also cancels the subtasks it waits for.",
            inputSchema: { id },
        },
        ({ id }) => call("POST", `/api/workflow-runs/${id}/cancel`),
    );
    server.registerTool(
        "olimp_answer_workflow_run",
        {
            description:
                "Answer the gate or question a waiting workflow run stopped at (state.wait of " +
                "olimp_get_workflow_run): a gate takes approve or reject with an optional comment, " +
                "a question any text. The run is queued again and goes on from that node.",
            inputSchema: {
                id,
                answer: z.string().min(1).max(TASK_BODY_MAX),
                comment: z.string().max(TASK_BODY_MAX).optional(),
            },
        },
        ({ id, ...body }) => call("POST", `/api/workflow-runs/${id}/answer`, body),
    );
    server.registerTool(
        "olimp_retry_workflow_run",
        {
            description:
                "Queue a finished workflow run again with the definition it ran with, linked by " +
                "retryOf, on your behalf.",
            inputSchema: { id },
        },
        ({ id }) => call("POST", `/api/workflow-runs/${id}/retry`),
    );
    server.registerTool(
        "olimp_resume_workflow_run",
        {
            description:
                "Queue a failed workflow run again in place, to go on from the step it failed at " +
                "with the outputs, loop counters and sessions of the steps before it, in its kept " +
                "worktree or one made again from its branch. Only when its last step failed; " +
                "olimp_retry_workflow_run starts over instead.",
            inputSchema: { id },
        },
        ({ id }) => call("POST", `/api/workflow-runs/${id}/resume`),
    );
}
