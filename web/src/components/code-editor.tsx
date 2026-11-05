import { type CSSProperties, Fragment, type Ref } from "react";
import { useHighlight } from "@/lib/highlight";
import { cn } from "@/lib/utils";

// Both layers lay text out alike, so the caret in the clear textarea sits on its coloured copy.
const LAYER =
    "col-start-1 row-start-1 m-0 border-0 px-3 py-2.5 font-mono text-[0.8rem] leading-relaxed whitespace-pre-wrap break-words [tab-size:4]";

// A textarea over shiki's colouring of the same text, the language from the file's name.
export function CodeEditor({
    value,
    onChange,
    path,
    ref,
    className,
    ...props
}: Omit<React.ComponentProps<"textarea">, "onChange" | "value"> & {
    value: string;
    onChange: (value: string) => void;
    path: string;
    ref?: Ref<HTMLTextAreaElement>;
}) {
    const tokens = useHighlight(value, path);
    // Tokens of an earlier text would misalign under the caret: until fresh ones come it is plain.
    const lines =
        tokens && tokens.map((line) => line.map((t) => t.content).join("")).join("\n") === value
            ? tokens
            : null;
    return (
        <div
            className={cn(
                "grid rounded-2xl border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive dark:bg-input/30",
                className,
            )}
        >
            <pre aria-hidden className={cn(LAYER, "shiki-code pointer-events-none")}>
                {lines
                    ? lines.map((line, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: lines of the text being shown
                          <Fragment key={i}>
                              {i > 0 && "\n"}
                              {line.map((token, j) => (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: tokens of a fixed line
                                  <span key={j} style={token.htmlStyle as CSSProperties}>
                                      {token.content}
                                  </span>
                              ))}
                          </Fragment>
                      ))
                    : value}
                {/* A pre drops a trailing line break, which the textarea keeps. */}
                {"\n"}
            </pre>
            <textarea
                ref={ref}
                value={value}
                spellCheck={false}
                onChange={(e) => onChange(e.target.value)}
                className={cn(
                    LAYER,
                    "resize-none overflow-hidden bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground selection:bg-primary/25 disabled:cursor-not-allowed",
                )}
                {...props}
            />
        </div>
    );
}
