"use client";

import { PointerEventHandler, ReactNode, RefObject } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { PagePreviews } from "@/lib/usePagePreviews";

type PageStageProps = {
    previews: PagePreviews;
    page: number;
    onPage: (page: number) => void;
    stageRef?: RefObject<HTMLDivElement | null>;
    onPointerDown?: PointerEventHandler<HTMLDivElement>;
    onPointerMove?: PointerEventHandler<HTMLDivElement>;
    onPointerUp?: PointerEventHandler<HTMLDivElement>;
    cursor?: string;
    children?: ReactNode;
};

/** One large page with overlays on top, for tools that point at the page. */
export function PageStage({
    previews,
    page,
    onPage,
    stageRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    cursor = "cursor-crosshair",
    children,
}: PageStageProps) {
    if (previews.loading) {
        return <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto my-10" aria-label="Loading pages" />;
    }
    if (previews.error) {
        return <p className="rounded-xl bg-danger-soft text-danger px-4 py-3 text-sm">{previews.error}</p>;
    }
    const preview = previews.pages[page - 1];
    if (!preview) return null;
    const count = previews.pages.length;

    return (
        <div>
            <div className="flex items-center justify-center gap-2 mb-2">
                <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => onPage(page - 1)}
                    aria-label="Previous page"
                    className="btn btn-ghost !p-1.5"
                >
                    <ChevronLeft className="w-4 h-4" aria-hidden />
                </button>
                <span className="text-sm text-ink-2 tabular-nums">
                    Page {page} of {count}
                </span>
                <button
                    type="button"
                    disabled={page >= count}
                    onClick={() => onPage(page + 1)}
                    aria-label="Next page"
                    className="btn btn-ghost !p-1.5"
                >
                    <ChevronRight className="w-4 h-4" aria-hidden />
                </button>
            </div>
            <div
                ref={stageRef}
                data-testid="page-stage"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={`relative mx-auto border border-line-strong select-none touch-none overflow-hidden ${cursor}`}
                style={{ aspectRatio: `${preview.width} / ${preview.height}`, maxWidth: 560 }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.image} alt={`Page ${page}`} draggable={false} className="block w-full h-full" />
                {children}
            </div>
            {previews.total > count && (
                <p className="text-xs text-ink-3 mt-2 text-center">Showing the first {count} of {previews.total} pages.</p>
            )}
        </div>
    );
}
