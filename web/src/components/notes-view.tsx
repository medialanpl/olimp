import { NotebookPenIcon, StickyNoteIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { EmptyState } from "@/components/empty-state";
import { ErrorState, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/lib/format";
import { useNotes } from "@/lib/queries";
import type { Note } from "@/lib/types";

function NotesSkeleton() {
    return (
        <div className="space-y-3">
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="space-y-2">
                {times(3).map((note) => (
                    <div key={note} className="flex gap-3 rounded-lg border bg-card p-3">
                        <Skeleton className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-3 w-32" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// The notes a task or a run's steps saved for later work in the repository.
export function NotesView({ repo, match }: { repo: string; match: (note: Note) => boolean }) {
    const t = useTranslations("web");
    const format = useFormat();
    const notes = useNotes(repo);
    if (notes.isPending)
        return (
            <Loading>
                <NotesSkeleton />
            </Loading>
        );
    if (notes.isError) return <ErrorState error={notes.error} onRetry={() => notes.refetch()} />;
    const own = notes.data.filter(match);
    if (!own.length)
        return (
            <EmptyState
                icon={<NotebookPenIcon />}
                title={t("notes.emptyTitle")}
                description={t("notes.empty")}
            />
        );
    return (
        <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("notes.hint")}</p>
            <ul className="space-y-2">
                {own.map((note) => (
                    <li key={note.id} className="flex gap-3 rounded-lg border bg-card p-3">
                        <StickyNoteIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                        <div className="min-w-0 space-y-1">
                            <p className="whitespace-pre-wrap break-words text-sm">{note.text}</p>
                            <p className="text-xs text-muted-foreground">
                                {note.node ? `${note.node} · ` : ""}
                                {format.dateTime(note.createdAt)}
                            </p>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
