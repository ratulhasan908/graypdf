"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import Link from "next/link";
import { apiUpload, apiFetch } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

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
        <main className="min-h-screen bg-gray-50 px-4 py-12">
            <div className="max-w-3xl mx-auto">
                <Link href="/" className="text-sm text-blue-600 hover:underline">
                    ← Back to tools
                </Link>

                <h1 className="text-3xl font-bold mt-4 mb-2">Organize PDF</h1>
                <p className="text-gray-500 mb-8">
                    Reorder, delete, or duplicate pages by dragging them around.
                </p>

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
                                className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition ${dragActive
                                        ? "border-blue-500 bg-blue-50"
                                        : "border-gray-300 bg-white hover:border-blue-400"
                                    }`}
                                onClick={() => document.getElementById("file-input")?.click()}
                            >
                                <p className="text-lg font-medium mb-1">
                                    Drag & drop a PDF here
                                </p>
                                <p className="text-sm text-gray-500">or click to browse</p>
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
                                <div className="bg-white rounded-lg shadow p-4 flex items-center gap-3">
                                    <span className="text-2xl">📄</span>
                                    <div className="flex-1">
                                        <p className="font-medium text-sm">{file.name}</p>
                                        <p className="text-xs text-gray-500">
                                            {totalPages !== null
                                                ? `${totalPages} pages`
                                                : readingPdf
                                                    ? "Reading pages..."
                                                    : "Ready"}
                                        </p>
                                    </div>
                                    <button
                                        onClick={reset}
                                        className="text-sm text-blue-600 hover:underline"
                                    >
                                        Change file
                                    </button>
                                </div>

                                {readingPdf && (
                                    <div className="mt-4 bg-white rounded-lg shadow p-8 text-center">
                                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent"></div>
                                        <p className="text-sm text-gray-500 mt-3">
                                            Reading PDF pages...
                                        </p>
                                    </div>
                                )}

                                {!readingPdf && totalPages !== null && (
                                    <>
                                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                                            <div className="flex items-center justify-between mb-4">
                                                <div>
                                                    <p className="text-sm font-medium text-gray-700">
                                                        Page order
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {order.length} of {totalPages} pages
                                                        {removedCount > 0 && (
                                                            <span className="text-red-600">
                                                                {" "}
                                                                • {removedCount} removed
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={resetOrder}
                                                    className="text-xs text-blue-600 hover:underline"
                                                >
                                                    Reset order
                                                </button>
                                            </div>

                                            <p className="text-xs text-gray-400 mb-3">
                                                Drag to reorder · click ✕ to delete · click ⧉ to
                                                duplicate
                                            </p>

                                            <div className="flex flex-wrap gap-2">
                                                {order.map((pageNum, idx) => (
                                                    <div
                                                        key={`${pageNum}-${idx}`}
                                                        draggable
                                                        onDragStart={() => onDragStart(idx)}
                                                        onDragOver={(e) => onDragOver(e, idx)}
                                                        onDragEnd={onDragEnd}
                                                        className={`group relative w-20 h-24 border-2 rounded-lg flex flex-col items-center justify-center cursor-grab active:cursor-grabbing transition select-none ${dragIndex === idx
                                                                ? "border-blue-500 bg-blue-50 opacity-50"
                                                                : "border-gray-200 bg-white hover:border-blue-400"
                                                            }`}
                                                    >
                                                        <div className="text-2xl font-bold text-gray-800">
                                                            {pageNum}
                                                        </div>
                                                        <div className="text-[10px] text-gray-400">
                                                            pos {idx + 1}
                                                        </div>

                                                        <button
                                                            onClick={() => removePage(idx)}
                                                            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center text-xs text-red-500 bg-white rounded-full border border-red-200 opacity-0 group-hover:opacity-100 transition"
                                                            title="Delete"
                                                        >
                                                            ✕
                                                        </button>
                                                        <button
                                                            onClick={() => duplicatePage(idx)}
                                                            className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center text-xs text-blue-500 bg-white rounded-full border border-blue-200 opacity-0 group-hover:opacity-100 transition"
                                                            title="Duplicate"
                                                        >
                                                            ⧉
                                                        </button>
                                                    </div>
                                                ))}

                                                {order.length === 0 && (
                                                    <div className="w-full text-center text-sm text-gray-400 py-8">
                                                        All pages removed. Click &quot;Reset order&quot; or
                                                        upload a different file.
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {error && (
                                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                                {error}
                                            </div>
                                        )}

                                        <button
                                            onClick={handleApply}
                                            disabled={order.length === 0 || loading}
                                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                                        >
                                            {loading
                                                ? "Uploading..."
                                                : `Save reordered PDF (${order.length} page${order.length !== 1 ? "s" : ""
                                                })`}
                                        </button>
                                    </>
                                )}

                                {!readingPdf && error && !totalPages && (
                                    <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                        {error}
                                    </div>
                                )}
                            </>
                        )}

                        {!file && error && (
                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                {error}
                            </div>
                        )}
                    </>
                )}

                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Reordering..."}
                        </h2>
                    </div>
                )}

                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">📑</div>
                        <h2 className="text-xl font-bold mb-2">Reordering complete</h2>
                        <p className="text-gray-500 mb-6">
                            Your reorganized PDF is ready to download.
                        </p>
                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download PDF
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Organize another PDF
                        </button>
                    </div>
                )}

                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Organize failed</p>
                        <p className="text-sm">{job.error_message}</p>
                        <button onClick={reset} className="mt-3 text-sm underline">
                            Try again
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}