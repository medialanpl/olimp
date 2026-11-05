import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    COMMITS_MAX,
    FILE_MAX,
    PATH_MAX,
    REF_MAX,
    REPO_DESCRIPTION_MAX,
    TREE_FILES_MAX,
} from "../limits.ts";
import { type Call, githubRepo, repo } from "./shared.ts";

const folder = z.string().regex(/^(?!\.{1,2}$)[\w.-]{1,100}$/);

export function registerProjectTools(server: McpServer, call: Call): void {
    server.registerTool(
        "olimp_add_repo",
        {
            description:
                "Register a project with OLIMP, which then works in its folder; its id comes from " +
                "the folder or repository name. Either clone a GitHub repository with the " +
                "installation's gh login into a new folder of OLIMP_PROJECTS (repo, folder), or " +
                "add any local folder (path, inside OLIMP_BROWSE_ROOT; admin only; see " +
                "olimp_list_folders). A git repository whose origin is on GitHub gets pull " +
                "requests and issues; other git folders keep each task's commit on its branch; a " +
                "folder without git is worked on in place, without branches. A project registered " +
                "before is fetched again.",
            inputSchema: {
                repo: z
                    .string()
                    .max(REF_MAX)
                    .optional()
                    .describe("owner/name or a GitHub address, to clone"),
                folder: folder.optional().describe("Folder name; the repository's name by default"),
                path: z
                    .string()
                    .max(PATH_MAX)
                    .optional()
                    .describe("Absolute path of a local folder"),
            },
        },
        (args) => call("POST", "/api/repos", args),
    );
    server.registerTool(
        "olimp_list_folders",
        {
            description:
                "List the subfolders of a folder on the OLIMP machine, inside OLIMP_BROWSE_ROOT " +
                "(admin only): name, path and whether it is a git repository; also the folder's " +
                "parent. Use it to find the path for olimp_add_repo, or an agent's config folder " +
                "for olimp_add_agent_login (hidden: true lists dot folders too).",
            inputSchema: {
                path: z
                    .string()
                    .max(PATH_MAX)
                    .optional()
                    .describe("Absolute path; the root by default"),
                hidden: z.boolean().optional().describe("Also list folders starting with a dot"),
            },
        },
        ({ path, hidden }) => {
            const query = new URLSearchParams({
                ...(path ? { path } : {}),
                ...(hidden ? { hidden: "1" } : {}),
            }).toString();
            return call("GET", `/api/folders${query ? `?${query}` : ""}`);
        },
    );
    server.registerTool(
        "olimp_create_folder",
        {
            description:
                "Create a new, empty subfolder in a folder on the OLIMP machine, inside " +
                "OLIMP_BROWSE_ROOT (admin only), e.g. for a project to add with olimp_add_repo; " +
                "answers with the new folder as olimp_list_folders lists it.",
            inputSchema: {
                path: z
                    .string()
                    .max(PATH_MAX)
                    .describe("Absolute path of the folder to create it in"),
                folder: folder.describe("Name of the new folder"),
            },
        },
        (args) => call("POST", "/api/folders", args),
    );
    server.registerTool(
        "olimp_create_repo",
        {
            description:
                "Create a new project in a new folder of OLIMP_PROJECTS. With GitHub (default): a " +
                "repository created with the installation's gh login, with a README or from a " +
                "template, then cloned; olimp_list_github_owners lists the possible owners. With " +
                "github false: a local git repository with an empty first commit (name).",
            inputSchema: {
                github: z.boolean().optional().describe("false for a local project"),
                name: folder.optional().describe("Folder of a local project"),
                repo: githubRepo
                    .optional()
                    .describe("The new repository as owner/name; owner is a user or an org"),
                visibility: z.enum(["private", "public"]).optional().describe("private by default"),
                description: z.string().max(REPO_DESCRIPTION_MAX).optional(),
                template: z
                    .string()
                    .max(REF_MAX)
                    .optional()
                    .describe("A GitHub template repository as owner/name or address"),
                folder: folder.optional().describe("Folder name; the repository's name by default"),
            },
        },
        (args) => call("POST", "/api/repos", { ...args, create: true }),
    );
    server.registerTool(
        "olimp_list_repos",
        { description: "List the registered repositories with their default branch." },
        () => call("GET", "/api/repos"),
    );
    server.registerTool(
        "olimp_get_repo",
        {
            description:
                "Show one registered repository: default branch, the GitHub issue label it takes " +
                "tasks from (null when off) and the shell commands agents may run.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", `/api/repos/${repo}`),
    );
    server.registerTool(
        "olimp_remove_repo",
        {
            description:
                "Unregister a repository: it leaves the project list, nothing on disk is deleted " +
                "and its tasks, runs, notes, memory and integrations stay for when it is added " +
                "again. Refused while its tasks or runs are queued or running, or an automation " +
                "uses it. Admin only.",
            inputSchema: { repo },
        },
        ({ repo }) => call("DELETE", `/api/repos/${repo}`, {}),
    );
    server.registerTool(
        "olimp_init_git",
        {
            description:
                "Make a local project's folder without git a git repository (admin only): git " +
                "init on main, a .gitignore when it has none and a local exclude for node_modules " +
                "and .env files, then its files in a first commit. Its tasks then work in " +
                "worktrees on branches of their own. Nothing is pushed.",
            inputSchema: { repo },
        },
        ({ repo }) => call("POST", `/api/repos/${repo}/git`, {}),
    );
    server.registerTool(
        "olimp_fetch_repo",
        {
            description:
                "Fetch a GitHub project's origin into its folder now, so its branches, commits " +
                "and files show what was pushed or merged on GitHub since the last task. The " +
                "folder's checkout stays as it is. Fails for a project not on GitHub.",
            inputSchema: { repo },
        },
        ({ repo }) => call("POST", `/api/repos/${repo}/fetch`, {}),
    );
    server.registerTool(
        "olimp_list_branches",
        {
            description:
                "List a project's branches (local and origin's, without OLIMP's olimp/* task " +
                "branches) and its base: the branch new tasks start from and pull requests target.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", `/api/repos/${repo}/branches`),
    );
    server.registerTool(
        "olimp_create_branch",
        {
            description:
                "Create a local branch in a project's folder from its base (origin's when the " +
                "project is on GitHub), without checking it out or pushing it. The name must be " +
                "a valid git branch name, new, and not under olimp/. Returns olimp_list_branches.",
            inputSchema: { repo, name: z.string().min(1).max(REF_MAX) },
        },
        ({ repo, name }) => call("POST", `/api/repos/${repo}/branches`, { name }),
    );
    server.registerTool(
        "olimp_set_base_branch",
        {
            description:
                "Set a project's base branch: new tasks start from it and their pull requests " +
                "target it. It must be one of olimp_list_branches.",
            inputSchema: { repo, branch: z.string().min(1).max(REF_MAX) },
        },
        ({ repo, branch }) => call("PUT", `/api/repos/${repo}/branch`, { branch }),
    );
    const gitBranch = z
        .string()
        .min(1)
        .max(REF_MAX)
        .optional()
        .describe("One of olimp_list_branches; the project's base when left out");
    const withBranch = (path: string, branch?: string, more = "") => {
        const query = [branch && `branch=${encodeURIComponent(branch)}`, more].filter(Boolean);
        return query.length ? `${path}?${query.join("&")}` : path;
    };
    server.registerTool(
        "olimp_get_repo_changes",
        {
            description:
                "Show a project's uncommitted work in its folder against the checked-out commit, " +
                "untracked files as new ones: changed files with line counts and the diff, cut as " +
                "in olimp_get_task_changes.",
            inputSchema: { repo },
        },
        ({ repo }) => call("GET", `/api/repos/${repo}/changes`),
    );
    server.registerTool(
        "olimp_list_repo_commits",
        {
            description:
                "List the history of a project branch, newest first, as the project's folder has " +
                `it (nothing is fetched): sha, parents, refs, author, email, date, title and body, at most ${COMMITS_MAX} ` +
                "(truncated says so).",
            inputSchema: { repo, branch: gitBranch },
        },
        ({ repo, branch }) => call("GET", withBranch(`/api/repos/${repo}/commits`, branch)),
    );
    server.registerTool(
        "olimp_get_repo_commit",
        {
            description:
                "Show one commit of a project branch's history: its message, changed files and " +
                "diff against its first parent, cut as in olimp_get_task_changes.",
            inputSchema: {
                repo,
                sha: z
                    .string()
                    .regex(/^[0-9a-f]{7,40}$/)
                    .describe("Commit sha, full or abbreviated"),
                branch: gitBranch,
            },
        },
        ({ repo, sha, branch }) =>
            call("GET", withBranch(`/api/repos/${repo}/commits/${sha}`, branch)),
    );
    server.registerTool(
        "olimp_list_repo_files",
        {
            description:
                "List every file at the head of a project branch, paths from the repository root, " +
                `at most ${TREE_FILES_MAX} (truncated says so).`,
            inputSchema: { repo, branch: gitBranch },
        },
        ({ repo, branch }) => call("GET", withBranch(`/api/repos/${repo}/files`, branch)),
    );
    server.registerTool(
        "olimp_get_repo_file",
        {
            description:
                "Read one file at the head of a project branch: size, whether it is binary (then " +
                "without content, except an image: its media type in image and base64 content) " +
                `and its text, cut at ${FILE_MAX} characters (truncated says so).`,
            inputSchema: {
                repo,
                path: z
                    .string()
                    .min(1)
                    .max(PATH_MAX)
                    .describe("Path from the repository root, as olimp_list_repo_files lists it"),
                branch: gitBranch,
            },
        },
        ({ repo, path, branch }) =>
            call(
                "GET",
                withBranch(`/api/repos/${repo}/files`, branch, `path=${encodeURIComponent(path)}`),
            ),
    );
}
