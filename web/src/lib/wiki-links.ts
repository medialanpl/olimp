// [[slug]] links a page of the memory, as in Jarvis; code spans and blocks keep it as written.
export const wikiLinks = (repo: string, text: string) =>
    text
        .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/)
        .map((part, i) =>
            i % 2
                ? part
                : part.replace(
                      /\[\[([a-z0-9-]+)\]\]/g,
                      (_, slug) => `[${slug}](/project/${repo}/memory/${slug})`,
                  ),
        )
        .join("");
