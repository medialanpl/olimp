import { useMutation } from "@tanstack/react-query";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    CircleIcon,
    ExternalLinkIcon,
    InfoIcon,
    MonitorIcon,
    MousePointerClickIcon,
    RotateCwIcon,
    SendIcon,
    SmartphoneIcon,
    TabletIcon,
    XIcon,
} from "lucide-react";
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";
import { FormError } from "@/components/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiError, api } from "@/lib/api";
import { useTerminalUrls } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface Opened {
    origin: string;
    target: string;
    url: string;
}

export interface Pick {
    selector: string;
    html: string;
    text: string;
    url: string;
    note: string;
}

const WIDTHS = { desktop: null, tablet: 768, mobile: 390 } as const;
type Device = keyof typeof WIDTHS;

// The picked elements as the agent reads them: where, which element and what to do with it.
export function picksText(heading: string, picks: Pick[]): string {
    const lines = picks.map((pick, index) =>
        [
            `${index + 1}. \`${pick.selector}\`${pick.text ? ` "${pick.text.replace(/\s+/g, " ")}"` : ""} (${pick.url})`,
            `   ${pick.html.replace(/\s+/g, " ")}`,
            ...(pick.note.trim() ? [`   → ${pick.note.trim()}`] : []),
        ].join("\n"),
    );
    return `${heading}\n${lines.join("\n")}`;
}

function Hint({ label, children }: { label: string; children: ReactElement }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

// The app a task, run or project serves, framed through OLIMP's proxy on a port of its own: the
// page tells where it is, and in Design Mode a click picks an element for the agent instead of
// acting on the page.
export default function PreviewPanel({
    owner,
    sendLabel,
    onSend,
}: {
    owner: string;
    sendLabel: string;
    onSend: (text: string) => void;
}) {
    const t = useTranslations("web");
    const frame = useRef<HTMLIFrameElement>(null);
    const [typed, setTyped] = useState("");
    const [opened, setOpened] = useState<Opened | null>(null);
    const [shown, setShown] = useState("");
    const [reload, setReload] = useState(0);
    const [down, setDown] = useState(false);
    const [design, setDesign] = useState(false);
    const [device, setDevice] = useState<Device>("desktop");
    const [picks, setPicks] = useState<Pick[]>([]);
    const urls = useTerminalUrls(owner).data?.urls ?? [];
    const open = useMutation({
        mutationFn: (url: string) =>
            api<Opened>("/api/preview", {
                method: "POST",
                body: { url, parent: window.location.origin },
            }),
        onSuccess: (next) => {
            setOpened(next);
            setShown(next.url.replace(next.origin, next.target));
            setTyped(next.url.replace(next.origin, next.target));
            setDown(false);
            setDesign(false);
            setReload((n) => n + 1);
        },
    });
    const send = (message: Record<string, unknown>) =>
        frame.current?.contentWindow?.postMessage(
            { source: "olimp-panel", ...message },
            opened?.origin ?? "",
        );

    useEffect(() => {
        if (!opened) return;
        const onMessage = (e: MessageEvent) => {
            const data = e.data as Record<string, unknown> | null;
            if (e.origin !== opened.origin || data?.source !== "olimp-preview") return;
            if (data.type === "location" && typeof data.url === "string") {
                setShown(data.url);
                setDown(false);
                // A page loaded anew starts without the picker.
                if (data.how === "load") setDesign(false);
            } else if (data.type === "unreachable") setDown(true);
            else if (data.type === "pickEnd") setDesign(false);
            else if (data.type === "picked")
                setPicks((list) => [
                    ...list,
                    {
                        selector: String(data.selector),
                        html: String(data.html),
                        text: String(data.text),
                        url: String(data.url),
                        note: "",
                    },
                ]);
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [opened]);

    // The first address a terminal printed that answers opens by itself.
    const running = urls.find((url) => url.running)?.url;
    useEffect(() => {
        if (running && !opened && !open.isPending && !open.error) open.mutate(running);
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (typed.trim()) open.mutate(typed.trim());
    };
    const toggleDesign = () => {
        send({ type: "pick", on: !design });
        setDesign(!design);
    };
    const remote = open.error instanceof ApiError && open.error.code === "preview.remote";
    const width = WIDTHS[device];

    return (
        <div className="flex h-[calc(100dvh-13rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl border bg-card">
            <div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-2 py-1.5">
                <Hint label={t("preview.back")}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("preview.back")}
                        disabled={!opened}
                        onClick={() => send({ type: "go", delta: -1 })}
                    >
                        <ArrowLeftIcon />
                    </Button>
                </Hint>
                <Hint label={t("preview.forward")}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("preview.forward")}
                        disabled={!opened}
                        onClick={() => send({ type: "go", delta: 1 })}
                    >
                        <ArrowRightIcon />
                    </Button>
                </Hint>
                <Hint label={t("preview.reload")}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("preview.reload")}
                        disabled={!opened}
                        onClick={() => (down ? setReload((n) => n + 1) : send({ type: "reload" }))}
                    >
                        <RotateCwIcon />
                    </Button>
                </Hint>
                <form onSubmit={submit} className="min-w-48 flex-1">
                    <Input
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={t("preview.address")}
                        aria-label={t("preview.address")}
                        className="h-8 font-mono text-xs"
                    />
                </form>
                <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={device}
                    onValueChange={(value) => value && setDevice(value as Device)}
                    aria-label={t("preview.device")}
                >
                    <ToggleGroupItem value="desktop" aria-label={t("preview.desktop")}>
                        <MonitorIcon />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="tablet" aria-label={t("preview.tablet")}>
                        <TabletIcon />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="mobile" aria-label={t("preview.mobile")}>
                        <SmartphoneIcon />
                    </ToggleGroupItem>
                </ToggleGroup>
                <Hint label={t("preview.designHint")}>
                    <Button
                        variant={design ? "default" : "outline"}
                        size="sm"
                        aria-pressed={design}
                        disabled={!opened || down}
                        onClick={toggleDesign}
                    >
                        <MousePointerClickIcon />
                        {t("preview.design")}
                    </Button>
                </Hint>
                {shown && (
                    <Hint label={t("preview.openBrowser")}>
                        <Button asChild variant="ghost" size="icon-sm">
                            <a
                                href={shown}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={t("preview.openBrowser")}
                            >
                                <ExternalLinkIcon />
                            </a>
                        </Button>
                    </Hint>
                )}
            </div>
            {urls.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
                    <span className="text-xs text-muted-foreground">{t("terminal.urls")}</span>
                    {urls.map((url) => (
                        <button
                            key={url.url}
                            type="button"
                            onClick={() => open.mutate(url.url)}
                            className={cn(
                                "flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs hover:bg-muted",
                                shown.startsWith(url.url) && "ring-1 ring-ring",
                            )}
                        >
                            <CircleIcon
                                aria-hidden="true"
                                className={cn(
                                    "size-2",
                                    url.running
                                        ? "fill-constructive text-constructive"
                                        : "fill-muted text-muted-foreground",
                                )}
                            />
                            {url.url}
                        </button>
                    ))}
                </div>
            )}
            {picks.length > 0 && (
                <div className="shrink-0 space-y-2 border-b bg-muted/20 px-3 py-2">
                    <ul className="scroll-fade max-h-44 space-y-1.5 overflow-y-auto">
                        {picks.map((pick, index) => (
                            <li
                                // biome-ignore lint/suspicious/noArrayIndexKey: picks only grow or lose one by its place.
                                key={index}
                                className="flex items-center gap-2"
                            >
                                <span
                                    className="min-w-0 max-w-[45%] truncate font-mono text-xs"
                                    title={pick.html}
                                >
                                    {pick.selector}
                                    {pick.text && (
                                        <span className="text-muted-foreground">
                                            {" "}
                                            “{pick.text}”
                                        </span>
                                    )}
                                </span>
                                <Input
                                    value={pick.note}
                                    onChange={(e) =>
                                        setPicks((list) =>
                                            list.map((p, i) =>
                                                i === index ? { ...p, note: e.target.value } : p,
                                            ),
                                        )
                                    }
                                    placeholder={t("preview.note")}
                                    aria-label={t("preview.note")}
                                    className="h-7 flex-1 text-xs"
                                />
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t("preview.removePick")}
                                    onClick={() =>
                                        setPicks((list) => list.filter((_, i) => i !== index))
                                    }
                                >
                                    <XIcon />
                                </Button>
                            </li>
                        ))}
                    </ul>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            onClick={() => {
                                onSend(picksText(t("preview.picksHeading"), picks));
                                setPicks([]);
                            }}
                        >
                            <SendIcon />
                            {sendLabel}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setPicks([])}>
                            {t("preview.clearPicks")}
                        </Button>
                    </div>
                </div>
            )}
            <FormError error={remote ? null : open.error} />
            <div className="relative min-h-0 flex-1 overflow-auto bg-muted/30">
                {remote ? (
                    <Alert variant="info" role="note" className="m-3 w-auto">
                        <InfoIcon />
                        <AlertDescription>{t("preview.remote")}</AlertDescription>
                    </Alert>
                ) : !opened ? (
                    <Alert variant="info" role="note" className="m-3 w-auto">
                        <InfoIcon />
                        <AlertDescription>{t("preview.empty")}</AlertDescription>
                    </Alert>
                ) : (
                    <>
                        {down && (
                            <Alert variant="info" role="status" className="m-3 w-auto">
                                <InfoIcon />
                                <AlertDescription>
                                    {t("preview.down", { url: opened.target })}
                                </AlertDescription>
                            </Alert>
                        )}
                        <iframe
                            key={`${opened.url} ${reload}`}
                            ref={frame}
                            src={opened.url}
                            title={t("preview.frame")}
                            // Same origin is the proxy's own; without top navigation the app
                            // cannot take the panel's place.
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                            className={cn(
                                "mx-auto block h-full bg-white",
                                width ? "border-x" : "w-full",
                                down && "hidden",
                            )}
                            style={width ? { width } : undefined}
                        />
                    </>
                )}
            </div>
        </div>
    );
}
