import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { createApi } from "../src/api.ts";
import { loadConfig } from "../src/config.ts";
import { autoMerge, labelPr, mergeView, parseType } from "../src/github.ts";
import type { Repo } from "../src/store.ts";
import { openStore, script } from "./fixtures.ts";

const root = mkdtempSync(join(tmpdir(), "olimp-github-"));
const servers: Server[] = [];
after(() => {
    for (const server of servers) server.close();
    rmSync(root, { recursive: true, force: true });
});

const SHA = "a".repeat(40);
const check = (name: string, conclusion: string | null, status = "COMPLETED") => ({
    name,
    conclusion,
    status,
});
const pr = (extra: Record<string, unknown> = {}) => ({
    number: 7,
    title: "Fix the login",
    url: "https://github.com/acme/demo/pull/7",
    author: { login: "octo" },
    createdAt: "2026-10-31T10:00:00Z",
    labels: [{ name: "fix", color: "d73a4a" }],
    comments: [],
    isDraft: false,
    additions: 3,
    deletions: 1,
    headRefName: "olimp/abc",
    body: "Closes #3",
    state: "OPEN",
    mergeStateStatus: "CLEAN",
    reviewDecision: "",
    headRefOid: SHA,
    baseRefName: "main",
    statusCheckRollup: [check("test", "SUCCESS")],
    ...extra,
});

// A gh that answers from files in its folder and logs every call.
function fakeGithub() {
    const dir = mkdtempSync(join(root, "gh-"));
    const put = (name: string, value: unknown) =>
        writeFileSync(join(dir, name), JSON.stringify(value));
    const gh = script(
        dir,
        "gh",
        `echo "$*" >> "${dir}/calls.log"
case "$1 $2" in
  "issue list") cat "${dir}/issues.json" ;;
  "pr list") case "$*" in *--label*) cat "${dir}/labelled.json" ;; *) cat "${dir}/prs.json" ;; esac ;;
  "pr view") cat "${dir}/pr-$3.json" ;;
  "issue view") cat "${dir}/issue-$3.json" ;;
  "api repos/acme/demo") cat "${dir}/policy.json" ;;
  "api --method")
    [ -f "${dir}/refuse" ] && { echo "gh: Head branch was modified (HTTP 409)" >&2; exit 1; }
    echo '{"merged":true}' ;;
  "label list") cat "${dir}/labels.json" 2>/dev/null || echo '[]' ;;
  "label create"|"pr edit") ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac`,
    );
    put("policy.json", { allow_squash_merge: true, allow_merge_commit: true });
    const calls = () => readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n");
    return { dir, gh, put, calls };
}

async function setup() {
    const fake = fakeGithub();
    const home = mkdtempSync(join(root, "home-"));
    const store = await openStore(home);
    await store.addRepo("demo", "main", null, "acme/demo");
    await store.addRepo("local", "main", join(home, "local"), null);
    const cfg = {
        ...loadConfig({ OLIMP_HOME: home, HOME: join(home, "agent-home") }),
        gh: fake.gh,
    };
    const server = createApi(store, cfg);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, path: string, body?: object) => {
        const res = await fetch(base + path, {
            method,
            headers: body ? { "content-type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    return { ...fake, store, cfg, call };
}

test("the agent's type marker is read and taken off its answer", () => {
    assert.deepEqual(parseType("Done.\nOLIMP:TYPE fix\n"), { type: "fix", text: "Done." });
    assert.deepEqual(parseType("Done.\nOLIMP:TYPE Docs"), { type: "docs", text: "Done." });
    assert.deepEqual(parseType("Done.\nOLIMP:TYPE wip"), { type: null, text: "Done." });
    assert.deepEqual(parseType("No marker"), { type: null, text: "No marker" });
});

test("a person may merge what GitHub allows; unattended merging needs every check green", () => {
    const view = (extra: Record<string, unknown>) => {
        const { ready, auto } = mergeView(pr(extra), ["squash"]);
        return { ready, auto };
    };
    assert.deepEqual(view({}), { ready: true, auto: true });
    // Only a check that is not required fails.
    assert.deepEqual(view({ mergeStateStatus: "UNSTABLE" }), { ready: true, auto: false });
    assert.deepEqual(view({ statusCheckRollup: [] }), { ready: true, auto: false });
    assert.deepEqual(view({ statusCheckRollup: [check("test", null, "IN_PROGRESS")] }), {
        ready: true,
        auto: false,
    });
    for (const blocked of [
        { mergeStateStatus: "BLOCKED" },
        { mergeStateStatus: "DIRTY" },
        { mergeStateStatus: "BEHIND" },
        { isDraft: true },
        { state: "MERGED" },
    ])
        assert.deepEqual(view(blocked), { ready: false, auto: false }, JSON.stringify(blocked));
    // A commit status has a state instead of a conclusion.
    const status = mergeView(pr({ statusCheckRollup: [{ context: "ci", state: "SUCCESS" }] }), []);
    assert.deepEqual(status.checks, [{ name: "ci", state: "passing", url: null }]);
    assert.equal(status.auto, true);
});

test("a project's issues and pull requests list with their labels; an admin merges by head SHA", async () => {
    const { call, put, calls, dir } = await setup();
    put("issues.json", [{ ...pr(), number: 3, title: "Login fails", isDraft: undefined }]);
    put("prs.json", [pr()]);
    put(
        "pr-7.json",
        pr({ comments: [{ author: { login: "ada" }, body: "LGTM", createdAt: "x" }] }),
    );
    const issues = await call("GET", "/api/repos/demo/github/issues");
    assert.equal(issues.status, 200, JSON.stringify(issues.json));
    const [issue] = issues.json as unknown as { number: number; labels: unknown[] }[];
    assert.deepEqual([issue?.number, issue?.labels], [3, [{ name: "fix", color: "d73a4a" }]]);
    const one = await call("GET", "/api/repos/demo/github/prs/7");
    const merge = one.json.merge as { ready: boolean; methods: string[]; headSha: string };
    assert.deepEqual([merge.ready, merge.methods, merge.headSha], [true, ["squash", "merge"], SHA]);
    assert.deepEqual(one.json.conversation, [{ author: "ada", body: "LGTM", createdAt: "x" }]);

    const merging = "/api/repos/demo/github/prs/7/merge";
    assert.equal(
        (await call("POST", merging, { method: "fast", sha: SHA })).json.code,
        "github.invalidMethod",
    );
    assert.equal(
        (await call("POST", merging, { method: "squash", sha: "abc" })).json.code,
        "github.invalidSha",
    );
    const merged = await call("POST", merging, { method: "squash", sha: SHA });
    assert.equal(merged.status, 200, JSON.stringify(merged.json));
    assert.ok(
        calls().includes(
            `api --method PUT repos/acme/demo/pulls/7/merge -f merge_method=squash -f sha=${SHA}`,
        ),
    );
    writeFileSync(join(dir, "refuse"), "");
    const refused = await call("POST", merging, { method: "squash", sha: SHA });
    assert.deepEqual([refused.status, refused.json.code], [409, "github.mergeRefused"]);
    assert.match(refused.json.error as string, /Head branch was modified/);
    const local = await call("GET", "/api/repos/local/github/prs");
    assert.deepEqual([local.status, local.json.code], [400, "github.localProject"]);
});

test("the pull request settings are checked: labels without commas, at most ten", async () => {
    const { call } = await setup();
    const path = "/api/repos/demo/settings";
    const saved = await call("PATCH", path, {
        prLabels: ["olimp", " olimp ", "risk:low"],
        typeLabel: true,
        autoMergeLabel: "risk:low",
    });
    const settings = saved.json.settings as Record<string, unknown>;
    assert.deepEqual(
        [settings.prLabels, settings.typeLabel, settings.autoMergeLabel],
        [["olimp", "risk:low"], true, "risk:low"],
    );
    assert.equal(
        (await call("PATCH", path, { prLabels: ["a,b"] })).json.code,
        "project.invalidLabel",
    );
    const many = Array.from({ length: 11 }, (_, i) => `l${i}`);
    assert.equal(
        (await call("PATCH", path, { prLabels: many })).json.code,
        "project.invalidLabels",
    );
    const off = await call("PATCH", path, { autoMergeLabel: null });
    assert.equal((off.json.settings as Record<string, unknown>).autoMergeLabel, null);
});

test("auto-merge takes only OLIMP's own labelled pull requests whose checks all passed", async () => {
    const { store, cfg, put, calls } = await setup();
    await store.setRepoSettings("demo", {
        ...((await store.repo("demo")) as Repo).settings,
        autoMergeLabel: "risk:low",
    });
    const url = (n: number) => `https://github.com/acme/demo/pull/${n}`;
    put("labelled.json", [
        pr({ number: 1, url: url(1) }),
        pr({ number: 2, url: url(2), statusCheckRollup: [check("test", null, "QUEUED")] }),
        pr({ number: 3, url: url(3), headRefName: "someone/else" }),
        pr({ number: 4, url: url(4), statusCheckRollup: [] }),
        pr({ number: 5, url: url(5), isDraft: true }),
        pr({ number: 6, url: url(6), mergeStateStatus: "BLOCKED" }),
    ]);
    assert.deepEqual(await autoMerge(store, cfg), [url(1)]);
    assert.ok(
        calls().some(
            (c) => c.startsWith("pr list --repo acme/demo") && c.includes("--label risk:low"),
        ),
    );
    assert.deepEqual(
        calls().filter((c) => c.startsWith("api --method")),
        [`api --method PUT repos/acme/demo/pulls/1/merge -f merge_method=squash -f sha=${SHA}`],
    );
});

test("a pull request gets its labels, the missing ones made first", async () => {
    const { store, cfg, put, calls } = await setup();
    put("labels.json", [{ name: "Olimp" }]);
    await labelPr(cfg, (await store.repo("demo")) as Repo, "https://github.com/acme/demo/pull/7", [
        "olimp",
        "fix",
    ]);
    assert.deepEqual(calls().slice(-2), [
        "label create fix --repo acme/demo --color d73a4a",
        "pr edit https://github.com/acme/demo/pull/7 --add-label olimp --add-label fix",
    ]);
});
