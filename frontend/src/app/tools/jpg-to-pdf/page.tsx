"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    Images,
    Upload,
    X,
    ArrowUp,
    ArrowDown,
    Image as ImageIcon,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    FileText,
    Sparkles,
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

type PageSize = "auto" | "A4" | "Letter";

const PAGE_SIZES: {
    id: PageSize;
    title: string;
    desc: string;
    badge?: string;
}[] = [
        {
            id: "auto",
            title: "Auto (match image)",
            desc: "Page fits each image exactly",
            badge: "Recommended",
        },
        {
            id: "A4",
            title: "A4",
            desc: "210 × 297 mm · standard document size",
        },
        {
            id: "Letter",
            title: "US Letter",
            desc: "8.5 × 11 in · US standard",
        },
    ];

export default function JpgToPdfPage() {
    const [files, setFiles] = useState<File[]>([]);
    const [pageSize, setPageSize] = useState<PageSize>("auto");
    const [loading, setLoading] = useState(false);
    const [job, setJob] = useState<Job | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { refreshUsage } = useAuth();

    function addFiles(newFiles: FileList | null) {
        if (!newFiles) return;
        const images = Array.from(newFiles).filter((f) =>
            /\.(jpe?g|png)$/i.test(f.name)
        );
        if (images.length === 0) {
            setError("Please upload JPG or PNG files.");
            return;
        }
        setFiles((prev) => [...prev, ...images]);
        setError(null);
        setJob(null);
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

    async function handleConvert() {
        if (files.length === 0) {
            setError("Please select at least 1 image.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            files.forEach((f) => formData.append("files", f));
            formData.append("page_size", pageSize);

            const result = await apiUpload<Job>("/tools/jpg-to-pdf/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Conversion failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFiles([]);
        setPageSize("auto");
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
            icon={Images}
            title="JPG to PDF"
            description="Combine images into a single PDF — reorder them any way you want."
            color="from-amber-500 to-amber-600"
        >
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
                            border: dragActive ? "2px solid #f59e0b" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(245, 158, 11, 0.2), 0 0 0 4px rgba(245, 158, 11, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-amber-500/5 via-transparent to-orange-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
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
                                {dragActive ? "Drop your images here" : "Select JPG or PNG files"}
                            </h3>
                            <p className="text-sm text-[#0D1C42]/60 mb-4">
                                Drag & drop or click to browse · multiple allowed
                            </p>
                            <div className="inline-flex items-center gap-2 text-xs font-medium text-[#0D1C42]/50 bg-[#FCF1D0]/70 px-3 py-1.5 rounded-full border border-[#e5dcb8]">
                                <ImageIcon className="w-3 h-3" />
                                <span>JPG or PNG only · max 50 MB each</span>
                            </div>
                        </div>

                        <input
                            id="file-input"
                            type="file"
                            accept="image/jpeg,image/png"
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
                                        {files.length} image{files.length !== 1 ? "s" : ""}
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
                                        className="group bg-white/80 backdrop-blur-sm border border-[#e5dcb8] hover:border-amber-400 rounded-2xl p-3 flex items-center gap-3 transition-all hover:shadow-md animate-fade-in"
                                    >
                                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0">
                                            {i + 1}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-[#010736] truncate">
                                                {f.name}
                                            </p>
                                            <p className="text-xs text-[#0D1C42]/50">
                                                {formatBytes(f.size)}
                                            </p>
                                        </div>

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

                            {/* Page size selection */}
                            <div className="mt-6">
                                <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-amber-500" />
                                    <span>Page size</span>
                                </h3>

                                <div className="space-y-2">
                                    {PAGE_SIZES.map((opt) => {
                                        const active = pageSize === opt.id;
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => setPageSize(opt.id)}
                                                className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center gap-3 ${active
                                                        ? "border-amber-500 bg-amber-50/70 shadow-sm"
                                                        : "border-[#e5dcb8] bg-white/70 hover:border-amber-300 hover:bg-white"
                                                    }`}
                                            >
                                                <div
                                                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${active
                                                            ? "border-amber-500 bg-amber-500"
                                                            : "border-[#c8bf9c]"
                                                        }`}
                                                >
                                                    {active && (
                                                        <div className="w-2 h-2 rounded-full bg-white" />
                                                    )}
                                                </div>

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-0.5">
                                                        <p className="font-semibold text-sm text-[#010736]">
                                                            {opt.title}
                                                        </p>
                                                        {opt.badge && (
                                                            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                                {opt.badge}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-[#0D1C42]/60">
                                                        {opt.desc}
                                                    </p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
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
                        onClick={handleConvert}
                        disabled={files.length === 0 || loading}
                        className="btn-primary mt-6 w-full flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Uploading...</span>
                            </>
                        ) : (
                            <>
                                <FileText className="w-5 h-5" />
                                <span>
                                    Convert {files.length || ""}{" "}
                                    {files.length === 1 ? "image" : "images"} to PDF
                                </span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-transparent to-amber-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-500 to-amber-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Building your PDF"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-amber-500 to-amber-600 rounded-full animate-progress" />
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
                            PDF created
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            {files.length} image{files.length !== 1 ? "s" : ""} combined into one PDF
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Convert more images</span>
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
                                Conversion failed
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