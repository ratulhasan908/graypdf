"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    Droplet,
    Upload,
    FileText,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Sparkles,
    Type,
    Palette,
    Move,
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

type Position = "diagonal" | "center";

const COLOR_PRESETS = [
    { name: "Red", value: "#FF0000" },
    { name: "Blue", value: "#0000FF" },
    { name: "Black", value: "#000000" },
    { name: "Gray", value: "#888888" },
    { name: "Green", value: "#10B981" },
];

export default function WatermarkPage() {
    const [file, setFile] = useState<File | null>(null);
    const [text, setText] = useState("CONFIDENTIAL");
    const [fontSize, setFontSize] = useState(60);
    const [opacity, setOpacity] = useState(0.3);
    const [color, setColor] = useState("#FF0000");
    const [position, setPosition] = useState<Position>("diagonal");
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

    async function handleWatermark() {
        if (!file) {
            setError("Please select a PDF file.");
            return;
        }
        if (!text.trim()) {
            setError("Please enter watermark text.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            formData.append("files", file);
            formData.append("text", text.trim());
            formData.append("font_size", String(fontSize));
            formData.append("opacity", String(opacity));
            formData.append("color", color);
            formData.append("position", position);

            const result = await apiUpload<Job>("/tools/watermark/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Watermark failed.");
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

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    return (
        <ToolLayout
            icon={Droplet}
            title="Watermark PDF"
            description="Stamp text over every page — choose size, color, opacity, and angle."
            color="from-sky-500 to-sky-600"
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
                            border: dragActive ? "2px solid #0ea5e9" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(14, 165, 233, 0.2), 0 0 0 4px rgba(14, 165, 233, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-sky-500/5 via-transparent to-blue-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {file ? (
                                <>
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 shadow-lg mb-5">
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
                            {/* Text */}
                            <div>
                                <label className="text-sm font-semibold text-[#010736] mb-2 flex items-center gap-2">
                                    <Type className="w-4 h-4 text-sky-500" />
                                    <span>Watermark text</span>
                                </label>
                                <input
                                    type="text"
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    maxLength={50}
                                    placeholder="e.g., CONFIDENTIAL"
                                    className="w-full px-4 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white text-[#010736] transition-all"
                                />
                                <p className="text-xs text-[#0D1C42]/50 mt-1.5">
                                    {text.length}/50 characters
                                </p>
                            </div>

                            {/* Font size slider */}
                            <div>
                                <label className="text-sm font-semibold text-[#010736] mb-2 flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-sky-500" />
                                        Font size
                                    </span>
                                    <span className="text-xs font-mono bg-white/70 px-2 py-0.5 rounded-md border border-[#e5dcb8] text-[#0D1C42]">
                                        {fontSize}px
                                    </span>
                                </label>
                                <input
                                    type="range"
                                    min={20}
                                    max={150}
                                    value={fontSize}
                                    onChange={(e) => setFontSize(Number(e.target.value))}
                                    className="w-full accent-sky-500"
                                />
                            </div>

                            {/* Opacity slider */}
                            <div>
                                <label className="text-sm font-semibold text-[#010736] mb-2 flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                        <Droplet className="w-4 h-4 text-sky-500" />
                                        Opacity
                                    </span>
                                    <span className="text-xs font-mono bg-white/70 px-2 py-0.5 rounded-md border border-[#e5dcb8] text-[#0D1C42]">
                                        {Math.round(opacity * 100)}%
                                    </span>
                                </label>
                                <input
                                    type="range"
                                    min={5}
                                    max={100}
                                    value={opacity * 100}
                                    onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                                    className="w-full accent-sky-500"
                                />
                            </div>

                            {/* Color */}
                            <div>
                                <label className="text-sm font-semibold text-[#010736] mb-2 flex items-center gap-2">
                                    <Palette className="w-4 h-4 text-sky-500" />
                                    <span>Color</span>
                                </label>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {COLOR_PRESETS.map((c) => (
                                        <button
                                            key={c.value}
                                            type="button"
                                            onClick={() => setColor(c.value)}
                                            className={`w-10 h-10 rounded-xl border-2 transition-all ${color === c.value
                                                    ? "border-[#010736] scale-110 shadow-md"
                                                    : "border-[#e5dcb8] hover:border-[#22396F]"
                                                }`}
                                            style={{ backgroundColor: c.value }}
                                            title={c.name}
                                            aria-label={`Set color to ${c.name}`}
                                        />
                                    ))}
                                    <label className="relative cursor-pointer">
                                        <input
                                            type="color"
                                            value={color}
                                            onChange={(e) => setColor(e.target.value)}
                                            className="absolute inset-0 opacity-0 cursor-pointer w-10 h-10"
                                        />
                                        <div className="w-10 h-10 rounded-xl border-2 border-dashed border-[#c8bf9c] flex items-center justify-center text-[#0D1C42]/50 hover:border-[#22396F] transition">
                                            <Palette className="w-4 h-4" />
                                        </div>
                                    </label>
                                </div>
                            </div>

                            {/* Position */}
                            <div>
                                <label className="text-sm font-semibold text-[#010736] mb-2 flex items-center gap-2">
                                    <Move className="w-4 h-4 text-sky-500" />
                                    <span>Position</span>
                                </label>
                                <div className="grid grid-cols-2 gap-2 p-1 bg-white/70 rounded-2xl border border-[#e5dcb8]">
                                    <button
                                        type="button"
                                        onClick={() => setPosition("diagonal")}
                                        className={`py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${position === "diagonal"
                                                ? "bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-md"
                                                : "text-[#0D1C42]/70 hover:bg-white"
                                            }`}
                                    >
                                        <span className="text-lg leading-none">⟋</span>
                                        <span>Diagonal</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setPosition("center")}
                                        className={`py-3 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${position === "center"
                                                ? "bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-md"
                                                : "text-[#0D1C42]/70 hover:bg-white"
                                            }`}
                                    >
                                        <span className="text-lg leading-none">⊞</span>
                                        <span>Center</span>
                                    </button>
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
                        onClick={handleWatermark}
                        disabled={!file || loading || !text.trim()}
                        className="btn-primary mt-6 w-full flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Uploading...</span>
                            </>
                        ) : (
                            <>
                                <Droplet className="w-5 h-5" />
                                <span>Add watermark</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-sky-500/5 via-transparent to-sky-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-sky-500 to-sky-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Adding watermark"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-sky-500 to-sky-600 rounded-full animate-progress" />
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
                            Watermark added
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Your watermarked PDF is ready
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download watermarked PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Watermark another PDF</span>
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
                                Watermark failed
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