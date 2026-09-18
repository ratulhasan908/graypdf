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

type Unit = "pt" | "mm" | "in";
type ApplyTo = "all" | "first" | "last";

// Conversion factors to points (72 pt = 1 inch)
const TO_POINTS: Record<Unit, number> = {
    pt: 1,
    mm: 72 / 25.4, // ≈ 2.835
    in: 72,
};

const PRESETS = [
    { label: "1 cm", value: 10, unit: "mm" as Unit },
    { label: "1 inch", value: 1, unit: "in" as Unit },
    { label: "0.5 inch", value: 0.5, unit: "in" as Unit },
    { label: "20 pt", value: 20, unit: "pt" as Unit },
];

export default function CropPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [unit, setUnit] = useState<Unit>("mm");
    const [top, setTop] = useState(10);
    const [bottom, setBottom] = useState(10);
    const [left, setLeft] = useState(10);
    const [right, setRight] = useState(10);
    const [applyTo, setApplyTo] = useState<ApplyTo>("all");
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

    function applyPreset(presetValue: number, presetUnit: Unit) {
        setUnit(presetUnit);
        setTop(presetValue);
        setBottom(presetValue);
        setLeft(presetValue);
        setRight(presetValue);
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

    async function handleCrop() {
        if (!file) {
            setError("Please select a PDF file.");
            return;
        }
        if (top + bottom + left + right <= 0) {
            setError("Please specify at least one crop amount.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            // Convert all values to points for the backend
            const conv = TO_POINTS[unit];
            const formData = new FormData();
            formData.append("files", file);
            formData.append("top", String(top * conv));
            formData.append("bottom", String(bottom * conv));
            formData.append("left", String(left * conv));
            formData.append("right", String(right * conv));
            formData.append("apply_to", applyTo);

            const result = await apiUpload<Job>("/tools/crop/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Crop failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setTop(10);
        setBottom(10);
        setLeft(10);
        setRight(10);
        setUnit("mm");
        setApplyTo("all");
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

                <h1 className="text-3xl font-bold mt-4 mb-2">Crop PDF</h1>
                <p className="text-gray-500 mb-8">
                    Trim margins from your PDF pages. Enter crop amounts for each side.
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

                        {/* Presets */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Quick presets
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {PRESETS.map((p) => (
                                    <button
                                        key={p.label}
                                        type="button"
                                        onClick={() => applyPreset(p.value, p.unit)}
                                        className="px-3 py-2 text-sm border border-gray-300 rounded hover:border-blue-500 hover:bg-blue-50 transition"
                                    >
                                        {p.label} all sides
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Unit + Dimensions */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <div className="flex items-center justify-between mb-4">
                                <p className="text-sm font-medium text-gray-700">
                                    Crop amounts
                                </p>
                                <div className="flex gap-1 bg-gray-100 rounded p-1">
                                    {(["mm", "in", "pt"] as Unit[]).map((u) => (
                                        <button
                                            key={u}
                                            type="button"
                                            onClick={() => setUnit(u)}
                                            className={`text-xs px-3 py-1 rounded transition ${unit === u
                                                    ? "bg-white text-blue-600 font-medium shadow-sm"
                                                    : "text-gray-600"
                                                }`}
                                        >
                                            {u}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">
                                        Top
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.1"
                                        value={top}
                                        onChange={(e) =>
                                            setTop(Math.max(0, Number(e.target.value) || 0))
                                        }
                                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">
                                        Bottom
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.1"
                                        value={bottom}
                                        onChange={(e) =>
                                            setBottom(Math.max(0, Number(e.target.value) || 0))
                                        }
                                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">
                                        Left
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.1"
                                        value={left}
                                        onChange={(e) =>
                                            setLeft(Math.max(0, Number(e.target.value) || 0))
                                        }
                                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">
                                        Right
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        step="0.1"
                                        value={right}
                                        onChange={(e) =>
                                            setRight(Math.max(0, Number(e.target.value) || 0))
                                        }
                                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            {/* Visual preview */}
                            <div className="mt-5 flex justify-center">
                                <div className="relative w-48 h-64 bg-gray-100 border-2 border-gray-300">
                                    <div
                                        className="absolute bg-white border-2 border-blue-500 border-dashed"
                                        style={{
                                            top: `${Math.min(top * 3, 40)}px`,
                                            bottom: `${Math.min(bottom * 3, 40)}px`,
                                            left: `${Math.min(left * 3, 40)}px`,
                                            right: `${Math.min(right * 3, 40)}px`,
                                        }}
                                    >
                                        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                                            visible area
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <p className="text-center text-xs text-gray-400 mt-2">
                                Preview (approximate) — the shaded border shows what gets
                                removed.
                            </p>
                        </div>

                        {/* Apply to */}
                        <div className="mt-6 bg-white rounded-lg shadow p-5">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                                Apply to
                            </p>
                            <div className="space-y-3">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="applyTo"
                                        value="all"
                                        checked={applyTo === "all"}
                                        onChange={() => setApplyTo("all")}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm">All pages</p>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="applyTo"
                                        value="first"
                                        checked={applyTo === "first"}
                                        onChange={() => setApplyTo("first")}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm">First page only</p>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="applyTo"
                                        value="last"
                                        checked={applyTo === "last"}
                                        onChange={() => setApplyTo("last")}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm">Last page only</p>
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
                            onClick={handleCrop}
                            disabled={!file || loading}
                            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded transition disabled:opacity-50"
                        >
                            {loading ? "Uploading..." : "Crop PDF"}
                        </button>
                    </>
                )}

                {job && (job.status === "pending" || job.status === "processing") && (
                    <div className="bg-white rounded-lg shadow p-12 text-center">
                        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
                        <h2 className="text-xl font-bold mb-2">
                            {job.status === "pending" ? "Queued..." : "Cropping..."}
                        </h2>
                    </div>
                )}

                {job && job.status === "completed" && job.download_url && (
                    <div className="bg-white rounded-lg shadow p-8 text-center">
                        <div className="text-5xl mb-4">✂️</div>
                        <h2 className="text-xl font-bold mb-2">Crop complete</h2>
                        <p className="text-gray-500 mb-6">
                            Your cropped PDF is ready to download.
                        </p>
                        <a
                            href={job.download_url}
                            className="inline-block bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-8 rounded transition"
                        >
                            Download cropped PDF
                        </a>
                        <button
                            onClick={reset}
                            className="block mx-auto mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Crop another PDF
                        </button>
                    </div>
                )}

                {job && job.status === "failed" && (
                    <div className="bg-red-50 text-red-600 p-4 rounded">
                        <p className="font-bold mb-1">Crop failed</p>
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