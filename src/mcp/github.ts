import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ISSUE_LABEL_MAX } from "../limits.ts";
import { type Call, repo, repoPath } from "./shared.ts";

export function registerGithubTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_list_github_owners",
        {
            description:
                "List where olimp_create_repo can create a repository: the installation's gh " +
                "account and its organizations (login, name, description, kind, avatarUrl).",
        },
        () => call("GET", "/api/github/owners"),
    );
    server.registerTool(
        "olimp_github_status",
        {
            description:
                "Whether the installation's gh is signed in to GitHub, and as whom (loggedIn, " +
                "login). Without it, GitHub projects, pull requests and issues do not work; " +
                "`gh auth login` on the OLIMP machine signs in.",
        },
        () => call("GET", "/api/github/status"),
    );
    server.registerTool(
        "olimp_enable_issues",
        {
            description:
                "Make open GitHub issues of the repository with a label a task source, or change " +
                "the label. Every few minutes OLIMP queues one task per new labelled issue; its " +
                "pull request closes the issue. Only people with triage access can label issues.",
            inputSchema: {
                repo,
                label: z
                    .string()
                    .min(1)
                    .max(ISSUE_LABEL_MAX)
                    .optional()
                    .describe("Label that marks issues for OLIMP; olimp by default"),
            },
        },
        ({ repo, ...body }) => call("PUT", repoPath(repo, "issues"), body),
    );
    server.registerTool(
        "olimp_disable_issues",
        {
            description: "Stop taking tasks from the repository's GitHub issues.",
            inputSchema: { repo },
        },
        ({ repo }) => call("DELETE", repoPath(repo, "issues")),
    );
    const githubKind = z.enum(["issues", "prs"]).describe("issues or prs (pull requests)");
    server.registerTool(
        "olimp_list_github_items",
        {
            description:
                "List a GitHub project's open issues or pull requests (up to 100): number, title, " +
                "author, labels with their colors, comments; a pull request also its branch, " +
                "draft flag and lines added and deleted.",
            inputSchema: { repo, kind: githubKind },
        },
        ({ repo, kind }) => call("GET", repoPath(repo, `github/${kind}`)),
    );
    server.registerTool(
        "olimp_get_github_item",
        {
            description:
                "One issue or pull request of a GitHub project with its body and comments; a " +
                "pull request also with its merge state: GitHub's status, whether a person may " +
                "merge it now (ready), whether it would merge unattended (auto: every check " +
                "passed), the head SHA, the repository's merge methods and each check.",
            inputSchema: { repo, kind: githubKind, number: z.number().int().positive() },
        },
        ({ repo, kind, number }) => call("GET", repoPath(repo, `github/${kind}/${number}`)),
    );
    server.registerTool(
        "olimp_merge_pull_request",
        {
            description:
                "Merge a project's pull request on GitHub with the installation's gh login " +
                "(admin only). sha is the head commit read with olimp_get_github_item: GitHub " +
                "refuses the merge if a commit was pushed since. method is one the repository " +
                "allows.",
            inputSchema: {
                repo,
                number: z.number().int().positive(),
                method: z.enum(["squash", "merge", "rebase"]),
                sha: z.string().regex(/^[0-9a-f]{40}$/),
            },
        },
        ({ repo, number, ...body }) =>
            call("POST", repoPath(repo, `github/prs/${number}/merge`), body),
    );
}
