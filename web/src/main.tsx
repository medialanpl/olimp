import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { ApiError } from "@/lib/api";
import { AuthProvider } from "@/lib/auth";
import { LocaleProvider } from "@/lib/i18n";
import { applySavedTheme, ThemeProvider } from "@/lib/theme";
import "@fontsource-variable/inter";
import "./styles.css";

applySavedTheme();

// Live events keep the lists fresh, so nothing refetches on focus; client errors are not retried.
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, error) =>
                !(error instanceof ApiError && error.status < 500) && count < 2,
        },
    },
});

createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
        <ThemeProvider>
            <LocaleProvider>
                <QueryClientProvider client={queryClient}>
                    <AuthProvider>
                        <App />
                    </AuthProvider>
                </QueryClientProvider>
            </LocaleProvider>
        </ThemeProvider>
    </StrictMode>,
);
