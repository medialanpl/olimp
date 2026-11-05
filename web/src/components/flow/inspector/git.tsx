import { useTranslations } from "use-intl";
import {
    Field,
    fromMinutes,
    MINUTE,
    minutes,
    NONE,
    type NodeFieldsProps,
    NumberField,
    TextField,
    TextList,
} from "@/components/flow/inspector/fields";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function CommitFields(p: NodeFieldsProps<"git.commit">) {
    const { node, field } = p;
    const t = useTranslations("web");
    return (
        <Field
            id={field("message")}
            label={t("flow.field.commitMessage")}
            hint={t("flow.field.templateHint")}
        >
            <TextField {...p} name="message" value={node.message} rows={2} />
        </Field>
    );
}

export function DraftPrFields(p: NodeFieldsProps<"github.draft-pr">) {
    const { node, readOnly, field, set } = p;
    const t = useTranslations("web");
    return (
        <>
            <Field
                id={field("title")}
                label={t("flow.field.prTitle")}
                hint={t("flow.field.prTitleHint")}
            >
                <TextField {...p} name="title" value={node.title} />
            </Field>
            <Field id={field("draft")} label={t("flow.field.prDraft")}>
                <Select
                    value={node.draft === undefined ? NONE : String(node.draft)}
                    disabled={readOnly}
                    onValueChange={(v) => set({ draft: v === NONE ? undefined : v === "true" })}
                >
                    <SelectTrigger id={field("draft")} className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NONE}>{t("flow.field.prDraftProject")}</SelectItem>
                        <SelectItem value="true">{t("flow.field.prDraftYes")}</SelectItem>
                        <SelectItem value="false">{t("flow.field.prDraftNo")}</SelectItem>
                    </SelectContent>
                </Select>
            </Field>
        </>
    );
}

export function PrUpdateFields({
    node,
    readOnly,
    field,
    set,
}: NodeFieldsProps<"github.pr-update">) {
    const t = useTranslations("web");
    return (
        <>
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <Label htmlFor={field("ready")}>{t("flow.field.prReady")}</Label>
                <Switch
                    id={field("ready")}
                    checked={Boolean(node.ready)}
                    disabled={readOnly}
                    onCheckedChange={(v) => set({ ready: v || undefined })}
                />
            </div>
            <Field id={field("labels")} label={t("flow.field.labels")}>
                <TextList
                    id={field("labels")}
                    value={node.addLabels}
                    disabled={readOnly}
                    placeholder="ready, ai"
                    onChange={(v) => set({ addLabels: v })}
                />
            </Field>
            <Field id={field("reviewers")} label={t("flow.field.reviewers")}>
                <TextList
                    id={field("reviewers")}
                    value={node.reviewers}
                    disabled={readOnly}
                    placeholder="octocat"
                    onChange={(v) => set({ reviewers: v })}
                />
            </Field>
        </>
    );
}

export function PrCommentFields(p: NodeFieldsProps<"github.pr-comment">) {
    const { node, field } = p;
    const t = useTranslations("web");
    return (
        <Field
            id={field("body")}
            label={t("flow.field.comment")}
            hint={t("flow.field.templateHint")}
        >
            <TextField {...p} name="body" value={node.body} rows={4} />
        </Field>
    );
}

export function IssueCommentFields(p: NodeFieldsProps<"github.issue-comment">) {
    const { node, readOnly, field, set } = p;
    const t = useTranslations("web");
    return (
        <>
            <Field
                id={field("issue")}
                label={t("flow.field.issue")}
                hint={t("flow.field.issueHint")}
            >
                <NumberField
                    id={field("issue")}
                    value={node.issue}
                    min={1}
                    disabled={readOnly}
                    onChange={(v) => set({ issue: v })}
                />
            </Field>
            <Field
                id={field("body")}
                label={t("flow.field.comment")}
                hint={t("flow.field.templateHint")}
            >
                <TextField {...p} name="body" value={node.body} rows={4} />
            </Field>
        </>
    );
}

export function WaitCiFields({ node, readOnly, field, set }: NodeFieldsProps<"github.wait-ci">) {
    const t = useTranslations("web");
    return (
        <div className="grid grid-cols-2 gap-3">
            <Field id={field("timeout")} label={t("flow.field.ciTimeout")}>
                <NumberField
                    id={field("timeout")}
                    value={minutes(node.timeoutMs)}
                    min={1}
                    max={7 * 24 * 60}
                    disabled={readOnly}
                    onChange={(v) => set({ timeoutMs: fromMinutes(v) ?? MINUTE })}
                />
            </Field>
            <Field id={field("poll")} label={t("flow.field.ciPoll")}>
                <NumberField
                    id={field("poll")}
                    value={node.pollMs / 1000}
                    min={10}
                    max={1800}
                    disabled={readOnly}
                    onChange={(v) => set({ pollMs: Math.round((v ?? 60) * 1000) })}
                />
            </Field>
        </div>
    );
}
