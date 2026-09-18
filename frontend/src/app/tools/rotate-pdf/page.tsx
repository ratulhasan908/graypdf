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

type Angle = 90 | 180 | 270;
type PageMode = "all" | "specific";

export default function RotatePdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [angle, setAngle] = useState<Angle>(90);
    const [pageMode, setPageMode] = useState<PageMode>("all");
    const [pages, setPages] = useState("");
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

    async function handleRotate() {
        if (!file) {
            setError("Please select a PDF file.");
            return;
        }
        if (pageMode === "specific" && !pages.trim()) {
            setError("Please enter page numbers (e.g., 1,3,5).");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            formData.append("files", file);
            formData.append("angle", String(angle));
            formData.append(
                "pages",
                pageMode === "all" ? "all" : pages.trim()
            );

            const result = await apiUpload<Job>("/tools/rotate/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Rotate failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setAngle(90);
        setPageMode("all");
        setPages("");
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

                <h1 className="text-3xl font-bold mt-4 mb-2">Rotate PDF</h1>
                <p className="text-gray-500 mb-8">
                    Rotate your PDF pages the way you need them.
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

                        {/* Angle selection */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Rotation angle
                            </p>
                            <div className="grid grid-cols-3 gap-3">
                                {([90, 180, 270] as Angle[]).map((a) => (
                                    <button
                                        key={a}
                                        type="button"
                                        onClick={() => setAngle(a)}
                                        className={`py-4 rounded border-2 transition text-center ${angle === a
                                                ? "border-blue-600 bg-blue-50 text-blue-700"
                                                : "border-gray-200 hover:border-gray-300 text-gray-700"
                                            }`}
                                    >
                                        <div className="text-3xl mb-1">
                                            {a === 90 ? "↻" : a === 180 ? "⇅" : "↺"}
                                        </div>
                                        <div className="text-sm font-medium">{a}°</div>
                                        <div className="text-xs text-gray-500">
                                            {a === 90
                                                ? "Clockwise"
                                                : a === 180
                                                    ? "Upside down"
                                                    : "Counter-clockwise"}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Pages selection */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Which pages to rotate
                            </p>
                            <div className="space-y-3">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="pageMode"
                                        value="all"
                                        checked={pageMode === "all"}
                                        onChange={() => setPageMode("all")}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm">All pages</p>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="pageMode"
                                        value="specific"
                                        checked={pageMode === "specific"}
                                        onChange={() => setPageMode("specific")}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm">Specific pages</p>
                                        <p className="text-xs text-gray-500">
                                            Enter pages like <code>1,3,5</code> or ranges like{" "}
                                            <code>1-3</code>
                                        </p>
                                    </div>
                                </label>
                            </div>

                            {pageMode === "specific" && (
                                <input
                                    type="text"
                                    value={pages}
                                    onChange={(e) => setPages(e.target.value)}
                                    placeholder="e.g., 1,3,5-7"
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
                            onClick={handleRotate}
                            disabled={!file || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading ? "Uploading..." : "Rotate PDF"}
                        </button>
                    </>
                )}

                {/* Processing */}
                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Rotating..."}
                        </h2>
                        <p className="text-gray-500">This usually takes a few seconds.</p>
                    </div>
                )}

                {/* Completed */}
                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">✅</div>
                        <h2 className="text-xl font-bold mb-2">Rotation complete</h2>
                        <p className="text-gray-500 mb-6">
                            Your rotated PDF is ready to download.
                        </p>
                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download rotated PDF
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Rotate another PDF
                        </button>
                    </div>
                )}

                {/* Failed */}
                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Rotation failed</p>
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