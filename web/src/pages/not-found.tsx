import { Link } from "react-router";
import { useTranslations } from "use-intl";
import { OlimpMark } from "@/components/logo";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
    const t = useTranslations("web");
    return (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
            <OlimpMark className="size-12 text-muted-foreground" />
            <h1 className="text-xl font-semibold">{t("notFound.title")}</h1>
            <Button asChild variant="outline">
                <Link to="/tasks">{t("notFound.back")}</Link>
            </Button>
        </div>
    );
}
