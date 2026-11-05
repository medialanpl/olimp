import { CheckIcon, PlusIcon, SearchIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { ExternalLink } from "@/components/external-link";
import { IntegrationLogo } from "@/components/integrations/integration-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIES, type Category, PRESETS, type Preset } from "@/lib/integration-catalog";
import type { IntegrationView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function IntegrationStatus({ integration }: { integration: IntegrationView }) {
    const t = useTranslations("web");
    return integration.missing.length ? (
        <Badge variant="destructive">
            {t("repo.needs", { names: integration.missing.join(", ") })}
        </Badge>
    ) : (
        <Badge variant="constructive">
            <CheckIcon />
            {t("integrations.connected")}
        </Badge>
    );
}

// The whole card answers a click through the action button's stretched `::after`; the docs
// link sits above it. `aria-haspopup` also keeps the button's press nudge off that area.
function Card({
    logo,
    name,
    category,
    description,
    status,
    docs,
    action,
    dashed,
}: {
    logo: ReactNode;
    name: string;
    category?: string;
    description: string;
    status?: ReactNode;
    docs?: string;
    action: ReactNode;
    dashed?: boolean;
}) {
    const t = useTranslations("web");
    return (
        <article
            className={cn(
                "group relative flex h-full flex-col gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/50",
                dashed && "border-dashed",
            )}
        >
            <div className="flex items-start justify-between gap-2">
                {logo}
                {status}
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="font-medium">{name}</h3>
                {category && <p className="text-xs text-muted-foreground">{category}</p>}
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
                {docs ? (
                    <ExternalLink
                        href={docs}
                        className="relative z-10 text-sm text-muted-foreground no-underline underline-offset-4 hover:text-foreground hover:underline [&_svg]:size-3.5"
                    >
                        {t("integrations.docs")}
                        <span className="sr-only">: {name}</span>
                    </ExternalLink>
                ) : (
                    <span />
                )}
                {action}
            </div>
        </article>
    );
}

const stretched = "after:absolute after:inset-0 after:rounded-xl";

export function IntegrationCatalog({
    integrations,
    onConnect,
    onEdit,
    onCustom,
}: {
    integrations: IntegrationView[];
    onConnect: (preset: Preset) => void;
    onEdit: (integration: IntegrationView) => void;
    onCustom: () => void;
}) {
    const t = useTranslations("web");
    const [category, setCategory] = useState<Category | "">("");
    const [query, setQuery] = useState("");
    const q = query.trim().toLowerCase();
    const describe = (preset: Preset) => t(`integrations.catalog.${preset.id}`);
    const visible = PRESETS.filter(
        (preset) =>
            (!category || preset.category === category) &&
            (!q ||
                preset.name.toLowerCase().includes(q) ||
                describe(preset).toLowerCase().includes(q)),
    );
    const links = [
        { value: "" as const, label: t("integrations.all"), count: PRESETS.length },
        ...CATEGORIES.map((value) => ({
            value,
            label: t(`integrations.categories.${value}`),
            count: PRESETS.filter((preset) => preset.category === value).length,
        })),
    ];
    return (
        <div className="@container/catalog">
            <div className="grid gap-6 @2xl/catalog:grid-cols-[12rem_1fr]">
                <nav
                    aria-label={t("integrations.categoryNav")}
                    className="-mx-4 scroll-fade-x overflow-x-auto px-4 @2xl/catalog:mx-0 @2xl/catalog:px-0"
                >
                    <ul className="flex gap-1 @2xl/catalog:flex-col">
                        {links.map((link) => (
                            <li key={link.value} className="shrink-0">
                                <button
                                    type="button"
                                    aria-pressed={link.value === category}
                                    onClick={() => setCategory(link.value)}
                                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground"
                                >
                                    {link.label}
                                    <span className="text-xs tabular-nums opacity-80">
                                        {link.count}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>
                <div className="@container/results flex min-w-0 flex-col gap-4">
                    <search className="relative max-w-sm">
                        <SearchIcon
                            aria-hidden
                            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            type="search"
                            value={query}
                            aria-label={t("integrations.search")}
                            placeholder={t("integrations.search")}
                            className="pl-9"
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </search>
                    {visible.length === 0 && (
                        <p className="text-sm text-muted-foreground">{t("integrations.empty")}</p>
                    )}
                    <ul className="grid gap-3 @md/results:grid-cols-2 @3xl/results:grid-cols-3">
                        {visible.map((preset) => {
                            const connected = integrations.find((i) => i.name === preset.id);
                            return (
                                <li key={preset.id}>
                                    <Card
                                        logo={<IntegrationLogo preset={preset} />}
                                        name={preset.name}
                                        category={
                                            category
                                                ? undefined
                                                : t(`integrations.categories.${preset.category}`)
                                        }
                                        description={describe(preset)}
                                        status={
                                            connected && (
                                                <IntegrationStatus integration={connected} />
                                            )
                                        }
                                        docs={preset.docs}
                                        action={
                                            <Button
                                                size="sm"
                                                variant={connected ? "outline" : "default"}
                                                aria-haspopup="dialog"
                                                className={stretched}
                                                onClick={() =>
                                                    connected
                                                        ? onEdit(connected)
                                                        : onConnect(preset)
                                                }
                                            >
                                                {connected
                                                    ? t("integrations.edit")
                                                    : t("integrations.connect")}
                                                <span className="sr-only">: {preset.name}</span>
                                            </Button>
                                        }
                                    />
                                </li>
                            );
                        })}
                        <li>
                            <Card
                                dashed
                                logo={<IntegrationLogo preset={undefined} />}
                                name={t("integrations.customName")}
                                description={t("integrations.customDescription")}
                                action={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        aria-haspopup="dialog"
                                        className={stretched}
                                        onClick={onCustom}
                                    >
                                        <PlusIcon />
                                        {t("integrations.add")}
                                    </Button>
                                }
                            />
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
