import { memo } from "react";
import { type Components, Streamdown } from "streamdown";
import { cn } from "@/lib/utils";

// As infra's MarkdownPreview: long code lines wrap instead of widening the column, top-level lists
// keep their markers outside the text, and tables and code blocks get no height limit of their own,
// so nothing scrolls inside a scrolling tab.
const WRAP_CODE_BLOCK =
    "[&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:whitespace-pre-wrap";
const LIST_INDENT =
    "[&_[data-streamdown='unordered-list']]:list-outside [&_[data-streamdown='unordered-list']]:pl-6 [&_[data-streamdown='ordered-list']]:list-outside [&_[data-streamdown='ordered-list']]:pl-6";
const HEADINGS = "[&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-sm";
const TABLE_SCROLL_X = "[&_[data-streamdown='table-wrapper']>div:last-child]:scroll-fade-x";

// Agents' Markdown, sanitized by Streamdown's default rehype plugins.
export const Markdown = memo(function Markdown({
    children,
    className,
    components,
}: {
    children: string;
    className?: string;
    components?: Components;
}) {
    return (
        <Streamdown
            mode="static"
            components={components}
            controls={false}
            linkSafety={{ enabled: false }}
            tableMaxHeight={0}
            codeBlockMaxHeight={0}
            className={cn(
                "min-w-0 text-sm leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
                WRAP_CODE_BLOCK,
                LIST_INDENT,
                HEADINGS,
                TABLE_SCROLL_X,
                className,
            )}
        >
            {children}
        </Streamdown>
    );
});
