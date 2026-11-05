import { useEffect, useState } from "react";
import type { BundledLanguage, ThemedToken } from "shiki";

// Past this a file stays plain text: tokenizing it would stall the tab.
const HIGHLIGHT_MAX = 100_000;

// The language from the file's extension, or its whole name (Dockerfile, Makefile).
async function tokensOf(code: string, path: string): Promise<ThemedToken[][] | null> {
    const shiki = await import("shiki");
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    const lang = name.slice(name.lastIndexOf(".") + 1);
    if (!(lang in shiki.bundledLanguages)) return null;
    const result = await shiki.codeToTokens(code, {
        lang: lang as BundledLanguage,
        themes: { light: "github-light", dark: "github-dark" },
        defaultColor: false,
    });
    return result.tokens;
}

// A file's lines as shiki tokens; null while they load, and for an unknown language or a big file.
export function useHighlight(code: string, path: string): ThemedToken[][] | null {
    const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
    useEffect(() => {
        let live = true;
        setTokens(null);
        if (code.length <= HIGHLIGHT_MAX)
            tokensOf(code, path).then(
                (found) => live && setTokens(found),
                () => {},
            );
        return () => {
            live = false;
        };
    }, [code, path]);
    return tokens;
}
