import { SmartphoneIcon } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { notifyEnabled, setNotifyEnabled } from "@/lib/notify";

const supported = typeof Notification !== "undefined";

export function Notifications() {
    const t = useTranslations("web");
    const [on, setOn] = useState(notifyEnabled);
    const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
    const toggle = async (next: boolean) => {
        if (next && Notification.permission !== "granted") {
            const answer = await Notification.requestPermission();
            setPermission(answer);
            if (answer !== "granted") return;
        }
        setNotifyEnabled(next);
        setOn(next);
    };
    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <Alert variant="info" role="note">
                <SmartphoneIcon />
                <AlertTitle>{t("settings.phoneTitle")}</AlertTitle>
                <AlertDescription>{t("settings.phoneHint")}</AlertDescription>
            </Alert>
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.notifyTitle")}</CardTitle>
                    <CardDescription>{t("settings.notifyHint")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="notify"
                            checked={on}
                            disabled={!supported || permission === "denied"}
                            onCheckedChange={(next) => void toggle(next)}
                        />
                        <Label htmlFor="notify">{t("settings.notifyLabel")}</Label>
                    </div>
                    {(!supported || permission === "denied") && (
                        <p className="text-sm text-warning">{t("settings.notifyBlocked")}</p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
