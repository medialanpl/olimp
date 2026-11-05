import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitBranchPlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { FormError } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";
import type { Repo } from "@/lib/types";

// A local folder without git made a repository, its files in a first commit; admin only.
export function InitGit({ repo, size = "sm" }: { repo: Repo; size?: "sm" | "default" }) {
    const t = useTranslations("web");
    const client = useQueryClient();
    const [open, setOpen] = useState(false);
    const init = useMutation({
        mutationFn: () => api<Repo>(`/api/repos/${repo.id}/git`, { method: "POST" }),
        onSuccess: () => {
            setOpen(false);
            void client.invalidateQueries({ queryKey: keys.repos });
            void client.invalidateQueries({ queryKey: keys.repo(repo.id) });
        },
    });
    return (
        <>
            <Button size={size} onClick={() => setOpen(true)}>
                <GitBranchPlusIcon />
                {t("repo.initGit")}
            </Button>
            <Dialog open={open} onOpenChange={(next) => !init.isPending && setOpen(next)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("repo.initGitTitle", { folder: repo.folder })}</DialogTitle>
                        <DialogDescription>{t("repo.initGitHint")}</DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                        <FormError error={init.error} />
                    </DialogBody>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>
                            {t("common.cancel")}
                        </Button>
                        <Button disabled={init.isPending} onClick={() => init.mutate()}>
                            {init.isPending ? <Spinner /> : <GitBranchPlusIcon />}
                            {t("repo.initGit")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
