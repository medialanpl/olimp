import { GitBranchPlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { SidePanel } from "@/components/flow/canvas";
import { NODE_ICON, toneOf, useNodeTitle } from "@/components/flow/graph";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { labelOf, nodeKey } from "@/lib/flow";
import { useSkills } from "@/lib/queries";
import type { GraphNode, NodeType, Workflow } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NodeChoice {
    key: string;
    type: NodeType;
    title: string;
    description: string;
    extra?: Partial<GraphNode>;
    skill?: boolean;
}

function NodeItem({ choice, onPick }: { choice: NodeChoice; onPick: () => void }) {
    const Icon = choice.skill ? GitBranchPlusIcon : NODE_ICON[choice.type];
    return (
        <li>
            <button
                type="button"
                onClick={onPick}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
                <span
                    className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
                        toneOf(choice.type).tile,
                    )}
                >
                    <Icon />
                </span>
                <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{choice.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                        {choice.description}
                    </span>
                </span>
            </button>
        </li>
    );
}

const AGENTS: NodeType[] = ["agent", "ask-user", "dispatch"];
const FLOW: NodeType[] = ["if", "loop", "gate.human", "fork", "workflow"];
const SCRIPTS: NodeType[] = ["check", "notify.webhook"];
const GIT: NodeType[] = [
    "git.commit",
    "git.push",
    "git.sync-base",
    "github.draft-pr",
    "github.pr-update",
    "github.pr-comment",
    "github.issue-comment",
    "github.wait-ci",
];

// "Add a node": every node the engine runs, the skills as ready agent steps and the agent
// steps of the project's other workflows.
export function NodePalette({
    workflows,
    onPick,
    onClose,
}: {
    workflows: Workflow[];
    onPick: (choice: NodeChoice) => void;
    onClose: () => void;
}) {
    const t = useTranslations("web");
    const nodeTitle = useNodeTitle();
    const skills = useSkills();
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const plain = (type: NodeType): NodeChoice => ({
        key: type,
        type,
        title: nodeTitle(type),
        description: t(`flow.node.${nodeKey(type)}.description`),
    });
    const sections: [string, NodeChoice[]][] = [
        [t("flow.category.agents"), AGENTS.map(plain)],
        [
            t("flow.category.flow"),
            [
                ...FLOW.map(plain),
                {
                    key: "end:success",
                    type: "end",
                    title: t("flow.endSuccess"),
                    description: t("flow.endSuccessHint"),
                    extra: { status: "success" },
                },
                {
                    key: "end:failed",
                    type: "end",
                    title: t("flow.endFailed"),
                    description: t("flow.endFailedHint"),
                    extra: { status: "failed" },
                },
            ],
        ],
        [t("flow.category.scripts"), SCRIPTS.map(plain)],
        [t("flow.category.git"), GIT.map(plain)],
        [
            t("flow.category.skills"),
            (skills.data ?? []).map((s) => ({
                key: `skill:${s.id}`,
                type: "agent",
                title: s.name,
                description: s.description || s.id,
                skill: true,
                extra: { id: s.name, name: s.name, skill: s.id, prompt: "{{task}}" },
            })),
        ],
        [
            t("flow.category.saved"),
            workflows.flatMap((w) =>
                w.definition.nodes
                    .filter((n) => n.type === "agent")
                    .map((n) => ({
                        key: `${w.id}:${n.id}`,
                        type: "agent" as const,
                        title: labelOf(n),
                        description: t("flow.fromWorkflow", { workflow: w.name }),
                        extra: { ...n, id: n.id },
                    })),
            ),
        ],
    ];
    const hit = (c: NodeChoice) =>
        !q || [c.title, c.description, c.type].some((text) => text.toLowerCase().includes(q));
    const visible = sections.map(([title, items]) => [title, items.filter(hit)] as const);
    return (
        <SidePanel title={t("flow.addNode")} side="left" onClose={onClose}>
            <InputGroup>
                <InputGroupAddon>
                    <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("flow.searchNodes")}
                    aria-label={t("flow.searchNodes")}
                    autoFocus
                />
            </InputGroup>
            {visible.map(([title, items]) =>
                items.length ? (
                    <section key={title} className="-mx-2 space-y-1">
                        <h3 className="flex items-center gap-1.5 px-2 pt-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            <span
                                aria-hidden
                                className={cn(
                                    "size-2 rounded-full",
                                    items[0] && toneOf(items[0].type).bar,
                                )}
                            />
                            {title}
                        </h3>
                        <ul>
                            {items.map((c) => (
                                <NodeItem key={c.key} choice={c} onPick={() => onPick(c)} />
                            ))}
                        </ul>
                    </section>
                ) : null,
            )}
            {visible.every(([, items]) => !items.length) ? (
                <p className="text-sm text-muted-foreground">{t("flow.noNodeMatches")}</p>
            ) : null}
        </SidePanel>
    );
}
