import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    ArrowUpRightIcon,
    CopyIcon,
    EllipsisIcon,
    GitBranchIcon,
    MailIcon,
    RotateCcwIcon,
    SettingsIcon,
    SquareIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { ErrorState, FormError, UNDERLINE_TAB, UNDERLINE_TABS } from "@/components/page";
import { StatusBadge } from "@/components/status-badge";
import { prNumber } from "@/components/task-chat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { freshInput, InputTokens } from "@/components/usage";
import { api } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { type JobKind, jobKey, jobPath, useMarkRead, useReads } from "@/lib/queries";
import { FINISHED } from "@/lib/reads";
import { triggered } from "@/lib/shortcuts";
import type { RunStatus, Usage } from "@/lib/types";

type Job = {
    id: string;
    repo: string;
    status: RunStatus;
    branch: string | null;
    prUrl: string | null;
};

const copy = (text: string) => void navigator.clipboard.writeText(text);

// The open tab rides in ?tab=; the first one goes without it.
export function useJobTab<T extends string>(
    tabs: readonly [T, ...T[]],
): [T, (next: string) => void] {
    const [params, setParams] = useSearchParams();
    const tab = tabs.find((name) => name === params.get("tab")) ?? tabs[0];
    const setTab = (next: string) =>
        setParams(
            (old) => {
                const search = new URLSearchParams(old);
                if (next === tabs[0]) search.delete("tab");
                else search.set("tab", next);
                return search;
            },
            { replace: true },
        );
    return [tab, setTab];
}

// The terminal shortcut goes to the Terminal tab and back to the tab it was opened from.
export function useTerminalShortcut(tab: string, setTab: (next: string) => void) {
    const before = useRef(tab);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!triggered(e, "terminal")) return;
            e.preventDefault();
            if (tab === "terminal") setTab(before.current);
            else {
                before.current = tab;
                setTab("terminal");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [tab, setTab]);
}

export function JobPage({
    tab,
    onTab,
    header,
    tabs,
    footer,
    children,
}: {
    tab: string;
    onTab: (tab: string) => void;
    header: ReactNode;
    tabs: ReactNode;
    footer?: ReactNode;
    children: ReactNode;
}) {
    return (
        <Tabs value={tab} onValueChange={onTab} className="min-h-0 flex-1 gap-0">
            <div className="shrink-0 space-y-3 border-b px-4 pt-3 md:px-6">
                {header}
                <TabsList className={UNDERLINE_TABS}>{tabs}</TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">{children}</div>
            {footer}
        </Tabs>
    );
}

export function JobPageError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
    return (
        <div className="p-4 md:p-6">
            <ErrorState error={error} onRetry={onRetry} />
        </div>
    );
}

export function JobTab({
    value,
    count,
    children,
}: {
    value: string;
    count?: number;
    children: ReactNode;
}) {
    return (
        <TabsTrigger value={value} className={UNDERLINE_TAB}>
            {children}
            {!!count && (
                <Badge variant="secondary" className="px-1.5">
                    {count}
                </Badge>
            )}
        </TabsTrigger>
    );
}

export function JobHeader({
    title,
    status,
    usage,
    meta,
    actions,
}: {
    title: string;
    status: RunStatus;
    usage: Pick<
        Usage,
        | "inputTokens"
        | "cacheReadTokens"
        | "cacheWriteTokens"
        | "outputTokens"
        | "costUsd"
        | "durationMs"
    >;
    meta: ReactNode;
    actions: ReactNode;
}) {
    const t = useTranslations("web");
    const format = useFormat();
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <h1 className="min-w-0 truncate text-lg font-semibold" title={title}>
                    {title}
                </h1>
                <StatusBadge status={status} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <div className="flex min-w-0 flex-wrap items-center gap-2">{meta}</div>
                <div className="flex items-center gap-3">
                    {usage.durationMs !== null && (
                        <span className="font-mono tabular-nums">
                            <InputTokens usage={usage}>
                                {t("task.usage", {
                                    input: format.count(freshInput(usage)),
                                    output: format.count(usage.outputTokens),
                                })}
                            </InputTokens>{" "}
                            · {format.cost(usage.costUsd)} · {format.duration(usage.durationMs)}
                        </span>
                    )}
                    {actions}
                </div>
            </div>
        </div>
    );
}

export function MetaLink({
    to,
    chip,
    children,
}: {
    to: string;
    chip?: boolean;
    children: ReactNode;
}) {
    return (
        <Link
            to={to}
            className={
                chip
                    ? "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-foreground hover:bg-muted"
                    : "hover:text-foreground hover:underline"
            }
        >
            {children}
        </Link>
    );
}

export function BranchChip({ branch }: { branch: string }) {
    const t = useTranslations("web");
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            title={t("task.copyBranch")}
            onClick={() => {
                copy(branch);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-foreground hover:bg-muted"
        >
            <GitBranchIcon className="size-3" />
            {copied ? t("task.copied") : branch}
        </button>
    );
}

export function PrChip({ url }: { url: string }) {
    const t = useTranslations("web");
    const pr = prNumber(url);
    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-foreground hover:bg-muted"
        >
            {pr ? `#${pr}` : t("fields.pr")}
            <ArrowUpRightIcon className="size-3" />
        </a>
    );
}

export function Action({
    label,
    onClick,
    disabled,
    destructive,
    className,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    destructive?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant={destructive ? "destructive" : "ghost"}
                    size={destructive ? "sm" : "icon-sm"}
                    aria-label={label}
                    onClick={onClick}
                    disabled={disabled}
                    className={className}
                >
                    {children}
                    {destructive && label}
                </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export function JobActions({
    kind,
    job,
    onUnread,
    error,
    children,
    menu,
}: {
    kind: JobKind;
    job: Job;
    onUnread: () => void;
    error?: unknown;
    children?: ReactNode;
    menu?: ReactNode;
}) {
    const t = useTranslations("web");
    const navigate = useNavigate();
    const client = useQueryClient();
    const reads = useReads();
    const markRead = useMarkRead();
    const [confirm, setConfirm] = useState(false);
    useEffect(() => {
        if (!confirm) return;
        const timer = setTimeout(() => setConfirm(false), 4000);
        return () => clearTimeout(timer);
    }, [confirm]);
    const cancel = useMutation({
        mutationFn: () => api(`${jobPath(kind, job.id)}/cancel`, { method: "POST" }),
        onSuccess: (updated) => client.setQueryData(jobKey(kind, job.id), updated),
    });
    const retry = useMutation({
        mutationFn: () => api<{ id: string }>(`${jobPath(kind, job.id)}/retry`, { method: "POST" }),
        onSuccess: (created) => {
            client.setQueryData(jobKey(kind, created.id), created);
            navigate(`/tasks/${created.id}`);
        },
    });
    const active = !FINISHED.includes(job.status);
    const read = reads.data?.[kind === "task" ? "tasks" : "runs"].includes(job.id) ?? false;
    const checkout = job.prUrl
        ? `gh pr checkout ${prNumber(job.prUrl) ?? job.prUrl}`
        : job.branch && `git checkout ${job.branch}`;
    return (
        <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-0.5">
                {!active && read && (
                    <Action
                        label={t("task.markUnread")}
                        onClick={() => {
                            onUnread();
                            markRead.mutate({ kind, id: job.id, read: false });
                        }}
                    >
                        <MailIcon />
                    </Action>
                )}
                {children}
                {active &&
                    (confirm ? (
                        <Action
                            label={t("task.confirmCancel")}
                            destructive
                            onClick={() => cancel.mutate()}
                            disabled={cancel.isPending}
                        >
                            <SquareIcon />
                        </Action>
                    ) : (
                        <Action label={t("task.cancel")} onClick={() => setConfirm(true)}>
                            <SquareIcon />
                        </Action>
                    ))}
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={t("task.more")}>
                            <EllipsisIcon />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {/* Not in the row: a click on Cancel as the job finished landed on it and
                            started a paid retry. */}
                        {!active && (
                            <>
                                <DropdownMenuItem
                                    onSelect={() => retry.mutate()}
                                    disabled={retry.isPending}
                                >
                                    <RotateCcwIcon />
                                    {t("task.retry")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                            </>
                        )}
                        {menu}
                        {job.prUrl && (
                            <DropdownMenuItem asChild>
                                <a href={job.prUrl} target="_blank" rel="noreferrer noopener">
                                    <ArrowUpRightIcon />
                                    {t("task.openPr")}
                                </a>
                            </DropdownMenuItem>
                        )}
                        {checkout && (
                            <DropdownMenuItem onSelect={() => copy(checkout)}>
                                <CopyIcon />
                                {t("task.copyCheckout")}
                            </DropdownMenuItem>
                        )}
                        {job.branch && (
                            <DropdownMenuItem onSelect={() => copy(job.branch ?? "")}>
                                <GitBranchIcon />
                                {t("task.copyBranch")}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => copy(job.id)}>
                            <CopyIcon />
                            {t("task.copyId")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link to={`/project/${job.repo}/settings/general`}>
                                <SettingsIcon />
                                {t("task.projectSettings")}
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <FormError error={cancel.error ?? retry.error ?? error ?? markRead.error} />
        </div>
    );
}
