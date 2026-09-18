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
        <main className="min-h-screen bg-gray-50 px-4 py-12">
            <div className="max-w-2xl mx-auto">
                <Link href="/" className="text-sm text-blue-600 hover:underline">
                    ← Back to tools
                </Link>

                <h1 className="text-3xl font-bold mt-4 mb-2">JPG to PDF</h1>
                <p className="text-gray-500 mb-8">
                    Convert JPG and PNG images into a single PDF.
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
                            <p className="text-lg font-medium mb-1">
                                Drag & drop JPG / PNG files here
                            </p>
                            <p className="text-sm text-gray-500">or click to browse</p>
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
                            <div className="mt-6 bg-white rounded-lg shadow p-4">
                                <p className="text-sm font-medium text-gray-700 mb-3">
                                    {files.length} image{files.length !== 1 ? "s" : ""} selected
                                </p>
                                <ul className="space-y-2">
                                    {files.map((f, i) => (
                                        <li
                                            key={`${f.name}-${i}`}
                                            className="flex items-center gap-2 text-sm bg-gray-50 p-2 rounded"
                                        >
                                            <span className="flex-1 truncate">{f.name}</span>
                                            <span className="text-xs text-gray-400">
                                                {(f.size / 1024).toFixed(0)} KB
                                            </span>
                                            <button
                                                onClick={() => moveFile(i, -1)}
                                                disabled={i === 0}
                                                className="text-gray-500 hover:text-blue-600 disabled:opacity-30"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                onClick={() => moveFile(i, 1)}
                                                disabled={i === files.length - 1}
                                                className="text-gray-500 hover:text-blue-600 disabled:opacity-30"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                onClick={() => removeFile(i)}
                                                className="text-red-500 hover:text-red-700"
                                            >
                                                ✕
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Page size selection */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
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
                                        <p className="font-medium text-sm">Auto (match image)</p>
                                        <p className="text-xs text-gray-500">
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
                                        <p className="font-medium text-sm">A4</p>
                                        <p className="text-xs text-gray-500">
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
                                        <p className="font-medium text-sm">US Letter</p>
                                        <p className="text-xs text-gray-500">
                                            8.5 × 11 in — US standard
                                        </p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {error && (
                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleConvert}
                            disabled={files.length === 0 || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading
                                ? "Uploading..."
                                : `Convert ${files.length} image${files.length !== 1 ? "s" : ""
                                } to PDF`}
                        </button>
                    </>
                )}

                {/* Processing */}
                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Converting..."}
                        </h2>
                        <p className="text-gray-500">This usually takes a few seconds.</p>
                    </div>
                )}

                {/* Completed */}
                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">✅</div>
                        <h2 className="text-xl font-bold mb-2">Conversion complete</h2>
                        <p className="text-gray-500 mb-6">
                            Your PDF is ready to download.
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
                            Convert more images
                        </button>
                    </div>
                )}

                {/* Failed */}
                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Conversion failed</p>
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