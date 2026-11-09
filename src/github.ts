import type { Config } from "./config.ts";
import { HttpError } from "./http.ts";
import { must, run } from "./proc.ts";
import type { Repo, Store } from "./store.ts";

export const PR_TYPES = ["fix", "feat", "docs", "refactor", "test", "chore", "perf"] as const;
export type PrType = (typeof PR_TYPES)[number];
// A label OLIMP makes gets GitHub's usual colors where there is one.
const LABEL_COLOR: Record<string, string> = {
    fix: "d73a4a",
    feat: "a2eeef",
    docs: "0075ca",
    refactor: "c5def5",
    test: "fbca04",
    chore: "ededed",
    perf: "5319e7",
};
export const TYPE_MARKER = "OLIMP:TYPE";
const TYPE_LINE = /\s*OLIMP:TYPE[ \t:=]+([A-Za-z]+)\s*$/;

export const typeRequest = () =>
    `\n\nWhen you finish, end your final message with \`${TYPE_MARKER} <type>\` on its own last ` +
    `line, the kind of change you made, one of: ${PR_TYPES.join(", ")}. OLIMP labels the pull ` +
    "request with it and starts its title with it.";

// A pull request title in the Conventional Commits form, `fix: …`, unless it has a type already.
export const typedTitle = (type: PrType | null, title: string) =>
    type && !/^[a-z]+(\([\w-]+\))?!?: /.test(title) ? `${type}: ${title}` : title;

// The kind of change the agent named on its last line, and its answer without that line.
export function parseType(answer: string): { type: PrType | null; text: string } {
    const m = TYPE_LINE.exec(answer);
    if (!m) return { type: null, text: answer };
    const named = (m[1] as string).toLowerCase() as PrType;
    return { type: PR_TYPES.includes(named) ? named : null, text: answer.slice(0, m.index) };
}

export const METHODS = ["squash", "merge", "rebase"] as const;
export type MergeMethod = (typeof METHODS)[number];

interface GhLabel {
    name: string;
    color?: string;
}
export interface GhCheck {
    name?: string;
    context?: string;
    conclusion?: string | null;
    state?: string | null;
    status?: string | null;
    detailsUrl?: string | null;
    targetUrl?: string | null;
}
interface GhItem {
    number: number;
    title: string;
    url: string;
    author?: { login: string } | null;
    createdAt: string;
    labels?: GhLabel[];
    comments?: { author?: { login: string } | null; body: string; createdAt: string }[];
    isDraft?: boolean;
    additions?: number;
    deletions?: number;
    headRefName?: string;
}
interface GhPr extends GhItem {
    body?: string;
    state: string;
    mergeStateStatus?: string | null;
    reviewDecision?: string | null;
    headRefOid: string;
    baseRefName: string;
    statusCheckRollup?: GhCheck[] | null;
}

const ITEM_FIELDS = "number,title,url,author,createdAt,labels,comments";
const PR_FIELDS = `${ITEM_FIELDS},isDraft,additions,deletions,headRefName`;
const MERGE_FIELDS =
    "state,isDraft,mergeStateStatus,reviewDecision,headRefOid,baseRefName,statusCheckRollup";

const itemOf = (i: GhItem) => ({
    number: i.number,
    title: i.title,
    url: i.url,
    author: i.author?.login ?? "",
    createdAt: i.createdAt,
    labels: (i.labels ?? []).map((l) => ({ name: l.name, color: l.color ?? "" })),
    comments: i.comments?.length ?? 0,
    draft: i.isDraft ?? false,
    additions: i.additions ?? null,
    deletions: i.deletions ?? null,
    branch: i.headRefName ?? null,
});
export type GithubItem = ReturnType<typeof itemOf>;

const PASSING = ["SUCCESS", "NEUTRAL", "SKIPPED"];
const FAILING = [
    "FAILURE",
    "ERROR",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "CANCELLED",
    "STARTUP_FAILURE",
    "STALE",
];

export function checkOf(c: GhCheck) {
    // A check run has a conclusion once completed; a commit status has only its state.
    const value = (c.conclusion || c.state || c.status || "").toUpperCase();
    return {
        name: c.name || c.context || "check",
        state: PASSING.includes(value)
            ? "passing"
            : FAILING.includes(value)
              ? "failing"
              : "pending",
        url: c.detailsUrl || c.targetUrl || null,
    } as const;
}

// GitHub folds branch protection, required reviews and checks and conflicts into
// mergeStateStatus: `unstable` fails only checks that are not required, so a person may still
// merge. Unattended merging wants more: at least one check ran and every one passed.
export function mergeView(pr: GhPr, methods: MergeMethod[]) {
    const checks = (pr.statusCheckRollup ?? []).map(checkOf);
    const status = (pr.mergeStateStatus || "UNKNOWN").toLowerCase();
    const open = pr.state.toUpperCase() === "OPEN" && !pr.isDraft;
    return {
        status,
        ready: open && ["clean", "has_hooks", "unstable"].includes(status),
        auto:
            open &&
            ["clean", "has_hooks"].includes(status) &&
            checks.length > 0 &&
            checks.every((c) => c.state === "passing"),
        headSha: pr.headRefOid,
        base: pr.baseRefName,
        review: pr.reviewDecision?.toLowerCase() || null,
        methods,
        checks,
    };
}
export type MergeView = ReturnType<typeof mergeView>;

async function ghJson<T>(cfg: Config, args: string[]): Promise<T> {
    const done = await run(cfg.gh, args, { timeoutMs: 60_000 });
    if (done.code !== 0) {
        const reason =
            (done.stderr || done.stdout).trim().split("\n").at(-1) || `exit ${done.code}`;
        throw new HttpError(502, "github.unavailable", { reason });
    }
    return JSON.parse(done.stdout) as T;
}

// The repository's merge methods, squash first, as GitHub's own button orders them.
async function mergeMethods(cfg: Config, github: string): Promise<MergeMethod[]> {
    const policy = await ghJson<Record<string, unknown>>(cfg, ["api", `repos/${github}`]);
    const allowed = {
        squash: policy.allow_squash_merge,
        merge: policy.allow_merge_commit,
        rebase: policy.allow_rebase_merge,
    };
    return METHODS.filter((m) => allowed[m] === true);
}

export async function listItems(cfg: Config, github: string, kind: "issues" | "prs") {
    const items = await ghJson<GhItem[]>(cfg, [
        kind === "prs" ? "pr" : "issue",
        "list",
        "--repo",
        github,
        "--state",
        "open",
        "--limit",
        "100",
        "--json",
        kind === "prs" ? PR_FIELDS : ITEM_FIELDS,
    ]);
    return items.map(itemOf);
}

export async function detailOf(
    cfg: Config,
    github: string,
    kind: "issues" | "prs",
    number: number,
) {
    const fields = `${kind === "prs" ? PR_FIELDS : ITEM_FIELDS},body,state`;
    const args = [kind === "prs" ? "pr" : "issue", "view", String(number), "--repo", github];
    const item = await ghJson<GhPr>(cfg, [
        ...args,
        "--json",
        kind === "prs" ? `${fields},${MERGE_FIELDS}` : fields,
    ]);
    return {
        ...itemOf(item),
        body: item.body ?? "",
        state: item.state.toLowerCase(),
        conversation: (item.comments ?? []).map((c) => ({
            author: c.author?.login ?? "",
            body: c.body,
            createdAt: c.createdAt,
        })),
        merge: kind === "prs" ? mergeView(item, await mergeMethods(cfg, github)) : null,
    };
}
export type GithubDetail = Awaited<ReturnType<typeof detailOf>>;

// The head is pinned: a commit pushed after the caller looked makes GitHub refuse the merge.
export async function mergePr(
    cfg: Config,
    github: string,
    number: number,
    method: MergeMethod,
    sha: string,
): Promise<void> {
    const done = await run(
        cfg.gh,
        [
            "api",
            "--method",
            "PUT",
            `repos/${github}/pulls/${number}/merge`,
            "-f",
            `merge_method=${method}`,
            "-f",
            `sha=${sha}`,
        ],
        { timeoutMs: 60_000 },
    );
    if (done.code !== 0) {
        const reason =
            (done.stderr || done.stdout).trim().split("\n").at(-1) || `exit ${done.code}`;
        throw new HttpError(409, "github.mergeRefused", { reason });
    }
}

// Adds the labels to a pull request, making the ones the repository lacks. Best effort: a
// failure is logged and the pull request stays as it is.
export async function labelPr(cfg: Config, repo: Repo, prUrl: string, labels: string[]) {
    if (!repo.github || !labels.length) return;
    try {
        const have = new Set(
            (
                await ghJson<GhLabel[]>(cfg, [
                    "label",
                    "list",
                    "--repo",
                    repo.github,
                    "--limit",
                    "500",
                    "--json",
                    "name",
                ])
            ).map((l) => l.name.toLowerCase()),
        );
        for (const name of labels.filter((l) => !have.has(l.toLowerCase())))
            await must(cfg.gh, [
                "label",
                "create",
                name,
                "--repo",
                repo.github,
                "--color",
                LABEL_COLOR[name] ?? "ededed",
            ]);
        await must(cfg.gh, ["pr", "edit", prUrl, ...labels.flatMap((l) => ["--add-label", l])]);
    } catch (error) {
        console.error(
            `labels of ${prUrl}: ${error instanceof HttpError ? error.params?.reason : error}`,
        );
    }
}

export const AUTO_MERGE_POLL_MS = 2 * 60_000;

// OLIMP's own open pull requests (on an olimp/ branch, or one a task or run of OLIMP opened) that
// carry the project's auto-merge label, merged once every check passed. A failing project is
// logged and skipped.
export async function autoMerge(store: Store, cfg: Config): Promise<string[]> {
    const merged: string[] = [];
    let known: Set<string> | undefined;
    for (const repo of await store.repos()) {
        const label = repo.settings.autoMergeLabel;
        if (!label || !repo.github) continue;
        try {
            const prs = await ghJson<GhPr[]>(cfg, [
                "pr",
                "list",
                "--repo",
                repo.github,
                "--state",
                "open",
                "--label",
                label,
                "--limit",
                "50",
                "--json",
                `number,url,${MERGE_FIELDS},headRefName`,
            ]);
            let methods: MergeMethod[] | undefined;
            for (const pr of prs) {
                if (!pr.headRefName?.startsWith("olimp/")) {
                    known ??= new Set(
                        [...(await store.tasks(500)), ...(await store.runs(500))]
                            .map((job) => job.prUrl)
                            .filter((url): url is string => !!url),
                    );
                    if (!known.has(pr.url)) continue;
                }
                if (!mergeView(pr, []).auto) continue;
                methods ??= await mergeMethods(cfg, repo.github);
                const method = methods[0];
                if (!method) break;
                await mergePr(cfg, repo.github, pr.number, method, pr.headRefOid);
                console.log(`auto-merge ${repo.id}#${pr.number} by ${method} (label ${label})`);
                merged.push(pr.url);
            }
        } catch (error) {
            const reason = error instanceof HttpError ? error.params?.reason : error;
            console.error(`auto-merge of ${repo.id}: ${reason}`);
        }
    }
    return merged;
}

export function startAutoMerge(store: Store, cfg: Config): () => void {
    let timer: NodeJS.Timeout | undefined;
    let stopped = false;
    const tick = async () => {
        try {
            await autoMerge(store, cfg);
        } catch (error) {
            console.error(`auto-merge: ${error}`);
        }
        if (!stopped) timer = setTimeout(tick, AUTO_MERGE_POLL_MS);
    };
    void tick();
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
