"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    FileStack,
    Upload,
    X,
    ArrowUp,
    ArrowDown,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    FileText,
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

export default function MergePdfPage() {
    const [files, setFiles] = useState<File[]>([]);
    const [loading, setLoading] = useState(false);
    const [job, setJob] = useState<Job | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { refreshUsage } = useAuth();

    function addFiles(newFiles: FileList | null) {
        if (!newFiles) return;
        const pdfs = Array.from(newFiles).filter((f) =>
            f.name.toLowerCase().endsWith(".pdf")
        );
        if (pdfs.length === 0) {
            setError("Please upload PDF files.");
            return;
        }
        setFiles((prev) => [...prev, ...pdfs]);
        setJob(null);
        setError(null);
    }

    function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
        addFiles(e.target.files);
    }

    function handleDrop(e: DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragActive(false);
        addFiles(e.dataTransfer.files);
    }

    function removeFile(index: number) {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    }

    function moveFile(index: number, direction: -1 | 1) {
        const newIndex = index + direction;
        if (newIndex < 0 || newIndex >= files.length) return;
        const next = [...files];
        [next[index], next[newIndex]] = [next[newIndex], next[index]];
        setFiles(next);
    }

    function stopPolling() {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }

    function startPolling(jobId: string) {
        stopPolling();
        const startedAt = Date.now();
        pollRef.current = setInterval(async () => {
            try {
                if (Date.now() - startedAt > 120000) {
                    stopPolling();
                    setLoading(false);
                    setError("The PDF worker is taking too long to respond. Please try again.");
                    return;
                }
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

    async function handleMerge() {
        if (files.length < 2) {
            setError("Please select at least 2 PDF files.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            files.forEach((f) => formData.append("files", f));

            const result = await apiUpload<Job>("/tools/merge/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Merge failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFiles([]);
        setJob(null);
        setError(null);
        setLoading(false);
    }

    const totalSize = files.reduce((acc, f) => acc + f.size, 0);

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    return (
        <ToolLayout
            icon={FileStack}
            title="Merge PDF"
            description="Combine multiple PDFs into one document — in the exact order you want."
            color="from-blue-500 to-blue-600"
        >
            {/* ============ UPLOAD STATE ============ */}
            {!job && (
                <>
                    {/* Dropzone */}
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
                                ? "2px solid #4f7cff"
                                : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(79, 124, 255, 0.2), 0 0 0 4px rgba(79, 124, 255, 0.1)"
                                : undefined,
                        }}
                    >
                        {/* Glow behind dropzone */}
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-[#4f7cff]/5 via-transparent to-[#8b5cf6]/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {/* Floating upload icon */}
                            <div
                                className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#010736] to-[#22396f] shadow-lg mb-5 transition-transform duration-500 ${dragActive ? "scale-110 -translate-y-1" : "group-hover:scale-105"
                                    }`}
                            >
                                <Upload
                                    className={`w-7 h-7 text-[#FCF1D0] transition-transform ${dragActive ? "animate-bounce-subtle" : ""
                                        }`}
                                    strokeWidth={2.5}
                                />
                            </div>

                            <h3 className="text-xl font-bold text-[#010736] mb-2">
                                {dragActive ? "Drop your PDFs here" : "Select PDF files"}
                            </h3>
                            <p className="text-sm text-[#0D1C42]/60 mb-4">
                                Drag & drop or click to browse · at least 2 files
                            </p>

                            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#0D1C42]/50 bg-[#FCF1D0]/70 px-3 py-1.5 rounded-full border border-[#e5dcb8]">
                                <FileText className="w-3 h-3" />
                                <span>PDF only · max 50 MB each</span>
                            </div>
                        </div>

                        <input
                            id="file-input"
                            type="file"
                            accept="application/pdf"
                            multiple
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>

                    {/* File list */}
                    {files.length > 0 && (
                        <div className="mt-6 animate-fade-in">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-[#010736]">
                                        {files.length} file{files.length !== 1 ? "s" : ""}
                                    </h3>
                                    <span className="text-xs text-[#0D1C42]/50 bg-white/70 px-2 py-0.5 rounded-full border border-[#e5dcb8]">
                                        {formatBytes(totalSize)}
                                    </span>
                                </div>
                                <button
                                    onClick={() => setFiles([])}
                                    className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                                >
                                    Clear all
                                </button>
                            </div>

                            <div className="space-y-2">
                                {files.map((f, i) => (
                                    <div
                                        key={`${f.name}-${i}`}
                                        className="group bg-white/80 backdrop-blur-sm border border-[#e5dcb8] hover:border-[#22396F] rounded-2xl p-3 flex items-center gap-3 transition-all hover:shadow-md animate-fade-in"
                                    >
                                        {/* Index badge */}
                                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0">
                                            {i + 1}
                                        </div>

                                        {/* File info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-[#010736] truncate">
                                                {f.name}
                                            </p>
                                            <p className="text-xs text-[#0D1C42]/50">
                                                {formatBytes(f.size)}
                                            </p>
                                        </div>

                                        {/* Reorder buttons */}
                                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => moveFile(i, -1)}
                                                disabled={i === 0}
                                                className="w-7 h-7 flex items-center justify-center rounded-lg text-[#0D1C42] hover:bg-[#FCF1D0] disabled:opacity-20 transition"
                                                title="Move up"
                                            >
                                                <ArrowUp className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={() => moveFile(i, 1)}
                                                disabled={i === files.length - 1}
                                                className="w-7 h-7 flex items-center justify-center rounded-lg text-[#0D1C42] hover:bg-[#FCF1D0] disabled:opacity-20 transition"
                                                title="Move down"
                                            >
                                                <ArrowDown className="w-3.5 h-3.5" />
                                            </button>
                                        </div>

                                        {/* Remove */}
                                        <button
                                            onClick={() => removeFile(i)}
                                            className="w-7 h-7 flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 transition"
                                            title="Remove"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2 animate-fade-in">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        onClick={handleMerge}
                        disabled={files.length < 2 || loading}
                        className="btn-primary mt-6 w-full flex items-center justify-center gap-2 group"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Uploading...</span>
                            </>
                        ) : (
                            <>
                                <FileStack className="w-5 h-5" />
                                <span>
                                    Merge {files.length || ""}{" "}
                                    {files.length === 1 ? "PDF" : "PDFs"}
                                </span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* ============ PROCESSING STATE ============ */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    {/* Animated background */}
                    <div className="absolute inset-0 bg-gradient-to-r from-[#4f7cff]/5 via-[#8b5cf6]/5 to-[#4f7cff]/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Merging your PDFs"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        {/* Progress bar (indeterminate) */}
                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-[#0D1C42] to-[#22396F] rounded-full animate-progress" />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ COMPLETED STATE ============ */}
            {job && job.status === "completed" && job.download_url && (
                <div className="card p-10 text-center animate-scale-in relative overflow-hidden">
                    {/* Success glow */}
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-emerald-500/5" />

                    <div className="relative">
                        {/* Animated checkmark */}
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-xl mb-5 animate-scale-in">
                            <CheckCircle2 className="w-9 h-9 text-white" strokeWidth={2.5} />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            Merge complete
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            {files.length} PDFs combined into one document
                        </p>

                        {/* Download button */}
                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download merged PDF</span>
                        </a>

                        {/* Restart */}
                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Merge more files</span>
                        </button>
                    </div>
                </div>
            )}

            {/* ============ FAILED STATE ============ */}
            {job && job.status === "failed" && (
                <div className="card p-8 animate-fade-in border-red-200">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shrink-0 shadow-md">
                            <AlertCircle className="w-6 h-6 text-white" strokeWidth={2.5} />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-[#010736] mb-1">
                                Merge failed
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