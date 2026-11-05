import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
    CheckIcon,
    ExternalLinkIcon,
    HandIcon,
    MessageCircleQuestionIcon,
    SendIcon,
    SquareStackIcon,
    TimerIcon,
    XIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { FormError } from "@/components/page";
import { ChildLink } from "@/components/run/steps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { labelOf, nodeById } from "@/lib/flow";
import { useFormat } from "@/lib/format";
import { keys } from "@/lib/queries";
import type { RunWait, WorkflowRun } from "@/lib/types";

export function WaitCard({ run, wait }: { run: WorkflowRun; wait: RunWait }) {
    const t = useTranslations("web");
    const format = useFormat();
    const client = useQueryClient();
    const [comment, setComment] = useState("");
    const [answer, setAnswer] = useState("");
    const node = nodeById(run.definition, wait.node);
    const send = useMutation({
        mutationFn: (body: { answer: string; comment?: string }) =>
            api<WorkflowRun>(`/api/workflow-runs/${run.id}/answer`, { method: "POST", body }),
        onSuccess: (updated) => client.setQueryData(keys.run(run.id), updated),
    });
    const until = wait.until ? (
        <p className="text-xs text-muted-foreground">
            {t("runs.wait.until", { when: format.dateTime(wait.until) })}
        </p>
    ) : null;
    const head = (icon: React.ReactNode, title: string) => (
        <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-info/10 text-info [&_svg]:size-4">
                {icon}
            </span>
            <div className="min-w-0">
                <h2 className="font-semibold">{title}</h2>
                <p className="truncate text-xs text-muted-foreground">
                    {node ? labelOf(node) : wait.node} ·{" "}
                    {t("runs.wait.since", { when: format.relative(wait.since) })}
                </p>
            </div>
        </div>
    );
    return (
        <section
            aria-live="polite"
            className="space-y-4 rounded-2xl border border-info/40 bg-info/5 p-4 sm:p-5"
        >
            {wait.kind === "gate" ? (
                <>
                    {head(<HandIcon />, t("runs.wait.gate"))}
                    <p className="whitespace-pre-wrap break-words text-sm">{wait.question}</p>
                    <Textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder={t("runs.wait.commentPlaceholder")}
                        aria-label={t("runs.wait.comment")}
                        className="min-h-16 bg-background"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            disabled={send.isPending}
                            onClick={() =>
                                send.mutate({
                                    answer: "approve",
                                    ...(comment.trim() && { comment }),
                                })
                            }
                        >
                            <CheckIcon />
                            {t("runs.wait.approve")}
                        </Button>
                        <Button
                            variant="outline"
                            className="text-destructive"
                            disabled={send.isPending}
                            onClick={() =>
                                send.mutate({
                                    answer: "reject",
                                    ...(comment.trim() && { comment }),
                                })
                            }
                        >
                            <XIcon />
                            {t("runs.wait.reject")}
                        </Button>
                    </div>
                    {until}
                </>
            ) : wait.kind === "ask" ? (
                <>
                    {head(<MessageCircleQuestionIcon />, t("runs.wait.ask"))}
                    <p className="whitespace-pre-wrap break-words text-sm">{wait.question}</p>
                    {wait.options?.length ? (
                        <div className="flex flex-wrap gap-2">
                            {wait.options.map((option) => (
                                <Button
                                    key={option}
                                    variant="outline"
                                    className="bg-background"
                                    disabled={send.isPending}
                                    onClick={() => send.mutate({ answer: option })}
                                >
                                    {option}
                                </Button>
                            ))}
                        </div>
                    ) : null}
                    <form
                        className="flex gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (answer.trim()) send.mutate({ answer: answer.trim() });
                        }}
                    >
                        <Input
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                            placeholder={t("runs.wait.answerPlaceholder")}
                            aria-label={t("runs.wait.answer")}
                            className="bg-background"
                        />
                        <Button type="submit" disabled={!answer.trim() || send.isPending}>
                            <SendIcon />
                            {t("runs.wait.send")}
                        </Button>
                    </form>
                    {until}
                </>
            ) : wait.kind === "ci" ? (
                <>
                    {head(<TimerIcon />, t("runs.wait.ci", { pr: wait.pr ?? "" }))}
                    {run.prUrl ? (
                        <a
                            href={run.prUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-sm text-info underline-offset-4 hover:underline"
                        >
                            <ExternalLinkIcon className="size-3.5" />
                            {run.prUrl}
                        </a>
                    ) : null}
                    {until}
                </>
            ) : (
                <>
                    {head(
                        <SquareStackIcon />,
                        t(wait.mode === "any" ? "runs.wait.childrenAny" : "runs.wait.childrenAll", {
                            count: wait.children?.length ?? 0,
                        }),
                    )}
                    <ul className="grid gap-2 sm:grid-cols-2">
                        {(wait.children ?? []).map((child) => (
                            <li key={child.id}>
                                <ChildLink child={child} />
                            </li>
                        ))}
                    </ul>
                </>
            )}
            <FormError error={send.error} />
        </section>
    );
}
