import { useQuery } from "@tanstack/react-query";
import { KeyRoundIcon, MailCheckIcon, MailIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";
import { AuthHeading, AuthLayout } from "@/components/auth-layout";
import { FormError, Loading } from "@/components/page";
import { FieldSkeleton } from "@/components/skeletons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { passwordCompliant, passwordReady, passwordStrength } from "@/lib/password";

const STRENGTH = {
    weak: ["bg-destructive", "text-destructive"],
    medium: ["bg-warning", "text-warning"],
    strong: ["bg-constructive", "text-constructive"],
} as const;

function PasswordStrength({ password }: { password: string }) {
    const t = useTranslations("web");
    if (!password) return null;
    const { score, label } = passwordStrength(password);
    const [bar, text] = STRENGTH[label];
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("account.strength.label")}</span>
                <span className={`font-medium ${text}`}>{t(`account.strength.${label}`)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={`h-full transition-all ${bar}`} style={{ width: `${score}%` }} />
            </div>
        </div>
    );
}

export function PasswordFields({
    value,
    onChange,
    again,
    onAgain,
}: {
    value: string;
    onChange: (value: string) => void;
    again: string;
    onAgain: (value: string) => void;
}) {
    const t = useTranslations("web");
    const mismatch = again !== "" && again !== value;
    return (
        <>
            <div className="space-y-2">
                <Label htmlFor="new-password">{t("account.newPassword")}</Label>
                <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    aria-describedby="password-rule"
                />
                <PasswordStrength password={value} />
                <p
                    id="password-rule"
                    className={
                        value && !passwordCompliant(value)
                            ? "text-xs text-warning"
                            : "text-xs text-muted-foreground"
                    }
                >
                    {t("account.passwordRule")}
                </p>
            </div>
            <div className="space-y-2">
                <Label htmlFor="new-password-again">{t("account.repeatPassword")}</Label>
                <Input
                    id="new-password-again"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={again}
                    onChange={(e) => onAgain(e.target.value)}
                    aria-invalid={mismatch || undefined}
                />
                {mismatch && <p className="text-xs text-destructive">{t("account.mismatch")}</p>}
            </div>
        </>
    );
}

function SetPasswordSkeleton() {
    return (
        <Loading>
            <div className="mb-6 space-y-2">
                <Skeleton className="h-8 w-64 max-w-full" />
                <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <div className="space-y-4">
                <FieldSkeleton />
                <FieldSkeleton />
                <Skeleton className="h-10 w-full rounded-4xl" />
            </div>
        </Loading>
    );
}

// The page an invitation or a reset link opens: a new password, then the sign-in.
export function SetPasswordPage() {
    const t = useTranslations("web");
    const [params] = useSearchParams();
    const token = params.get("token") ?? "";
    const link = useQuery({
        queryKey: ["link", token],
        queryFn: () =>
            api<{ kind: "invite" | "reset"; email: string; name: string }>("/api/auth/link", {
                method: "POST",
                body: { token },
            }),
        retry: false,
    });
    const [password, setPassword] = useState("");
    const [again, setAgain] = useState("");
    const [done, setDone] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        try {
            await api("/api/auth/password", { method: "POST", body: { token, password } });
            setDone(true);
        } catch (failure) {
            setError(failure);
        }
    };
    return (
        <AuthLayout>
            {link.isPending ? (
                <SetPasswordSkeleton />
            ) : link.isError ? (
                <>
                    <AuthHeading title={t("login.linkInvalid")} />
                    <FormError error={link.error} />
                    <Button asChild variant="outline" className="mt-4">
                        <Link to="/">{t("login.toSignIn")}</Link>
                    </Button>
                </>
            ) : done ? (
                <>
                    <AuthHeading
                        title={t("login.passwordSet")}
                        description={t("login.passwordSetHint")}
                    />
                    <Button asChild size="lg" className="w-full">
                        <Link to="/">{t("login.toSignIn")}</Link>
                    </Button>
                </>
            ) : (
                <>
                    <AuthHeading
                        title={t(
                            link.data.kind === "invite" ? "login.inviteTitle" : "login.resetTitle",
                        )}
                        description={t("login.forAccount", {
                            name: link.data.name,
                            email: link.data.email,
                        })}
                    />
                    <form onSubmit={submit} className="space-y-4">
                        <PasswordFields
                            value={password}
                            onChange={setPassword}
                            again={again}
                            onAgain={setAgain}
                        />
                        <FormError error={error} />
                        <Button
                            type="submit"
                            size="lg"
                            className="w-full"
                            disabled={!passwordReady(password, again)}
                        >
                            <KeyRoundIcon />
                            {t("login.setPassword")}
                        </Button>
                    </form>
                </>
            )}
        </AuthLayout>
    );
}

export function ForgotPasswordPage() {
    const t = useTranslations("web");
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        try {
            await api("/api/auth/forgot", { method: "POST", body: { email } });
            setSent(true);
        } catch (failure) {
            setError(failure);
        }
    };
    return (
        <AuthLayout>
            <AuthHeading title={t("login.forgotTitle")} description={t("login.forgotHint")} />
            {sent ? (
                <Alert variant="info" role="status">
                    <MailCheckIcon />
                    <AlertDescription>{t("login.forgotSent")}</AlertDescription>
                </Alert>
            ) : (
                <form onSubmit={submit} className="space-y-4">
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
                    <FormError error={error} />
                    <Button type="submit" size="lg" className="w-full" disabled={!email}>
                        <MailIcon />
                        {t("login.sendLink")}
                    </Button>
                </form>
            )}
            <Link
                to="/"
                className="mt-6 block text-center text-sm text-muted-foreground hover:text-primary"
            >
                {t("login.back")}
            </Link>
        </AuthLayout>
    );
}
