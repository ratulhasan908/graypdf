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

type Unit = "pt" | "mm" | "in";
type ApplyTo = "all" | "first" | "last";

const TO_POINTS: Record<Unit, number> = {
    pt: 1,
    mm: 72 / 25.4,
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
        <ToolLayout
            icon="✂️"
            title="Crop PDF"
            description="Trim margins from your PDF pages. Enter crop amounts for each side."
            color="from-orange-500 to-orange-600"
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

                    {/* Presets */}
                    <div className="mt-6 card p-5">
                        <p className="text-sm font-semibold text-[#010736] mb-3">
                            Quick presets
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {PRESETS.map((p) => (
                                <button
                                    key={p.label}
                                    type="button"
                                    onClick={() => applyPreset(p.value, p.unit)}
                                    className="px-3 py-2 text-sm border-2 border-[#e5dcb8] rounded-lg bg-white/70 hover:border-[#22396F] hover:bg-[#FCF1D0] text-[#010736] font-medium transition"
                                >
                                    {p.label} all sides
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Unit + Dimensions */}
                    <div className="mt-6 card p-5">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm font-semibold text-[#010736]">
                                Crop amounts
                            </p>
                            <div className="flex gap-1 bg-[#FCF1D0] rounded-lg p-1 border border-[#e5dcb8]">
                                {(["mm", "in", "pt"] as Unit[]).map((u) => (
                                    <button
                                        key={u}
                                        type="button"
                                        onClick={() => setUnit(u)}
                                        className={`text-xs px-3 py-1 rounded-md transition font-medium ${unit === u
                                                ? "bg-white text-[#010736] shadow-sm"
                                                : "text-[#0D1C42]/60 hover:text-[#010736]"
                                            }`}
                                    >
                                        {u}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-[#0D1C42]/60 mb-1">
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
                                    className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[#0D1C42]/60 mb-1">
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
                                    className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[#0D1C42]/60 mb-1">
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
                                    className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[#0D1C42]/60 mb-1">
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
                                    className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                                />
                            </div>
                        </div>

                        {/* Visual preview */}
                        <div className="mt-5 flex justify-center">
                            <div className="relative w-48 h-64 bg-[#FCF1D0] border-2 border-[#e5dcb8] rounded-lg">
                                <div
                                    className="absolute bg-white border-2 border-[#22396F] border-dashed rounded"
                                    style={{
                                        top: `${Math.min(top * 3, 40)}px`,
                                        bottom: `${Math.min(bottom * 3, 40)}px`,
                                        left: `${Math.min(left * 3, 40)}px`,
                                        right: `${Math.min(right * 3, 40)}px`,
                                    }}
                                >
                                    <div className="absolute inset-0 flex items-center justify-center text-xs text-[#0D1C42]/40">
                                        visible area
                                    </div>
                                </div>
                            </div>
                        </div>
                        <p className="text-center text-xs text-[#0D1C42]/50 mt-2">
                            Preview (approximate) — the outer border shows what gets removed.
                        </p>
                    </div>

                    {/* Apply to */}
                    <div className="mt-6 card p-5">
                        <p className="text-sm font-semibold text-[#010736] mb-3">
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
                                    <p className="font-medium text-sm text-[#010736]">
                                        All pages
                                    </p>
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
                                    <p className="font-medium text-sm text-[#010736]">
                                        First page only
                                    </p>
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
                                    <p className="font-medium text-sm text-[#010736]">
                                        Last page only
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
                        onClick={handleCrop}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Crop PDF"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Cropping..."}
                    </h2>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">✂️</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Crop complete
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your cropped PDF is ready to download.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download cropped PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Crop another PDF
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Crop failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}