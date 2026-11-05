import type { IncomingMessage } from "node:http";
import { githubLogin, githubOwners } from "../clones.ts";
import type { Config } from "../config.ts";
import { detailOf, listItems, METHODS, type MergeMethod, mergePr } from "../github.ts";
import { HttpError, readJson, requireAdmin } from "../http.ts";
import { DEFAULT_ISSUE_LABEL } from "../issues.ts";
import { ISSUE_LABEL_MAX } from "../limits.ts";
import type { Store, User } from "../store.ts";
import type { Answer } from "./shared.ts";

function issueLabel(value: unknown): string {
    if (value === undefined) return DEFAULT_ISSUE_LABEL;
    // gh splits --label on commas.
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > ISSUE_LABEL_MAX ||
        value.includes(",")
    )
        throw new HttpError(400, "issues.invalidLabel", { max: ISSUE_LABEL_MAX });
    return value.trim();
}

const ROUTE =
    /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/github\/(issues|prs)(?:\/(\d{1,9}))?(\/merge)?$/;

// The installation's GitHub login and owners, a project's issue label, its open issues and pull
// requests on GitHub, one of them, and merging a pull request (admin only: it lands with the
// installation's gh login, not the caller's own).
export async function githubRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    path: string,
    actor: User | null,
): Promise<Answer | undefined> {
    const method = req.method;
    const author = actor?.id ?? null;
    if (path === "/api/github/owners" && method === "GET") return [200, await githubOwners(cfg)];
    if (path === "/api/github/status" && method === "GET") {
        const login = await githubLogin(cfg);
        return [200, { loggedIn: login !== null, login }];
    }
    const issues = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/issues(?:\/([\w-]+))?$/.exec(path);
    if (issues) {
        const [, repo = "", name] = issues;
        const found = await store.repo(repo);
        if (!found) throw new HttpError(404, "repo.notRegistered", { repo });
        if (!name) {
            if (method === "PUT") {
                if (!found.github) throw new HttpError(400, "repo.noGithub", { repo });
                const label = issueLabel((await readJson(req)).label);
                return [200, await store.setIssueLabel(repo, label, author)];
            }
            if (method === "DELETE") return [200, await store.setIssueLabel(repo, null)];
        }
    }
    const match = ROUTE.exec(path);
    if (!match) return undefined;
    const [, id = "", , number, merge] = match;
    const kind = match[2] as "issues" | "prs";
    const repo = await store.repo(id);
    if (!repo) throw new HttpError(404, "repo.notRegistered", { repo: id });
    if (!repo.github) throw new HttpError(400, "github.localProject", { repo: id });
    if (!number && !merge && method === "GET")
        return [200, await listItems(cfg, repo.github, kind)];
    if (number && !merge && method === "GET")
        return [200, await detailOf(cfg, repo.github, kind, Number(number))];
    if (number && merge && kind === "prs" && method === "POST") {
        requireAdmin(actor);
        const body = await readJson(req);
        if (!(METHODS as readonly unknown[]).includes(body.method))
            throw new HttpError(400, "github.invalidMethod", { methods: METHODS.join(", ") });
        if (typeof body.sha !== "string" || !/^[0-9a-f]{40}$/.test(body.sha))
            throw new HttpError(400, "github.invalidSha");
        await mergePr(cfg, repo.github, Number(number), body.method as MergeMethod, body.sha);
        return [200, await detailOf(cfg, repo.github, kind, Number(number))];
    }
    throw new HttpError(404, "request.notFound");
}
