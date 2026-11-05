import { useTranslations } from "use-intl";
import { Field, listOf, type NodeFieldsProps, TextField } from "@/components/flow/inspector/fields";
import { Input } from "@/components/ui/input";

export function CheckFields(p: NodeFieldsProps<"check">) {
    const { node, readOnly, field, set } = p;
    const t = useTranslations("web");
    return (
        <>
            <Field
                id={field("command")}
                label={t("flow.field.command")}
                hint={t("flow.field.commandHint")}
            >
                <TextField {...p} name="command" value={node.command} rows={3} mono />
            </Field>
            <Field
                id={field("retryOn")}
                label={t("flow.field.retryOn")}
                hint={t("flow.field.retryOnHint")}
            >
                <Input
                    id={field("retryOn")}
                    defaultValue={(node.retryOn ?? []).join(", ")}
                    placeholder="1"
                    disabled={readOnly}
                    onBlur={(e) => {
                        const codes = listOf(e.target.value)
                            .map(Number)
                            .filter((n) => Number.isInteger(n) && n > 0 && n < 256);
                        set({ retryOn: codes.length ? codes : undefined });
                    }}
                />
            </Field>
        </>
    );
}

export function WebhookFields(p: NodeFieldsProps<"notify.webhook">) {
    const { node, field } = p;
    const t = useTranslations("web");
    return (
        <>
            <Field id={field("url")} label={t("flow.field.url")} hint={t("flow.field.urlHint")}>
                <TextField {...p} name="url" value={node.url} mono />
            </Field>
            <Field
                id={field("body")}
                label={t("flow.field.webhookBody")}
                hint={t("flow.field.templateHint")}
            >
                <TextField {...p} name="body" value={node.body} rows={3} />
            </Field>
        </>
    );
}
