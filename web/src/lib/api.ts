// The panel signs in with a session cookie the API sets (HttpOnly, SameSite=Strict), so no
// credential is ever readable here.
let locale = "en";
const unauthorized = new Set<() => void>();

export function setApiLocale(value: string): void {
    locale = value;
}

// Called when the API refuses the session, e.g. once it expired.
export function onUnauthorized(listener: () => void): () => void {
    unauthorized.add(listener);
    return () => unauthorized.delete(listener);
}

export function reportUnauthorized(): void {
    for (const listener of unauthorized) listener();
}

export class ApiError extends Error {
    readonly status: number;
    readonly code: string | null;
    constructor(status: number, message: string, code: string | null) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export function headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
        "accept-language": locale,
        ...extra,
    };
}

// Every write carries a JSON body: the API refuses other content types on non-GET requests.
export async function api<T>(path: string, init: { method?: string; body?: object } = {}) {
    const method = init.method ?? "GET";
    const write = method !== "GET";
    const res = await fetch(path, {
        method,
        headers: headers(write ? { "content-type": "application/json" } : {}),
        body: write ? JSON.stringify(init.body ?? {}) : undefined,
        cache: "no-store",
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
        const { error, code } = (payload ?? {}) as { error?: string; code?: string };
        if (res.status === 401 && path !== "/api/me" && !path.startsWith("/api/auth/"))
            reportUnauthorized();
        // A proxy's error page has no JSON, and over HTTP/2 no status text either.
        throw new ApiError(
            res.status,
            error ?? (res.statusText || `HTTP ${res.status}`),
            code ?? null,
        );
    }
    return payload as T;
}

// A repository id keeps its slash in API paths.
export const repoPath = (repo: string) => repo.split("/").map(encodeURIComponent).join("/");
