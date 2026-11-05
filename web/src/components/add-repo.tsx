import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    CheckIcon,
    FolderDownIcon,
    FolderOpenIcon,
    FolderPlusIcon,
    FolderSearchIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslations } from "use-intl";
import { FolderBrowser } from "@/components/folder-browser";
import { ErrorState, FormError, Loading } from "@/components/page";
import { times } from "@/components/skeletons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { keys, useGithubOwners } from "@/lib/queries";
import type { Repo } from "@/lib/types";
import { cn } from "@/lib/utils";

type Form = "folder" | "clone" | "create";

const NAME = /^[\w.-]+$/;

// GitHub template repositories (checked with `gh api repos/<id>`); any other can be pasted.
const TEMPLATES = [
    { id: "github/codespaces-nextjs", name: "Next.js" },
    { id: "vercel/ai-chatbot", name: "Next.js AI chatbot" },
    { id: "vercel/nextjs-postgres-nextauth-tailwindcss-template", name: "Next.js admin dashboard" },
    { id: "github/codespaces-react", name: "React + Vite" },
    { id: "antfu-collective/vitesse", name: "Vue + Vite" },
    { id: "nuxt-ui-templates/starter", name: "Nuxt UI" },
    { id: "github/codespaces-express", name: "Express" },
];

// owner/name of what the user typed, also from a GitHub address; the API checks it again.
const repoRef = (value: string) =>
    /^(?:(?:https?:\/\/|ssh:\/\/git@)(?:www\.)?github\.com\/|git@github\.com:)?([\w.-]+\/[\w.-]+)$/.exec(
        value
            .trim()
            .replace(/\/+$/, "")
            .replace(/\.git$/, ""),
    )?.[1] ?? null;

function useAddRepo(onAdded: (repo: Repo) => void) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: (body: object) => api<Repo>("/api/repos", { method: "POST", body }),
        onSuccess: (repo) => {
            void client.invalidateQueries({ queryKey: keys.repos });
            onAdded(repo);
        },
    });
}

function Header({ title, hint }: { title: string; hint: string }) {
    return (
        <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
    );
}

// "Open local folder": a folder of the machine under the browse root, typed or browsed.
function FolderPicker({ cancel, onAdded }: { cancel: ReactNode; onAdded: (repo: Repo) => void }) {
    const t = useTranslations("web");
    const [folder, setFolder] = useState("");
    const [browsing, setBrowsing] = useState(true);
    const add = useAddRepo(onAdded);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        add.mutate({ path: folder.trim() });
    };
    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <Header title={t("addRepo.folderTitle")} hint={t("addRepo.folderHint")} />
            <DialogBody className="space-y-2">
                <Label htmlFor="add-folder">{t("addRepo.folder")}</Label>
                <div className="flex gap-2">
                    <Input
                        id="add-folder"
                        value={folder}
                        spellCheck={false}
                        placeholder="/home/…/project"
                        className="font-mono"
                        onChange={(e) => setFolder(e.target.value)}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        aria-expanded={browsing}
                        onClick={() => setBrowsing(!browsing)}
                    >
                        <FolderSearchIcon />
                        {t("settings.browse")}
                    </Button>
                </div>
                {browsing && (
                    <FolderBrowser
                        onPick={(path) => {
                            setFolder(path);
                            setBrowsing(false);
                        }}
                    />
                )}
                <FormError error={add.error} />
            </DialogBody>
            <DialogFooter>
                {cancel}
                <Button type="submit" disabled={add.isPending || !folder.trim()}>
                    {add.isPending && <Spinner />}
                    {t("addRepo.add")}
                </Button>
            </DialogFooter>
        </form>
    );
}

function CloneForm({ cancel, onAdded }: { cancel: ReactNode; onAdded: (repo: Repo) => void }) {
    const t = useTranslations("web");
    const [repo, setRepo] = useState("");
    const [folder, setFolder] = useState("");
    const add = useAddRepo(onAdded);
    const id = repoRef(repo);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (id)
            add.mutate({ repo: repo.trim(), ...(folder.trim() ? { folder: folder.trim() } : {}) });
    };
    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <Header title={t("addRepo.cloneTitle")} hint={t("addRepo.cloneHint")} />
            <DialogBody className="space-y-3">
                <div className="space-y-2">
                    <Label htmlFor="clone-repo">{t("fields.repo")}</Label>
                    <Input
                        id="clone-repo"
                        placeholder={t("addRepo.repoPlaceholder")}
                        value={repo}
                        spellCheck={false}
                        autoFocus
                        onChange={(e) => setRepo(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="clone-folder">{t("addRepo.folderName")}</Label>
                    <Input
                        id="clone-folder"
                        placeholder={id?.split("/")[1] ?? "repo"}
                        value={folder}
                        spellCheck={false}
                        onChange={(e) => setFolder(e.target.value)}
                    />
                </div>
                <FormError error={add.error} />
            </DialogBody>
            <DialogFooter>
                {cancel}
                <Button type="submit" disabled={!id || add.isPending}>
                    {t("addRepo.clone")}
                </Button>
            </DialogFooter>
        </form>
    );
}

function Choice({
    selected,
    disabled = false,
    onSelect,
    title,
    hint,
}: {
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
    title: string;
    hint: string;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={onSelect}
            className={cn(
                "rounded-xl border p-3 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
                selected && "border-foreground/40 bg-muted",
            )}
        >
            <span className="block text-sm font-medium">{title}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
        </button>
    );
}

function OwnersSkeleton() {
    return (
        <Loading className="space-y-2">
            {times(2).map((owner) => (
                <div key={owner} className="flex gap-2 rounded-xl border p-2.5">
                    <Skeleton className="size-8 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                </div>
            ))}
        </Loading>
    );
}

// "New project": an owner, a name, on GitHub (private) or only local, empty or from a
// template.
function CreateForm({ cancel, onAdded }: { cancel: ReactNode; onAdded: (repo: Repo) => void }) {
    const t = useTranslations("web");
    const owners = useGithubOwners();
    const [owner, setOwner] = useState<string | null>(null);
    const [name, setName] = useState("");
    const [github, setGithub] = useState(true);
    const [fromTemplate, setFromTemplate] = useState(false);
    const [search, setSearch] = useState("");
    const [template, setTemplate] = useState<string | null>(null);
    const add = useAddRepo(onAdded);
    const chosen = owner ?? owners.data?.[0]?.login ?? null;
    const typed = repoRef(search);
    const shown = TEMPLATES.filter((item) =>
        `${item.name} ${item.id}`.toLowerCase().includes(search.trim().toLowerCase()),
    );
    const ready = NAME.test(name.trim()) && (!github || (chosen && (!fromTemplate || template)));
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!ready) return;
        add.mutate(
            github
                ? {
                      repo: `${chosen}/${name.trim()}`,
                      create: true,
                      visibility: "private",
                      ...(fromTemplate && template ? { template } : {}),
                  }
                : { name: name.trim(), create: true, github: false },
        );
    };
    const option = (id: string, title: string) => (
        <li key={id}>
            <button
                type="button"
                aria-pressed={template === id}
                onClick={() => setTemplate(id)}
                className={cn(
                    "block w-full px-3 py-2 text-left outline-none hover:bg-muted focus-visible:bg-muted",
                    template === id && "bg-muted",
                )}
            >
                <span className="block text-sm font-medium">{title}</span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{id}</span>
            </button>
        </li>
    );
    return (
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <Header title={t("addRepo.createTitle")} hint={t("addRepo.createHint")} />
            <DialogBody className="grid gap-4 sm:grid-cols-[14rem_1fr]">
                <section className="space-y-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {t("addRepo.owner")}
                    </h3>
                    {owners.isError ? (
                        <ErrorState error={owners.error} onRetry={() => owners.refetch()} />
                    ) : !owners.data ? (
                        <OwnersSkeleton />
                    ) : (
                        <ul className="space-y-2">
                            {owners.data.map((item) => (
                                <li key={item.login}>
                                    <button
                                        type="button"
                                        aria-pressed={chosen === item.login}
                                        onClick={() => setOwner(item.login)}
                                        className={cn(
                                            "flex w-full items-start gap-2 rounded-xl border p-2.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                                            chosen === item.login &&
                                                "border-foreground/40 bg-muted",
                                        )}
                                    >
                                        <Avatar className="rounded-lg after:rounded-lg">
                                            {item.avatarUrl && (
                                                <AvatarImage
                                                    src={item.avatarUrl}
                                                    alt=""
                                                    className="rounded-lg"
                                                />
                                            )}
                                            <AvatarFallback className="rounded-lg bg-secondary font-semibold text-secondary-foreground uppercase">
                                                {item.login.slice(0, 1)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1 text-sm font-medium">
                                                <span className="truncate">{item.login}</span>
                                                {chosen === item.login && (
                                                    <CheckIcon className="size-3.5 shrink-0" />
                                                )}
                                            </span>
                                            <span className="line-clamp-2 text-xs text-muted-foreground">
                                                {item.kind === "user"
                                                    ? t("addRepo.personal")
                                                    : item.description}
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
                <section className="min-w-0 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="create-name">{t("addRepo.name")}</Label>
                        <Input
                            id="create-name"
                            placeholder="my-project"
                            value={name}
                            spellCheck={false}
                            autoFocus
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                        <div className="min-w-0 flex-1 space-y-0.5">
                            <Label htmlFor="create-private">{t("addRepo.private")}</Label>
                            <p className="text-xs text-muted-foreground">
                                {github
                                    ? t("addRepo.privateHint", { owner: chosen ?? "…" })
                                    : t("addRepo.localHint")}
                            </p>
                        </div>
                        <Switch
                            id="create-private"
                            checked={github}
                            onCheckedChange={(on) => {
                                setGithub(on);
                                if (!on) setFromTemplate(false);
                            }}
                        />
                    </div>
                    <div className="space-y-2 rounded-xl border p-3">
                        <p className="text-sm font-medium">{t("addRepo.startWith")}</p>
                        <div className="grid grid-cols-2 gap-2">
                            <Choice
                                selected={!fromTemplate}
                                onSelect={() => setFromTemplate(false)}
                                title={t("addRepo.empty")}
                                hint={t(github ? "addRepo.emptyHint" : "addRepo.emptyLocalHint")}
                            />
                            <Choice
                                selected={fromTemplate}
                                disabled={!github}
                                onSelect={() => setFromTemplate(true)}
                                title={t("addRepo.fromTemplate")}
                                hint={t(
                                    github
                                        ? "addRepo.fromTemplateHint"
                                        : "addRepo.fromTemplateLocalHint",
                                )}
                            />
                        </div>
                        {fromTemplate && (
                            <div className="space-y-2 pt-1">
                                <Label htmlFor="create-template">{t("addRepo.template")}</Label>
                                <Input
                                    id="create-template"
                                    placeholder={t("addRepo.templateSearch")}
                                    value={search}
                                    spellCheck={false}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                <ul className="max-h-56 divide-y overflow-y-auto rounded-xl border">
                                    {typed &&
                                        !TEMPLATES.some((item) => item.id === typed) &&
                                        option(typed, t("addRepo.useTemplate"))}
                                    {shown.map((item) => option(item.id, item.name))}
                                </ul>
                            </div>
                        )}
                    </div>
                    <FormError error={add.error} />
                </section>
            </DialogBody>
            <DialogFooter>
                {cancel}
                <Button type="submit" disabled={!ready || add.isPending}>
                    {t("addRepo.create")}
                </Button>
            </DialogFooter>
        </form>
    );
}

// The sidebar's "Add project" menu: a local folder, a clone or a new repository.
export function AddRepoMenu({
    compact = false,
    onAdded,
}: {
    compact?: boolean;
    onAdded?: () => void;
}) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const [form, setForm] = useState<Form | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const cancel = (
        <DialogClose asChild>
            <Button variant="outline">{t("common.cancel")}</Button>
        </DialogClose>
    );
    const added = (repo: Repo) => {
        setForm(null);
        onAdded?.();
        navigate(`/project/${repo.id}/settings/general`);
    };
    return (
        <>
            {/* Not modal: a modal menu would keep the page inert under the dialog it opens. */}
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                    {compact ? (
                        <Button
                            ref={trigger}
                            variant="outline"
                            size="icon-sm"
                            aria-label={t("nav.addProject")}
                            className="shrink-0 group-data-[collapsible=icon]:hidden"
                        >
                            <FolderPlusIcon />
                        </Button>
                    ) : (
                        <Button ref={trigger}>
                            <FolderPlusIcon />
                            {t("nav.addProject")}
                        </Button>
                    )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align={compact ? "start" : "end"} className="w-60">
                    <DropdownMenuLabel>{t("nav.addProject")}</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setForm("folder")}>
                        <FolderOpenIcon />
                        {t("nav.openFolder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setForm("clone")}>
                        <FolderDownIcon />
                        {t("nav.cloneRepo")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setForm("create")}>
                        <FolderPlusIcon />
                        {t("nav.createRepo")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
                <DialogContent
                    className={cn(form === "create" && "sm:max-w-3xl")}
                    onCloseAutoFocus={(e) => {
                        e.preventDefault();
                        trigger.current?.focus();
                    }}
                >
                    {form === "folder" && <FolderPicker cancel={cancel} onAdded={added} />}
                    {form === "clone" && <CloneForm cancel={cancel} onAdded={added} />}
                    {form === "create" && <CreateForm cancel={cancel} onAdded={added} />}
                </DialogContent>
            </Dialog>
        </>
    );
}
