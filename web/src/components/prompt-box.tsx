import {
    AlertCircleIcon,
    ArrowUpIcon,
    FileIcon,
    MicIcon,
    NotebookPenIcon,
    PaperclipIcon,
    PlusIcon,
    XIcon,
} from "lucide-react";
import type * as React from "react";
import {
    type ClipboardEvent,
    type DragEvent,
    type KeyboardEvent,
    type ReactNode,
    useRef,
    useState,
} from "react";
import { Link } from "react-router";
import { useLocale, useTranslations } from "use-intl";
import { OrbCanvas } from "@/components/orb";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ATTACHMENTS_MAX, type Attachments, UPLOAD_MAX } from "@/lib/attachments";
import { dictationBlock, useDictation } from "@/lib/dictation";
import { type PromptTemplate, usePromptTemplates } from "@/lib/queries";
import { keysOf, triggered, useKeyMap } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

// A setting of the prompt beside the send button: project, agent, skill and the like.
export function PromptChip({
    className,
    empty,
    ...props
}: React.ComponentProps<"button"> & { empty?: boolean }) {
    return (
        <button
            type="button"
            className={cn(
                "inline-flex h-7 max-w-56 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60 [&_svg]:size-3.5 [&_svg]:shrink-0 [&>span]:truncate",
                empty ? "border-dashed text-muted-foreground" : "bg-background",
                className,
            )}
            {...props}
        />
    );
}

function IconAction({
    label,
    className,
    ...props
}: React.ComponentProps<"button"> & { label: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    className={cn(
                        "inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
                        className,
                    )}
                    {...props}
                />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

const BUILT_IN = ["addTests", "explain", "minimal", "docs", "edgeCases"] as const;

export function useTemplates(): PromptTemplate[] {
    const t = useTranslations("web");
    const saved = usePromptTemplates();
    return (
        saved.data ??
        BUILT_IN.map((id) => ({
            id,
            label: t(`prompt.builtIn.${id}.label`),
            text: t(`prompt.builtIn.${id}.text`),
        }))
    );
}

// Everything but the project and the agent sits behind "+", so the box stays simple; the templates
// are always there, the page adds its own settings above them.
function OptionsMenu({
    menu,
    onMenuClosed,
    onTemplate,
    disabled,
}: {
    menu?: ReactNode;
    onMenuClosed?: () => boolean;
    onTemplate: (text: string) => void;
    disabled?: boolean;
}) {
    const t = useTranslations("web");
    const templates = useTemplates();
    return (
        <DropdownMenu modal={false}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            disabled={disabled}
                            aria-label={t("prompt.options")}
                            className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted data-[state=open]:text-foreground [&_svg]:size-4"
                        >
                            <PlusIcon />
                        </button>
                    </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("prompt.options")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
                align="start"
                className="w-56"
                onCloseAutoFocus={(event) => {
                    if (onMenuClosed?.()) event.preventDefault();
                }}
            >
                {menu}
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        <NotebookPenIcon />
                        {t("prompt.template")}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
                        {templates.map((template) => (
                            <DropdownMenuItem
                                key={template.id}
                                onSelect={() => onTemplate(template.text)}
                                className="flex-col items-start gap-0.5"
                            >
                                <span className="font-medium">{template.label}</span>
                                <span className="line-clamp-2 text-xs text-muted-foreground">
                                    {template.text}
                                </span>
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                            <Link
                                to="/settings/general/templates"
                                className="text-xs text-muted-foreground"
                            >
                                {t("prompt.manageTemplates")}
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function AttachmentList({ attachments }: { attachments: Attachments }) {
    const t = useTranslations("web");
    if (!attachments.items.length) return null;
    return (
        <ul className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.items.map((item) => {
                const problem =
                    item.error === "tooLarge"
                        ? t("prompt.tooLarge", { max: UPLOAD_MAX / 1024 / 1024 })
                        : item.error === "tooMany"
                          ? t("prompt.tooMany", { max: ATTACHMENTS_MAX })
                          : item.error === "proxyTooLarge"
                            ? t("prompt.proxyTooLarge")
                            : item.error;
                return (
                    <li
                        key={item.key}
                        title={problem ?? item.name}
                        className={cn(
                            "group relative flex h-12 max-w-52 items-center gap-2 overflow-hidden rounded-xl border bg-muted/40 pr-7 text-xs",
                            item.preview ? "pl-0" : "pl-2.5",
                            problem && "border-destructive/50 bg-destructive/5",
                        )}
                    >
                        {item.preview ? (
                            <img
                                src={item.preview}
                                alt=""
                                className="h-full w-12 shrink-0 object-cover"
                            />
                        ) : (
                            <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0">
                            <span className="block truncate font-medium">{item.name}</span>
                            <span
                                className={cn(
                                    "flex items-center gap-1 text-muted-foreground",
                                    problem && "text-destructive",
                                )}
                            >
                                {problem ? (
                                    <>
                                        <AlertCircleIcon className="size-3" />
                                        <span className="truncate">{problem}</span>
                                    </>
                                ) : item.upload ? (
                                    `${Math.max(1, Math.round(item.size / 1024))} KB`
                                ) : (
                                    <>
                                        <Spinner className="size-3" />
                                        {t("prompt.uploading")}
                                    </>
                                )}
                            </span>
                        </span>
                        <button
                            type="button"
                            aria-label={t("prompt.remove", { name: item.name })}
                            onClick={() => attachments.remove(item.key)}
                            className="absolute top-1 right-1 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <XIcon className="size-3.5" />
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}

const clock = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

// The chat's input: the send shortcut (Ctrl+Enter by default) sends, Enter adds a line, "/" may
// open a picker; files
// are attached by the clip, pasted or dropped; dictation listens with Jarvis's orb.
export function PromptBox({
    value,
    onChange,
    onSubmit,
    onSlash,
    attachments,
    label,
    placeholder,
    disabled,
    pending,
    canSend,
    autoFocus,
    toolbar,
    menu,
    onMenuClosed,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: (text: string) => void;
    onSlash?: () => void;
    attachments?: Attachments;
    label: string;
    placeholder: string;
    disabled?: boolean;
    pending?: boolean;
    canSend: boolean;
    autoFocus?: boolean;
    toolbar?: ReactNode;
    // Settings behind "+", as dropdown items and submenus.
    menu?: ReactNode;
    // Once "+" has closed; true when it opened a layer of its own that takes the focus. A layer
    // opened while the menu closes loses its focus to the menu and closes at once.
    onMenuClosed?: () => boolean;
    className?: string;
}) {
    const t = useTranslations("web");
    const locale = useLocale();
    const field = useRef<HTMLTextAreaElement>(null);
    const files = useRef<HTMLInputElement>(null);
    const dictation = useDictation(locale === "pl" ? "pl-PL" : "en-US");
    const [dragging, setDragging] = useState(false);
    const block = dictationBlock();
    const keyMap = useKeyMap();
    const ready = canSend && !pending && !disabled && !attachments?.busy && !attachments?.failed;

    const send = (text: string) => {
        if (ready || (text.trim() && !pending && !disabled)) onSubmit(text);
    };
    const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!event.nativeEvent.isComposing && triggered(event.nativeEvent, "send")) {
            event.preventDefault();
            if (ready) onSubmit(value);
        }
    };
    const insert = (text: string) => {
        const el = field.current;
        const at = el ? el.selectionStart : value.length;
        const before = value.slice(0, at);
        const after = value.slice(at);
        const pad = (side: string) => (side && !side.endsWith("\n\n") ? "\n\n" : "");
        onChange(`${before}${before ? pad(before) : ""}${text}${after ? "\n\n" : ""}${after}`);
        requestAnimationFrame(() => el?.focus());
    };
    const appended = (text: string) => (value.trim() ? `${value.trimEnd()} ${text}` : text);
    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        if (!attachments || !event.clipboardData.files.length) return;
        event.preventDefault();
        attachments.add([...event.clipboardData.files]);
    };
    const onDrop = (event: DragEvent<HTMLFormElement>) => {
        setDragging(false);
        if (!attachments || !event.dataTransfer.files.length) return;
        event.preventDefault();
        attachments.add([...event.dataTransfer.files]);
    };

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                if (ready) onSubmit(value);
            }}
            onDragOver={(event) => {
                if (!attachments || disabled) return;
                event.preventDefault();
                setDragging(true);
            }}
            onDragLeave={(event) => {
                // dragleave also fires when the pointer moves onto a child of the form.
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDragging(false);
            }}
            onDrop={onDrop}
            className={cn(
                "relative rounded-3xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15",
                disabled && "opacity-70",
                dragging && "border-ring ring-4 ring-ring/25",
                className,
            )}
        >
            {attachments && <AttachmentList attachments={attachments} />}
            <textarea
                ref={field}
                value={value}
                onChange={(event) => {
                    if (onSlash && !value && event.target.value === "/") onSlash();
                    else onChange(event.target.value);
                }}
                onKeyDown={onKey}
                onPaste={onPaste}
                maxLength={20_000}
                disabled={disabled}
                // biome-ignore lint/a11y/noAutofocus: the page exists to type this prompt
                autoFocus={autoFocus}
                aria-label={label}
                placeholder={placeholder}
                className="block field-sizing-content max-h-72 min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
            {dictation.listening ? (
                <div className="flex items-center gap-3 border-t px-3 py-2.5">
                    <span data-palette="lagoon" className="orb size-10">
                        <OrbCanvas palette="lagoon" state="listening" volume={dictation.volume} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-xs font-medium">
                            <span className="size-2 animate-pulse rounded-full bg-destructive motion-reduce:animate-none" />
                            <span className="tabular-nums">{clock(dictation.seconds)}</span>
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                            {dictation.text || t("prompt.listening")}
                        </p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={dictation.cancel}>
                        {t("common.cancel")}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            const text = dictation.finish();
                            if (text) onChange(appended(text));
                            requestAnimationFrame(() => field.current?.focus());
                        }}
                    >
                        {t("prompt.insert")}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                            const text = dictation.finish();
                            if (text) send(appended(text));
                        }}
                    >
                        {t("prompt.insertSend")}
                    </Button>
                </div>
            ) : (
                <div className="flex items-end gap-1.5 px-2.5 pb-2.5">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        {attachments && (
                            <>
                                <IconAction
                                    label={t("prompt.attach")}
                                    disabled={disabled}
                                    onClick={() => files.current?.click()}
                                >
                                    <PaperclipIcon />
                                </IconAction>
                                <input
                                    ref={files}
                                    type="file"
                                    multiple
                                    hidden
                                    onChange={(event) => {
                                        attachments.add([...(event.target.files ?? [])]);
                                        event.target.value = "";
                                    }}
                                />
                            </>
                        )}
                        <OptionsMenu
                            menu={menu}
                            onMenuClosed={onMenuClosed}
                            onTemplate={insert}
                            disabled={disabled}
                        />
                        {toolbar}
                    </div>
                    {dictation.error && (
                        <span className="pb-1.5 text-xs text-destructive">
                            {t("prompt.dictationError", { error: dictation.error })}
                        </span>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span>
                                <button
                                    type="button"
                                    aria-label={t("prompt.dictation")}
                                    disabled={!!block || disabled}
                                    data-palette="dusk"
                                    onClick={() => void dictation.start()}
                                    className="orb group size-8 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-40"
                                >
                                    <OrbCanvas palette="dusk" />
                                    <span className="relative z-1 grid size-5 place-items-center rounded-full bg-background/90 text-foreground shadow-xs transition-transform group-hover:scale-110">
                                        <MicIcon className="size-3" />
                                    </span>
                                </button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            {block ? t(`prompt.dictation_${block}`) : t("prompt.dictation")}
                        </TooltipContent>
                    </Tooltip>
                    <Button
                        type="submit"
                        size="icon"
                        className="size-8 shrink-0 rounded-full"
                        disabled={!ready}
                        aria-label={t("prompt.send")}
                        title={`${t("prompt.send")} (${keysOf(keyMap.send).join("+")})`}
                    >
                        {pending ? <Spinner /> : <ArrowUpIcon />}
                    </Button>
                </div>
            )}
        </form>
    );
}
