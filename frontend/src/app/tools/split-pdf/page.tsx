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
            if (mode === "range") formData.append("ranges", ranges);

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
        <ToolLayout
            icon="✂️"
            title="Split PDF"
            description="Separate one page or a whole set into independent PDF files."
            color="from-violet-500 to-violet-600"
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
                                    {(file.size / 1024 / 1024).toFixed(2)} MB — click to change
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
                                    <p className="font-medium text-sm text-[#010736]">
                                        Split every page into a separate PDF
                                    </p>
                                    <p className="text-xs text-[#0D1C42]/60">
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
                                    <p className="font-medium text-sm text-[#010736]">
                                        Custom ranges
                                    </p>
                                    <p className="text-xs text-[#0D1C42]/60">
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
                                className="mt-4 w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                            />
                        )}
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleSplit}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Split PDF"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Splitting..."}
                    </h2>
                    <p className="text-[#0D1C42]/60">This usually takes a few seconds.</p>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">✅</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Split complete
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your split PDFs are ready. Download the ZIP file.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download ZIP
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Split another PDF
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Split failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}