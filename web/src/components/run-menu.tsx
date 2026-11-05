import { PlayIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslations } from "use-intl";
import { Loading } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useTerminalCommands } from "@/lib/queries";

// Commands the worktree's files define, each run in a new tab, and one typed by hand.
export function RunMenu({
    owner,
    label,
    onRun,
}: {
    owner: string;
    label?: string;
    onRun: (command: string) => void;
}) {
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
                    {label ?? t("terminal.run")}
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
