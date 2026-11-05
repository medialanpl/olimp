import { useQueryClient } from "@tanstack/react-query";
import {
    createContext,
    type ReactNode,
    use,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import { ApiError, api, onUnauthorized } from "./api";
import type { Me } from "./types";

// open: OLIMP has no accounts and trusts loopback, so the panel needs no sign-in.
export type Session =
    | { status: "loading" }
    | { status: "open" }
    | { status: "signedIn"; user: Me }
    | { status: "signedOut"; reason: "none" | "expired" }
    | { status: "error"; message: string };

interface AuthValue {
    session: Session;
    // Asks the API again, e.g. after the second factor or after the first account was made.
    refresh: () => Promise<Session>;
    signOut: () => void;
    retry: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
    const value = use(AuthContext);
    if (!value) throw new Error("useAuth outside AuthProvider");
    return value;
}

// The signed-in account, or null without accounts.
export function useMe(): Me | null {
    const { session } = useAuth();
    return session.status === "signedIn" ? session.user : null;
}

async function probe(): Promise<Session> {
    try {
        return { status: "signedIn", user: await api<Me>("/api/me") };
    } catch (error) {
        if (error instanceof ApiError && error.code === "account.none") return { status: "open" };
        if (error instanceof ApiError && error.status === 401)
            return { status: "signedOut", reason: "none" };
        return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const [session, setSession] = useState<Session>({ status: "loading" });

    const refresh = useCallback(async () => {
        const next = await probe();
        setSession(next);
        return next;
    }, []);

    const signOut = useCallback(
        (reason: "none" | "expired" = "none") => {
            void api("/api/auth/logout", { method: "POST" }).catch(() => {});
            queryClient.clear();
            setSession({ status: "signedOut", reason });
        },
        [queryClient],
    );

    useEffect(() => {
        void refresh();
        return onUnauthorized(() => signOut("expired"));
    }, [refresh, signOut]);

    const value = useMemo<AuthValue>(
        () => ({
            session,
            refresh: async () => {
                queryClient.clear();
                return refresh();
            },
            signOut: () => signOut(),
            retry: () => {
                setSession({ status: "loading" });
                void refresh();
            },
        }),
        [session, refresh, signOut, queryClient],
    );
    return <AuthContext value={value}>{children}</AuthContext>;
}
