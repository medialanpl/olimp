import assert from "node:assert/strict";
import { test } from "node:test";
import { openApi } from "../src/openapi.ts";

type Op = {
    operationId: string;
    description: string;
    parameters: { name: string; in: string; required: boolean }[];
    requestBody?: { content: { "application/json": { schema: Record<string, unknown> } } };
};

test("the OpenAPI description is made from the MCP tools' own requests", async () => {
    const spec = (await openApi()) as { paths: Record<string, Record<string, Op>> };
    const text = JSON.stringify(spec);
    assert.ok(!/__\w+__/.test(text), "no argument marker is left");
    const ops = Object.entries(spec.paths).flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, op]) => ({ path, method, op })),
    );
    for (const { path, method, op } of ops) {
        for (const [, name] of path.matchAll(/\{(\w+)\}/g))
            assert.ok(
                op.parameters.some((p) => p.in === "path" && p.name === name && p.required),
                `${method} ${path} declares {${name}}`,
            );
        // The API refuses a write without a JSON body, so every one has one.
        if (method !== "get") assert.ok(op.requestBody, `${method} ${path} has a JSON body`);
    }
    const create = spec.paths["/api/tasks"].post;
    assert.equal(create.operationId, "olimp_create_task");
    assert.deepEqual(create.requestBody?.content["application/json"].schema.required, [
        "repo",
        "title",
    ]);
    const search = spec.paths["/api/repos/{repo}/memory/search"].get;
    assert.deepEqual(
        search.parameters.map((p) => [p.in, p.name, p.required]),
        [
            ["path", "repo", true],
            ["query", "q", true],
        ],
    );
    // Adding and creating a repository share one method and path: one operation, two bodies.
    const repos = spec.paths["/api/repos"].post;
    assert.match(repos.description, /olimp_add_repo[\s\S]*olimp_create_repo/);
    const bodies = repos.requestBody?.content["application/json"].schema.oneOf as unknown[];
    assert.equal(bodies.length, 2);
    // Tools name each other; the description names the operation instead.
    assert.match(create.description, /`POST \/api\/task-groups\/\{group\}\/pick`/);
});
