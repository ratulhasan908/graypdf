"use client";

import { useCallback, useRef, useState } from "react";
import { apiUpload, getErrorMessage } from "@/lib/api";

export type PagePreview = { width: number; height: number; image: string };

/** Fetch page images for a chosen file. Nothing is kept on the server. */
export function usePagePreviews(dpi: number) {
    const [pages, setPages] = useState<PagePreview[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const latest = useRef(0);

    const clear = useCallback(() => {
        latest.current += 1;
        setPages([]);
        setTotal(0);
        setLoading(false);
        setError(null);
    }, []);

    const load = useCallback(
        async (file: File) => {
            const request = ++latest.current;
            setPages([]);
            setTotal(0);
            setError(null);
            setLoading(true);
            try {
                const body = new FormData();
                body.append("files", file);
                body.append("dpi", String(dpi));
                const result = await apiUpload<{ total: number; pages: PagePreview[] }>("/tools/page-previews/", body);
                if (request !== latest.current) return;
                setPages(result.pages);
                setTotal(result.total);
            } catch (err: unknown) {
                if (request === latest.current) setError(getErrorMessage(err, "Could not read this PDF."));
            } finally {
                if (request === latest.current) setLoading(false);
            }
        },
        [dpi]
    );

    return { pages, total, loading, error, load, clear };
}

export type PagePreviews = ReturnType<typeof usePagePreviews>;
