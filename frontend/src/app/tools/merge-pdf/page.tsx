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

    return (
        <ToolLayout
            icon="🔗"
            title="Merge PDF"
            description="Combine PDFs in the order you want. Upload at least 2 files."
            color="from-blue-500 to-blue-600"
        >
            {/* Upload UI — shown only before job starts */}
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
                        <p className="text-lg font-medium mb-1 text-[#010736]">
                            Drag & drop PDF files here
                        </p>
                        <p className="text-sm text-[#0D1C42]/60">or click to browse</p>
                        <input
                            id="file-input"
                            type="file"
                            accept="application/pdf"
                            multiple
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>

                    {files.length > 0 && (
                        <div className="mt-6 card p-4">
                            <p className="text-sm font-medium text-[#010736] mb-3">
                                {files.length} file{files.length !== 1 ? "s" : ""} selected
                            </p>
                            <ul className="space-y-2">
                                {files.map((f, i) => (
                                    <li
                                        key={`${f.name}-${i}`}
                                        className="flex items-center gap-2 text-sm bg-[#FCF1D0]/60 p-2.5 rounded-lg border border-[#e5dcb8]"
                                    >
                                        <span className="text-lg">📄</span>
                                        <span className="flex-1 truncate text-[#010736]">
                                            {f.name}
                                        </span>
                                        <button
                                            onClick={() => moveFile(i, -1)}
                                            disabled={i === 0}
                                            className="w-7 h-7 flex items-center justify-center text-[#0D1C42] hover:text-[#22396F] hover:bg-white rounded-md transition disabled:opacity-20"
                                        >
                                            ↑
                                        </button>
                                        <button
                                            onClick={() => moveFile(i, 1)}
                                            disabled={i === files.length - 1}
                                            className="w-7 h-7 flex items-center justify-center text-[#0D1C42] hover:text-[#22396F] hover:bg-white rounded-md transition disabled:opacity-20"
                                        >
                                            ↓
                                        </button>
                                        <button
                                            onClick={() => removeFile(i)}
                                            className="w-7 h-7 flex items-center justify-center text-red-500 hover:text-red-700 hover:bg-white rounded-md transition"
                                        >
                                            ✕
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleMerge}
                        disabled={files.length < 2 || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : `Merge ${files.length} PDFs`}
                    </button>
                </>
            )}

            {/* Processing state */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Merging..."}
                    </h2>
                    <p className="text-[#0D1C42]/60">
                        Please wait. This usually takes a few seconds.
                    </p>
                </div>
            )}

            {/* Completed */}
            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">✅</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Merge complete
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your merged PDF is ready to download.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download merged PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Merge more files
                    </button>
                </div>
            )}

            {/* Failed */}
            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Merge failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button
                        onClick={reset}
                        className="mt-3 text-sm font-medium underline"
                    >
                        Try again
                    </button>
                </div>
            )}

            {error && job && (
                <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                    {error}
                </div>
            )}
        </ToolLayout>
    );
}