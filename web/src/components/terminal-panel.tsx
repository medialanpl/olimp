import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useQueryClient } from "@tanstack/react-query";
import {
    CircleIcon,
    ExternalLinkIcon,
    InfoIcon,
    PlayIcon,
    PlusIcon,
    SquareIcon,
    SquareTerminalIcon,
    XIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { CopyButton } from "@/components/copy-button";
import { FormError, Loading } from "@/components/page";
import { TerminalSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { onTerminalOutput } from "@/lib/events";
import { keys, useTerminalCommands, useTerminals, useTerminalUrls } from "@/lib/queries";
import { comboOf, keyMap } from "@/lib/shortcuts";
import type { TerminalOutput, TerminalSession } from "@/lib/types";
import { cn, themeColor } from "@/lib/utils";

const RESIZE_MS = 100;

// `owner` is the API path of a task, a workflow run or a project.
const path = (owner: string, session?: string, action?: string) =>
    `${owner}/terminals${session ? `/${session}` : ""}${action ? `/${action}` : ""}`;

function theme(el: HTMLElement) {
    return {
        background: themeColor(el, "--card"),
        foreground: themeColor(el, "--card-foreground"),
        cursor: themeColor(el, "--foreground"),
        selectionBackground: themeColor(el, "--muted-foreground", 0.35),
    };
}

// One shell: xterm in the browser, the PTY in the API. Output is read from a cursor whenever the
// event stream says it changed, so a page opened again replays the scrollback the API kept.
function TerminalView({
    owner,
    session,
    active,
    onExit,
}: {
    owner: string;
    session: TerminalSession;
    active: boolean;
    onExit: () => void;
}) {
    const t = useTranslations("web");
    const box = useRef<HTMLDivElement>(null);
    const view = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
    const exited = useRef(onExit);
    exited.current = onExit;
    const translate = useRef(t);
    translate.current = t;

    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const root = document.documentElement;
        const term = new Terminal({
            fontFamily:
                getComputedStyle(root).getPropertyValue("--font-mono").trim() || "monospace",
            fontSize: 13,
            cursorBlink: true,
            scrollback: 10_000,
            theme: theme(root),
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(el);
        view.current = { term, fit };
        // The panel's own shortcut, e.g. leaving the terminal, is not the shell's key.
        term.attachCustomKeyEventHandler((e) => comboOf(e) !== keyMap().terminal);
        let alive = true;
        let cursor = 0;
        let reading = false;
        let again = false;
        let done = false;
        const read = async () => {
            if (reading) {
                again = true;
                return;
            }
            reading = true;
            try {
                do {
                    again = false;
                    const out = await api<TerminalOutput>(
                        `${path(owner, session.id, "output")}?cursor=${cursor}`,
                    );
                    if (!alive) return;
                    term.write(out.data);
                    cursor = out.cursor;
                    if (out.exitCode !== null && !done) {
                        done = true;
                        const note = translate.current("terminal.exited", { code: out.exitCode });
                        term.write(`\r\n\x1b[2m${note}\x1b[0m\r\n`);
                        exited.current();
                    }
                } while (again && alive);
            } catch {
                // A session closed meanwhile is dropped by the next list.
            } finally {
                reading = false;
            }
        };
        const stop = onTerminalOutput(session.id, () => void read());
        void read();
        // Keys go in order, those typed while one is on its way together.
        let pending = "";
        let sending = Promise.resolve();
        const typed = term.onData((data) => {
            const first = !pending;
            pending += data;
            if (!first) return;
            queueMicrotask(() => {
                const chunk = pending;
                pending = "";
                sending = sending
                    .then(() =>
                        api(path(owner, session.id, "input"), {
                            method: "POST",
                            body: { data: chunk },
                        }),
                    )
                    .then(
                        () => {},
                        () => {},
                    );
            });
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const resized = term.onResize(({ cols, rows }) => {
            clearTimeout(timer);
            timer = setTimeout(
                () =>
                    void api(path(owner, session.id, "resize"), {
                        method: "POST",
                        body: { cols, rows },
                    }).catch(() => {}),
                RESIZE_MS,
            );
        });
        const observer = new ResizeObserver(() => {
            if (el.clientWidth && el.clientHeight) fit.fit();
        });
        observer.observe(el);
        const repaint = new MutationObserver(() => {
            term.options.theme = theme(root);
        });
        repaint.observe(root, { attributes: true, attributeFilter: ["class"] });
        return () => {
            alive = false;
            stop();
            typed.dispose();
            resized.dispose();
            clearTimeout(timer);
            observer.disconnect();
            repaint.disconnect();
            view.current = null;
            term.dispose();
        };
    }, [owner, session.id]);

    useEffect(() => {
        if (!active) return;
        view.current?.fit.fit();
        view.current?.term.focus();
    }, [active]);

    return <div ref={box} className={cn("absolute inset-2", !active && "invisible")} />;
}

function tabLabel(t: ReturnType<typeof useTranslations<"web">>, session: TerminalSession) {
    return session.label ?? t("terminal.tab", { n: session.ordinal });
}

function DetectedUrls({ owner }: { owner: string }) {
    const t = useTranslations("web");
    const urls = useTerminalUrls(owner).data?.urls ?? [];
    if (!urls.length) return null;
    return (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
            <span className="text-xs text-muted-foreground">{t("terminal.urls")}</span>
            {urls.map((url) => (
                <span
                    key={url.url}
                    className="flex items-center gap-1.5 rounded-md bg-muted/60 py-0.5 pr-0.5 pl-2 text-xs"
                >
                    <CircleIcon
                        aria-hidden="true"
                        className={cn(
                            "size-2",
                            url.running === true
                                ? "fill-constructive text-constructive"
                                : "fill-muted text-muted-foreground",
                        )}
                    />
                    <span className="font-mono">{url.url}</span>
                    <span className="text-muted-foreground">
                        {url.running ? t("terminal.running") : t("terminal.stopped")}
                    </span>
                    <Button asChild variant="ghost" size="icon-xs">
                        <a
                            href={url.url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t("terminal.open", { url: url.url })}
                        >
                            <ExternalLinkIcon />
                        </a>
                    </Button>
                </span>
            ))}
        </div>
    );
}

// Commands the worktree's files define, each run in a new tab, and one typed by hand.
function RunMenu({ owner, onRun }: { owner: string; onRun: (command: string) => void }) {
    const t = useTranslations("web");
    const [open, setOpen] = useState(false);
    const [custom, setCustom] = useState("");
    const found = useTerminalCommands(owner, open);
    const run = (command: string) => {
        setOpen(false);
        setCustom("");
        onRun(command);
    };
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (custom.trim()) run(custom.trim());
    };
    const commands = found.data?.commands ?? [];
    const install = found.data?.install;
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="xs">
                    <PlayIcon />
                    {t("terminal.run")}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)] space-y-3 p-3">
                <p className="text-sm font-medium">{t("terminal.commands")}</p>
                {found.isPending ? (
                    <Loading className="space-y-1.5">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                    </Loading>
                ) : (
                    <>
                        {install && (
                            <button
                                type="button"
                                onClick={() => run(install)}
                                className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                            >
                                <span className="font-mono text-xs">{install}</span>
                                <span className="text-xs text-muted-foreground">
                                    {t("terminal.install")}
                                </span>
                            </button>
                        )}
                        {commands.length ? (
                            <ul className="scroll-fade max-h-64 space-y-0.5 overflow-y-auto">
                                {commands.map((command) => (
                                    <li key={`${command.source}:${command.command}`}>
                                        <button
                                            type="button"
                                            title={command.detail}
                                            onClick={() => run(command.command)}
                                            className="flex w-full items-baseline justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                                        >
                                            <span className="min-w-0 truncate font-mono text-xs">
                                                {command.command}
                                            </span>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {command.source}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            !install && (
                                <p className="text-xs text-muted-foreground">
                                    {t("terminal.noCommands")}
                                </p>
                            )
                        )}
                    </>
                )}
                <form onSubmit={submit} className="space-y-1.5 border-t pt-3">
                    <label htmlFor="terminal-command" className="text-xs text-muted-foreground">
                        {t("terminal.custom")}
                    </label>
                    <Input
                        id="terminal-command"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                        placeholder={t("terminal.customPlaceholder")}
                        className="h-8 font-mono text-xs"
                    />
                </form>
            </PopoverContent>
        </Popover>
    );
}

// The terminals of a task's thread, a workflow run or a project, one tab each, in its folder; they
// keep running while the page is closed and stop when the tab is closed, the thread archived, the
// worktree removed or OLIMP stopped.
export default function TerminalPanel({ owner, repo }: { owner: string; repo: string }) {
    const t = useTranslations("web");
    const client = useQueryClient();
    const state = useTerminals(owner);
    const [active, setActive] = useState<string | null>(null);
    const [closing, setClosing] = useState<TerminalSession | null>(null);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const started = useRef(false);
    const refresh = () => client.invalidateQueries({ queryKey: keys.terminals(owner) });

    const open = async (input: { shell?: string; input?: string } = {}) => {
        setOpening(true);
        setError(null);
        try {
            const session = await api<TerminalSession>(path(owner), {
                method: "POST",
                body: input,
            });
            client.setQueryData(keys.terminals(owner), (old: typeof state.data) =>
                old ? { ...old, sessions: [...old.sessions, session] } : old,
            );
            setActive(session.id);
        } catch (failure) {
            setError(failure);
        } finally {
            setOpening(false);
        }
    };
    const close = async (session: TerminalSession) => {
        setClosing(null);
        await api(path(owner, session.id), { method: "DELETE" }).catch(() => {});
        client.setQueryData(keys.terminals(owner), (old: typeof state.data) =>
            old ? { ...old, sessions: old.sessions.filter((s) => s.id !== session.id) } : old,
        );
    };

    const data = state.data;
    const sessions = data?.sessions ?? [];
    // The first visit opens a shell; a thread whose tabs were all closed stays empty until "+".
    useEffect(() => {
        if (!data || started.current) return;
        started.current = true;
        if (data.available && data.folder && !data.sessions.length) void open();
    });
    const current = sessions.find((s) => s.id === active) ?? sessions.at(-1) ?? null;

    if (state.isPending) return <TerminalSkeleton />;
    if (state.isError) return <FormError error={state.error} />;
    if (!data) return null;
    const shells = data.shells ?? [];
    const notice = !data.available
        ? `${t("terminal.unavailable")} ${data.reason ?? ""}`
        : !data.folder
          ? t("terminal.noFolder")
          : null;

    return (
        <div className="flex h-[calc(100dvh-13rem)] min-h-[24rem] flex-col gap-2">
            {data.takeOver && (
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">{t("terminal.takeOver")}</span>
                    <code className="min-w-0 truncate font-mono" title={data.takeOver}>
                        {data.takeOver}
                    </code>
                    <CopyButton value={data.takeOver} label={t("terminal.copy")} />
                </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card">
                <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
                    <SquareTerminalIcon
                        aria-hidden="true"
                        className="mx-1 size-4 shrink-0 text-muted-foreground"
                    />
                    <div
                        role="tablist"
                        aria-label={t("terminal.tabs")}
                        className="scroll-fade-x flex min-w-0 items-center gap-1 overflow-x-auto"
                    >
                        {sessions.map((session) => {
                            const label = tabLabel(t, session);
                            const selected = session.id === current?.id;
                            return (
                                <div
                                    key={session.id}
                                    className={cn(
                                        "flex shrink-0 items-center rounded-md text-xs",
                                        selected
                                            ? "bg-muted text-foreground"
                                            : "text-muted-foreground hover:bg-muted/60",
                                    )}
                                >
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={selected}
                                        onClick={() => setActive(session.id)}
                                        className={cn(
                                            "max-w-48 truncate py-1 pl-2 font-mono outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                                            session.exitCode !== null && "line-through opacity-70",
                                        )}
                                    >
                                        {label}
                                    </button>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={t("terminal.close", { label })}
                                        onClick={() =>
                                            session.busy === false || session.exitCode !== null
                                                ? void close(session)
                                                : setClosing(session)
                                        }
                                    >
                                        <XIcon />
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                    {!notice &&
                        (shells.length > 1 ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={t("terminal.newTab")}
                                        disabled={opening}
                                    >
                                        <PlusIcon />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                    <DropdownMenuLabel>
                                        {t("terminal.newTabShell")}
                                    </DropdownMenuLabel>
                                    {shells.map((shell, index) => (
                                        <DropdownMenuItem
                                            key={shell}
                                            onSelect={() => void open({ shell })}
                                            className="font-mono text-xs"
                                        >
                                            {shell}
                                            {index === 0 && (
                                                <Badge variant="secondary" className="ml-auto">
                                                    {t("terminal.default")}
                                                </Badge>
                                            )}
                                        </DropdownMenuItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={t("terminal.newTab")}
                                disabled={opening}
                                onClick={() => void open()}
                            >
                                <PlusIcon />
                            </Button>
                        ))}
                    <span
                        className="ml-auto hidden min-w-0 max-w-[40%] truncate pl-2 text-xs text-muted-foreground lg:block"
                        title={`${data.host} · ${repo} · ${data.folder ?? ""}`}
                    >
                        <span className="text-foreground/80">{data.host}</span> · {repo}
                        {data.folder && ` · ${data.folder}`}
                    </span>
                    <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
                        {!notice && (
                            <RunMenu
                                owner={owner}
                                onRun={(command) => void open({ input: `${command}\r` })}
                            />
                        )}
                        {current?.busy === true && (
                            <Button
                                variant="ghost"
                                size="xs"
                                title={t("terminal.stopHint")}
                                onClick={() =>
                                    void api(path(owner, current.id, "input"), {
                                        method: "POST",
                                        body: { data: "\x03" },
                                    }).catch(() => {})
                                }
                            >
                                <SquareIcon />
                                {t("terminal.stop")}
                            </Button>
                        )}
                    </div>
                </div>
                <DetectedUrls owner={owner} />
                <FormError error={error} />
                {notice ? (
                    <Alert variant="info" role="note" className="m-3 w-auto">
                        <InfoIcon />
                        <AlertDescription>{notice}</AlertDescription>
                    </Alert>
                ) : opening && !sessions.length ? (
                    <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                        <Spinner className="size-3.5" />
                        {t("terminal.starting")}
                    </p>
                ) : (
                    <div className="relative min-h-0 flex-1">
                        {sessions.map((session) => (
                            <TerminalView
                                key={session.id}
                                owner={owner}
                                session={session}
                                active={session.id === current?.id}
                                onExit={() => void refresh()}
                            />
                        ))}
                    </div>
                )}
            </div>
            <Dialog open={closing !== null} onOpenChange={(next) => !next && setClosing(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {closing?.busy === true
                                ? t("terminal.closeBusyTitle")
                                : t("terminal.closeUnknownTitle")}
                        </DialogTitle>
                        <DialogDescription>
                            {closing?.busy === true
                                ? t("terminal.closeBusy", { label: tabLabel(t, closing) })
                                : t("terminal.closeUnknown")}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setClosing(null)}>
                            {t("common.cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => closing && void close(closing)}
                        >
                            {t("terminal.closeAnyway")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
