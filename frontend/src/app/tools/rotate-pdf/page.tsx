"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    RotateCw,
    RotateCcw as RotateCcwIcon,
    Upload,
    FileText,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Sparkles,
    FlipVertical,
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

type Angle = 90 | 180 | 270;
type PageMode = "all" | "specific";

const ANGLES: {
    id: Angle;
    label: string;
    sub: string;
    Icon: any;
}[] = [
        { id: 90, label: "90°", sub: "Clockwise", Icon: RotateCw },
        { id: 180, label: "180°", sub: "Upside down", Icon: FlipVertical },
        { id: 270, label: "270°", sub: "Counter-clockwise", Icon: RotateCcwIcon },
    ];

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
        const startedAt = Date.now();
        pollRef.current = setInterval(async () => {
            try {
                if (Date.now() - startedAt > 120000) {
                    stopPolling();
                    setLoading(false);
                    setError("The PDF worker is taking too long to respond. Please try again.");
                    return;
                }
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
            formData.append("pages", pageMode === "all" ? "all" : pages.trim());

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

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    return (
        <ToolLayout
            icon={RotateCw}
            title="Rotate PDF"
            description="Rotate every page or just specific ones to the orientation you need."
            color="from-cyan-500 to-cyan-600"
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
                            border: dragActive ? "2px solid #06b6d4" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(6, 182, 212, 0.2), 0 0 0 4px rgba(6, 182, 212, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-cyan-500/5 via-transparent to-blue-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {file ? (
                                <>
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-cyan-600 shadow-lg mb-5">
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

                    {/* Angle selection */}
                    {file && (
                        <div className="mt-6 animate-fade-in">
                            <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-cyan-500" />
                                <span>Rotation angle</span>
                            </h3>

                            <div className="grid grid-cols-3 gap-2">
                                {ANGLES.map((a) => {
                                    const active = angle === a.id;
                                    const Icon = a.Icon;
                                    return (
                                        <button
                                            key={a.id}
                                            type="button"
                                            onClick={() => setAngle(a.id)}
                                            className={`group/btn p-4 rounded-2xl border-2 text-center transition-all ${active
                                                ? "border-cyan-500 bg-cyan-50/70 shadow-sm"
                                                : "border-[#e5dcb8] bg-white/70 hover:border-cyan-300 hover:bg-white"
                                                }`}
                                        >
                                            <div
                                                className={`inline-flex items-center justify-center w-12 h-12 rounded-xl mb-3 transition-all ${active
                                                    ? "bg-gradient-to-br from-cyan-500 to-cyan-600 shadow-md"
                                                    : "bg-[#FCF1D0] group-hover/btn:bg-white"
                                                    }`}
                                            >
                                                <Icon
                                                    className={`w-6 h-6 transition-all ${active ? "text-white" : "text-[#0D1C42]"
                                                        }`}
                                                    strokeWidth={2.5}
                                                />
                                            </div>
                                            <div
                                                className={`text-sm font-bold mb-0.5 ${active ? "text-cyan-700" : "text-[#010736]"
                                                    }`}
                                            >
                                                {a.label}
                                            </div>
                                            <div className="text-xs text-[#0D1C42]/60">
                                                {a.sub}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Page selection */}
                    {file && (
                        <div className="mt-6 animate-fade-in">
                            <h3 className="text-sm font-semibold text-[#010736] mb-3">
                                Which pages to rotate
                            </h3>

                            {/* Segmented control */}
                            <div className="grid grid-cols-2 gap-2 p-1 bg-white/70 rounded-2xl border border-[#e5dcb8]">
                                <button
                                    type="button"
                                    onClick={() => setPageMode("all")}
                                    className={`py-3 rounded-xl font-medium text-sm transition-all ${pageMode === "all"
                                        ? "bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-md"
                                        : "text-[#0D1C42]/70 hover:bg-white"
                                        }`}
                                >
                                    All pages
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPageMode("specific")}
                                    className={`py-3 rounded-xl font-medium text-sm transition-all ${pageMode === "specific"
                                        ? "bg-gradient-to-br from-cyan-500 to-cyan-600 text-white shadow-md"
                                        : "text-[#0D1C42]/70 hover:bg-white"
                                        }`}
                                >
                                    Specific pages
                                </button>
                            </div>

                            <p className="text-xs text-[#0D1C42]/60 mt-3 px-1">
                                {pageMode === "all"
                                    ? "Every page in the PDF will be rotated."
                                    : "Enter page numbers like 1,3,5 or ranges like 1-3."}
                            </p>

                            {pageMode === "specific" && (
                                <div className="mt-4 animate-fade-in">
                                    <input
                                        type="text"
                                        value={pages}
                                        onChange={(e) => setPages(e.target.value)}
                                        placeholder="e.g., 1,3,5-7"
                                        className="w-full px-4 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:bg-white text-[#010736] font-mono text-sm transition-all"
                                    />
                                </div>
                            )}
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
                        onClick={handleRotate}
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
                                <RotateCw className="w-5 h-5" />
                                <span>Rotate PDF</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-cyan-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-cyan-500 to-cyan-600 shadow-xl mb-5">
                            <RotateCw className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Rotating pages"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-cyan-500 to-cyan-600 rounded-full animate-progress" />
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
                            Rotation complete
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Your PDF is ready to download
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download rotated PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Rotate another PDF</span>
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
                                Rotation failed
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