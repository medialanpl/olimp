import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api";

// As the API's limits: bytes of one file and files of one message.
export const UPLOAD_MAX = 5 * 1024 * 1024;
export const ATTACHMENTS_MAX = 10;

export interface Attachment {
    key: string;
    name: string;
    size: number;
    // An object URL for an image's thumbnail.
    preview: string | null;
    upload: string | null;
    error: "tooLarge" | "tooMany" | "proxyTooLarge" | string | null;
}

const base64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });

// Stages a file with the API: its upload id goes with the request that uses it.
export const stageFile = (file: File) =>
    base64(file).then((data) =>
        api<{ id: string }>("/api/uploads", {
            method: "POST",
            body: { name: file.name, mediaType: file.type || undefined, data },
        }),
    );

// Each file is staged as soon as it is attached, so sending does not wait for it.
export function useAttachments() {
    const [items, setItems] = useState<Attachment[]>([]);
    const count = useRef(0);
    const patch = useCallback(
        (key: string, change: Partial<Attachment>) =>
            setItems((list) =>
                list.map((item) => (item.key === key ? { ...item, ...change } : item)),
            ),
        [],
    );

    const add = useCallback(
        (files: File[]) => {
            for (const file of files) {
                const key = `${Date.now()}-${count.current++}`;
                const error =
                    file.size > UPLOAD_MAX || !file.size
                        ? "tooLarge"
                        : count.current > ATTACHMENTS_MAX
                          ? "tooMany"
                          : null;
                const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
                setItems((list) => [
                    ...list,
                    { key, name: file.name, size: file.size, preview, upload: null, error },
                ]);
                if (error) continue;
                void stageFile(file).then(
                    (upload) => patch(key, { upload: upload.id }),
                    (failure: unknown) =>
                        patch(key, {
                            // A 413 without our code comes from a reverse proxy's body limit.
                            error:
                                failure instanceof ApiError &&
                                failure.status === 413 &&
                                !failure.code
                                    ? "proxyTooLarge"
                                    : failure instanceof Error
                                      ? failure.message
                                      : String(failure),
                        }),
                );
            }
        },
        [patch],
    );

    const remove = useCallback((key: string) => {
        setItems((list) => {
            const gone = list.find((item) => item.key === key);
            if (gone?.preview) URL.revokeObjectURL(gone.preview);
            return list.filter((item) => item.key !== key);
        });
        count.current = Math.max(0, count.current - 1);
    }, []);

    const clear = useCallback(() => {
        setItems((list) => {
            for (const item of list) if (item.preview) URL.revokeObjectURL(item.preview);
            return [];
        });
        count.current = 0;
    }, []);

    useEffect(() => clear, [clear]);

    return {
        items,
        add,
        remove,
        clear,
        ids: items.flatMap((item) => (item.upload ? [item.upload] : [])),
        busy: items.some((item) => !item.upload && !item.error),
        failed: items.some((item) => item.error),
    };
}

export type Attachments = ReturnType<typeof useAttachments>;
