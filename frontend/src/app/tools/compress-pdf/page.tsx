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
        <main className="min-h-screen bg-gray-50 px-4 py-12">
            <div className="max-w-2xl mx-auto">
                <Link href="/" className="text-sm text-blue-600 hover:underline">
                    ← Back to tools
                </Link>

                <h1 className="text-3xl font-bold mt-4 mb-2">Compress PDF</h1>
                <p className="text-gray-500 mb-8">
                    Reduce file size while optimizing for maximal PDF quality.
                </p>

                {!job && (
                    <>
                        {/* Drop zone */}
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
                            {file ? (
                                <>
                                    <p className="text-lg font-medium mb-1">{file.name}</p>
                                    <p className="text-sm text-gray-500">
                                        {formatBytes(file.size)} — click to change
                                    </p>
                                </>
                            ) : (
                                <>
                                    <p className="text-lg font-medium mb-1">
                                        Drag & drop a PDF here
                                    </p>
                                    <p className="text-sm text-gray-500">or click to browse</p>
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

                        {/* Quality selection */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Compression level
                            </p>

                            <div className="space-y-3">
                                {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => (
                                    <label
                                        key={q}
                                        className="flex items-start gap-3 cursor-pointer"
                                    >
                                        <input
                                            type="radio"
                                            name="quality"
                                            value={q}
                                            checked={quality === q}
                                            onChange={() => setQuality(q)}
                                            className="mt-1"
                                        />
                                        <div>
                                            <p className="font-medium text-sm">
                                                {QUALITY_LABELS[q].title}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {QUALITY_LABELS[q].desc}
                                            </p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {error && (
                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleCompress}
                            disabled={!file || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading ? "Uploading..." : "Compress PDF"}
                        </button>
                    </>
                )}

                {/* Processing */}
                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Compressing..."}
                        </h2>
                        <p className="text-gray-500">
                            This usually takes a few seconds for small files.
                        </p>
                    </div>
                )}

                {/* Completed */}
                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">✅</div>
                        <h2 className="text-xl font-bold mb-2">Compression complete</h2>

                        {originalSize > 0 && (
                            <div className="bg-green-50 rounded p-4 my-6 text-left">
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-600">Original</span>
                                    <span className="font-medium">{formatBytes(originalSize)}</span>
                                </div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-gray-600">Compressed</span>
                                    <span className="font-medium">
                                        {formatBytes(compressedSize)}
                                    </span>
                                </div>
                                <div className="flex justify-between text-sm pt-2 border-t border-green-200">
                                    <span className="font-bold text-green-700">Saved</span>
                                    <span className="font-bold text-green-700">{savings}%</span>
                                </div>
                            </div>
                        )}

                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download compressed PDF
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Compress another PDF
                        </button>
                    </div>
                )}

                {/* Failed */}
                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Compression failed</p>
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