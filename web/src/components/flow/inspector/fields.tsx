import { type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Definition, NodeOf, NodeType, Workflow } from "@/lib/types";
import { cn } from "@/lib/utils";

export const NONE = "__none__";
export const MINUTE = 60_000;

export interface NodeFieldsProps<T extends NodeType> {
    node: NodeOf<T>;
    definition: Definition;
    repo: string;
    workflows: Workflow[];
    readOnly: boolean;
    field: (name: string) => string;
    set: (patch: Record<string, unknown>) => void;
    onResizeFork: (n: number) => void;
    onAddReviewers?: (node: string, logins: string[]) => void;
    onManageIntegrations?: () => void;
}

export function Field({
    id,
    label,
    hint,
    children,
}: {
    id: string;
    label: string;
    hint?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            {children}
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

// Lists typed as text: one entry per line or comma, empty entries dropped.
export const listOf = (text: string, split = /[\n,]/) =>
    text
        .split(split)
        .map((s) => s.trim())
        .filter(Boolean);

export function TextList({
    id,
    value,
    onChange,
    lines = false,
    disabled,
    placeholder,
}: {
    id: string;
    value: string[] | undefined;
    onChange: (list: string[] | undefined) => void;
    lines?: boolean;
    disabled?: boolean;
    placeholder?: string;
}) {
    const joined = (value ?? []).join(lines ? "\n" : ", ");
    const [text, setText] = useState(joined);
    useEffect(() => setText(joined), [joined]);
    const commit = () => {
        const list = listOf(text, lines ? /\n/ : /[\n,]/);
        onChange(list.length ? list : undefined);
    };
    return lines ? (
        <Textarea
            id={id}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            className="min-h-16 font-mono text-xs"
        />
    ) : (
        <Input
            id={id}
            value={text}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
        />
    );
}

// A number that may be empty; the node keeps undefined then.
export function NumberField({
    id,
    value,
    onChange,
    min,
    max,
    step,
    disabled,
    placeholder,
}: {
    id: string;
    value: number | undefined;
    onChange: (value: number | undefined) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    placeholder?: string;
}) {
    return (
        <Input
            id={id}
            type="number"
            inputMode="decimal"
            value={value ?? ""}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
                const n = e.target.value === "" ? undefined : Number(e.target.value);
                onChange(n === undefined || Number.isNaN(n) ? undefined : n);
            }}
        />
    );
}

export function TextField({
    field,
    readOnly,
    set,
    name,
    value,
    rows = 0,
    mono = false,
}: Pick<NodeFieldsProps<NodeType>, "field" | "readOnly" | "set"> & {
    name: string;
    value: string | undefined;
    rows?: number;
    mono?: boolean;
}) {
    return rows ? (
        <Textarea
            id={field(name)}
            value={value ?? ""}
            disabled={readOnly}
            onChange={(e) => set({ [name]: e.target.value })}
            className={cn("scroll-fade max-h-80", mono && "font-mono text-xs")}
            style={{ minHeight: `${rows * 1.5}rem` }}
        />
    ) : (
        <Input
            id={field(name)}
            value={value ?? ""}
            disabled={readOnly}
            onChange={(e) => set({ [name]: e.target.value || undefined })}
            className={cn(mono && "font-mono text-xs")}
        />
    );
}

export const minutes = (ms: number | undefined) => (ms === undefined ? undefined : ms / MINUTE);
export const fromMinutes = (m: number | undefined) =>
    m === undefined ? undefined : Math.round(m * MINUTE);

export function TimeoutField({
    node,
    field,
    readOnly,
    set,
}: NodeFieldsProps<"gate.human" | "ask-user">) {
    const t = useTranslations("web");
    return (
        <Field
            id={field("timeout")}
            label={t("flow.field.timeout")}
            hint={t("flow.field.timeoutHint")}
        >
            <NumberField
                id={field("timeout")}
                value={minutes(node.timeoutMs)}
                min={1}
                max={7 * 24 * 60}
                disabled={readOnly}
                placeholder={t("flow.field.noTimeout")}
                onChange={(v) => set({ timeoutMs: fromMinutes(v) })}
            />
        </Field>
    );
}
