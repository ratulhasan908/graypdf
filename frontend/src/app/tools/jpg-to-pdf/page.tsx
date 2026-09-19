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

type PageSize = "auto" | "A4" | "Letter";

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

    return (
        <ToolLayout
            icon="📷"
            title="JPG to PDF"
            description="Convert JPG and PNG images into a single PDF."
            color="from-amber-500 to-amber-600"
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
                        <p className="text-lg font-medium mb-1 text-[#010736]">
                            Drag & drop JPG / PNG files here
                        </p>
                        <p className="text-sm text-[#0D1C42]/60">or click to browse</p>
                        <input
                            id="file-input"
                            type="file"
                            accept="image/jpeg,image/png"
                            multiple
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>

                    {files.length > 0 && (
                        <div className="mt-6 card p-4">
                            <p className="text-sm font-semibold text-[#010736] mb-3">
                                {files.length} image{files.length !== 1 ? "s" : ""} selected
                            </p>
                            <ul className="space-y-2">
                                {files.map((f, i) => (
                                    <li
                                        key={`${f.name}-${i}`}
                                        className="flex items-center gap-2 text-sm bg-[#FCF1D0]/60 p-2.5 rounded-lg border border-[#e5dcb8]"
                                    >
                                        <span className="text-lg">🖼️</span>
                                        <span className="flex-1 truncate text-[#010736]">
                                            {f.name}
                                        </span>
                                        <span className="text-xs text-[#0D1C42]/50">
                                            {(f.size / 1024).toFixed(0)} KB
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

                    <div className="mt-6 card p-5">
                        <p className="text-sm font-semibold text-[#010736] mb-3">
                            Page size
                        </p>
                        <div className="space-y-3">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="pageSize"
                                    value="auto"
                                    checked={pageSize === "auto"}
                                    onChange={() => setPageSize("auto")}
                                    className="mt-1"
                                />
                                <div>
                                    <p className="font-medium text-sm text-[#010736]">
                                        Auto (match image)
                                    </p>
                                    <p className="text-xs text-[#0D1C42]/60">
                                        Page fits each image exactly
                                    </p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="pageSize"
                                    value="A4"
                                    checked={pageSize === "A4"}
                                    onChange={() => setPageSize("A4")}
                                    className="mt-1"
                                />
                                <div>
                                    <p className="font-medium text-sm text-[#010736]">A4</p>
                                    <p className="text-xs text-[#0D1C42]/60">
                                        210 × 297 mm — standard document size
                                    </p>
                                </div>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="pageSize"
                                    value="Letter"
                                    checked={pageSize === "Letter"}
                                    onChange={() => setPageSize("Letter")}
                                    className="mt-1"
                                />
                                <div>
                                    <p className="font-medium text-sm text-[#010736]">
                                        US Letter
                                    </p>
                                    <p className="text-xs text-[#0D1C42]/60">
                                        8.5 × 11 in — US standard
                                    </p>
                                </div>
                            </label>
                        </div>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleConvert}
                        disabled={files.length === 0 || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading
                            ? "Uploading..."
                            : `Convert ${files.length} image${files.length !== 1 ? "s" : ""
                            } to PDF`}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Converting..."}
                    </h2>
                    <p className="text-[#0D1C42]/60">This usually takes a few seconds.</p>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">✅</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Conversion complete
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your PDF is ready to download.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Convert more images
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Conversion failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}