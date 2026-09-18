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

type Mode = "each" | "range";

export default function SplitPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [mode, setMode] = useState<Mode>("each");
    const [ranges, setRanges] = useState("");
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

    async function handleSplit() {
        if (!file) {
            setError("Please select a PDF file.");
            return;
        }
        if (mode === "range" && !ranges.trim()) {
            setError("Please enter page ranges (e.g., 1-3,5,7-9).");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            formData.append("files", file);
            formData.append("mode", mode);
            if (mode === "range") {
                formData.append("ranges", ranges);
            }

            const result = await apiUpload<Job>("/tools/split/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Split failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setRanges("");
        setMode("each");
        setJob(null);
        setError(null);
        setLoading(false);
    }

    return (
        <main className="min-h-screen bg-gray-50 px-4 py-12">
            <div className="max-w-2xl mx-auto">
                <Link href="/" className="text-sm text-blue-600 hover:underline">
                    ← Back to tools
                </Link>

                <h1 className="text-3xl font-bold mt-4 mb-2">Split PDF</h1>
                <p className="text-gray-500 mb-8">
                    Separate one page or a whole set into independent PDF files.
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
                                        {(file.size / 1024 / 1024).toFixed(2)} MB — click to change
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

                        {/* Mode selection */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Split mode
                            </p>

                            <div className="space-y-3">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="mode"
                                        value="each"
                                        checked={mode === "each"}
                                        onChange={() => setMode("each")}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm">
                                            Split every page into a separate PDF
                                        </p>
                                        <p className="text-xs text-gray-500">
                                            Result: ZIP containing 1 PDF per page
                                        </p>
                                    </div>
                                </label>

                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="mode"
                                        value="range"
                                        checked={mode === "range"}
                                        onChange={() => setMode("range")}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm">Custom ranges</p>
                                        <p className="text-xs text-gray-500">
                                            Enter ranges like <code>1-3,5,7-9</code>
                                        </p>
                                    </div>
                                </label>
                            </div>

                            {mode === "range" && (
                                <input
                                    type="text"
                                    value={ranges}
                                    onChange={(e) => setRanges(e.target.value)}
                                    placeholder="e.g., 1-3,5,7-9"
                                    className="mt-4 w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            )}
                        </div>

                        {error && (
                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleSplit}
                            disabled={!file || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading ? "Uploading..." : "Split PDF"}
                        </button>
                    </>
                )}

                {/* Processing */}
                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Splitting..."}
                        </h2>
                        <p className="text-gray-500">This usually takes a few seconds.</p>
                    </div>
                )}

                {/* Completed */}
                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">✅</div>
                        <h2 className="text-xl font-bold mb-2">Split complete</h2>
                        <p className="text-gray-500 mb-6">
                            Your split PDFs are ready. Download the ZIP file.
                        </p>
                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download ZIP
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Split another PDF
                        </button>
                    </div>
                )}

                {/* Failed */}
                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Split failed</p>
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