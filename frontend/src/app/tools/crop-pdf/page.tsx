"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    Crop,
    Upload,
    FileText,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Sparkles,
    Ruler,
    Layout,
} from "lucide-react";
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

const APPLY_OPTIONS: { value: ApplyTo; label: string; desc: string }[] = [
    { value: "all", label: "All pages", desc: "Apply to every page" },
    { value: "first", label: "First page", desc: "Only the first page" },
    { value: "last", label: "Last page", desc: "Only the last page" },
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

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    return (
        <ToolLayout
            icon={Crop}
            title="Crop PDF"
            description="Trim margins from your PDF pages. Enter crop amounts for each side."
            color="from-orange-500 to-orange-600"
        >
            {!job && (
                <>
                    {/* Dropzone */}
                    <div
                        onDrop={handleDrop}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragActive(true);
                        }}
                        onDragLeave={() => setDragActive(false)}
                        onClick={() => document.getElementById("file-input")?.click()}
                        className={`relative group cursor-pointer rounded-3xl p-10 text-center transition-all duration-300 overflow-hidden ${dragActive
                                ? "bg-white/90 scale-[1.02] shadow-2xl"
                                : "bg-white/70 hover:bg-white hover:shadow-xl"
                            }`}
                        style={{
                            border: dragActive ? "2px solid #f97316" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(249, 115, 22, 0.2), 0 0 0 4px rgba(249, 115, 22, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-orange-500/5 via-transparent to-amber-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {file ? (
                                <>
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-lg mb-5">
                                        <FileText className="w-7 h-7 text-white" strokeWidth={2.5} />
                                    </div>
                                    <h3 className="text-lg font-bold text-[#010736] mb-1 truncate max-w-md mx-auto">
                                        {file.name}
                                    </h3>
                                    <p className="text-sm text-[#0D1C42]/60">
                                        {formatBytes(file.size)} — click to change
                                    </p>
                                </>
                            ) : (
                                <>
                                    <div
                                        className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#010736] to-[#22396f] shadow-lg mb-5 transition-transform duration-500 ${dragActive ? "scale-110 -translate-y-1" : "group-hover:scale-105"
                                            }`}
                                    >
                                        <Upload
                                            className={`w-7 h-7 text-[#FCF1D0] ${dragActive ? "animate-bounce-subtle" : ""
                                                }`}
                                            strokeWidth={2.5}
                                        />
                                    </div>
                                    <h3 className="text-xl font-bold text-[#010736] mb-2">
                                        {dragActive ? "Drop your PDF here" : "Select a PDF file"}
                                    </h3>
                                    <p className="text-sm text-[#0D1C42]/60 mb-4">
                                        Drag & drop or click to browse
                                    </p>
                                    <div className="inline-flex items-center gap-2 text-xs font-medium text-[#0D1C42]/50 bg-[#FCF1D0]/70 px-3 py-1.5 rounded-full border border-[#e5dcb8]">
                                        <FileText className="w-3 h-3" />
                                        <span>PDF only · max 50 MB</span>
                                    </div>
                                </>
                            )}
                        </div>

                        <input
                            id="file-input"
                            type="file"
                            accept="application/pdf"
                            onChange={handleFileChange}
                            className="hidden"
                        />
                    </div>

                    {/* Options */}
                    {file && (
                        <div className="mt-6 space-y-5 animate-fade-in">
                            {/* Presets */}
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-orange-500" />
                                    <span>Quick presets</span>
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {PRESETS.map((p) => (
                                        <button
                                            key={p.label}
                                            type="button"
                                            onClick={() => applyPreset(p.value, p.unit)}
                                            className="px-4 py-2 text-sm border-2 border-[#e5dcb8] rounded-xl bg-white/70 hover:border-orange-400 hover:bg-orange-50/50 text-[#010736] font-medium transition-all"
                                        >
                                            {p.label} all sides
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Unit + dimensions */}
                            <div>
                                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                    <h3 className="text-sm font-semibold text-[#010736] flex items-center gap-2">
                                        <Ruler className="w-4 h-4 text-orange-500" />
                                        <span>Crop amounts</span>
                                    </h3>

                                    {/* Unit selector */}
                                    <div className="flex gap-1 bg-[#FCF1D0]/70 rounded-xl p-1 border border-[#e5dcb8]">
                                        {(["mm", "in", "pt"] as Unit[]).map((u) => (
                                            <button
                                                key={u}
                                                type="button"
                                                onClick={() => setUnit(u)}
                                                className={`text-xs px-3 py-1 rounded-lg transition font-medium ${unit === u
                                                        ? "bg-white text-[#010736] shadow-sm"
                                                        : "text-[#0D1C42]/60 hover:text-[#010736]"
                                                    }`}
                                            >
                                                {u}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Visual preview */}
                                <div className="flex justify-center mb-5">
                                    <div className="relative w-40 h-56 bg-[#FCF1D0] border-2 border-[#e5dcb8] rounded-xl overflow-hidden">
                                        {/* Dashed visible area */}
                                        <div
                                            className="absolute bg-white border-2 border-dashed border-orange-500 rounded transition-all duration-300"
                                            style={{
                                                top: `${Math.min(top * 3, 40)}px`,
                                                bottom: `${Math.min(bottom * 3, 40)}px`,
                                                left: `${Math.min(left * 3, 40)}px`,
                                                right: `${Math.min(right * 3, 40)}px`,
                                            }}
                                        >
                                            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-[#0D1C42]/40 font-medium">
                                                visible area
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs font-medium text-[#0D1C42]/60 mb-1.5">
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
                                            className="w-full px-3 py-2.5 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white text-[#010736] transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[#0D1C42]/60 mb-1.5">
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
                                            className="w-full px-3 py-2.5 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white text-[#010736] transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[#0D1C42]/60 mb-1.5">
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
                                            className="w-full px-3 py-2.5 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white text-[#010736] transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[#0D1C42]/60 mb-1.5">
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
                                            className="w-full px-3 py-2.5 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white text-[#010736] transition-all"
                                        />
                                    </div>
                                </div>

                                <p className="text-xs text-[#0D1C42]/50 text-center mt-4">
                                    Preview is approximate — the dashed border shows the visible
                                    area after cropping.
                                </p>
                            </div>

                            {/* Apply to */}
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                    <Layout className="w-4 h-4 text-orange-500" />
                                    <span>Apply to</span>
                                </h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {APPLY_OPTIONS.map((opt) => {
                                        const active = applyTo === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setApplyTo(opt.value)}
                                                className={`p-3 rounded-2xl border-2 text-center transition-all ${active
                                                        ? "border-orange-500 bg-orange-50/70 shadow-sm"
                                                        : "border-[#e5dcb8] bg-white/70 hover:border-orange-300 hover:bg-white"
                                                    }`}
                                            >
                                                <div
                                                    className={`text-sm font-semibold mb-0.5 ${active ? "text-orange-700" : "text-[#010736]"
                                                        }`}
                                                >
                                                    {opt.label}
                                                </div>
                                                <div className="text-[10px] text-[#0D1C42]/60">
                                                    {opt.desc}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm flex items-start gap-2 animate-fade-in">
                            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        onClick={handleCrop}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Uploading...</span>
                            </>
                        ) : (
                            <>
                                <Crop className="w-5 h-5" />
                                <span>Crop PDF</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 via-transparent to-orange-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-500 to-orange-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Cropping pages"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-orange-500 to-orange-600 rounded-full animate-progress" />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Completed */}
            {job && job.status === "completed" && job.download_url && (
                <div className="card p-10 text-center animate-scale-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-emerald-500/5" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-xl mb-5 animate-scale-in">
                            <CheckCircle2 className="w-9 h-9 text-white" strokeWidth={2.5} />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            Crop complete
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Your cropped PDF is ready to download
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download cropped PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Crop another PDF</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Failed */}
            {job && job.status === "failed" && (
                <div className="card p-8 animate-fade-in border-red-200">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shrink-0 shadow-md">
                            <AlertCircle className="w-6 h-6 text-white" strokeWidth={2.5} />
                        </div>
                        <div className="flex-1">
                            <h3 className="font-bold text-[#010736] mb-1">
                                Crop failed
                            </h3>
                            <p className="text-sm text-[#0D1C42]/70 mb-4">
                                {job.error_message || "Something went wrong."}
                            </p>
                            <button
                                onClick={reset}
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Try again</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ToolLayout>
    );
}