import { PlugIcon } from "lucide-react";
import { useTranslations } from "use-intl";
import { AGENT_NAMES, agentLabel } from "@/components/agent-mark";
import {
    Field,
    NONE,
    type NodeFieldsProps,
    NumberField,
    TextField,
    TextList,
    TimeoutField,
} from "@/components/flow/inspector/fields";
import { IntegrationLogo } from "@/components/integrations/integration-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { forkOf, labelOf, OPTIONS_MAX, promptReviewers } from "@/lib/flow";
import { presetOf } from "@/lib/integration-catalog";
import { useIntegrations, useSkills } from "@/lib/queries";
import type { Definition, GraphNode, IntegrationView } from "@/lib/types";

function AgentSelect({
    id,
    value,
    onChange,
    disabled,
}: {
    id: string;
    value: string | undefined;
    onChange: (value: string | undefined) => void;
    disabled?: boolean;
}) {
    const t = useTranslations("web");
    return (
        <Select
            value={value ?? NONE}
            disabled={disabled}
            onValueChange={(v) => onChange(v === NONE ? undefined : v)}
        >
            <SelectTrigger id={id} className="w-full">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NONE}>{t("flow.field.projectAgent")}</SelectItem>
                {AGENT_NAMES.map((agent) => (
                    <SelectItem key={agent} value={agent}>
                        {agentLabel(agent)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function PromptReviewers({
    definition,
    node,
    onAdd,
}: {
    definition: Definition;
    node: GraphNode;
    onAdd?: (node: string, logins: string[]) => void;
}) {
    const t = useTranslations("web");
    const logins = promptReviewers(definition, node);
    if (!logins.length) return null;
    const update = definition.nodes.find((n) => n.type === "github.pr-update");
    return (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <p>
                {t(update ? "flow.reviewersInPrompt" : "flow.reviewersInPromptNoUpdate", {
                    logins: logins.map((login) => `@${login}`).join(", "),
                })}
            </p>
            {update && onAdd ? (
                <Button size="sm" variant="outline" onClick={() => onAdd(update.id, logins)}>
                    {t("flow.addReviewers", { node: update.id })}
                </Button>
            ) : null}
        </div>
    );
}

function IntegrationChips({
    id,
    integrations,
    value,
    readOnly,
    onChange,
    onManage,
}: {
    id: string;
    integrations: IntegrationView[] | undefined;
    value: string[] | undefined;
    readOnly: boolean;
    onChange: (list: string[]) => void;
    onManage?: () => void;
}) {
    const t = useTranslations("web");
    if (!integrations || (!integrations.length && !onManage)) return null;
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
                <Label id={id}>{t("flow.field.integrations")}</Label>
                {onManage && (
                    <Button size="xs" variant="ghost" onClick={onManage}>
                        <PlugIcon />
                        {t("integrations.manage")}
                    </Button>
                )}
            </div>
            {integrations.length ? (
                <ToggleGroup
                    type="multiple"
                    variant="outline"
                    spacing={1.5}
                    aria-labelledby={id}
                    value={value ?? []}
                    disabled={readOnly}
                    onValueChange={onChange}
                    className="w-full flex-wrap"
                >
                    {integrations.map((integration) => {
                        const preset = presetOf(integration.name);
                        return (
                            <ToggleGroupItem
                                key={integration.name}
                                value={integration.name}
                                title={integration.name}
                                className="h-7 gap-1.5 pr-2.5 pl-1 text-xs font-normal text-muted-foreground aria-pressed:border-primary/50 aria-pressed:bg-primary/10 aria-pressed:text-foreground data-[state=on]:bg-primary/10"
                            >
                                <IntegrationLogo preset={preset} size="xs" />
                                <span className={preset ? undefined : "font-mono"}>
                                    {preset?.name ?? integration.name}
                                </span>
                            </ToggleGroupItem>
                        );
                    })}
                </ToggleGroup>
            ) : (
                <p className="text-xs text-muted-foreground">{t("integrations.noneInProject")}</p>
            )}
        </div>
    );
}

export function AgentFields(p: NodeFieldsProps<"agent">) {
    const { definition, node, repo, readOnly, field, set, onAddReviewers, onManageIntegrations } =
        p;
    const t = useTranslations("web");
    const skills = useSkills();
    const integrations = useIntegrations(repo || null);
    const agents = definition.nodes.filter((n) => n.type === "agent" && n.id !== node.id);
    const branch = Boolean(forkOf(definition, node.id));
    return (
        <>
            <Field
                id={field("prompt")}
                label={t("flow.field.prompt")}
                hint={t("flow.field.templateHint")}
            >
                <TextField {...p} name="prompt" value={node.prompt} rows={8} />
            </Field>
            <PromptReviewers
                definition={definition}
                node={node}
                onAdd={readOnly ? undefined : onAddReviewers}
            />
            <Field id={field("skill")} label={t("flow.field.skill")}>
                <SearchableSelect
                    id={field("skill")}
                    value={node.skill ?? NONE}
                    disabled={readOnly}
                    onValueChange={(v) => set({ skill: v === NONE ? undefined : v })}
                    searchPlaceholder={t("flow.field.searchSkills")}
                    options={[
                        { value: NONE, label: t("flow.field.noSkill") },
                        ...(node.skill && !(skills.data ?? []).some((s) => s.id === node.skill)
                            ? [{ value: node.skill, label: node.skill }]
                            : []),
                        ...(skills.data ?? []).map((s) => ({
                            value: s.id,
                            label: s.name,
                            keywords: `${s.id} ${s.description}`,
                        })),
                    ]}
                />
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field id={field("agent")} label={t("flow.field.agent")}>
                    <AgentSelect
                        id={field("agent")}
                        value={node.agent}
                        disabled={readOnly}
                        onChange={(v) => set({ agent: v })}
                    />
                </Field>
                <Field id={field("model")} label={t("flow.field.model")}>
                    <Input
                        id={field("model")}
                        value={node.model ?? ""}
                        placeholder={t("flow.field.defaultModel")}
                        disabled={readOnly}
                        onChange={(e) => set({ model: e.target.value || undefined })}
                    />
                </Field>
            </div>
            <IntegrationChips
                id={field("integrations")}
                integrations={integrations.data}
                value={node.integrations}
                readOnly={readOnly}
                onChange={(list) => set({ integrations: list.length ? list : undefined })}
                onManage={readOnly ? undefined : onManageIntegrations}
            />
            {branch ? (
                <>
                    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                        <div className="space-y-0.5">
                            <Label htmlFor={field("review")}>{t("flow.field.review")}</Label>
                            <p className="text-xs text-muted-foreground">
                                {t("flow.field.reviewHint")}
                            </p>
                        </div>
                        <Switch
                            id={field("review")}
                            checked={Boolean(node.review)}
                            disabled={readOnly}
                            onCheckedChange={(v) => set({ review: v || undefined })}
                        />
                    </div>
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
            ) : (
                <>
                    <Field
                        id={field("verdicts")}
                        label={t("flow.field.verdicts")}
                        hint={t("flow.field.verdictsHint")}
                    >
                        <TextList
                            id={field("verdicts")}
                            value={node.verdicts}
                            disabled={readOnly}
                            placeholder="approve, changes"
                            onChange={(v) => set({ verdicts: v })}
                        />
                    </Field>
                    <Field
                        id={field("session")}
                        label={t("flow.field.session")}
                        hint={t("flow.field.sessionHint")}
                    >
                        <Select
                            value={node.session?.continue ?? NONE}
                            disabled={readOnly}
                            onValueChange={(v) =>
                                set({ session: v === NONE ? undefined : { continue: v } })
                            }
                        >
                            <SelectTrigger id={field("session")} className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NONE}>{t("flow.field.freshSession")}</SelectItem>
                                {agents.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                        {labelOf(a)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                </>
            )}
            <details className="group rounded-xl border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">
                    {t("flow.field.tools")}
                </summary>
                <div className="mt-3 space-y-3">
                    <Field
                        id={field("tools")}
                        label={t("flow.field.allowedTools")}
                        hint={t("flow.field.allowedToolsHint")}
                    >
                        <TextList
                            id={field("tools")}
                            value={node.allowedTools}
                            disabled={readOnly}
                            placeholder="Read, Edit, Grep"
                            onChange={(v) => set({ allowedTools: v })}
                        />
                    </Field>
                    <Field
                        id={field("bash")}
                        label={t("flow.field.bashAllowlist")}
                        hint={t("flow.field.bashAllowlistHint")}
                    >
                        <TextList
                            id={field("bash")}
                            lines
                            value={node.bashAllowlist}
                            disabled={readOnly}
                            placeholder="pnpm test"
                            onChange={(v) => set({ bashAllowlist: v })}
                        />
                    </Field>
                </div>
            </details>
        </>
    );
}

export function AskFields(p: NodeFieldsProps<"ask-user">) {
    const { node, readOnly, field, set } = p;
    const t = useTranslations("web");
    return (
        <>
            <Field
                id={field("question")}
                label={t("flow.field.question")}
                hint={t("flow.field.templateHint")}
            >
                <TextField {...p} name="question" value={node.question} rows={3} />
            </Field>
            <Field
                id={field("options")}
                label={t("flow.field.options")}
                hint={t("flow.field.optionsHint", { max: OPTIONS_MAX })}
            >
                <TextList
                    id={field("options")}
                    lines
                    value={node.options}
                    disabled={readOnly}
                    onChange={(v) => set({ options: v?.slice(0, OPTIONS_MAX) })}
                />
            </Field>
            <TimeoutField {...p} />
        </>
    );
}

export function DispatchFields(p: NodeFieldsProps<"dispatch">) {
    const { node, readOnly, field, set } = p;
    const t = useTranslations("web");
    return (
        <>
            <Field
                id={field("prompt")}
                label={t("flow.field.prompt")}
                hint={t("flow.field.templateHint")}
            >
                <TextField {...p} name="prompt" value={node.prompt} rows={6} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field id={field("agent")} label={t("flow.field.agent")}>
                    <AgentSelect
                        id={field("agent")}
                        value={node.agent}
                        disabled={readOnly}
                        onChange={(v) => set({ agent: v })}
                    />
                </Field>
                <Field id={field("model")} label={t("flow.field.model")}>
                    <Input
                        id={field("model")}
                        value={node.model ?? ""}
                        placeholder={t("flow.field.defaultModel")}
                        disabled={readOnly}
                        onChange={(e) => set({ model: e.target.value || undefined })}
                    />
                </Field>
            </div>
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
