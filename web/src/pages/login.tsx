import { InfoIcon, LogInIcon, MailIcon, ShieldCheckIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { AuthHeading, AuthLayout } from "@/components/auth-layout";
import { FormError } from "@/components/page";
import { TotpSetup } from "@/components/totp-setup";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Method = "app" | "email" | "setup";

function useSubmit<T>(work: () => Promise<T>, then: (value: T) => void) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const submit = async (event?: FormEvent) => {
        event?.preventDefault();
        setPending(true);
        setError(null);
        try {
            then(await work());
        } catch (failure) {
            setError(failure);
        } finally {
            setPending(false);
        }
    };
    return { submit, pending, error };
}

function SecondFactor({ method, onBack }: { method: "app" | "email"; onBack: () => void }) {
    const t = useTranslations("web");
    const { refresh } = useAuth();
    const [code, setCode] = useState("");
    const [resent, setResent] = useState(false);
    const verify = useSubmit(
        () => api("/api/auth/two-factor", { method: "POST", body: { code: code.trim() } }),
        () => void refresh(),
    );
    const resend = useSubmit(
        () => api("/api/auth/two-factor/email", { method: "POST" }),
        () => setResent(true),
    );
    return (
        <>
            <AuthHeading
                title={t("login.codeTitle")}
                description={t(method === "app" ? "login.codeApp" : "login.codeEmail")}
            />
            <form onSubmit={verify.submit} className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="code">{t("account.code")}</Label>
                    <Input
                        id="code"
                        autoFocus
                        inputMode={method === "email" ? "numeric" : "text"}
                        autoComplete="one-time-code"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        className="font-mono tracking-widest"
                    />
                    {method === "app" && (
                        <p className="text-xs text-muted-foreground">{t("login.backupHint")}</p>
                    )}
                </div>
                <FormError error={verify.error ?? resend.error} />
                {resent && <p className="text-sm text-constructive">{t("login.resent")}</p>}
                <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={verify.pending || !code.trim()}
                >
                    <ShieldCheckIcon />
                    {t("login.verify")}
                </Button>
                <div className="flex justify-between gap-2 text-sm">
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-primary"
                        onClick={onBack}
                    >
                        {t("login.back")}
                    </button>
                    {method === "email" && (
                        <button
                            type="button"
                            className="flex items-center gap-1 text-muted-foreground hover:text-primary"
                            disabled={resend.pending}
                            onClick={() => void resend.submit()}
                        >
                            <MailIcon className="size-4" />
                            {t("login.resend")}
                        </button>
                    )}
                </div>
            </form>
        </>
    );
}

// No app and no e-mail: the second factor is mandatory, so the app is set up right here.
function SetupApp() {
    const t = useTranslations("web");
    const { refresh } = useAuth();
    const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
    const start = useSubmit(
        () =>
            api<{ secret: string; uri: string }>("/api/auth/two-factor/setup", { method: "POST" }),
        setSetup,
    );
    return (
        <>
            <AuthHeading title={t("login.setupTitle")} description={t("login.setupHint")} />
            {setup ? (
                <TotpSetup
                    setup={setup}
                    enable={async (code) =>
                        (
                            await api<{ backupCodes: string[] }>("/api/auth/two-factor/enable", {
                                method: "POST",
                                body: { secret: setup.secret, code },
                            })
                        ).backupCodes
                    }
                    onDone={() => void refresh()}
                />
            ) : (
                <>
                    <FormError error={start.error} />
                    <Button
                        size="lg"
                        className="w-full"
                        disabled={start.pending}
                        onClick={() => void start.submit()}
                    >
                        <ShieldCheckIcon />
                        {t("login.setupStart")}
                    </Button>
                </>
            )}
        </>
    );
}

export function LoginPage({ reason }: { reason: "none" | "expired" }) {
    const t = useTranslations("web");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [method, setMethod] = useState<Method | null>(null);
    const login = useSubmit(
        async () =>
            (
                await api<{ method: Method }>("/api/auth/login", {
                    method: "POST",
                    body: { email, password },
                })
            ).method,
        (next) => {
            setPassword("");
            setMethod(next);
        },
    );
    return (
        <AuthLayout>
            {method === "setup" ? (
                <SetupApp />
            ) : method ? (
                <SecondFactor method={method} onBack={() => setMethod(null)} />
            ) : (
                <>
                    <AuthHeading title={t("login.title")} description={t("login.description")} />
                    <form onSubmit={login.submit} className="space-y-4">
                        {reason === "expired" && (
                            <Alert variant="info" role="status">
                                <InfoIcon />
                                <AlertDescription>{t("login.expired")}</AlertDescription>
                            </Alert>
                        )}
                        <div className="space-y-2">
                            <Label htmlFor="email">{t("login.email")}</Label>
                            <Input
                                id="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">{t("login.password")}</Label>
                                <Link
                                    to="/forgot-password"
                                    className="text-xs text-muted-foreground hover:text-primary"
                                >
                                    {t("login.forgot")}
                                </Link>
                            </div>
                            <Input
                                id="password"
                                type="password"
                                autoComplete="current-password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                        <FormError error={login.error} />
                        <Button
                            type="submit"
                            size="lg"
                            className="mt-2 w-full"
                            disabled={login.pending || !email || !password}
                        >
                            <LogInIcon />
                            {t("login.submit")}
                        </Button>
                    </form>
                </>
            )}
        </AuthLayout>
    );
}
