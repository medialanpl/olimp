import { useTranslations } from "use-intl";
import {
    Field,
    NONE,
    type NodeFieldsProps,
    NumberField,
    TextField,
    TimeoutField,
} from "@/components/flow/inspector/fields";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
    CONDITION_KINDS,
    LOOP_MAX,
    labelOf,
    NODE_OUTPUTS,
    NUMERIC_OPS,
    OUTPUT_OPS,
} from "@/lib/flow";
import type { Condition } from "@/lib/types";

export function EndFields({ node, readOnly, field, set }: NodeFieldsProps<"end">) {
    const t = useTranslations("web");
    return (
        <Field id={field("status")} label={t("flow.field.endStatus")}>
            <ToggleGroup
                type="single"
                variant="outline"
                value={node.status}
                disabled={readOnly}
                onValueChange={(v) => v && set({ status: v })}
            >
                <ToggleGroupItem value="success">{t("flow.endSuccess")}</ToggleGroupItem>
                <ToggleGroupItem value="failed">{t("flow.endFailed")}</ToggleGroupItem>
            </ToggleGroup>
        </Field>
    );
}

export function LoopFields({ node, readOnly, field, set }: NodeFieldsProps<"loop">) {
    const t = useTranslations("web");
    return (
        <Field
            id={field("max")}
            label={t("flow.field.loopMax")}
            hint={t("flow.field.loopHint", { max: LOOP_MAX })}
        >
            <NumberField
                id={field("max")}
                value={node.max}
                min={1}
                max={LOOP_MAX}
                disabled={readOnly}
                onChange={(v) => set({ max: v ?? 1 })}
            />
        </Field>
    );
}

export function GateFields(p: NodeFieldsProps<"gate.human">) {
    const { node, field } = p;
    const t = useTranslations("web");
    return (
        <>
            <Field
                id={field("message")}
                label={t("flow.field.message")}
                hint={t("flow.field.templateHint")}
            >
                <TextField {...p} name="message" value={node.message} rows={4} />
            </Field>
            <TimeoutField {...p} />
        </>
    );
}

export function ForkFields({ node, readOnly, field, onResizeFork }: NodeFieldsProps<"fork">) {
    const t = useTranslations("web");
    return (
        <Field
            id={field("branches")}
            label={t("flow.field.branches")}
            hint={t("flow.field.branchesHint")}
        >
            <ToggleGroup
                type="single"
                variant="outline"
                value={String(node.branches)}
                disabled={readOnly}
                onValueChange={(v) => v && onResizeFork(Number(v))}
            >
                {["2", "3", "4"].map((n) => (
                    <ToggleGroupItem key={n} value={n} className="px-4">
                        {n}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </Field>
    );
}

export function JoinFields({ node, readOnly, field, set }: NodeFieldsProps<"join">) {
    const t = useTranslations("web");
    return (
        <Field id={field("wait")} label={t("flow.field.wait")}>
            <ToggleGroup
                type="single"
                variant="outline"
                value={node.wait}
                disabled={readOnly}
                onValueChange={(v) => v && set({ wait: v })}
                className="flex-col items-stretch"
            >
                <ToggleGroupItem value="all" className="justify-start">
                    {t("flow.field.waitAll")}
                </ToggleGroupItem>
                <ToggleGroupItem value="any" className="justify-start">
                    {t("flow.field.waitAny")}
                </ToggleGroupItem>
            </ToggleGroup>
        </Field>
    );
}

export function WorkflowFields(p: NodeFieldsProps<"workflow">) {
    const { node, repo, workflows, readOnly, field, set } = p;
    const t = useTranslations("web");
    const others = workflows.filter((w) => w.repo === repo);
    return (
        <>
            <Field
                id={field("workflow")}
                label={t("flow.field.subWorkflow")}
                hint={t("flow.field.subWorkflowHint")}
            >
                <SearchableSelect
                    id={field("workflow")}
                    value={node.workflow || NONE}
                    disabled={readOnly}
                    onValueChange={(v) => set({ workflow: v === NONE ? "" : v })}
                    placeholder={t("flow.field.pickWorkflow")}
                    options={[
                        {
                            value: NONE,
                            label: t("flow.field.pickWorkflow"),
                            disabled: true,
                        },
                        ...others.map((w) => ({ value: w.id, label: w.name })),
                    ]}
                />
            </Field>
            <Field
                id={field("prompt")}
                label={t("flow.field.subInput")}
                hint={t("flow.field.templateHint")}
            >
                <TextField {...p} name="prompt" value={node.prompt} rows={3} />
            </Field>
            <Field
                id={field("budget")}
                label={t("flow.field.budget")}
                hint={t("flow.field.budgetHint")}
            >
                <NumberField
                    id={field("budget")}
                    value={node.budgetUsd}
                    min={0}
                    step={0.5}
                    disabled={readOnly}
                    onChange={(v) => set({ budgetUsd: v || undefined })}
                />
            </Field>
        </>
    );
}

export function IfFields({ definition, node, readOnly, field, set }: NodeFieldsProps<"if">) {
    const t = useTranslations("web");
    const { condition } = node;
    const onChange = (next: Condition) => set({ condition: next });
    const refs = definition.nodes.flatMap((n) =>
        (NODE_OUTPUTS[n.type] ?? []).map((output) => ({
            value: `${n.id}.${output}`,
            label: `${labelOf(n)} · ${output}`,
        })),
    );
    const switchKind = (kind: Condition["kind"]) => {
        switch (kind) {
            case "diff-lines":
            case "diff-files":
                return onChange({ kind, op: ">", value: kind === "diff-lines" ? 200 : 10 });
            case "paths-changed":
                return onChange({ kind, glob: "src/**" });
            case "output":
                return onChange({ kind, ref: refs[0]?.value ?? "", op: "equals", value: "" });
            case "branch":
                return onChange({ kind, op: "equals", value: "main" });
        }
    };
    return (
        <>
            <Field
                id={field("kind")}
                label={t("flow.field.conditionKind")}
                hint={t("flow.field.conditionHint")}
            >
                <Select
                    value={condition.kind}
                    disabled={readOnly}
                    onValueChange={(v) => switchKind(v as Condition["kind"])}
                >
                    <SelectTrigger id={field("kind")} className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {CONDITION_KINDS.map((kind) => (
                            <SelectItem key={kind} value={kind}>
                                {t(`flow.condition.${kind}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Field>
            {condition.kind === "diff-lines" || condition.kind === "diff-files" ? (
                <div className="grid grid-cols-[6rem_1fr] gap-3">
                    <Select
                        value={condition.op}
                        disabled={readOnly}
                        onValueChange={(op) =>
                            onChange({ ...condition, op: op as typeof condition.op })
                        }
                    >
                        <SelectTrigger aria-label={t("flow.field.operator")} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {NUMERIC_OPS.map((op) => (
                                <SelectItem key={op} value={op}>
                                    {op}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <NumberField
                        id={field("value")}
                        value={condition.value}
                        min={0}
                        disabled={readOnly}
                        onChange={(v) => onChange({ ...condition, value: v ?? 0 })}
                    />
                </div>
            ) : null}
            {condition.kind === "paths-changed" ? (
                <Field
                    id={field("glob")}
                    label={t("flow.field.glob")}
                    hint={t("flow.field.globHint")}
                >
                    <Input
                        id={field("glob")}
                        value={condition.glob}
                        disabled={readOnly}
                        onChange={(e) => onChange({ ...condition, glob: e.target.value })}
                        className="font-mono text-xs"
                    />
                </Field>
            ) : null}
            {condition.kind === "output" ? (
                <>
                    <Field id={field("ref")} label={t("flow.field.ref")}>
                        <SearchableSelect
                            id={field("ref")}
                            value={condition.ref || NONE}
                            disabled={readOnly}
                            onValueChange={(ref) => onChange({ ...condition, ref })}
                            options={[
                                ...(condition.ref && !refs.some((r) => r.value === condition.ref)
                                    ? [{ value: condition.ref, label: condition.ref }]
                                    : []),
                                ...refs,
                            ]}
                        />
                    </Field>
                    <div className="grid grid-cols-[8rem_1fr] gap-3">
                        <Select
                            value={condition.op}
                            disabled={readOnly}
                            onValueChange={(op) =>
                                onChange({ ...condition, op: op as typeof condition.op })
                            }
                        >
                            <SelectTrigger aria-label={t("flow.field.operator")} className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {OUTPUT_OPS.map((op) => (
                                    <SelectItem key={op} value={op}>
                                        {op === "equals" || op === "contains"
                                            ? t(`flow.op.${op}`)
                                            : op === "not-equals"
                                              ? t("flow.op.notEquals")
                                              : op}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            aria-label={t("flow.field.value")}
                            value={String(condition.value)}
                            disabled={readOnly}
                            onChange={(e) => onChange({ ...condition, value: e.target.value })}
                        />
                    </div>
                </>
            ) : null}
            {condition.kind === "branch" ? (
                <div className="grid grid-cols-[8rem_1fr] gap-3">
                    <Select
                        value={condition.op}
                        disabled={readOnly}
                        onValueChange={(op) =>
                            onChange({ ...condition, op: op as "equals" | "matches" })
                        }
                    >
                        <SelectTrigger aria-label={t("flow.field.operator")} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="equals">{t("flow.op.equals")}</SelectItem>
                            <SelectItem value="matches">{t("flow.op.matches")}</SelectItem>
                        </SelectContent>
                    </Select>
                    <Input
                        aria-label={t("flow.field.value")}
                        value={condition.value}
                        disabled={readOnly}
                        onChange={(e) => onChange({ ...condition, value: e.target.value })}
                        className="font-mono text-xs"
                    />
                </div>
            ) : null}
        </>
    );
}
