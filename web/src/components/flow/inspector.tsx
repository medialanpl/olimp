import { CheckIcon, CopyIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Hint, SidePanel } from "@/components/flow/canvas";
import { useNodeTitle, usePortLabel } from "@/components/flow/graph";
import { AgentFields, AskFields, DispatchFields } from "@/components/flow/inspector/agents";
import { Field, NONE, TextField } from "@/components/flow/inspector/fields";
import {
    EndFields,
    ForkFields,
    GateFields,
    IfFields,
    JoinFields,
    LoopFields,
    WorkflowFields,
} from "@/components/flow/inspector/flow";
import {
    CommitFields,
    DraftPrFields,
    IssueCommentFields,
    PrCommentFields,
    PrUpdateFields,
    WaitCiFields,
} from "@/components/flow/inspector/git";
import { CheckFields, WebhookFields } from "@/components/flow/inspector/scripts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { edgeFrom, isFailurePort, labelOf, NODE_OUTPUTS, nodeKey, portsOf } from "@/lib/flow";
import type { Definition, GraphNode, Workflow } from "@/lib/types";
import { cn } from "@/lib/utils";

function CopyRef({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            onClick={() =>
                void navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                })
            }
            className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
        >
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            {text}
        </button>
    );
}

export function NodeInspector({
    definition,
    node,
    repo,
    workflows,
    readOnly,
    onChange,
    onRename,
    onRemove,
    onConnect,
    onResizeFork,
    onAddReviewers,
    onManageIntegrations,
    onClose,
}: {
    definition: Definition;
    node: GraphNode;
    repo: string;
    workflows: Workflow[];
    readOnly: boolean;
    onChange: (patch: Partial<GraphNode>) => void;
    onRename: (id: string) => void;
    onRemove: () => void;
    onConnect: (port: string, to: string | null) => void;
    onResizeFork: (n: number) => void;
    // Adds logins to the reviewers of a PR update node.
    onAddReviewers?: (node: string, logins: string[]) => void;
    onManageIntegrations?: () => void;
    onClose: () => void;
}) {
    const t = useTranslations("web");
    const nodeTitle = useNodeTitle();
    const portLabel = usePortLabel();
    const field = (name: string) => `node-${node.id}-${name}`;
    const [id, setId] = useState(node.id);
    useEffect(() => setId(node.id), [node.id]);
    const targets = definition.nodes.filter((n) => n.type !== "start" && n.id !== node.id);
    const set = (patch: Record<string, unknown>) => onChange(patch as Partial<GraphNode>);
    const props = {
        definition,
        repo,
        workflows,
        readOnly,
        field,
        set,
        onResizeFork,
        onAddReviewers,
        onManageIntegrations,
    };
    const outputs = NODE_OUTPUTS[node.type] ?? [];

    let fields: ReactNode = null;
    switch (node.type) {
        case "start":
            fields = <p className="text-sm text-muted-foreground">{t("flow.field.startHint")}</p>;
            break;
        case "end":
            fields = <EndFields {...props} node={node} />;
            break;
        case "loop":
            fields = <LoopFields {...props} node={node} />;
            break;
        case "agent":
            fields = <AgentFields {...props} node={node} />;
            break;
        case "check":
            fields = <CheckFields {...props} node={node} />;
            break;
        case "if":
            fields = <IfFields {...props} node={node} />;
            break;
        case "gate.human":
            fields = <GateFields {...props} node={node} />;
            break;
        case "ask-user":
            fields = <AskFields {...props} node={node} />;
            break;
        case "dispatch":
            fields = <DispatchFields {...props} node={node} />;
            break;
        case "fork":
            fields = <ForkFields {...props} node={node} />;
            break;
        case "join":
            fields = <JoinFields {...props} node={node} />;
            break;
        case "workflow":
            fields = <WorkflowFields {...props} node={node} />;
            break;
        case "git.commit":
            fields = <CommitFields {...props} node={node} />;
            break;
        case "github.draft-pr":
            fields = <DraftPrFields {...props} node={node} />;
            break;
        case "github.pr-update":
            fields = <PrUpdateFields {...props} node={node} />;
            break;
        case "github.pr-comment":
            fields = <PrCommentFields {...props} node={node} />;
            break;
        case "github.issue-comment":
            fields = <IssueCommentFields {...props} node={node} />;
            break;
        case "github.wait-ci":
            fields = <WaitCiFields {...props} node={node} />;
            break;
        case "notify.webhook":
            fields = <WebhookFields {...props} node={node} />;
            break;
        default:
            fields = (
                <p className="text-sm text-muted-foreground">
                    {t(`flow.node.${nodeKey(node.type)}.description`)}
                </p>
            );
    }

    return (
        <SidePanel title={labelOf(node)} subtitle={nodeTitle(node.type)} onClose={onClose}>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                <Field id={field("id")} label={t("flow.field.id")}>
                    <Input
                        id={field("id")}
                        value={id}
                        disabled={readOnly}
                        onChange={(e) => setId(e.target.value)}
                        onBlur={() => id !== node.id && onRename(id)}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        className="font-mono text-xs"
                    />
                </Field>
                <Field id={field("name")} label={t("flow.field.name")}>
                    <TextField {...props} name="name" value={node.name} />
                </Field>
                {node.type !== "start" ? (
                    <Hint label={t("flow.removeNode")}>
                        <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t("flow.removeNode")}
                            disabled={readOnly}
                            onClick={onRemove}
                            className="text-destructive"
                        >
                            <Trash2Icon />
                        </Button>
                    </Hint>
                ) : null}
            </div>
            {node.type !== "start" && node.type !== "end" ? (
                <p className="-mt-1 text-xs text-muted-foreground">
                    {t(`flow.node.${nodeKey(node.type)}.description`)}
                </p>
            ) : null}
            {fields}
            {portsOf(node).length ? (
                <section className="space-y-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {t("flow.ports")}
                    </h3>
                    <ul className="space-y-2">
                        {portsOf(node).map((port) => {
                            const to = edgeFrom(definition, node.id, port)?.to ?? NONE;
                            return (
                                <li
                                    key={port}
                                    className="grid grid-cols-[6rem_1fr] items-center gap-2"
                                >
                                    <span
                                        className={cn(
                                            "truncate text-xs font-medium",
                                            isFailurePort(port)
                                                ? "text-destructive"
                                                : "text-muted-foreground",
                                        )}
                                    >
                                        {portLabel(port)}
                                    </span>
                                    <Select
                                        value={to}
                                        disabled={readOnly}
                                        onValueChange={(v) =>
                                            onConnect(port, v === NONE ? null : v)
                                        }
                                    >
                                        <SelectTrigger
                                            size="sm"
                                            className="w-full"
                                            aria-label={t("flow.portTarget", {
                                                port: portLabel(port),
                                            })}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={NONE}>
                                                {isFailurePort(port)
                                                    ? t("flow.unwiredFails")
                                                    : t("flow.unwiredEnds")}
                                            </SelectItem>
                                            {targets.map((n) => (
                                                <SelectItem key={n.id} value={n.id}>
                                                    {labelOf(n)}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ) : null}
            {outputs.length ? (
                <section className="space-y-2">
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {t("flow.outputs")}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                        {outputs.map((output) => (
                            <CopyRef key={output} text={`{{nodes.${node.id}.${output}}}`} />
                        ))}
                    </div>
                </section>
            ) : null}
        </SidePanel>
    );
}
