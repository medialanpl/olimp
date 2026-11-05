import { type ServerSpec, variablesOf } from "../../../src/integrations.ts";

export const CATEGORIES = ["code", "work", "web"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Preset {
    id: PresetId;
    name: string;
    category: Category;
    spec: ServerSpec;
    variables: string[];
    docs: string;
}

const ref = (variable: string) => `\${${variable}}`;

const npx = (args: string[], env: Record<string, string> = {}): ServerSpec => ({
    kind: "stdio",
    command: "npx",
    args: ["-y", ...args],
    env,
});

const bearer = (url: string, variable: string): ServerSpec => ({
    kind: "http",
    url,
    headers: { Authorization: `Bearer ${ref(variable)}` },
});

// The key is the integration name the preset suggests, and its message key.
const DATA = {
    github: {
        name: "GitHub",
        category: "code",
        spec: bearer("https://api.githubcopilot.com/mcp/", "GITHUB_TOKEN"),
        docs: "https://github.com/github/github-mcp-server",
    },
    sentry: {
        name: "Sentry",
        category: "code",
        spec: npx(["@sentry/mcp-server@latest"], {
            SENTRY_ACCESS_TOKEN: ref("SENTRY_ACCESS_TOKEN"),
        }),
        docs: "https://github.com/getsentry/sentry-mcp",
    },
    // Supabase documents only its hosted server; a URL takes no reference, so scoping it to one
    // project (`&project_ref=…`) is left to the form.
    supabase: {
        name: "Supabase",
        category: "code",
        spec: bearer("https://mcp.supabase.com/mcp?read_only=true", "SUPABASE_ACCESS_TOKEN"),
        docs: "https://supabase.com/docs/guides/getting-started/mcp",
    },
    linear: {
        name: "Linear",
        category: "work",
        spec: bearer("https://mcp.linear.app/mcp", "LINEAR_API_KEY"),
        docs: "https://linear.app/docs/mcp",
    },
    notion: {
        name: "Notion",
        category: "work",
        spec: npx(["@notionhq/notion-mcp-server"], { NOTION_TOKEN: ref("NOTION_TOKEN") }),
        docs: "https://github.com/makenotion/notion-mcp-server",
    },
    corivo: {
        name: "Corivo",
        category: "work",
        spec: bearer("https://corivo.pl/api/mcp", "CORIVO_API_KEY"),
        docs: "https://corivo.pl",
    },
    context7: {
        name: "Context7",
        category: "web",
        spec: npx(["@upstash/context7-mcp"]),
        docs: "https://github.com/upstash/context7",
    },
    playwright: {
        name: "Playwright",
        category: "web",
        spec: npx(["@playwright/mcp@latest", "--headless"]),
        docs: "https://github.com/microsoft/playwright-mcp",
    },
    firecrawl: {
        name: "Firecrawl",
        category: "web",
        spec: npx(["firecrawl-mcp"], { FIRECRAWL_API_KEY: ref("FIRECRAWL_API_KEY") }),
        docs: "https://github.com/firecrawl/firecrawl-mcp-server",
    },
    "brave-search": {
        name: "Brave Search",
        category: "web",
        spec: npx(["@brave/brave-search-mcp-server", "--transport", "stdio"], {
            BRAVE_API_KEY: ref("BRAVE_API_KEY"),
        }),
        docs: "https://github.com/brave/brave-search-mcp-server",
    },
} satisfies Record<string, Omit<Preset, "id" | "variables">>;

export type PresetId = keyof typeof DATA;

export const PRESETS: Preset[] = Object.entries(DATA).map(([id, preset]) => ({
    ...preset,
    id: id as PresetId,
    variables: variablesOf(preset.spec),
}));

export const presetOf = (name: string): Preset | undefined => PRESETS.find((p) => p.id === name);
