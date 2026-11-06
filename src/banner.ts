import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";

// docs/brand/olimp-symbol-medium.svg in half blocks, the ring in the terminal's own colour so it
// follows the theme; o marks the ochre segment.
const MARK = [
    "     ▄▄▄ oooo ▄▄▄     ",
    "   ▄████  oo  ████▄   ",
    " ▄█████▀      ▀█████▄ ",
    " ████▀    ▄▄    ▀████ ",
    "████▀   ▄████▄   ▀████",
    "████  ▄████████▄  ████",
    "██████████████████████",
    " ████████████████████ ",
    " ▀██████████████████▀ ",
    "   ▀██████████████▀   ",
    "     ▀▀▀██████▀▀▀     ",
];
const GAP = "    ";

export type BannerFacts = {
    version: string;
    url: string;
    rows: [label: string, value: string][];
    agents: { name: string; found: boolean }[];
};

// depth is the stream's getColorDepth(): 1 without colours (NO_COLOR), 24 with true colour.
export function painter(depth: number) {
    const codes = {
        bold: "1",
        dim: "2",
        green: "32",
        blue: "34",
        yellow: "33",
        red: "31",
        link: "1;36",
        brand: depth >= 24 ? "38;2;184;122;32" : depth >= 8 ? "38;5;136" : "33",
    };
    return (style: keyof typeof codes, text: string) =>
        depth > 1 ? `\x1b[${codes[style]}m${text}\x1b[0m` : text;
}

export function banner(facts: BannerFacts, columns: number, depth: number): string {
    const paint = painter(depth);
    const home = homedir();
    const tilde = (value: string) => value.replaceAll(home, "~");
    const width = Math.max(...facts.rows.map(([label]) => label.length), "Agents".length) + 2;
    const agents = (found: boolean) =>
        facts.agents
            .filter((agent) => agent.found === found)
            .map(({ name }) =>
                found ? `${paint("green", "●")} ${name}` : paint("dim", `○ ${name}`),
            )
            .join("  ");
    const missing = agents(false);
    const table = [
        `${paint("bold", "OLIMP")} ${paint("dim", facts.version)}`,
        "",
        `${paint("brand", "➜")} ${paint("link", facts.url)}`,
        "",
        ...facts.rows.map(
            ([label, value]) => `${paint("dim", label.padEnd(width))}${tilde(value)}`,
        ),
        `${paint("dim", "Agents".padEnd(width))}${agents(true)}`,
        ...(missing ? [`${" ".repeat(width)}${missing}`] : []),
    ];
    const logo = MARK.map((line) =>
        line.replace(/o+/g, (o) => paint("brand", "█".repeat(o.length))),
    );
    const tableWidth = Math.max(...table.map((line) => stripVTControlCharacters(line).length));
    const sideBySide = 2 + MARK[0].length + GAP.length + tableWidth <= columns;
    const top = Math.max(0, Math.floor((logo.length - table.length) / 2));
    const lines = sideBySide
        ? Array.from(
              { length: Math.max(logo.length, top + table.length) },
              (_, i) => `${logo[i] ?? " ".repeat(MARK[0].length)}${GAP}${table[i - top] ?? ""}`,
          )
        : [...logo, "", ...table];
    return ["", ...lines.map((line) => (line ? `  ${line}`.trimEnd() : "")), ""].join("\n");
}
