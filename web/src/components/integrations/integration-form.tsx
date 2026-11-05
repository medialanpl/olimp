import { KeyRoundIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { IntegrationLogo } from "@/components/integrations/integration-logo";
import { FormError } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
    DialogBody,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Preset } from "@/lib/integration-catalog";
import { useRepoWrite } from "@/lib/queries";
import type { Integration, IntegrationView } from "@/lib/types";
import { cn } from "@/lib/utils";

type Kind = Integration["kind"];

const lines = (text: string) =>
    text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

// `NAME=value` for the environment, `Name: value` for headers; the API checks the names.
const pairs = (text: string, separator: string) =>
    Object.fromEntries(
        lines(text).map((line) => {
            const at = line.indexOf(separator);
            return at < 0
                ? [line, ""]
                : [line.slice(0, at).trim(), line.slice(at + separator.length).trim()];
        }),
    );

const unpair = (values: Record<string, string>, separator: string) =>
    Object.entries(values)
        .map(([name, value]) => `${name}${separator}${value}`)
        .join("\n");

// The project's secrets page; in the workflow editor it opens in a new tab so the draft stays.
export function SecretsLink({
    repo,
    newTab,
    className,
}: {
    repo: string;
    newTab?: boolean;
    className?: string;
}) {
    const t = useTranslations("web");
    return (
        <Link
            to={`/project/${repo}/settings/secrets`}
            target={newTab ? "_blank" : undefined}
            rel={newTab ? "noreferrer" : undefined}
            className={cn("underline underline-offset-2 hover:text-foreground", className)}
        >
            {t("projectSettings.secrets")}
        </Link>
    );
}

export function IntegrationForm({
    repo,
    editing,
    preset,
    newTab,
    onDone,
}: {
    repo: string;
    editing: IntegrationView | null;
    preset?: Preset;
    newTab?: boolean;
    onDone: () => void;
}) {
    const t = useTranslations("web");
    const write = useRepoWrite(repo);
    const start = editing ?? preset?.spec;
    const stdio = start?.kind === "stdio" ? start : null;
    const http = start?.kind === "http" ? start : null;
    const [name, setName] = useState(editing?.name ?? preset?.id ?? "");
    const [kind, setKind] = useState<Kind>(start?.kind ?? "stdio");
    const [command, setCommand] = useState(stdio?.command ?? "");
    const [args, setArgs] = useState(stdio?.args.join("\n") ?? "");
    const [env, setEnv] = useState(stdio ? unpair(stdio.env, "=") : "");
    const [url, setUrl] = useState(http?.url ?? "");
    const [headers, setHeaders] = useState(http ? unpair(http.headers, ": ") : "");
    const variables = editing ? editing.missing : (preset?.variables ?? []);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        const spec =
            kind === "stdio"
                ? { kind, command: command.trim(), args: lines(args), env: pairs(env, "=") }
                : { kind, url: url.trim(), headers: pairs(headers, ":") };
        write.mutate(
            editing
                ? { method: "PATCH", path: `integrations/${editing.name}`, body: spec }
                : { method: "POST", path: "integrations", body: { name: name.trim(), ...spec } },
            { onSuccess: onDone },
        );
    };
    return (
        <form onSubmit={submit} autoComplete="off" className="flex min-h-0 flex-1 flex-col">
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2.5">
                    {preset && <IntegrationLogo preset={preset} size="xs" />}
                    {editing
                        ? t("repo.editIntegration", { name: preset?.name ?? editing.name })
                        : preset
                          ? t("integrations.connectTitle", { name: preset.name })
                          : t("repo.addIntegration")}
                </DialogTitle>
                <DialogDescription>
                    {preset
                        ? t(`integrations.catalog.${preset.id}`)
                        : t("repo.integrationFormHint")}
                </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
                {variables.length > 0 && (
                    <div
                        className={cn(
                            "flex gap-2.5 rounded-lg border p-3 text-sm",
                            editing && "border-destructive/30 bg-destructive/5",
                        )}
                    >
                        <KeyRoundIcon
                            aria-hidden
                            className={cn(
                                "mt-0.5 size-4 shrink-0",
                                editing ? "text-destructive" : "text-muted-foreground",
                            )}
                        />
                        <p className="text-muted-foreground">
                            {t(editing ? "integrations.missingHint" : "integrations.needsHint", {
                                names: variables.join(", "),
                            })}{" "}
                            <SecretsLink repo={repo} newTab={newTab} />
                        </p>
                    </div>
                )}
                {!editing && (
                    <div className="space-y-2">
                        <Label htmlFor="integration-name">{t("repo.integrationName")}</Label>
                        <Input
                            id="integration-name"
                            value={name}
                            maxLength={50}
                            spellCheck={false}
                            placeholder="github"
                            className="font-mono"
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>
                )}
                <Tabs
                    activationMode="manual"
                    value={kind}
                    onValueChange={(value) => setKind(value as Kind)}
                >
                    <TabsList aria-label={t("repo.integrationKind")}>
                        <TabsTrigger value="stdio">{t("repo.kindStdio")}</TabsTrigger>
                        <TabsTrigger value="http">{t("repo.kindHttp")}</TabsTrigger>
                    </TabsList>
                </Tabs>
                {kind === "stdio" ? (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="integration-command">{t("repo.command")}</Label>
                            <Input
                                id="integration-command"
                                value={command}
                                spellCheck={false}
                                placeholder="npx"
                                className="font-mono"
                                onChange={(e) => setCommand(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="integration-args">{t("repo.args")}</Label>
                            <Textarea
                                id="integration-args"
                                value={args}
                                rows={3}
                                spellCheck={false}
                                placeholder={"-y\n@modelcontextprotocol/server-github"}
                                className="font-mono"
                                onChange={(e) => setArgs(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="integration-env">{t("repo.env")}</Label>
                            <Textarea
                                id="integration-env"
                                value={env}
                                rows={3}
                                spellCheck={false}
                                placeholder={`GITHUB_TOKEN=\${GITHUB_TOKEN}`}
                                className="font-mono"
                                onChange={(e) => setEnv(e.target.value)}
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor="integration-url">{t("repo.url")}</Label>
                            <Input
                                id="integration-url"
                                type="url"
                                value={url}
                                spellCheck={false}
                                placeholder="https://mcp.example.com/mcp"
                                className="font-mono"
                                onChange={(e) => setUrl(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="integration-headers">{t("repo.headers")}</Label>
                            <Textarea
                                id="integration-headers"
                                value={headers}
                                rows={3}
                                spellCheck={false}
                                placeholder={`Authorization: Bearer \${API_TOKEN}`}
                                className="font-mono"
                                onChange={(e) => setHeaders(e.target.value)}
                            />
                        </div>
                    </>
                )}
                <p className="text-xs text-muted-foreground">
                    {t("repo.referenceHint", { reference: `\${NAME}` })}
                </p>
                <FormError error={write.error} />
            </DialogBody>
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={write.isPending || (!editing && !name.trim())}>
                    {editing
                        ? t("common.save")
                        : preset
                          ? t("integrations.connect")
                          : t("repo.addIntegration")}
                </Button>
            </DialogFooter>
        </form>
    );
}
