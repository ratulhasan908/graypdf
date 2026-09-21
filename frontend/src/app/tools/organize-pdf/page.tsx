"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    LayoutGrid,
    Upload,
    FileText,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    X,
    Copy,
    GripVertical,
} from "lucide-react";
import { apiUpload, apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import ToolLayout from "@/components/ToolLayout";

type Job = {
    id: string;
    tool: string;
    status: "pending" | "processing" | "completed" | "failed";
    output_file: string | null;
    download_url: string | null;
    error_message: string | null;
};

export default function OrganizePdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [totalPages, setTotalPages] = useState<number | null>(null);
    const [order, setOrder] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [readingPdf, setReadingPdf] = useState(false);
    const [job, setJob] = useState<Job | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { refreshUsage } = useAuth();

    async function loadFile(f: File) {
        if (!f.name.toLowerCase().endsWith(".pdf")) {
            setError("Please upload a PDF file.");
            return;
        }
        setError(null);
        setJob(null);
        setFile(f);
        setTotalPages(null);
        setOrder([]);
        setReadingPdf(true);

        try {
            const formData = new FormData();
            formData.append("files", f);
            const res = await apiUpload<{ pages: number }>(
                "/tools/page-count/",
                formData
            );
            setTotalPages(res.pages);
            setOrder(Array.from({ length: res.pages }, (_, i) => i + 1));
        } catch (err: any) {
            setError(err.message || "Could not read PDF.");
            setFile(null);
        } finally {
            setReadingPdf(false);
        }
    }

    function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0];
        if (f) loadFile(f);
    }

    function handleDrop(e: DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragActive(false);
        const f = e.dataTransfer.files?.[0];
        if (f) loadFile(f);
    }

    function removePage(index: number) {
        setOrder((prev) => prev.filter((_, i) => i !== index));
    }

    function duplicatePage(index: number) {
        setOrder((prev) => {
            const next = [...prev];
            next.splice(index + 1, 0, prev[index]);
            return next;
        });
    }

    function resetOrder() {
        if (totalPages) {
            setOrder(Array.from({ length: totalPages }, (_, i) => i + 1));
        }
    }

    function onDragStart(index: number) {
        setDragIndex(index);
    }

    function onDragOver(e: DragEvent<HTMLDivElement>, index: number) {
        e.preventDefault();
        if (dragIndex === null || dragIndex === index) return;
        setOrder((prev) => {
            const next = [...prev];
            const [moved] = next.splice(dragIndex, 1);
            next.splice(index, 0, moved);
            return next;
        });
        setDragIndex(index);
    }

    function onDragEnd() {
        setDragIndex(null);
    }

    function stopPolling() {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }

    function startPolling(jobId: string) {
        stopPolling();
        pollRef.current = setInterval(async () => {
            try {
                const updated = await apiFetch<Job>(`/jobs/${jobId}/status/`);
                setJob(updated);
                if (updated.status === "completed" || updated.status === "failed") {
                    stopPolling();
                    setLoading(false);
                }
            } catch (err: any) {
                stopPolling();
                setLoading(false);
                setError(err.message || "Failed to check job status.");
            }
        }, 2000);
    }

    async function handleApply() {
        if (!file) {
            setError("Please select a PDF file.");
            return;
        }
        if (order.length === 0) {
            setError("Page order is empty. Keep at least one page.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            formData.append("files", file);
            formData.append("order", JSON.stringify(order));

            const result = await apiUpload<Job>("/tools/organize/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Organize failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setTotalPages(null);
        setOrder([]);
        setJob(null);
        setError(null);
        setLoading(false);
    }

    const removedCount =
        totalPages !== null && totalPages > 0
            ? totalPages - new Set(order).size
            : 0;

    return (
        <ToolLayout
            icon={LayoutGrid}
            title="Organize PDF"
            description="Reorder, delete, or duplicate pages by dragging them around."
            color="from-fuchsia-500 to-fuchsia-600"
        >
            {!job && (
                <>
                    {!file && (
                        <div
                            onDrop={handleDrop}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragActive(true);
                            }}
                            onDragLeave={() => setDragActive(false)}
                            onClick={() => document.getElementById("file-input")?.click()}
                            className={`relative group cursor-pointer rounded-3xl p-10 text-center transition-all duration-300 overflow-hidden ${dragActive
                                    ? "bg-white/90 scale-[1.02] shadow-2xl"
                                    : "bg-white/70 hover:bg-white hover:shadow-xl"
                                }`}
                            style={{
                                border: dragActive
                                    ? "2px solid #d946ef"
                                    : "2px dashed #e5dcb8",
                                boxShadow: dragActive
                                    ? "0 20px 60px rgba(217, 70, 239, 0.2), 0 0 0 4px rgba(217, 70, 239, 0.1)"
                                    : undefined,
                            }}
                        >
                            <div
                                className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-fuchsia-500/5 via-transparent to-purple-500/5 transition-opacity ${dragActive
                                        ? "opacity-100"
                                        : "opacity-0 group-hover:opacity-100"
                                    }`}
                            />

                            <div className="relative">
                                <div
                                    className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#010736] to-[#22396f] shadow-lg mb-5 transition-transform duration-500 ${dragActive ? "scale-110 -translate-y-1" : "group-hover:scale-105"
                                        }`}
                                >
                                    <Upload
                                        className={`w-7 h-7 text-[#FCF1D0] ${dragActive ? "animate-bounce-subtle" : ""
                                            }`}
                                        strokeWidth={2.5}
                                    />
                                </div>
                                <h3 className="text-xl font-bold text-[#010736] mb-2">
                                    {dragActive ? "Drop your PDF here" : "Select a PDF file"}
                                </h3>
                                <p className="text-sm text-[#0D1C42]/60 mb-4">
                                    Drag & drop or click to browse
                                </p>
                                <div className="inline-flex items-center gap-2 text-xs font-medium text-[#0D1C42]/50 bg-[#FCF1D0]/70 px-3 py-1.5 rounded-full border border-[#e5dcb8]">
                                    <FileText className="w-3 h-3" />
                                    <span>PDF only · max 50 MB</span>
                                </div>
                            </div>

                            <input
                                id="file-input"
                                type="file"
                                accept="application/pdf"
                                onChange={handleFileChange}
                                className="hidden"
                            />
                        </div>
                    )}

                    {file && (
                        <>
                            {/* File header */}
                            <div className="card p-4 flex items-center gap-3 animate-fade-in">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-fuchsia-600 flex items-center justify-center shadow-sm shrink-0">
                                    <FileText className="w-5 h-5 text-white" strokeWidth={2.5} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm text-[#010736] truncate">
                                        {file.name}
                                    </p>
                                    <p className="text-xs text-[#0D1C42]/60">
                                        {totalPages !== null
                                            ? `${totalPages} pages`
                                            : readingPdf
                                                ? "Reading pages..."
                                                : "Ready"}
                                    </p>
                                </div>
                                <button
                                    onClick={reset}
                                    className="text-xs font-medium text-[#22396F] hover:underline"
                                >
                                    Change file
                                </button>
                            </div>

                            {readingPdf && (
                                <div className="mt-4 card p-12 text-center animate-fade-in">
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-fuchsia-600 shadow-lg mb-4">
                                        <Loader2 className="w-7 h-7 text-white animate-spin" />
                                    </div>
                                    <p className="text-sm text-[#0D1C42]/60">
                                        Reading PDF pages...
                                    </p>
                                </div>
                            )}

                            {!readingPdf && totalPages !== null && (
                                <>
                                    {/* Page order panel */}
                                    <div className="mt-6 card p-5 animate-fade-in">
                                        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                                            <div>
                                                <p className="text-sm font-semibold text-[#010736]">
                                                    Page order
                                                </p>
                                                <p className="text-xs text-[#0D1C42]/60">
                                                    {order.length} of {totalPages} pages
                                                    {removedCount > 0 && (
                                                        <span className="text-red-600 font-medium">
                                                            {" "}
                                                            • {removedCount} removed
                                                        </span>
                                                    )}
                                                </p>
                                            </div>
                                            <button
                                                onClick={resetOrder}
                                                className="text-xs font-medium text-[#22396F] hover:underline"
                                            >
                                                Reset order
                                            </button>
                                        </div>

                                        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-[#FCF1D0]/60 border border-[#e5dcb8] rounded-xl">
                                            <GripVertical className="w-3.5 h-3.5 text-[#0D1C42]/40 shrink-0" />
                                            <p className="text-xs text-[#0D1C42]/60">
                                                Drag cards to reorder · hover to delete or duplicate
                                            </p>
                                        </div>

                                        <div className="flex flex-wrap gap-2">
                                            {order.map((pageNum, idx) => (
                                                <div
                                                    key={`${pageNum}-${idx}`}
                                                    draggable
                                                    onDragStart={() => onDragStart(idx)}
                                                    onDragOver={(e) => onDragOver(e, idx)}
                                                    onDragEnd={onDragEnd}
                                                    className={`group relative w-20 h-24 border-2 rounded-xl flex flex-col items-center justify-center cursor-grab active:cursor-grabbing transition select-none ${dragIndex === idx
                                                            ? "border-fuchsia-500 bg-fuchsia-50 opacity-40 scale-95"
                                                            : "border-[#e5dcb8] bg-white/70 hover:border-fuchsia-400 hover:bg-white hover:shadow-md"
                                                        }`}
                                                >
                                                    <div className="text-2xl font-bold text-[#010736]">
                                                        {pageNum}
                                                    </div>
                                                    <div className="text-[10px] text-[#0D1C42]/50">
                                                        pos {idx + 1}
                                                    </div>

                                                    {/* Delete */}
                                                    <button
                                                        onClick={() => removePage(idx)}
                                                        className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center text-red-500 bg-white rounded-full border border-red-200 opacity-0 group-hover:opacity-100 transition shadow-sm hover:bg-red-500 hover:text-white"
                                                        title="Delete"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>

                                                    {/* Duplicate */}
                                                    <button
                                                        onClick={() => duplicatePage(idx)}
                                                        className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center text-fuchsia-500 bg-white rounded-full border border-fuchsia-200 opacity-0 group-hover:opacity-100 transition shadow-sm hover:bg-fuchsia-500 hover:text-white"
                                                        title="Duplicate"
                                                    >
                                                        <Copy className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            ))}

                                            {order.length === 0 && (
                                                <div className="w-full text-center text-sm text-[#0D1C42]/50 py-8">
                                                    All pages removed. Click &quot;Reset order&quot; or
                                                    upload a different file.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {error && (
                                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2 animate-fade-in">
                                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                            <span>{error}</span>
                                        </div>
                                    )}

                                    <button
                                        onClick={handleApply}
                                        disabled={order.length === 0 || loading}
                                        className="btn-primary mt-6 w-full flex items-center justify-center gap-2"
                                    >
                                        {loading ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                <span>Uploading...</span>
                                            </>
                                        ) : (
                                            <>
                                                <LayoutGrid className="w-5 h-5" />
                                                <span>
                                                    Save reordered PDF ({order.length} page
                                                    {order.length !== 1 ? "s" : ""})
                                                </span>
                                            </>
                                        )}
                                    </button>
                                </>
                            )}

                            {!readingPdf && error && !totalPages && (
                                <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2 animate-fade-in">
                                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}
                        </>
                    )}

                    {!file && error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2 animate-fade-in">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-500/5 via-transparent to-fuchsia-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-fuchsia-500 to-fuchsia-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Reordering pages"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-fuchsia-500 to-fuchsia-600 rounded-full animate-progress" />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Completed */}
            {job && job.status === "completed" && job.download_url && (
                <div className="card p-10 text-center animate-scale-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-emerald-500/5" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-xl mb-5 animate-scale-in">
                            <CheckCircle2 className="w-9 h-9 text-white" strokeWidth={2.5} />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            Reordering complete
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Your reorganized PDF is ready
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download reorganized PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Organize another PDF</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Failed */}
            {job && job.status === "failed" && (
                <div className="card p-8 animate-fade-in border-red-200">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shrink-0 shadow-md">
                            <AlertCircle className="w-6 h-6 text-white" strokeWidth={2.5} />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-[#010736] mb-1">
                                Organize failed
                            </h3>
                            <p className="text-sm text-[#0D1C42]/70 mb-4">
                                {job.error_message || "Something went wrong."}
                            </p>
                            <button
                                onClick={reset}
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Try again</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ToolLayout>
    );
}