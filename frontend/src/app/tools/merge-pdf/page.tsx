"use client";

import { useState, ChangeEvent, DragEvent } from "react";
import Link from "next/link";
import { apiUpload, getApiBaseUrl } from "@/lib/api";

type Job = {
    id: string;
    tool: string;
    status: string;
    output_file: string;
    download_url: string | null;
    error_message: string | null;
};

export default function MergePdfPage() {
    const [files, setFiles] = useState<File[]>([]);
    const [loading, setLoading] = useState(false);
    const [job, setJob] = useState<Job | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);

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
        } catch (err: any) {
            setError(err.message || "Merge failed.");
        } finally {
            setLoading(false);
        }
    }

    function reset() {
        setFiles([]);
        setJob(null);
        setError(null);
    }

    return (
        <main className="min-h-screen bg-gray-50 px-4 py-12">
            <div className="max-w-2xl mx-auto">
                <Link href="/" className="text-sm text-blue-600 hover:underline">
                    ← Back to tools
                </Link>

                <h1 className="text-3xl font-bold mt-4 mb-2">Merge PDF</h1>
                <p className="text-gray-500 mb-8">
                    Combine PDFs in the order you want. Upload at least 2 files.
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
                                Drag & drop PDF files here
                            </p>
                            <p className="text-sm text-gray-500">or click to browse</p>
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
                            <div className="mt-6 bg-white rounded-lg shadow p-4">
                                <p className="text-sm font-medium text-gray-700 mb-3">
                                    {files.length} file{files.length !== 1 ? "s" : ""} selected
                                </p>
                                <ul className="space-y-2">
                                    {files.map((f, i) => (
                                        <li
                                            key={`${f.name}-${i}`}
                                            className="flex items-center gap-2 text-sm bg-gray-50 p-2 rounded"
                                        >
                                            <span className="flex-1 truncate">{f.name}</span>
                                            <button
                                                onClick={() => moveFile(i, -1)}
                                                disabled={i === 0}
                                                className="text-gray-500 hover:text-blue-600 disabled:opacity-30"
                                                title="Move up"
                                            >
                                                ↑
                                            </button>
                                            <button
                                                onClick={() => moveFile(i, 1)}
                                                disabled={i === files.length - 1}
                                                className="text-gray-500 hover:text-blue-600 disabled:opacity-30"
                                                title="Move down"
                                            >
                                                ↓
                                            </button>
                                            <button
                                                onClick={() => removeFile(i)}
                                                className="text-red-500 hover:text-red-700"
                                                title="Remove"
                                            >
                                                ✕
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                {error}
                            </div>
                        )}

                        {/* Merge button */}
                        <button
                            onClick={handleMerge}
                            disabled={files.length < 2 || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading ? "Merging..." : `Merge ${files.length} PDFs`}
                        </button>
                    </>
                )}

                {/* Result */}
                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">✅</div>
                        <h2 className="text-xl font-bold mb-2">Merge complete</h2>
                        <p className="text-gray-500 mb-6">
                            Your merged PDF is ready to download.
                        </p>
                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download merged PDF
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Merge more files
                        </button>
                    </div>
                )}

                {/* Failed */}
                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Merge failed</p>
                        <p className="text-sm">{job.error_message}</p>
                        <button
                            onClick={reset}
                            className="mt-3 text-sm underline"
                        >
                            Try again
                        </button>
                    </div>
                )}
            </div>
        </main>
    );
}