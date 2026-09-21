"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    Hash,
    Upload,
    FileText,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Sparkles,
    Settings,
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

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    return (
        <ToolLayout
            icon={Hash}
            title="Add Page Numbers"
            description="Insert page numbers with full control over position, format, and style."
            color="from-indigo-500 to-indigo-600"
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
                            border: dragActive ? "2px solid #6366f1" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(99, 102, 241, 0.2), 0 0 0 4px rgba(99, 102, 241, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-500/5 via-transparent to-violet-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {file ? (
                                <>
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg mb-5">
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
                            {/* Position */}
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-indigo-500" />
                                    <span>Position</span>
                                </h3>
                                <div className="grid grid-cols-3 gap-2">
                                    {POSITIONS.map((p) => {
                                        const active = position === p.value;
                                        return (
                                            <button
                                                key={p.value}
                                                type="button"
                                                onClick={() => setPosition(p.value)}
                                                className={`py-3 rounded-2xl border-2 text-center transition-all ${active
                                                        ? "border-indigo-500 bg-indigo-50/70 shadow-sm"
                                                        : "border-[#e5dcb8] bg-white/70 hover:border-indigo-300 hover:bg-white"
                                                    }`}
                                            >
                                                <div
                                                    className={`text-2xl mb-1 ${active ? "text-indigo-600" : "text-[#0D1C42]/60"
                                                        }`}
                                                >
                                                    {p.grid}
                                                </div>
                                                <div
                                                    className={`text-xs font-medium ${active ? "text-indigo-700" : "text-[#010736]"
                                                        }`}
                                                >
                                                    {p.label}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Format */}
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3">
                                    Number format
                                </h3>
                                <div className="space-y-2">
                                    {FORMATS.map((f) => {
                                        const active = format === f.value;
                                        return (
                                            <button
                                                key={f.value}
                                                type="button"
                                                onClick={() => setFormat(f.value)}
                                                className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-center gap-3 ${active
                                                        ? "border-indigo-500 bg-indigo-50/70 shadow-sm"
                                                        : "border-[#e5dcb8] bg-white/70 hover:border-indigo-300 hover:bg-white"
                                                    }`}
                                            >
                                                <div
                                                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${active
                                                            ? "border-indigo-500 bg-indigo-500"
                                                            : "border-[#c8bf9c]"
                                                        }`}
                                                >
                                                    {active && (
                                                        <div className="w-2 h-2 rounded-full bg-white" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <p className="font-semibold text-sm text-[#010736]">
                                                            {f.label}
                                                        </p>
                                                        <code
                                                            className={`text-xs font-mono px-2 py-0.5 rounded ${active
                                                                    ? "bg-indigo-100 text-indigo-700"
                                                                    : "bg-[#FCF1D0] text-[#0D1C42]/60"
                                                                }`}
                                                        >
                                                            {f.example}
                                                        </code>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Fine-tuning */}
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                    <Settings className="w-4 h-4 text-indigo-500" />
                                    <span>Fine-tuning</span>
                                </h3>

                                <div className="space-y-4">
                                    {/* Start number */}
                                    <div>
                                        <label className="block text-sm text-[#010736] mb-2 flex items-center justify-between">
                                            <span>Starting number</span>
                                            <span className="text-xs font-mono bg-white/70 px-2 py-0.5 rounded-md border border-[#e5dcb8] text-[#0D1C42]">
                                                {start}
                                            </span>
                                        </label>
                                        <input
                                            type="number"
                                            min={0}
                                            max={9999}
                                            value={start}
                                            onChange={(e) => setStart(Number(e.target.value) || 1)}
                                            className="w-full px-4 py-2.5 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white text-[#010736] transition-all"
                                        />
                                    </div>

                                    {/* Font size */}
                                    <div>
                                        <label className="block text-sm text-[#010736] mb-2 flex items-center justify-between">
                                            <span>Font size</span>
                                            <span className="text-xs font-mono bg-white/70 px-2 py-0.5 rounded-md border border-[#e5dcb8] text-[#0D1C42]">
                                                {fontSize}px
                                            </span>
                                        </label>
                                        <input
                                            type="range"
                                            min={8}
                                            max={30}
                                            value={fontSize}
                                            onChange={(e) => setFontSize(Number(e.target.value))}
                                            className="w-full accent-indigo-500"
                                        />
                                    </div>

                                    {/* Margin */}
                                    <div>
                                        <label className="block text-sm text-[#010736] mb-2 flex items-center justify-between">
                                            <span>Margin from edge</span>
                                            <span className="text-xs font-mono bg-white/70 px-2 py-0.5 rounded-md border border-[#e5dcb8] text-[#0D1C42]">
                                                {margin}px
                                            </span>
                                        </label>
                                        <input
                                            type="range"
                                            min={20}
                                            max={100}
                                            value={margin}
                                            onChange={(e) => setMargin(Number(e.target.value))}
                                            className="w-full accent-indigo-500"
                                        />
                                    </div>
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
                        onClick={handleApply}
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
                                <Hash className="w-5 h-5" />
                                <span>Add page numbers</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-transparent to-indigo-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Adding numbers"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full animate-progress" />
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
                            Page numbers added
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Your numbered PDF is ready to download
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download numbered PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Add to another PDF</span>
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
                                Failed to add page numbers
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