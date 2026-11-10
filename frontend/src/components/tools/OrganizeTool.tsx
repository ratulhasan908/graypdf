"use client";

import { DragEvent, useState } from "react";
import { Copy, Loader2, Trash2 } from "lucide-react";
import ToolLayout, { FormError } from "@/components/ToolLayout";
import { FileCard, FilePicker } from "@/components/tools/FilePicker";
import { apiUpload, getErrorMessage } from "@/lib/api";
import { getToolBySlug } from "@/lib/tools";
import { usePagePreviews } from "@/lib/usePagePreviews";
import { useToolJob } from "@/lib/useToolJob";

function sequence(total: number) {
    return Array.from({ length: total }, (_, index) => index + 1);
}

export function OrganizeTool() {
    const run = useToolJob(getToolBySlug("organize-pdf")?.endpoint ?? "");
    const [file, setFile] = useState<File | null>(null);
    const [total, setTotal] = useState(0);
    const [order, setOrder] = useState<number[]>([]);
    const [reading, setReading] = useState(false);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const previews = usePagePreviews(50);

    function clear() {
        previews.clear();
        setFile(null);
        setTotal(0);
        setOrder([]);
    }

    async function loadFile(chosen: File) {
        run.setError(null);
        setFile(chosen);
        setReading(true);
        try {
            const body = new FormData();
            body.append("files", chosen);
            const { pages } = await apiUpload<{ pages: number }>("/tools/page-count/", body);
            setTotal(pages);
            setOrder(sequence(pages));
            previews.load(chosen);
        } catch (err: unknown) {
            run.setError(getErrorMessage(err, "Could not read this PDF."));
            clear();
        } finally {
            setReading(false);
        }
    }

    function handleDragOver(event: DragEvent<HTMLLIElement>, index: number) {
        event.preventDefault();
        if (dragIndex === null || dragIndex === index) return;
        const next = [...order];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(index, 0, moved);
        setOrder(next);
        setDragIndex(index);
    }

    function handleSubmit() {
        if (!file) return;
        const body = new FormData();
        body.append("files", file);
        body.append("order", JSON.stringify(order));
        run.submit(body);
    }

    const iconButton = "p-1 rounded-md text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors";

    return (
        <ToolLayout slug="organize-pdf" run={run} wide onReset={clear}>
            {!file && (
                <FilePicker extensions={[".pdf"]} label="Choose a PDF" onFiles={([chosen]) => loadFile(chosen)} onError={run.setError} />
            )}
            {file && (
                <FileCard file={file} detail={reading ? "Reading pages…" : `${total} pages`} onRemove={clear} />
            )}
            {reading && <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto mt-8" aria-label="Reading pages" />}
            {file && !reading && total > 0 && (
                <>
                    <div className="flex items-center justify-between mt-6 mb-3">
                        <p className="text-sm text-ink-2">
                            Drag pages to reorder. {order.length} of {total} pages kept.
                        </p>
                        <button type="button" onClick={() => setOrder(sequence(total))} className="text-sm text-accent hover:underline">
                            Reset
                        </button>
                    </div>
                    <ol className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                        {order.map((page, index) => (
                            <li
                                key={`${page}-${index}`}
                                draggable
                                onDragStart={() => setDragIndex(index)}
                                onDragOver={(event) => handleDragOver(event, index)}
                                onDragEnd={() => setDragIndex(null)}
                                className={`card aspect-[1/1.3] flex flex-col cursor-grab active:cursor-grabbing transition-opacity ${
                                    dragIndex === index ? "opacity-40" : ""
                                }`}
                            >
                                <span className="relative flex-1 min-h-0 flex items-center justify-center text-xl font-semibold text-ink-2 p-1.5">
                                    {previews.pages[page - 1] ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={previews.pages[page - 1].image}
                                            alt={`Page ${page}`}
                                            draggable={false}
                                            className="max-w-full max-h-full border border-line"
                                        />
                                    ) : (
                                        page
                                    )}
                                </span>
                                <span className="text-center text-xs text-ink-3">{page}</span>
                                <span className="flex justify-center gap-1 pb-1.5">
                                    <button
                                        type="button"
                                        className={iconButton}
                                        aria-label={`Duplicate page ${page}`}
                                        onClick={() => setOrder([...order.slice(0, index + 1), page, ...order.slice(index + 1)])}
                                    >
                                        <Copy className="w-3.5 h-3.5" aria-hidden />
                                    </button>
                                    <button
                                        type="button"
                                        className={iconButton}
                                        aria-label={`Delete page ${page}`}
                                        onClick={() => setOrder(order.filter((_, i) => i !== index))}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" aria-hidden />
                                    </button>
                                </span>
                            </li>
                        ))}
                    </ol>
                    <button
                        type="button"
                        disabled={order.length === 0}
                        onClick={handleSubmit}
                        className="btn btn-primary btn-lg w-full mt-6"
                    >
                        Save new PDF
                    </button>
                </>
            )}
            <FormError run={run} />
        </ToolLayout>
    );
}
