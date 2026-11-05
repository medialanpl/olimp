import { ChevronRightIcon, FileIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { SkeletonText, times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChangedFile } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Line {
    kind: "add" | "del" | "context" | "hunk" | "note";
    text: string;
    old: number | null;
    new: number | null;
}

export interface PatchFile {
    path: string;
    lines: Line[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// A unified diff as git prints it, one entry per `diff --git` with numbered lines.
export function filesOfPatch(diff: string): PatchFile[] {
    const files: PatchFile[] = [];
    let file: PatchFile | null = null;
    let inHunk = false;
    let old = 0;
    let neu = 0;
    for (const text of diff.split("\n")) {
        const head = /^diff --git a\/(.*) b\/(.*)$/.exec(text);
        if (head) {
            file = { path: head[2] ?? "", lines: [] };
            files.push(file);
            inHunk = false;
            continue;
        }
        if (!file) continue;
        const hunk = HUNK.exec(text);
        if (hunk) {
            old = Number(hunk[1]);
            neu = Number(hunk[2]);
            inHunk = true;
            file.lines.push({ kind: "hunk", text, old: null, new: null });
        } else if (!inHunk) {
            if (text.startsWith("Binary files"))
                file.lines.push({ kind: "note", text, old: null, new: null });
        } else if (text.startsWith("+")) {
            file.lines.push({ kind: "add", text: text.slice(1), old: null, new: neu++ });
        } else if (text.startsWith("-")) {
            file.lines.push({ kind: "del", text: text.slice(1), old: old++, new: null });
        } else if (text.startsWith("\\")) {
            file.lines.push({ kind: "note", text, old: null, new: null });
        } else if (text.startsWith(" ")) {
            file.lines.push({ kind: "context", text: text.slice(1), old: old++, new: neu++ });
        }
    }
    return files;
}

const LINE = {
    add: "bg-constructive/10",
    del: "bg-destructive/10",
    context: "",
    hunk: "bg-info/5 text-info",
    note: "text-muted-foreground italic",
} as const;

// An agent's edit as its "-" and "+" lines, without line numbers.
export function EditDiff({ detail }: { detail: string }) {
    return (
        <div className="scroll-fade-x overflow-x-auto rounded-lg border">
            <pre className="w-max min-w-full font-mono text-xs leading-5">
                {detail.split("\n").map((text, i) => {
                    const kind = text[0] === "+" ? "add" : text[0] === "-" ? "del" : "context";
                    return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: an edit's lines are fixed text that never reorders
                        <div key={i} className={cn("px-3", LINE[kind])}>
                            {text || " "}
                        </div>
                    );
                })}
            </pre>
        </div>
    );
}

export function Delta({ added, deleted }: { added: number | null; deleted: number | null }) {
    const t = useTranslations("web");
    if (added === null) return <Badge variant="secondary">{t("changes.binary")}</Badge>;
    return (
        <span className="shrink-0 font-mono text-xs tabular-nums">
            <span className="text-constructive">+{added}</span>{" "}
            <span className="text-destructive">−{deleted}</span>
        </span>
    );
}

function FileDiff({ file, stat, anchor }: { file: PatchFile; stat?: ChangedFile; anchor: string }) {
    const [open, setOpen] = useState(true);
    return (
        <section id={anchor} className="scroll-mt-4 overflow-hidden rounded-xl border bg-card">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-2 border-b bg-muted/40 px-3 py-2 text-left hover:bg-muted/70"
            >
                <ChevronRightIcon
                    className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
                    {file.path}
                </span>
                {stat && <Delta added={stat.added} deleted={stat.deleted} />}
            </button>
            {open && (
                <div className="scroll-fade-x overflow-x-auto">
                    <table className="w-full border-collapse font-mono text-xs leading-5">
                        <tbody>
                            {file.lines.map((line, i) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: a diff's lines are fixed text that never reorders
                                <tr key={i} className={LINE[line.kind]}>
                                    <td className="w-10 select-none px-2 text-right align-top text-muted-foreground/70">
                                        {line.old ?? ""}
                                    </td>
                                    <td className="w-10 select-none px-2 text-right align-top text-muted-foreground/70">
                                        {line.new ?? ""}
                                    </td>
                                    <td
                                        className={cn(
                                            "w-4 select-none text-center align-top",
                                            line.kind === "add" && "text-constructive",
                                            line.kind === "del" && "text-destructive",
                                        )}
                                    >
                                        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
                                    </td>
                                    <td className="whitespace-pre pr-4">{line.text || " "}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

// The files of a diff beside it, each a link to its own collapsible diff, as in infra.
// A file's section of DiffView or of the file viewer: the path bar, then its lines.
export function FileSkeleton() {
    return (
        <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="ml-auto h-4 w-12" />
            </div>
            <SkeletonText lines={6} className="p-3" />
        </div>
    );
}

// DiffView: the list of files beside their diffs.
export function DiffSkeleton() {
    return (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <div className="space-y-2.5 px-2 py-1">
                {times(4).map((file) => (
                    <Skeleton key={file} className="h-4 w-full" />
                ))}
            </div>
            <div className="min-w-0 space-y-3">
                <FileSkeleton />
                <FileSkeleton />
            </div>
        </div>
    );
}

export function DiffView({ diff, files }: { diff: string; files: ChangedFile[] }) {
    const patch = filesOfPatch(diff);
    const anchor = (index: number) => `diff-${index}`;
    return (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <nav className="lg:sticky lg:top-(--sticky-top,0px) lg:max-h-[calc(100svh-16rem)] lg:self-start lg:overflow-y-auto">
                <ul className="space-y-0.5 text-sm">
                    {files.map((file) => {
                        const at = patch.findIndex((entry) => entry.path === file.path);
                        const slash = file.path.lastIndexOf("/");
                        return (
                            <li key={file.path}>
                                <a
                                    href={at >= 0 ? `#${anchor(at)}` : undefined}
                                    title={file.path}
                                    className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/60"
                                >
                                    <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                                        {file.path.slice(slash + 1)}
                                        {slash > 0 && (
                                            <span className="ml-1 text-muted-foreground">
                                                {file.path.slice(0, slash)}
                                            </span>
                                        )}
                                    </span>
                                    <Delta added={file.added} deleted={file.deleted} />
                                </a>
                            </li>
                        );
                    })}
                </ul>
            </nav>
            <div className="min-w-0 space-y-3">
                {patch.map((file, index) => (
                    <FileDiff
                        key={file.path}
                        file={file}
                        stat={files.find((stat) => stat.path === file.path)}
                        anchor={anchor(index)}
                    />
                ))}
            </div>
        </div>
    );
}
