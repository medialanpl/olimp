import type { IncomingMessage } from "node:http";
import { HttpError, readJson } from "../http.ts";
import { INTEGRATION_NAME, parseServer, type ServerSpec } from "../integrations.ts";
import { INTEGRATION_NAME_MAX } from "../limits.ts";
import { unresolved } from "../project.ts";
import type { Store } from "../store.ts";
import { type Answer, inputError } from "./shared.ts";

function integrationName(value: unknown): string {
    if (typeof value !== "string" || !INTEGRATION_NAME.test(value))
        throw new HttpError(400, "integration.invalidName", { max: INTEGRATION_NAME_MAX });
    return value;
}

function serverOf(body: Record<string, unknown>, base?: ServerSpec): ServerSpec {
    try {
        return parseServer(body, base);
    } catch (error) {
        inputError(error);
    }
}

const ROUTE = /^\/api\/repos\/([a-z0-9][a-z0-9-]*)\/integrations(?:\/([\w-]+))?$/;

export async function integrationsRoute(
    store: Store,
    req: IncomingMessage,
    path: string,
): Promise<Answer | undefined> {
    const match = ROUTE.exec(path);
    if (!match) return undefined;
    const [, repo = "", name] = match;
    const method = req.method;
    if (!(await store.repo(repo))) throw new HttpError(404, "repo.notRegistered", { repo });
    if (!name) {
        if (method === "GET") {
            const missing = await unresolved(store, repo);
            const list = await store.integrations(repo);
            return [200, list.map((i) => ({ ...i, missing: missing(i) }))];
        }
        if (method === "POST") {
            const body = await readJson(req);
            const integration = integrationName(body.name);
            const added = await store.addIntegration(repo, integration, serverOf(body));
            if (!added) throw new HttpError(409, "integration.exists", { repo, integration });
            return [201, added];
        }
        return undefined;
    }
    const current = await store.integration(repo, name);
    if (!current) throw new HttpError(404, "integration.notFound", { repo, integration: name });
    if (method === "PATCH") {
        const body = await readJson(req);
        if (body.name !== undefined && body.name !== name)
            throw new HttpError(400, "integration.fixedName");
        return [200, await store.updateIntegration(repo, name, serverOf(body, current))];
    }
    if (method === "DELETE") {
        await store.deleteIntegration(repo, name);
        return [200, current];
    }
    return undefined;
}
