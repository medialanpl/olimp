import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { parseLog, parseNumstat } from "../src/changes.ts";
import { cloneDir } from "../src/clones.ts";
import { type Config, loadConfig } from "../src/config.ts";
import { DIFF_MAX } from "../src/limits.ts";
import { must } from "../src/proc.ts";
import type { Store } from "../src/store.ts";
import { parseDefinition } from "../src/workflows.ts";
import { bareRepo, chain, commitFiles, openStore, step } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-changes-"));
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const fix = parseDefinition(chain(step("fix", "Fix")));

// OLIMP's clone of a local bare repository; `push` puts a branch on the "GitHub" side, as an agent
// step's push would, and fetches it into the clone.
async function setup() {
    const home = mkdtempSync(join(root, "home-"));
    const { bare, seed } = await bareRepo(mkdtempSync(join(root, "repo-")), "demo", {
        "README.md": "# Demo\n",
        "src/app.ts": "export const a = 1;\n",
    });
    const cfg = { ...loadConfig({ OLIMP_HOME: home }), webDir: join(root, "no-panel") };
    const clone = cloneDir(cfg, "repos", "acme/demo");
    await must("git", ["clone", "-q", bare, clone]);
    const store = await openStore(home);
    await store.addRepo("acme/demo", "main");
    const publish = async (branch: string) => {
        await must("git", ["-C", seed, "push", "-q", bare, branch]);
        await must("git", ["-C", clone, "fetch", "-q", "origin"]);
    };
    const push = async (branch: string, files: Record<string, string>) => {
        await must("git", ["-C", seed, "checkout", "-q", "-b", branch, "main"]);
        await commitFiles(seed, files, branch);
        await publish(branch);
        await must("git", ["-C", seed, "checkout", "-q", "main"]);
    };
    return { store, seed, push, publish, get: await serve(store, cfg) };
}

async function serve(store: Store, cfg: Config) {
    const server = createApi(store, cfg);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const get = (path: string): Promise<{ status: number; json: Record<string, unknown> }> =>
        new Promise((resolve, reject) => {
            const req = request(
                { host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}` } },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    res.on("end", () =>
                        resolve({ status: res.statusCode ?? 0, json: JSON.parse(data) }),
                    );
                },
            );
            req.on("error", reject);
            req.end();
        });
    return get;
}

test("a task's changes list its files with line counts and the diff against main", async () => {
    const { store, push, get } = await setup();
    const task = await store.createTask({ repo: "acme/demo", title: "Fix", body: "" });
    await store.startJob("task", task.id, `olimp/${task.id}`);
    await push(`olimp/${task.id}`, {
        "src/app.ts": "export const a = 2;\nexport const b = 3;\n",
        "docs/new.md": "new\n",
        "logo.bin": "\0\x01\x02binary",
    });
    const changes = await get(`/api/tasks/${task.id}/changes`);
    assert.equal(changes.status, 200);
    assert.equal(changes.json.task, task.id);
    assert.equal(changes.json.branch, `olimp/${task.id}`);
    assert.equal(changes.json.base, "main");
    assert.match(changes.json.head as string, /^[0-9a-f]{40}$/);
    assert.deepEqual(
        (changes.json.files as { path: string }[]).sort((a, b) => a.path.localeCompare(b.path)),
        [
            { path: "docs/new.md", added: 1, deleted: 0 },
            { path: "logo.bin", added: null, deleted: null },
            { path: "src/app.ts", added: 2, deleted: 1 },
        ],
    );
    assert.match(changes.json.diff as string, /^\+export const b = 3;$/m);
    assert.match(changes.json.diff as string, /^-export const a = 1;$/m);
    assert.equal(changes.json.filesTruncated, false);
    assert.equal(changes.json.diffTruncated, false);
});

test("the diff leaves out what main gained after the branch was cut", async () => {
    const { store, seed, push, publish, get } = await setup();
    const task = await store.createTask({ repo: "acme/demo", title: "Fix", body: "" });
    await store.startJob("task", task.id, `olimp/${task.id}`);
    await push(`olimp/${task.id}`, { "a.txt": "a\n" });
    await commitFiles(seed, { "later.txt": "later\n" }, "later on main");
    await publish("main");
    const changes = await get(`/api/tasks/${task.id}/changes`);
    assert.deepEqual(
        (changes.json.files as { path: string }[]).map((f) => f.path),
        ["a.txt"],
    );
});

test("a job without a pushed branch has no changes", async () => {
    const { store, get } = await setup();
    const queued = await store.createTask({ repo: "acme/demo", title: "Later", body: "" });
    const none = await get(`/api/tasks/${queued.id}/changes`);
    assert.equal(none.status, 200);
    assert.equal(none.json.branch, null);
    assert.equal(none.json.head, null);
    assert.deepEqual(none.json.files, []);
    assert.equal(none.json.diff, "");
    const failed = await store.createTask({ repo: "acme/demo", title: "Failed", body: "" });
    await store.startJob("task", failed.id, `olimp/${failed.id}`);
    const unpushed = await get(`/api/tasks/${failed.id}/changes`);
    assert.equal(unpushed.json.branch, `olimp/${failed.id}`);
    assert.equal(unpushed.json.head, null);
    assert.equal((await get("/api/tasks/0123456789ab/changes")).json.code, "task.notFound");
});

test("a workflow run's changes come from its branch, a large diff is cut", async () => {
    const { store, push, get } = await setup();
    const workflow = await store.createWorkflow({
        name: "Fix",
        repo: "acme/demo",
        definition: fix,
    });
    const run = await store.createRun(workflow);
    await store.startJob("run", run.id, `olimp/${run.id}`);
    await push(`olimp/${run.id}`, { "big.txt": `${"x".repeat(99)}\n`.repeat(3000) });
    const changes = await get(`/api/workflow-runs/${run.id}/changes`);
    assert.equal(changes.status, 200);
    assert.equal(changes.json.run, run.id);
    assert.deepEqual(changes.json.files, [{ path: "big.txt", added: 3000, deleted: 0 }]);
    assert.equal(changes.json.diffTruncated, true);
    assert.equal((changes.json.diff as string).length, DIFF_MAX);
    assert.equal((await get("/api/workflow-runs/cccccccccccc/changes")).status, 404);
});

test("a task's commits are the branch's own, newest first, each with its diff", async () => {
    const { store, seed, push, publish, get } = await setup();
    const task = await store.createTask({ repo: "acme/demo", title: "Fix", body: "" });
    const branch = `olimp/${task.id}`;
    await store.startJob("task", task.id, branch);
    await push(branch, { "a.txt": "a\n" });
    await must("git", ["-C", seed, "checkout", "-q", branch]);
    await commitFiles(seed, { "b.txt": "b\n" }, "Add b\n\nWhy b is needed.");
    await publish(branch);
    await must("git", ["-C", seed, "checkout", "-q", "main"]);
    const list = await get(`/api/tasks/${task.id}/commits`);
    assert.equal(list.status, 200);
    assert.equal(list.json.task, task.id);
    assert.equal(list.json.truncated, false);
    const commits = list.json.commits as { sha: string; title: string; body: string }[];
    assert.deepEqual(
        commits.map((c) => [c.title, c.body]),
        [
            ["Add b", "Why b is needed."],
            [branch, ""],
        ],
    );
    assert.match(commits[0]?.sha ?? "", /^[0-9a-f]{40}$/);
    const first = await get(`/api/tasks/${task.id}/commits/${commits[1]?.sha.slice(0, 7)}`);
    assert.equal(first.status, 200);
    assert.equal(first.json.title, branch);
    assert.deepEqual(first.json.files, [{ path: "a.txt", added: 1, deleted: 0 }]);
    assert.match(first.json.diff as string, /^\+a$/m);
    const mainHead = await must("git", ["-C", seed, "rev-parse", "main"]);
    const outside = await get(`/api/tasks/${task.id}/commits/${mainHead}`);
    assert.equal(outside.status, 404);
    assert.equal(outside.json.code, "task.commitNotFound");
});

test("a task's files are its branch's tree, each readable, binary ones without content but images", async () => {
    const { store, push, get } = await setup();
    const task = await store.createTask({ repo: "acme/demo", title: "Fix", body: "" });
    await store.startJob("task", task.id, `olimp/${task.id}`);
    // Bigger than one read of git's output, so base64 is decoded across chunks.
    const png = `\0${"ab\x01".repeat(40_000)}`;
    await push(`olimp/${task.id}`, {
        "src/new file.ts": "export {};\n",
        "logo.bin": "\0\x01",
        "logo/concepts.PNG": png,
    });
    const list = await get(`/api/tasks/${task.id}/files`);
    assert.equal(list.status, 200);
    assert.deepEqual((list.json.files as string[]).sort(), [
        "README.md",
        "logo.bin",
        "logo/concepts.PNG",
        "src/app.ts",
        "src/new file.ts",
    ]);
    const image = await get(`/api/tasks/${task.id}/files?path=logo/concepts.PNG`);
    assert.equal(image.json.image, "image/png");
    assert.equal(image.json.binary, true);
    assert.equal(image.json.content, Buffer.from(png).toString("base64"));
    const file = await get(
        `/api/tasks/${task.id}/files?path=${encodeURIComponent("src/new file.ts")}`,
    );
    assert.deepEqual(file.json, {
        task: task.id,
        path: "src/new file.ts",
        size: 11,
        binary: false,
        content: "export {};\n",
        truncated: false,
        image: null,
    });
    const binary = await get(`/api/tasks/${task.id}/files?path=logo.bin`);
    assert.equal(binary.json.binary, true);
    assert.equal(binary.json.content, "");
    assert.equal(binary.json.image, null);
    assert.equal(
        (await get(`/api/tasks/${task.id}/files?path=nope.txt`)).json.code,
        "task.fileNotFound",
    );
    assert.equal(
        (await get(`/api/tasks/${task.id}/files?path=src`)).json.code,
        "task.fileNotFound",
    );
    for (const bad of ["../etc/passwd", "/README.md", "src//app.ts", "./README.md"]) {
        const refused = await get(`/api/tasks/${task.id}/files?path=${encodeURIComponent(bad)}`);
        assert.equal(refused.status, 400, bad);
        assert.equal(refused.json.code, "task.badPath");
    }
    const queued = await store.createTask({ repo: "acme/demo", title: "Later", body: "" });
    const none = await get(`/api/tasks/${queued.id}/files`);
    assert.deepEqual([none.json.head, none.json.files], [null, []]);
    assert.deepEqual((await get(`/api/tasks/${queued.id}/commits`)).json.commits, []);
});

test("a project's Git page reads its folder: uncommitted work, any branch's history and tree", async () => {
    const home = mkdtempSync(join(root, "home-"));
    const project = join(home, "project");
    await must("git", ["init", "-q", "-b", "main", project]);
    await commitFiles(project, { "README.md": "# Demo\n", ".gitignore": "*.log\n" }, "init");
    await must("git", ["-C", project, "checkout", "-q", "-b", "release"]);
    await commitFiles(project, { "release.txt": "r\n" }, "Release notes");
    await must("git", ["-C", project, "checkout", "-q", "main"]);
    await commitFiles(project, { "src/app.ts": "export const a = 1;\n" }, "Add app");
    writeFileSync(join(project, "README.md"), "# Demo\nmore\n");
    writeFileSync(join(project, "new.txt"), "new\n");
    writeFileSync(join(project, "debug.log"), "ignored\n");
    const store = await openStore(home);
    await store.addRepo("demo", "main", project, null);
    await store.addRepo("plain", "", mkdtempSync(join(home, "plain-")), null);
    const get = await serve(store, {
        ...loadConfig({ OLIMP_HOME: home }),
        webDir: join(root, "no-panel"),
    });

    const changes = await get("/api/repos/demo/changes");
    assert.equal(changes.status, 200, JSON.stringify(changes.json));
    assert.equal(changes.json.branch, "main");
    assert.deepEqual(changes.json.files, [
        { path: "README.md", added: 1, deleted: 0 },
        { path: "new.txt", added: 1, deleted: 0 },
    ]);
    assert.match(changes.json.diff as string, /^\+new$/m);
    // The untracked file was marked only in a copy of the index.
    assert.match(await must("git", ["-C", project, "status", "--porcelain"]), /^\?\? new\.txt$/m);

    const history = await get("/api/repos/demo/commits");
    const commits = history.json.commits as {
        sha: string;
        parents: string[];
        refs: string[];
        title: string;
    }[];
    assert.deepEqual(
        commits.map((c) => [c.title, c.refs]),
        [
            ["Add app", ["HEAD", "main"]],
            ["init", []],
        ],
    );
    assert.deepEqual(commits[0]?.parents, [commits[1]?.sha]);
    assert.deepEqual(commits[1]?.parents, []);
    const root0 = await get(`/api/repos/demo/commits/${commits[1]?.sha}`);
    assert.equal(root0.status, 200, JSON.stringify(root0.json));
    assert.deepEqual(
        (root0.json.files as { path: string }[]).map((f) => f.path),
        [".gitignore", "README.md"],
    );
    const release = await get("/api/repos/demo/commits?branch=release");
    const top = (release.json.commits as { sha: string; title: string }[])[0];
    assert.equal(top?.title, "Release notes");
    assert.equal(
        (await get(`/api/repos/demo/commits/${top?.sha}`)).json.code,
        "repo.commitNotFound",
    );
    assert.equal(
        (await get(`/api/repos/demo/commits/${top?.sha}?branch=release`)).json.title,
        "Release notes",
    );

    assert.deepEqual((await get("/api/repos/demo/files?branch=release")).json.files, [
        ".gitignore",
        "README.md",
        "release.txt",
    ]);
    assert.equal(
        (await get("/api/repos/demo/files?path=src%2Fapp.ts")).json.content,
        "export const a = 1;\n",
    );
    assert.equal((await get("/api/repos/demo/files?path=new.txt")).json.code, "repo.fileNotFound");
    assert.equal((await get("/api/repos/demo/files?path=..%2Fx")).json.code, "task.badPath");
    assert.equal(
        (await get("/api/repos/demo/commits?branch=nope")).json.code,
        "repo.unknownBranch",
    );
    assert.equal((await get("/api/repos/plain/changes")).json.code, "repo.noGit");
    assert.equal((await get("/api/repos/nope/files")).status, 404);
});

test("numstat output with odd paths and binary files is parsed", () => {
    assert.deepEqual(parseNumstat("1\t2\ta b.ts\0-\t-\tlogo.png\x003\t0\tnew\tline.md\0"), [
        { path: "a b.ts", added: 1, deleted: 2 },
        { path: "logo.png", added: null, deleted: null },
        { path: "new\tline.md", added: 3, deleted: 0 },
    ]);
});

test("a log entry keeps its parents and refs, the body may span lines", () => {
    assert.deepEqual(
        parseLog(
            "a1\0p1 p2\0HEAD -> main, origin/main, tag: v1\0Ann\0ann@x.io\x002026-10-30\0Merge\0Line 1\nLine 2\n\x1e",
        ),
        [
            {
                sha: "a1",
                parents: ["p1", "p2"],
                refs: ["HEAD", "main", "origin/main", "tag: v1"],
                author: "Ann",
                email: "ann@x.io",
                date: "2026-10-30",
                title: "Merge",
                body: "Line 1\nLine 2",
            },
        ],
    );
});
