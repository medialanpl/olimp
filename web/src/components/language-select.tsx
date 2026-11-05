import { type SVGProps, useId } from "react";
import { useTranslations } from "use-intl";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { LOCALES, type Locale, useLocale } from "@/lib/i18n";

// Decorative: the language's name stands next to its flag.
function FlagGB(props: SVGProps<SVGSVGElement>) {
    const id = useId();
    return (
        <svg viewBox="0 0 60 30" width="20" height="15" aria-hidden="true" {...props}>
            <clipPath id={`${id}s`}>
                <path d="M0,0 v30 h60 v-30 z" />
            </clipPath>
            <clipPath id={`${id}t`}>
                <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
            </clipPath>
            <g clipPath={`url(#${id}s)`}>
                <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
                <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
                <path
                    d="M0,0 L60,30 M60,0 L0,30"
                    clipPath={`url(#${id}t)`}
                    stroke="#C8102E"
                    strokeWidth="4"
                />
                <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
                <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
            </g>
        </svg>
    );
}

function FlagPL(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 640 480" width="20" height="15" aria-hidden="true" {...props}>
            <g fillRule="evenodd">
                <path fill="#fff" d="M640 480H0V0h640z" />
                <path fill="#dc143c" d="M640 480H0V240h640z" />
            </g>
        </svg>
    );
}

const FLAGS: Record<Locale, typeof FlagPL> = { en: FlagGB, pl: FlagPL };

export function LanguageSelect({ className }: { className?: string }) {
    const t = useTranslations("web");
    const { locale, setLocale } = useLocale();
    return (
        <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
            <SelectTrigger size="sm" className={className} aria-label={t("header.language")}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {LOCALES.map((value) => {
                    const Flag = FLAGS[value];
                    return (
                        <SelectItem key={value} value={value}>
                            <Flag />
                            {t(`language.${value}`)}
                        </SelectItem>
                    );
                })}
            </SelectContent>
        </Select>
    );
}
