import { useTranslations } from "use-intl";
import { useMe } from "@/lib/auth";
import { shortId } from "@/lib/format";
import { useMachine, useUsers } from "@/lib/queries";

// Account names come from GET /api/users, which only an admin may read; others see their own name
// and the ids of the rest. Without accounts every task is the machine's, named by its user.
export function useAuthorName(): (id: string | null) => string {
    const t = useTranslations("web");
    const me = useMe();
    const users = useUsers(me?.role === "admin");
    const machine = useMachine(false).data;
    return (id) => {
        if (!id) return (!me && machine?.user) || t("common.nobody");
        if (id === me?.id) return me.name;
        return users.data?.find((user) => user.id === id)?.name ?? shortId(id);
    };
}
