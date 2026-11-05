import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AGENTS, LOGIN_NAME } from "../agents.ts";
import {
    DIFF_FILES_MAX,
    DIFF_MAX,
    INTEGRATION_NAME_MAX,
    REF_MAX,
    STEP_INTEGRATIONS_MAX,
} from "../limits.ts";

export type Call = (method: string, path: string, body?: object) => Promise<CallToolResult>;

export const repo = z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .describe("Project id, e.g. olimp (olimp_list_repos lists them)");
export const githubRepo = z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .describe("GitHub repository as owner/name");
export const id = z.string().regex(/^[0-9a-f]{12}$/);
export const model = z
    .string()
    .regex(/^[\w.:/[\]-]{1,64}$/)
    .describe(
        "A model the agent's CLI knows (olimp_list_models lists what the installed CLIs offer; " +
            "provider/model for opencode); none is the " +
            "project's model for the agent, then the installation's default, then the CLI's own",
    );
export const agent = z
    .enum(AGENTS)
    .describe(
        "Coding agent that makes the change; for a task or automation the project's agent by " +
            "default (olimp_set_repo_agents, then olimp_set_agent_defaults), claude in a workflow step",
    );
export const loginName = z.string().regex(LOGIN_NAME).describe("Login name, e.g. work");
export const perAgent = (value: z.ZodType<string>) => z.partialRecord(z.enum(AGENTS), value);
export const skill = z
    .string()
    .max(REF_MAX)
    .describe(
        "Skill the agent follows: owner/repo:name, or just name when only one source has it, " +
            "./name for a skill the task's repository keeps (see olimp_list_skills with repo), " +
            "~/name for the caller's own or claude.ai/name for one synced from claude.ai",
    );
export const integrationName = z.string().regex(new RegExp(`^[\\w-]{1,${INTEGRATION_NAME_MAX}}$`));
export const integrations = z
    .array(integrationName)
    .max(STEP_INTEGRATIONS_MAX)
    .describe(
        "Names of MCP integrations of the repository (see olimp_list_integrations) the agent " +
            "may use in this step; none by default, and the user's own MCP servers never",
    );
export const changesNote = (job: string) =>
    `Show what a ${job}'s branch changes against the default branch, as OLIMP's clone has them ` +
    "(nothing is fetched): changed files with lines added and deleted (null for binary files) " +
    `and the unified diff, cut at ${DIFF_MAX} characters and ${DIFF_FILES_MAX} files (the truncated ` +
    "flags say so). head is null while nothing was pushed.";
export const repoPath = (repo: string, rest: string) => `/api/repos/${repo}/${rest}`;
