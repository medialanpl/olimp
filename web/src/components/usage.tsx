import { Fragment, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { Fact } from "@/components/page";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFormat } from "@/lib/format";
import type { Usage } from "@/lib/types";

type InputUsage = Partial<Pick<Usage, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens">>;

// The input beyond the cache; a job from before the cache was recorded has only its total.
export const freshInput = (usage: InputUsage) =>
    typeof usage.inputTokens === "number"
        ? usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheWriteTokens ?? 0)
        : null;

// The fresh input, or `children` in its place, with the cache's share on hover and focus.
export function InputTokens({ usage, children }: { usage: InputUsage; children?: ReactNode }) {
    const t = useTranslations("web");
    const format = useFormat();
    const shown = children ?? format.count(freshInput(usage));
    if (typeof usage.cacheReadTokens !== "number" && typeof usage.cacheWriteTokens !== "number")
        return shown;
    const parts = [
        ["trace.fresh", freshInput(usage)],
        ["trace.cacheWrite", usage.cacheWriteTokens],
        ["trace.cacheRead", usage.cacheReadTokens],
        ["trace.inputTotal", usage.inputTokens],
    ] as const;
    return (
        <Tooltip>
            <TooltipTrigger className="cursor-help underline decoration-dotted underline-offset-4">
                {shown}
            </TooltipTrigger>
            <TooltipContent>
                <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
                    {parts.map(([key, value]) => (
                        <Fragment key={key}>
                            <dt>{t(key)}</dt>
                            <dd className="text-right tabular-nums">{format.count(value)}</dd>
                        </Fragment>
                    ))}
                </dl>
            </TooltipContent>
        </Tooltip>
    );
}

// What the agent's CLI reported; Codex reports no cost.
export function UsageFacts({ usage }: { usage: Partial<Usage> }) {
    const t = useTranslations("web");
    const format = useFormat();
    return (
        <>
            <Fact label={t("fields.cost")}>{format.cost(usage.costUsd)}</Fact>
            <Fact label={t("fields.turns")}>{format.count(usage.turns)}</Fact>
            <Fact label={t("fields.tokens")}>
                <InputTokens usage={usage} /> / {format.count(usage.outputTokens)}
            </Fact>
            <Fact label={t("fields.duration")}>{format.duration(usage.durationMs)}</Fact>
        </>
    );
}
