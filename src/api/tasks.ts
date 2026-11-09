import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { isAgent, isModel } from "../agents.ts";
import { branchCommits, branchFile, branchFiles, commitChanges } from "../changes.ts";
import { repoDir } from "../clones.ts";
import type { Config } from "../config.ts";
import { IN_FLIGHT_MAX, SUBTASKS_MAX } from "../dispatch.ts";
import { FileBody, HttpError, readJson, text } from "../http.ts";
import {
    ATTACHMENTS_MAX,
    MODEL_MAX,
    PATH_MAX,
    REF_MAX,
    TASK_BODY_MAX,
    TITLE_MAX,
    UPLOAD_MAX,
    VARIANTS_MAX,
} from "../limits.ts";
import { run } from "../proc.ts";
import { projectAgent } from "../settings.ts";
import type { Dispatch, Repo, Store, Task, User } from "../store.ts";
import { closeOwnerTerminals } from "../terminals.ts";
import {
    attachmentsDir,
    attachmentType,
    attachUploads,
    copyAttachments,
    readUpload,
    saveUpload,
    type Upload,
    uniqueNames,
} from "../uploads.ts";
import {
    type Answer,
    agentOf,
    cancel,
    changesOf,
    filePath,
    flag,
    integrationsOf,
    pinnerOf,
    registered,
    repoOf,
    skillOf,
    withGit,
} from "./shared.ts";

// `worktree: false` works in the project's checkout; `newBranch` first switches it to a new
// branch from the base, which `branch` may name. A folder without git always works in place.
// Without `worktree` the project's setting decides, unless dispatch or variants need a worktree.
async function workspaceOf(
    body: Record<string, unknown>,
    repo: Repo,
    git: boolean,
    needsWorktree: boolean,
): Promise<Pick<Task, "workspace" | "branchName">> {
    const worktree =
        body.worktree === undefined
            ? needsWorktree || repo.settings.workspace !== "checkout"
            : flag(body.worktree, "worktree");
    const newBranch = body.newBranch !== undefined && flag(body.newBranch, "newBranch");
    if (worktree || !git) return { workspace: "worktree", branchName: null };
    if (!newBranch) return { workspace: "checkout", branchName: null };
    if (body.branch === undefined || body.branch === null || body.branch === "")
        return { workspace: "branch", branchName: null };
    const branch = text(body.branch, "branch", REF_MAX);
    // Commits on the base branch would be pushed straight to it.
    if (
        branch === repo.defaultBranch ||
        (await run("git", ["check-ref-format", "--branch", branch])).code !== 0
    )
        throw new HttpError(400, "task.invalidBranch", { branch });
    return { workspace: "branch", branchName: branch };
}

const VARIANTS = ["A", "B", "C"] as const;
// A takes the prompt as it is, the others lean one way.
const VARIANT_HINTS: Record<string, string> = {
    B: "For this variant, change as little as you can: the smallest diff that does the job.",
    C: "For this variant, go deeper: fix the underlying design, even if the diff grows.",
};

// true is the full limits; an object may lower them.
function dispatchOf(value: unknown): Dispatch | null {
    if (value === undefined || value === null || value === false) return null;
    const given = value === true ? {} : (value as Record<string, unknown>);
    const dispatch = {
        maxSubtasks: given.maxSubtasks ?? SUBTASKS_MAX,
        inFlight: given.inFlight ?? IN_FLIGHT_MAX,
        agent: given.agent ?? null,
        model: given.model ?? null,
        budgetUsd: given.budgetUsd ?? null,
    };
    const within = (n: unknown, max: number) =>
        Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
    const budget = dispatch.budgetUsd;
    if (
        typeof given !== "object" ||
        !within(dispatch.maxSubtasks, SUBTASKS_MAX) ||
        !within(dispatch.inFlight, IN_FLIGHT_MAX) ||
        (dispatch.agent !== null && !isAgent(dispatch.agent)) ||
        (budget !== null && (typeof budget !== "number" || !(budget > 0) || budget > 1000))
    )
        throw new HttpError(400, "task.invalidDispatch", {
            max: SUBTASKS_MAX,
            inFlight: IN_FLIGHT_MAX,
        });
    return { ...dispatch, model: modelOf(dispatch.model) } as Dispatch;
}

function variantsOf(value: unknown): number {
    if (value === undefined) return 1;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > VARIANTS_MAX)
        throw new HttpError(400, "task.invalidVariants", { max: VARIANTS_MAX });
    return value as number;
}

// Null is the agent's own default model.
function modelOf(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    if (!isModel(value) || value.length > MODEL_MAX)
        throw new HttpError(400, "task.invalidModel", { max: MODEL_MAX });
    return value;
}

function uploadsOf(cfg: Config, value: unknown): Upload[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > ATTACHMENTS_MAX)
        throw new HttpError(400, "task.tooManyAttachments", { max: ATTACHMENTS_MAX });
    return value.map((id) => {
        const upload = typeof id === "string" ? readUpload(cfg, id) : null;
        if (!upload) throw new HttpError(400, "task.uploadExpired", { upload: String(id) });
        return upload;
    });
}

// The winner stays; every other variant is archived, its pull request closed and its branch
// deleted: only the picked diff stays.
async function pickVariant(
    store: Store,
    cfg: Config,
    group: string,
    variants: Task[],
    winner: string,
) {
    if (!variants.some((task) => task.id === winner))
        throw new HttpError(400, "task.notInGroup", { task: winner, group });
    const busy = variants.find((task) => task.status === "queued" || task.status === "running");
    if (busy) throw new HttpError(409, "task.variantsRunning", { group });
    const errors: string[] = [];
    for (const task of variants) {
        if (task.id === winner) continue;
        if (task.prUrl) {
            const closed = await run(cfg.gh, ["pr", "close", task.prUrl, "--delete-branch"]);
            if (closed.code !== 0) errors.push(`${task.prUrl}: ${closed.stderr.trim()}`);
        } else if (task.branch) {
            const repo = await store.repo(task.repo);
            if (repo) await run("git", ["-C", repoDir(cfg, repo), "branch", "-D", task.branch]);
        }
        await store.archiveTask(task.id, true);
    }
    return { group, tasks: await store.variantTasks(group), errors };
}

// What a retry or continuation copies of a task; its automation and issue stay with the task.
const template = (task: Task) => ({
    workspace: task.workspace,
    branchName: task.branchName,
    repo: task.repo,
    title: task.title,
    body: task.body,
    agent: task.agent,
    skill: task.skill,
    integrations: task.integrations,
    thread: task.thread,
    model: task.model,
    attachments: task.attachments,
    reviewPr: task.reviewPr,
});

export async function tasksRoute(
    store: Store,
    cfg: Config,
    req: IncomingMessage,
    url: URL,
    actor: User | null,
    home: string,
): Promise<Answer | undefined> {
    const path = url.pathname;
    const method = req.method;
    const author = actor?.id ?? null;
    const pinner = pinnerOf(actor);
    if (path === "/api/pins" && method === "GET") return [200, await store.pins(pinner)];
    if (path === "/api/reads" && method === "GET") return [200, await store.reads(pinner)];
    if (path === "/api/uploads" && method === "POST") {
        const tooLarge = () =>
            new HttpError(413, "upload.tooLarge", { max: UPLOAD_MAX / 1024 / 1024 });
        const body = await readJson(req, Math.ceil(UPLOAD_MAX / 3) * 4 + 64 * 1024).catch(
            (error: unknown) => {
                throw error instanceof HttpError && error.status === 413 ? tooLarge() : error;
            },
        );
        const name = text(body.name, "name", PATH_MAX);
        const mediaType =
            typeof body.mediaType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.mediaType)
                ? body.mediaType
                : "application/octet-stream";
        if (typeof body.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))
            throw new HttpError(400, "upload.invalid");
        const data = Buffer.from(body.data, "base64");
        if (!data.length || data.length > UPLOAD_MAX) throw tooLarge();
        return [201, saveUpload(cfg, name, mediaType, data)];
    }
    const group = /^\/api\/task-groups\/([0-9a-f]{12})(\/pick)?$/.exec(path);
    if (group) {
        const [, id = "", pick] = group;
        const variants = await store.variantTasks(id);
        if (!variants.length) throw new HttpError(404, "task.groupNotFound", { group: id });
        if (!pick && method === "GET") return [200, { group: id, tasks: variants }];
        if (pick && method === "POST") {
            const winner = text((await readJson(req)).task, "task", 12);
            return [200, await pickVariant(store, cfg, id, variants, winner)];
        }
    }
    if (path === "/api/tasks") {
        if (method === "GET") return [200, await store.tasks()];
        if (method === "POST") {
            const body = await readJson(req);
            const repo = await registered(store, body.repo);
            const project = (await store.repo(repo)) as Repo;
            const variants = variantsOf(body.variants);
            const dispatch = dispatchOf(body.dispatch);
            const git = withGit(cfg, project).git;
            if (variants > 1 && !git) throw new HttpError(400, "task.variantsNeedGit", { repo });
            if (dispatch && !git) throw new HttpError(400, "task.dispatchNeedsGit", { repo });
            if (dispatch && variants > 1) throw new HttpError(400, "task.dispatchWithVariants");
            const place = await workspaceOf(body, project, git, !!dispatch || variants > 1);
            if (place.workspace !== "worktree" && (dispatch || variants > 1))
                throw new HttpError(400, "task.checkoutAlone");
            const uploads = uploadsOf(cfg, body.attachments);
            const input = {
                repo,
                title: text(body.title, "title", TITLE_MAX),
                body: text(body.body, "body", TASK_BODY_MAX, false),
                agent:
                    body.agent === undefined
                        ? await projectAgent(store, project)
                        : agentOf(body.agent),
                model: modelOf(body.model),
                integrations: await integrationsOf(store, repo, body.integrations),
                skill: await skillOf(store, cfg, home, body.skill, project),
                attachments: uniqueNames(uploads.map((upload) => upload.name)),
                dispatch,
                ...place,
                author,
            };
            if (variants === 1) {
                const task = await store.createTask(input);
                attachUploads(cfg, task.id, uploads, input.attachments);
                return [201, task];
            }
            const variantGroup = randomBytes(6).toString("hex");
            const tasks: Task[] = [];
            for (const [i, variant] of VARIANTS.slice(0, variants).entries()) {
                const hint = VARIANT_HINTS[variant];
                const task = await store.createTask({
                    ...input,
                    body: hint ? `${input.body}\n\n${hint}`.trim() : input.body,
                    variantGroup,
                    variant,
                });
                if (i === 0) attachUploads(cfg, task.id, uploads, input.attachments);
                else copyAttachments(cfg, (tasks[0] as Task).id, task.id, input.attachments);
                tasks.push(task);
            }
            return [201, { group: variantGroup, tasks }];
        }
    }
    const attachment = /^\/api\/tasks\/([0-9a-f]{12})\/attachments\/([^/]+)$/.exec(path);
    if (attachment && method === "GET") {
        const [, id = "", encoded = ""] = attachment;
        const name = decodeURIComponent(encoded);
        const task = await store.task(id);
        if (!task) throw new HttpError(404, "task.notFound", { task: id });
        const file = join(attachmentsDir(cfg, id), name);
        if (!task.attachments.includes(name) || !existsSync(file))
            throw new HttpError(404, "task.attachmentNotFound", { task: id, name });
        const { type, inline } = attachmentType(name);
        return [
            200,
            new FileBody(
                readFileSync(file),
                type,
                `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
            ),
        ];
    }
    const one =
        /^\/api\/tasks\/([0-9a-f]{12})(?:\/(trace|changes|commits|files|thread|subtasks|cancel|retry|continue|archive|pin|read)(?:\/([0-9a-f]{7,40}))?)?$/.exec(
            path,
        );
    if (one && (!one[3] || one[2] === "commits")) {
        const [, id = "", action, sha] = one;
        const task = await store.task(id);
        if (!task) throw new HttpError(404, "task.notFound", { task: id });
        if (!action && method === "GET") return [200, task];
        if (action === "trace" && method === "GET")
            return [200, { task: id, events: await store.agentEvents({ task: id }) }];
        if (action === "changes" && method === "GET")
            return [200, { task: id, ...(await changesOf(store, cfg, task.repo, task.branch)) }];
        if (action === "commits" && method === "GET") {
            const repo = await repoOf(store, task.repo);
            if (!sha) return [200, { task: id, ...(await branchCommits(cfg, repo, task.branch)) }];
            const found = await commitChanges(cfg, repo, task.branch, sha);
            if (!found) throw new HttpError(404, "task.commitNotFound", { task: id, sha });
            return [200, { task: id, ...found }];
        }
        if (action === "files" && method === "GET") {
            const repo = await repoOf(store, task.repo);
            const file = url.searchParams.get("path");
            if (file === null)
                return [200, { task: id, ...(await branchFiles(cfg, repo, task.branch)) }];
            const found = await branchFile(cfg, repo, task.branch, filePath(file));
            if (!found) throw new HttpError(404, "task.fileNotFound", { task: id, path: file });
            return [200, { task: id, ...found }];
        }
        if (action === "thread" && method === "GET")
            return [200, await store.threadTasks(task.thread ?? task.id)];
        if (action === "subtasks" && method === "GET") return [200, await store.subtasks(id)];
        if (action === "cancel" && method === "POST") {
            await cancel(store, "task", id, task.status, actor);
            return [200, await store.task(id)];
        }
        if (action === "archive" && (method === "PUT" || method === "DELETE")) {
            // An archived task leaves the active lists, so one still at work would vanish.
            if (method === "PUT" && (task.status === "queued" || task.status === "running"))
                throw new HttpError(409, "task.notFinished", { task: id, status: task.status });
            if (method === "PUT") closeOwnerTerminals(`task:${task.thread ?? task.id}`);
            return [200, await store.archiveTask(id, method === "PUT")];
        }
        if (action === "pin" && (method === "PUT" || method === "DELETE")) {
            await store.pinTask(pinner, id, method === "PUT");
            return [200, await store.pins(pinner)];
        }
        if (action === "read" && (method === "PUT" || method === "DELETE")) {
            await store.markRead(pinner, "task", id, method === "PUT");
            return [200, await store.reads(pinner)];
        }
        if (action === "retry" && method === "POST") {
            if (task.status === "queued" || task.status === "running")
                throw new HttpError(409, "task.notFinished", { task: id, status: task.status });
            const retried = await store.createTask({
                ...template(task),
                dispatch: task.dispatch,
                retryOf: id,
                author,
            });
            copyAttachments(cfg, id, retried.id, task.attachments);
            return [201, retried];
        }
        if (action === "continue" && method === "POST") {
            const body = await readJson(req);
            const uploads = uploadsOf(cfg, body.attachments);
            const continued = await store.createTask({
                ...template(task),
                title: body.title === undefined ? task.title : text(body.title, "title", TITLE_MAX),
                body: text(body.body, "body", TASK_BODY_MAX, !uploads.length),
                ...(body.model === undefined ? {} : { model: modelOf(body.model) }),
                attachments: uniqueNames(uploads.map((upload) => upload.name)),
                thread: task.thread ?? task.id,
                author,
            });
            attachUploads(cfg, continued.id, uploads, continued.attachments);
            return [201, continued];
        }
    }
    return undefined;
}
