"use client";

import { Check, Loader2, X } from "lucide-react";
import type { PagePreviews } from "@/lib/usePagePreviews";

/** "1-3,5" to a set of page numbers. Anything unreadable is left for the server to explain. */
function parsePages(text: string, total: number) {
    const selected = new Set<number>();
    for (const part of text.split(",")) {
        const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
        if (!match) continue;
        const end = Math.min(Number(match[2] ?? match[1]), total);
        for (let page = Number(match[1]); page <= end; page += 1) selected.add(page);
    }
    return selected;
}

function formatPages(selected: Set<number>) {
    const sorted = [...selected].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length; i += 1) {
        const start = sorted[i];
        while (sorted[i + 1] === sorted[i] + 1) i += 1;
        parts.push(start === sorted[i] ? `${start}` : `${start}-${sorted[i]}`);
    }
    return parts.join(",");
}

type PagePickerProps = {
    previews: PagePreviews;
    value: string;
    onChange: (value: string) => void;
    mode: "remove" | "keep";
};

export function PagePicker({ previews, value, onChange, mode }: PagePickerProps) {
    if (previews.loading) {
        return <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto mt-8" aria-label="Loading pages" />;
    }
    if (previews.error) {
        return <p className="mt-4 rounded-xl bg-danger-soft text-danger px-4 py-3 text-sm">{previews.error}</p>;
    }

    const selected = parsePages(value, previews.total);
    const Mark = mode === "remove" ? X : Check;

    function toggle(page: number) {
        const next = new Set(selected);
        if (next.has(page)) next.delete(page);
        else next.add(page);
        onChange(formatPages(next));
    }

    return (
        <div className="mt-6">
            <label className="block text-sm font-medium mb-2">
                {mode === "remove" ? "Pages to remove" : "Pages to keep"}
                <input
                    className="input mt-2 !font-normal"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder="Click pages below, or type 1-3,5"
                />
            </label>
            {previews.total > previews.pages.length && (
                <p className="text-xs text-ink-3 mt-2">
                    Showing the first {previews.pages.length} of {previews.total} pages. Type page numbers for the rest.
                </p>
            )}
            <ol className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-3">
                {previews.pages.map((preview, index) => {
                    const page = index + 1;
                    const active = selected.has(page);
                    return (
                        <li key={page}>
                            <button
                                type="button"
                                aria-pressed={active}
                                aria-label={`Page ${page}`}
                                onClick={() => toggle(page)}
                                className={`relative block w-full rounded-lg border-2 overflow-hidden transition-colors ${
                                    active
                                        ? mode === "remove"
                                            ? "border-danger"
                                            : "border-accent"
                                        : "border-line hover:border-line-strong"
                                }`}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={preview.image}
                                    alt=""
                                    className={`block w-full ${active && mode === "remove" ? "opacity-40" : ""}`}
                                />
                                {active && (
                                    <span
                                        className={`absolute top-1 right-1 w-5 h-5 rounded-full text-white flex items-center justify-center ${
                                            mode === "remove" ? "bg-danger" : "bg-accent"
                                        }`}
                                    >
                                        <Mark className="w-3 h-3" aria-hidden />
                                    </span>
                                )}
                            </button>
                            <span className="block text-center text-xs text-ink-3 mt-1">{page}</span>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
