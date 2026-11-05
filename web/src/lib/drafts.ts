import { useEffect, useRef } from "react";

const inboxes = new Map<string, (text: string) => void>();
const waiting = new Map<string, string>();

// Text another view hands a thread's reply field (the Preview's picked elements): added to it
// when it is open, kept until it opens otherwise.
export function handToComposer(thread: string, text: string): void {
    const inbox = inboxes.get(thread);
    if (inbox) {
        inbox(text);
        return;
    }
    const before = waiting.get(thread);
    waiting.set(thread, before ? `${before}\n\n${text}` : text);
}

export function useComposerInbox(thread: string, add: (text: string) => void): void {
    const adding = useRef(add);
    adding.current = add;
    useEffect(() => {
        const kept = waiting.get(thread);
        if (kept) {
            waiting.delete(thread);
            adding.current(kept);
        }
        inboxes.set(thread, (text) => adding.current(text));
        return () => {
            inboxes.delete(thread);
        };
    }, [thread]);
}
