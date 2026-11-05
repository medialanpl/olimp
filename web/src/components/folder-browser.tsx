import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, CornerLeftUpIcon, FolderIcon, FolderPlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { useFolders } from "@/lib/queries";
import type { FolderList } from "@/lib/types";
import { cn } from "@/lib/utils";

function FolderBrowserSkeleton() {
    return (
        <Loading className="space-y-2 rounded-xl border p-2">
            <div className="flex items-center gap-2 px-1">
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-8 w-28 rounded-4xl" />
                <Skeleton className="h-8 w-28 rounded-4xl" />
            </div>
            <ul className="rounded-lg border">
                {times(5).map((folder) => (
                    <li key={folder} className="flex h-8 items-center gap-2 px-3">
                        <Skeleton className="size-4" />
                        <Skeleton className="h-3 w-40" />
                    </li>
                ))}
            </ul>
        </Loading>
    );
}

// The machine's folders from the browse root down; "Use this folder" picks the one shown.
export function FolderBrowser({
    onPick,
    hidden = false,
}: {
    onPick: (path: string) => void;
    hidden?: boolean;
}) {
    const t = useTranslations("web");
    const client = useQueryClient();
    const [path, setPath] = useState<string | null>(null);
    // The new folder's name while it is being typed, null otherwise.
    const [name, setName] = useState<string | null>(null);
    const folders = useFolders(path, hidden);
    const create = useMutation({
        mutationFn: (body: { path: string; folder: string }) =>
            api<FolderList>("/api/folders", { method: "POST", body }),
        onSuccess: (created) => {
            void client.invalidateQueries({ queryKey: ["folders"] });
            setName(null);
            setPath(created.path);
        },
    });
    const list = folders.data;
    const row =
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted";
    if (folders.isError)
        return <ErrorState error={folders.error} onRetry={() => folders.refetch()} />;
    if (!list) return <FolderBrowserSkeleton />;
    const submit = () => {
        if (name?.trim()) create.mutate({ path: list.path, folder: name.trim() });
    };
    return (
        <div className="space-y-2 rounded-xl border p-2">
            <div className="flex items-center gap-2 px-1">
                <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                    {list.path}
                </p>
                {list.git && <Badge variant="secondary">git</Badge>}
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                        create.reset();
                        setName("");
                    }}
                >
                    <FolderPlusIcon />
                    {t("addRepo.newFolder")}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onPick(list.path)}
                >
                    {t("settings.useFolder")}
                </Button>
            </div>
            {name !== null && (
                <div className="space-y-1 px-1">
                    <div className="flex items-center gap-2">
                        <Input
                            autoFocus
                            value={name}
                            aria-label={t("addRepo.folderName")}
                            placeholder={t("addRepo.folderName")}
                            className="h-8 font-mono text-xs"
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                // The browser sits inside the dialog's form: Enter must not submit it.
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                submit();
                            }}
                        />
                        <Button
                            type="button"
                            size="sm"
                            disabled={!name.trim() || create.isPending}
                            onClick={submit}
                        >
                            {t("addRepo.create")}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setName(null)}
                        >
                            {t("common.cancel")}
                        </Button>
                    </div>
                    <FormError error={create.error} />
                </div>
            )}
            <ul className="scroll-fade max-h-52 overflow-y-auto rounded-lg border">
                {list.parent && (
                    <li>
                        <button type="button" className={row} onClick={() => setPath(list.parent)}>
                            <CornerLeftUpIcon className="size-4 text-muted-foreground" />
                            ..
                        </button>
                    </li>
                )}
                {list.folders.map((folder) => (
                    <li key={folder.path}>
                        <button type="button" className={row} onClick={() => setPath(folder.path)}>
                            <FolderIcon
                                className={cn(
                                    "size-4 shrink-0 text-muted-foreground",
                                    folder.name.startsWith(".") && "opacity-60",
                                )}
                            />
                            <span className="truncate font-mono text-xs">{folder.name}</span>
                            {folder.git && <Badge variant="secondary">git</Badge>}
                            <ChevronRightIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
                        </button>
                    </li>
                ))}
                {!list.folders.length && (
                    <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {t("addRepo.noFolders")}
                    </li>
                )}
            </ul>
        </div>
    );
}
