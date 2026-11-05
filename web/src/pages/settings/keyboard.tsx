import { RotateCcwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
    comboOf,
    DEFAULTS,
    keysOf,
    recordable,
    SHORTCUTS,
    type Shortcut,
    setShortcut,
    useKeyMap,
} from "@/lib/shortcuts";

export function Keyboard() {
    const t = useTranslations("web");
    const keyMap = useKeyMap();
    const [recording, setRecording] = useState<Shortcut | null>(null);
    const [error, setError] = useState<{ id: Shortcut; text: string } | null>(null);

    useEffect(() => {
        if (!recording) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Tab") return;
            // Capture on window, so the panel's own shortcuts do not fire while the keys are recorded.
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.key === "Escape") return setRecording(null);
            const combo = comboOf(e);
            if (!combo) return;
            if (!recordable(combo)) {
                setError({ id: recording, text: t("settings.shortcutPlain") });
                return;
            }
            const taken = SHORTCUTS.find((id) => id !== recording && keyMap[id] === combo);
            if (taken) {
                setError({
                    id: recording,
                    text: t("settings.shortcutTaken", { name: t(`settings.shortcut.${taken}`) }),
                });
                return;
            }
            setShortcut(recording, combo);
            setRecording(null);
            setError(null);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [recording, keyMap, t]);

    return (
        <div className="grid max-w-3xl gap-6 mx-auto">
            <Card>
                <CardHeader>
                    <CardTitle>{t("settings.shortcuts")}</CardTitle>
                    <CardDescription>{t("settings.shortcutsHint")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <ul className="divide-y rounded-lg border">
                        {SHORTCUTS.map((id) => {
                            const name = t(`settings.shortcut.${id}`);
                            return (
                                <li key={id} className="grid gap-1 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        {name}
                                        <div className="flex items-center gap-1">
                                            {keyMap[id] !== DEFAULTS[id] && (
                                                <Button
                                                    variant="ghost"
                                                    size="icon-sm"
                                                    aria-label={t("settings.shortcutReset")}
                                                    title={t("settings.shortcutReset")}
                                                    onClick={() => {
                                                        setShortcut(id, null);
                                                        setError(null);
                                                    }}
                                                >
                                                    <RotateCcwIcon />
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                aria-label={t("settings.shortcutChange", { name })}
                                                aria-pressed={recording === id}
                                                onClick={() => {
                                                    setRecording(recording === id ? null : id);
                                                    setError(null);
                                                }}
                                                onBlur={() => setRecording(null)}
                                            >
                                                {recording === id ? (
                                                    t("settings.shortcutRecord")
                                                ) : (
                                                    <KbdGroup>
                                                        {keysOf(keyMap[id]).map((k) => (
                                                            <Kbd
                                                                key={k}
                                                                className="border bg-background text-foreground"
                                                            >
                                                                {k}
                                                            </Kbd>
                                                        ))}
                                                    </KbdGroup>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                    {error?.id === id && (
                                        <p className="text-xs text-destructive">{error.text}</p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}
