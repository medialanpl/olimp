import { ShieldCheckIcon } from "lucide-react";
import QRCode from "qrcode";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { CopyButton } from "@/components/copy-button";
import { FormError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Shown once: the API keeps only their hashes.
export function BackupCodes({ codes }: { codes: string[] }) {
    const t = useTranslations("web");
    return (
        <div className="space-y-2">
            <p className="text-sm font-medium">{t("account.backupCodes")}</p>
            <p className="text-xs text-muted-foreground">{t("account.backupCodesHint")}</p>
            <div className="grid gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-2">
                {codes.map((code) => (
                    <code key={code} className="rounded bg-background px-2 py-1 text-sm">
                        {code}
                    </code>
                ))}
            </div>
            <CopyButton value={codes.join("\n")} label={t("account.copyCodes")} />
        </div>
    );
}

// Corivo's setup: a QR code and the key for an authenticator app, then a code from it to turn it
// on; the API answers with the backup codes.
export function TotpSetup({
    setup,
    enable,
    onDone,
}: {
    setup: { secret: string; uri: string };
    enable: (code: string) => Promise<string[]>;
    onDone: () => void;
}) {
    const t = useTranslations("web");
    const [qr, setQr] = useState<string | null>(null);
    const [code, setCode] = useState("");
    const [error, setError] = useState<unknown>(null);
    const [pending, setPending] = useState(false);
    const [codes, setCodes] = useState<string[] | null>(null);
    useEffect(() => {
        void QRCode.toDataURL(setup.uri, { margin: 1, width: 224 }).then(setQr);
    }, [setup.uri]);
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
            setCodes(await enable(code.trim()));
        } catch (failure) {
            setError(failure);
        } finally {
            setPending(false);
        }
    };
    if (codes)
        return (
            <div className="space-y-4">
                <p className="rounded-md border border-constructive/30 bg-constructive/10 p-3 text-sm text-constructive">
                    {t("account.appEnabled")}
                </p>
                <BackupCodes codes={codes} />
                <Button onClick={onDone}>{t("account.codesSaved")}</Button>
            </div>
        );
    return (
        <div className="grid gap-6 sm:grid-cols-[minmax(0,180px)_1fr]">
            <div className="flex aspect-square items-center justify-center rounded-md border bg-white p-2">
                {qr && <img src={qr} alt={t("account.qrAlt")} className="size-full" />}
            </div>
            <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t("account.scan")}</p>
                <div className="space-y-2">
                    <p className="text-sm font-medium">{t("account.manualKey")}</p>
                    <code className="block rounded-md bg-muted p-2 text-xs break-all">
                        {setup.secret}
                    </code>
                    <CopyButton value={setup.secret} label={t("account.copy")} />
                </div>
                <form onSubmit={submit} className="space-y-2">
                    <Label htmlFor="totp-code">{t("account.code")}</Label>
                    <Input
                        id="totp-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="w-32 font-mono tracking-widest"
                    />
                    <FormError error={error} />
                    <Button type="submit" disabled={pending || code.trim().length !== 6}>
                        <ShieldCheckIcon />
                        {t("account.verifyAndEnable")}
                    </Button>
                </form>
            </div>
        </div>
    );
}
