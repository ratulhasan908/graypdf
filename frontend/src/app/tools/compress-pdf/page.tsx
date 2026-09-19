"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
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
    options?: Record<string, any>;
};

type Quality = "screen" | "ebook" | "printer" | "prepress";

const QUALITY_LABELS: Record<Quality, { title: string; desc: string }> = {
    screen: {
        title: "Extreme compression",
        desc: "Smallest file, lowest quality (72 dpi)",
    },
    ebook: {
        title: "Recommended",
        desc: "Good quality, good compression (150 dpi)",
    },
    printer: {
        title: "Less compression",
        desc: "High quality for printing (300 dpi)",
    },
    prepress: {
        title: "High quality",
        desc: "Best quality, largest size (300 dpi + color)",
    },
};

export default function CompressPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [quality, setQuality] = useState<Quality>("ebook");
    const [loading, setLoading] = useState(false);
    const [job, setJob] = useState<Job | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { refreshUsage } = useAuth();

    function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0];
        if (!f) return;
        if (!f.name.toLowerCase().endsWith(".pdf")) {
            setError("Please upload a PDF file.");
            return;
        }
        setFile(f);
        setError(null);
        setJob(null);
    }

    function handleDrop(e: DragEvent<HTMLDivElement>) {
        e.preventDefault();
        setDragActive(false);
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        if (!f.name.toLowerCase().endsWith(".pdf")) {
            setError("Please upload a PDF file.");
            return;
        }
        setFile(f);
        setError(null);
        setJob(null);
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

    async function handleCompress() {
        if (!file) {
            setError("Please select a PDF file.");
            return;
        }
        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            formData.append("files", file);
            formData.append("quality", quality);

            const result = await apiUpload<Job>("/tools/compress/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Compress failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setQuality("ebook");
        setJob(null);
        setError(null);
        setLoading(false);
    }

    const originalSize = job?.options?.original_size ?? 0;
    const compressedSize = job?.options?.compressed_size ?? 0;
    const savings = job?.options?.savings_percent ?? 0;

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    return (
        <ToolLayout
            icon="📉"
            title="Compress PDF"
            description="Reduce file size while optimizing for maximal PDF quality."
            color="from-emerald-500 to-emerald-600"
        >
            {!job && (
                <>
                    <div
                        onDrop={handleDrop}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${dragActive
                                ? "border-[#22396F] bg-white/80 scale-[1.01]"
                                : "border-[#e5dcb8] bg-white/70 hover:border-[#22396F] hover:bg-white"
                            }`}
                        onClick={() => document.getElementById("file-input")?.click()}
                    >
                        {file ? (
                            <>
                                <p className="text-lg font-medium mb-1 text-[#010736]">
                                    {file.name}
                                </p>
                                <p className="text-sm text-[#0D1C42]/60">
                                    {formatBytes(file.size)} — click to change
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-lg font-medium mb-1 text-[#010736]">
                                    Drag & drop a PDF here
                                </p>
                                <p className="text-sm text-[#0D1C42]/60">
                                    or click to browse
                                </p>
                            </>
                        )}
                        <input
                            id="file-input"
                            type="file"
                            accept="application/pdf"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>

                    <div className="mt-6 card p-5">
                        <p className="text-sm font-semibold text-[#010736] mb-3">
                            Compression level
                        </p>
                        <div className="space-y-3">
                            {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => (
                                <label key={q} className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="quality"
                                        value={q}
                                        checked={quality === q}
                                        onChange={() => setQuality(q)}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm text-[#010736]">
                                            {QUALITY_LABELS[q].title}
                                        </p>
                                        <p className="text-xs text-[#0D1C42]/60">
                                            {QUALITY_LABELS[q].desc}
                                        </p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleCompress}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Compress PDF"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Compressing..."}
                    </h2>
                    <p className="text-[#0D1C42]/60">
                        This usually takes a few seconds for small files.
                    </p>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">✅</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Compression complete
                    </h2>

                    {originalSize > 0 && (
                        <div className="bg-[#FCF1D0]/60 rounded-xl p-4 my-6 text-left border border-[#e5dcb8]">
                            <div className="flex justify-between text-sm mb-1.5">
                                <span className="text-[#0D1C42]/60">Original</span>
                                <span className="font-medium text-[#010736]">
                                    {formatBytes(originalSize)}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm mb-1.5">
                                <span className="text-[#0D1C42]/60">Compressed</span>
                                <span className="font-medium text-[#010736]">
                                    {formatBytes(compressedSize)}
                                </span>
                            </div>
                            <div className="flex justify-between text-sm pt-2 border-t border-[#e5dcb8]">
                                <span className="font-bold text-emerald-700">Saved</span>
                                <span className="font-bold text-emerald-700">{savings}%</span>
                            </div>
                        </div>
                    )}

                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download compressed PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Compress another PDF
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Compression failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}