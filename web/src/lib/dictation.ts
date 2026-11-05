import { useCallback, useEffect, useRef, useState } from "react";

// The few parts of the Web Speech API used here; TypeScript's DOM types leave it out.
interface Recognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: RecognitionEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
}

interface RecognitionEvent {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | null {
    const w = window as unknown as {
        SpeechRecognition?: RecognitionClass;
        webkitSpeechRecognition?: RecognitionClass;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Why dictation cannot start: no Web Speech API (Firefox, Safari without it), or no https.
export type DictationBlock = "unsupported" | "insecure" | null;

export const dictationBlock = (): DictationBlock =>
    !recognitionClass() ? "unsupported" : !window.isSecureContext ? "insecure" : null;

// The microphone's loudness for the orb, 0 to 1, from a stream of its own beside the recognition.
async function meter(): Promise<{ read: () => number; stop: () => void } | null> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buffer = new Float32Array(analyser.fftSize);
        return {
            read: () => {
                analyser.getFloatTimeDomainData(buffer);
                let sum = 0;
                for (const v of buffer) sum += v * v;
                return Math.min(1, Math.max(0, Math.sqrt(sum / buffer.length) - 0.01) * 6);
            },
            stop: () => {
                for (const track of stream.getTracks()) track.stop();
                void ctx.close();
            },
        };
    } catch {
        return null;
    }
}

// Dictation: the browser listens until stopped, the text grows as it hears, and the caller
// inserts it (or inserts and sends) when done.
export function useDictation(lang: string) {
    const [listening, setListening] = useState(false);
    const [text, setText] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [seconds, setSeconds] = useState(0);
    const recognition = useRef<Recognition | null>(null);
    const level = useRef<{ read: () => number; stop: () => void } | null>(null);
    const heard = useRef("");
    const wanted = useRef(false);

    const release = useCallback(() => {
        wanted.current = false;
        recognition.current?.abort();
        recognition.current = null;
        level.current?.stop();
        level.current = null;
        setListening(false);
    }, []);

    useEffect(() => release, [release]);

    useEffect(() => {
        if (!listening) return;
        const started = Date.now();
        const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
        return () => clearInterval(timer);
    }, [listening]);

    const start = useCallback(async () => {
        const Class = recognitionClass();
        if (!Class || recognition.current) return;
        const r = new Class();
        r.lang = lang;
        r.continuous = true;
        r.interimResults = true;
        heard.current = "";
        setText("");
        setError(null);
        setSeconds(0);
        r.onresult = (event) => {
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (!result) continue;
                if (result.isFinal) heard.current += `${result[0].transcript} `;
                else interim += result[0].transcript;
            }
            setText(`${heard.current}${interim}`.trim());
        };
        r.onerror = (event) => {
            if (event.error === "no-speech" || event.error === "aborted") return;
            setError(event.error);
            release();
        };
        // Chrome ends a session after a pause; it goes on until the user stops.
        r.onend = () => {
            if (wanted.current && recognition.current === r) r.start();
        };
        recognition.current = r;
        wanted.current = true;
        setListening(true);
        r.start();
        level.current = await meter();
    }, [lang, release]);

    // The heard text, with what was still being recognised.
    const finish = useCallback(() => {
        const result = text.trim();
        release();
        return result;
    }, [text, release]);

    const volume = useCallback(() => level.current?.read() ?? 0, []);

    return { listening, text, error, seconds, start, finish, cancel: release, volume };
}
