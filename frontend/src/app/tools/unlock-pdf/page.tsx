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

export default function UnlockPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState("");
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

    async function handleUnlock() {
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
            formData.append("password", password);

            const result = await apiUpload<Job>("/tools/unlock/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Unlock failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setPassword("");
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

                <h1 className="text-3xl font-bold mt-4 mb-2">Unlock PDF</h1>
                <p className="text-gray-500 mb-8">
                    Remove password protection from your PDF.
                </p>

                {!job && (
                    <>
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

                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Password (leave empty if PDF has no password)
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Current PDF password"
                            />
                            <p className="text-xs text-gray-500 mt-2">
                                If the PDF is protected, enter the password to remove it.
                            </p>
                        </div>

                        {error && (
                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleUnlock}
                            disabled={!file || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading ? "Uploading..." : "Unlock PDF"}
                        </button>
                    </>
                )}

                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Unlocking..."}
                        </h2>
                    </div>
                )}

                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">🔓</div>
                        <h2 className="text-xl font-bold mb-2">PDF unlocked</h2>
                        <p className="text-gray-500 mb-6">
                            Password removed. Your unlocked PDF is ready.
                        </p>
                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download unlocked PDF
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Unlock another PDF
                        </button>
                    </div>
                )}

                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Unlock failed</p>
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