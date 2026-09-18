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

type Position =
    | "bottom-center"
    | "bottom-right"
    | "bottom-left"
    | "top-center"
    | "top-right"
    | "top-left";

type Format = "number" | "page-n" | "n-of-total";

const POSITIONS: { value: Position; label: string; grid: string }[] = [
    { value: "top-left", label: "Top Left", grid: "↖" },
    { value: "top-center", label: "Top Center", grid: "↑" },
    { value: "top-right", label: "Top Right", grid: "↗" },
    { value: "bottom-left", label: "Bottom Left", grid: "↙" },
    { value: "bottom-center", label: "Bottom Center", grid: "↓" },
    { value: "bottom-right", label: "Bottom Right", grid: "↘" },
];

const FORMATS: { value: Format; label: string; example: string }[] = [
    { value: "number", label: "Number only", example: "1, 2, 3" },
    { value: "page-n", label: "With prefix", example: "Page 1, Page 2" },
    { value: "n-of-total", label: "Number of total", example: "1 / 10" },
];

export default function PageNumbersPage() {
    const [file, setFile] = useState<File | null>(null);
    const [position, setPosition] = useState<Position>("bottom-center");
    const [format, setFormat] = useState<Format>("number");
    const [start, setStart] = useState(1);
    const [fontSize, setFontSize] = useState(12);
    const [margin, setMargin] = useState(40);
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

    async function handleApply() {
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
            formData.append("position", position);
            formData.append("format", format);
            formData.append("start", String(start));
            formData.append("font_size", String(fontSize));
            formData.append("margin", String(margin));

            const result = await apiUpload<Job>("/tools/page-numbers/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Failed to add page numbers.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
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

                <h1 className="text-3xl font-bold mt-4 mb-2">Add Page Numbers</h1>
                <p className="text-gray-500 mb-8">
                    Insert page numbers into your PDF with full control over position
                    and format.
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

                        {/* Position grid */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Position
                            </p>
                            <div className="grid grid-cols-3 gap-2">
                                {POSITIONS.map((p) => (
                                    <button
                                        key={p.value}
                                        type="button"
                                        onClick={() => setPosition(p.value)}
                                        className={`py-3 rounded border-2 text-center transition ${position === p.value
                                                ? "border-blue-600 bg-blue-50 text-blue-700"
                                                : "border-gray-200 text-gray-700 hover:border-gray-300"
                                            }`}
                                    >
                                        <div className="text-xl">{p.grid}</div>
                                        <div className="text-xs mt-1">{p.label}</div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Format */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Format
                            </p>
                            <div className="space-y-3">
                                {FORMATS.map((f) => (
                                    <label
                                        key={f.value}
                                        className="flex items-start gap-3 cursor-pointer"
                                    >
                                        <input
                                            type="radio"
                                            name="format"
                                            value={f.value}
                                            checked={format === f.value}
                                            onChange={() => setFormat(f.value)}
                                            className="mt-1"
                                        />
                                        <div>
                                            <p className="font-medium text-sm">{f.label}</p>
                                            <p className="text-xs text-gray-500">
                                                Example: {f.example}
                                            </p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Advanced options */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5 space-y-4">
                            <p className="text-sm font-medium text-gray-700">
                                Fine-tuning
                            </p>

                            <div>
                                <label className="block text-sm text-gray-700 mb-1">
                                    Starting number: {start}
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    max={9999}
                                    value={start}
                                    onChange={(e) => setStart(Number(e.target.value) || 1)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-700 mb-1">
                                    Font size: {fontSize}px
                                </label>
                                <input
                                    type="range"
                                    min={8}
                                    max={30}
                                    value={fontSize}
                                    onChange={(e) => setFontSize(Number(e.target.value))}
                                    className="w-full"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-gray-700 mb-1">
                                    Margin from edge: {margin}px
                                </label>
                                <input
                                    type="range"
                                    min={20}
                                    max={100}
                                    value={margin}
                                    onChange={(e) => setMargin(Number(e.target.value))}
                                    className="w-full"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="mt-4 bg-red-50 text-red-600 p-3 rounded text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            onClick={handleApply}
                            disabled={!file || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading ? "Uploading..." : "Add page numbers"}
                        </button>
                    </>
                )}

                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Adding numbers..."}
                        </h2>
                    </div>
                )}

                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">🔢</div>
                        <h2 className="text-xl font-bold mb-2">Page numbers added</h2>
                        <p className="text-gray-500 mb-6">
                            Your PDF is ready to download.
                        </p>
                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download numbered PDF
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Add to another PDF
                        </button>
                    </div>
                )}

                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Failed</p>
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