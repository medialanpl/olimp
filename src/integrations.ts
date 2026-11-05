import type { MessageKey, Params } from "./i18n.ts";
import {
    INTEGRATION_ENTRIES_MAX,
    INTEGRATION_NAME_MAX,
    INTEGRATION_VALUE_MAX,
    STEP_INTEGRATIONS_MAX,
} from "./limits.ts";

export const INTEGRATION_NAME = new RegExp(`^[\\w-]{1,${INTEGRATION_NAME_MAX}}$`);
export const KINDS = ["stdio", "http"] as const;
export type Kind = (typeof KINDS)[number];

export interface StdioServer {
    kind: "stdio";
    command: string;
    args: string[];
    env: Record<string, string>;
}

export interface HttpServer {
    kind: "http";
    url: string;
    headers: Record<string, string>;
}

// Env and header values hold `${NAME}` references to the OLIMP process environment, never secrets.
export type ServerSpec = StdioServer | HttpServer;

export type Integration = ServerSpec & {
    repo: string;
    name: string;
    createdAt: string;
    updatedAt: string;
};

export class IntegrationError extends Error {
    readonly code: MessageKey;
    readonly params: Params;
    constructor(code: MessageKey, params: Params = {}) {
        super(code);
        this.code = code;
        this.params = params;
    }
}

export const REFERENCE_EXAMPLE = `\${API_TOKEN}`;
const REFERENCE = /\$\{([A-Za-z_]\w*)\}/g;
const ENV_NAME = /^[A-Za-z_]\w*$/;
// The token characters of RFC 9110.
const HEADER_NAME = /^[!#$%&'*+.^`|~\w-]+$/;
const AUTHORIZATION = /^(?:proxy-)?authorization$/i;

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

export const references = (value: string): string[] =>
    [...value.matchAll(REFERENCE)].map((m) => m[1] as string);

export function variablesOf(spec: ServerSpec): string[] {
    const values = Object.values(spec.kind === "stdio" ? spec.env : spec.headers);
    return [...new Set(values.flatMap(references))];
}

export const missingVariables = (spec: ServerSpec, env: NodeJS.ProcessEnv): string[] =>
    variablesOf(spec).filter((name) => env[name] === undefined);

// Only for agents that do not expand references themselves; the caller checked missingVariables.
export const expand = (value: string, env: NodeJS.ProcessEnv): string =>
    value.replace(REFERENCE, (_, name: string) => env[name] ?? "");

function plain(value: unknown, field: string, kind: Kind): string {
    if (typeof value !== "string" || !value.trim() || value.length > INTEGRATION_VALUE_MAX)
        throw new IntegrationError("integration.invalidField", { field, kind });
    if (value.includes("${"))
        throw new IntegrationError("integration.referenceNotAllowed", { field });
    return value;
}

// A value that may refer to variables; a `${` that is not a whole reference is refused, so the
// agent never expands something else (such as Claude's `${NAME:-default}`).
function withReferences(value: unknown, field: string, kind: Kind): string {
    if (typeof value !== "string" || value.length > INTEGRATION_VALUE_MAX)
        throw new IntegrationError("integration.invalidField", { field, kind });
    if (value.replace(REFERENCE, "").includes("${"))
        throw new IntegrationError("integration.invalidReference", {
            field,
            example: REFERENCE_EXAMPLE,
        });
    return value;
}

function entries(value: unknown, field: string, kind: Kind, key: RegExp): [string, string][] {
    if (value === undefined) return [];
    if (!isObject(value) || Object.keys(value).length > INTEGRATION_ENTRIES_MAX)
        throw new IntegrationError("integration.invalidField", { field, kind });
    return Object.entries(value).map(([name, v]) => {
        if (!key.test(name))
            throw new IntegrationError("integration.invalidField", {
                field: `${field}.${name}`,
                kind,
            });
        return [name, withReferences(v, `${field}.${name}`, kind)];
    });
}

function stdio(raw: Record<string, unknown>): StdioServer {
    const args = raw.args ?? [];
    if (!Array.isArray(args) || args.length > INTEGRATION_ENTRIES_MAX)
        throw new IntegrationError("integration.invalidField", { field: "args", kind: "stdio" });
    return {
        kind: "stdio",
        command: plain(raw.command, "command", "stdio"),
        args: args.map((arg, i) => plain(arg, `args.${i}`, "stdio")),
        env: Object.fromEntries(entries(raw.env, "env", "stdio", ENV_NAME)),
    };
}

function http(raw: Record<string, unknown>): HttpServer {
    const url = plain(raw.url, "url", "http");
    let protocol = "";
    try {
        protocol = new URL(url).protocol;
    } catch {}
    if (protocol !== "http:" && protocol !== "https:")
        throw new IntegrationError("integration.invalidField", { field: "url", kind: "http" });
    const headers = entries(raw.headers, "headers", "http", HEADER_NAME);
    for (const [name, value] of headers)
        if (AUTHORIZATION.test(name) && !references(value).length)
            throw new IntegrationError("integration.literalAuthorization", {
                header: name,
                example: `Bearer ${REFERENCE_EXAMPLE}`,
            });
    return { kind: "http", url, headers: Object.fromEntries(headers) };
}

const FIELDS: Record<Kind, string[]> = {
    stdio: ["command", "args", "env"],
    http: ["url", "headers"],
};

// A whole configuration, or with `base` a change: the given fields replace the stored ones, and a
// change of kind starts from nothing.
export function parseServer(body: Record<string, unknown>, base?: ServerSpec): ServerSpec {
    const kind = (body.kind ?? base?.kind) as Kind;
    if (!KINDS.includes(kind)) throw new IntegrationError("integration.invalidKind");
    const other = FIELDS[kind === "stdio" ? "http" : "stdio"];
    const stray = other.find((field) => body[field] !== undefined);
    if (stray) throw new IntegrationError("integration.invalidField", { field: stray, kind });
    const merged: Record<string, unknown> = base?.kind === kind ? { ...base } : {};
    for (const field of FIELDS[kind]) if (body[field] !== undefined) merged[field] = body[field];
    return kind === "stdio" ? stdio(merged) : http(merged);
}

// The integrations a task, automation or agent node chooses: names without duplicates, or null
// when the value is not such a list.
export function parseNames(value: unknown): string[] | null {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > STEP_INTEGRATIONS_MAX) return null;
    if (!value.every((name) => typeof name === "string" && INTEGRATION_NAME.test(name)))
        return null;
    return [...new Set(value as string[])];
}

export const specOf = (integration: Integration): ServerSpec =>
    integration.kind === "stdio"
        ? {
              kind: "stdio",
              command: integration.command,
              args: integration.args,
              env: integration.env,
          }
        : { kind: "http", url: integration.url, headers: integration.headers };
