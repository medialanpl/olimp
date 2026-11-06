import { painter } from "./banner.ts";
import { loadConfig } from "./config.ts";
import { openApi } from "./openapi.ts";

type Schema = {
    type?: string | string[];
    enum?: unknown[];
    const?: unknown;
    items?: Schema;
    anyOf?: Schema[];
    oneOf?: Schema[];
    title?: string;
    description?: string;
    properties?: Record<string, Schema>;
    required?: string[];
};
type Param = { name: string; in: string; required: boolean; schema: Schema };
type Op = {
    tags: string[];
    operationId: string;
    summary: string;
    description: string;
    parameters?: Param[];
    requestBody?: { content: { "application/json": { schema: Schema } } };
};
type Spec = { info: { title: string; version: string }; paths: Record<string, Record<string, Op>> };

const METHOD: Record<string, "blue" | "green" | "yellow" | "red"> = {
    get: "blue",
    post: "green",
    put: "yellow",
    patch: "yellow",
    delete: "red",
};
// More matches than this are listed, fewer are shown in full.
const DETAILED = 5;

const typeOf = (schema: Schema): string => {
    if (schema.enum) return schema.enum.join(" | ");
    if ("const" in schema) return JSON.stringify(schema.const);
    if (schema.type === "array") return `${typeOf(schema.items ?? {})}[]`;
    const options = schema.anyOf ?? schema.oneOf;
    if (options) return options.map(typeOf).join(" | ");
    return [schema.type ?? "any"].flat().join(" | ");
};

const wrap = (text: string, width: number) =>
    text.split("\n").flatMap((line) => {
        const lines: string[] = [];
        let current = "";
        for (const word of line.split(" ")) {
            if (current && current.length + word.length + 1 > width) {
                lines.push(current);
                current = word;
            } else current = current ? `${current} ${word}` : word;
        }
        return [...lines, current];
    });

export function docsText(
    spec: Spec,
    query: string,
    url: string,
    columns: number,
    depth: number,
): string {
    const paint = painter(depth);
    const ops = Object.entries(spec.paths).flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, op]) => ({ method, path, op })),
    );
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = ops.filter(({ method, path, op }) => {
        const text = `${method} ${path} ${op.summary} ${op.tags} ${op.operationId}`.toLowerCase();
        return words.every((word) => text.includes(word));
    });
    const method = (name: string) => paint(METHOD[name] ?? "bold", name.toUpperCase().padEnd(7));
    const text = Math.min(columns, 100);
    // A field's name and type on one line, its description wrapped under the type.
    const table = (title: string, rows: [string, boolean, Schema][]) => {
        if (!rows.length) return [];
        const width = Math.max(...rows.map(([name]) => name.length)) + 1;
        const indent = " ".repeat(width + 6);
        return [
            "",
            `  ${paint("bold", title)}`,
            ...rows.flatMap(([name, required, schema]) => [
                `    ${`${name}${required ? "*" : ""}`.padEnd(width)}  ${typeOf(schema)}`,
                ...(schema.description
                    ? wrap(schema.description, text - indent.length).map(
                          (line) => `${indent}${paint("dim", line)}`,
                      )
                    : []),
            ]),
        ];
    };
    const fields = (schema: Schema): [string, boolean, Schema][] =>
        Object.entries(schema.properties ?? {}).map(([name, field]) => [
            name,
            schema.required?.includes(name) ?? false,
            field,
        ]);

    const lines = ["", `  ${paint("bold", spec.info.title)} ${paint("dim", spec.info.version)}`];
    if (!found.length) lines.push("", `  Nothing matches "${query}".`);
    else if (!words.length || found.length > DETAILED) {
        const width = Math.max(...found.map(({ path }) => path.length));
        let tag = "";
        for (const { method: name, path, op } of found) {
            if (op.tags[0] !== tag) {
                tag = op.tags[0];
                lines.push("", `  ${paint("bold", tag)}`);
            }
            lines.push(`    ${method(name)} ${path.padEnd(width)}  ${paint("dim", op.summary)}`);
        }
    } else
        for (const { method: name, path, op } of found) {
            const tools = [...op.description.matchAll(/MCP tool: `(\w+)`/g)].map(
                ([, tool]) => tool,
            );
            const about = op.description
                .replace(/\n*MCP tool: `\w+`/g, "")
                .replace(/^#### (.+)$/gm, (_, title: string) => paint("bold", title))
                .trim();
            const params = op.parameters ?? [];
            const body = op.requestBody?.content["application/json"].schema;
            lines.push(
                "",
                `  ${method(name)} ${paint("bold", path)}`,
                `  ${paint("dim", [op.summary, op.tags[0], `MCP ${tools.join(", ")}`].join(" · "))}`,
                "",
                ...wrap(about, text - 4).map((line) => `  ${line}`),
                ...table(
                    "Path",
                    params.filter((p) => p.in === "path").map((p) => [p.name, true, p.schema]),
                ),
                ...table(
                    "Query",
                    params
                        .filter((p) => p.in === "query")
                        .map((p) => [p.name, p.required, p.schema]),
                ),
                ...(body?.oneOf
                    ? body.oneOf.flatMap((one) => table(`Body: ${one.title}`, fields(one)))
                    : table("Body", body ? fields(body) : [])),
            );
        }
    lines.push(
        "",
        `  ${paint("brand", "➜")} ${paint("link", `${url}/docs/api`)}  ${paint("dim", "the interactive reference")}`,
    );
    if (!words.length)
        lines.push(
            `    ${paint("dim", "olimp docs <words> shows the operations that match in full")}`,
        );
    return `${lines.join("\n")}\n\n`;
}

export async function docs(query: string): Promise<string> {
    const spec = (await openApi()) as Spec;
    const url = `http://127.0.0.1:${loadConfig().port}`;
    const { columns = 100 } = process.stdout;
    return docsText(spec, query, url, columns, process.stdout.getColorDepth?.() ?? 1);
}
