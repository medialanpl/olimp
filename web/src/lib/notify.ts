const KEY = "olimp.notify";

// Kept per browser, like the theme; off unless turned on.
export function notifyEnabled(): boolean {
    try {
        return localStorage.getItem(KEY) === "on" && Notification.permission === "granted";
    } catch {
        return false;
    }
}

export function setNotifyEnabled(on: boolean): void {
    try {
        if (on) localStorage.setItem(KEY, "on");
        else localStorage.removeItem(KEY);
    } catch {}
}
