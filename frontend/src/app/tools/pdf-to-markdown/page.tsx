"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    FileText,
    Upload,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Sparkles,
    Hash,
    List,
    Link as LinkIcon,
    Quote,
    Code as CodeIcon,
    AlignLeft,
    BookOpen,
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

type Layout2 = "preserve" | "simple";

const LAYOUT_OPTIONS: {
    id: Layout2;
    title: string;
    desc: string;
    Icon: any;
    badge?: string;
}[] = [
        {
            id: "preserve",
            title: "Preserve structure",
            desc: "Keeps headings, lists, tables, and links as Markdown.",
            Icon: BookOpen,
            badge: "Recommended",
        },
        {
            id: "simple",
            title: "Simple",
            desc: "Plain text per page with separators.",
            Icon: AlignLeft,
        },
    ];

const SYNTAX_HINTS = [
    { Icon: Hash, label: "Headings" },
    { Icon: List, label: "Lists" },
    { Icon: LinkIcon, label: "Links" },
    { Icon: Quote, label: "Quotes" },
    { Icon: CodeIcon, label: "Code" },
];

export default function PdfToMarkdownPage() {
    const [file, setFile] = useState<File | null>(null);
    const [layout, setLayout] = useState<Layout2>("preserve");
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

    async function handleConvert() {
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
            formData.append("layout", layout);

            const result = await apiUpload<Job>("/tools/pdf-to-markdown/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Conversion failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setLayout("preserve");
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
            icon={FileText}
            title="PDF to Markdown"
            description="Extract text and structure from your PDF as clean Markdown."
            color="from-teal-500 to-teal-600"
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
                            border: dragActive ? "2px solid #14b8a6" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(20, 184, 166, 0.2), 0 0 0 4px rgba(20, 184, 166, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-teal-500/5 via-transparent to-cyan-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {file ? (
                                <>
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-600 shadow-lg mb-5">
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

                    {/* Layout selection */}
                    {file && (
                        <div className="mt-6 animate-fade-in">
                            <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-teal-500" />
                                <span>Output style</span>
                            </h3>

                            <div className="space-y-2">
                                {LAYOUT_OPTIONS.map((opt) => {
                                    const active = layout === opt.id;
                                    const Icon = opt.Icon;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => setLayout(opt.id)}
                                            className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-start gap-3 ${active
                                                    ? "border-teal-500 bg-teal-50/70 shadow-sm"
                                                    : "border-[#e5dcb8] bg-white/70 hover:border-teal-300 hover:bg-white"
                                                }`}
                                        >
                                            <div
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${active
                                                        ? "bg-gradient-to-br from-teal-500 to-teal-600 shadow-sm"
                                                        : "bg-[#FCF1D0]"
                                                    }`}
                                            >
                                                <Icon
                                                    className={`w-5 h-5 ${active ? "text-white" : "text-[#0D1C42]/60"
                                                        }`}
                                                    strokeWidth={2.5}
                                                />
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                                    <p className="font-semibold text-sm text-[#010736]">
                                                        {opt.title}
                                                    </p>
                                                    {opt.badge && (
                                                        <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                            {opt.badge}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-[#0D1C42]/60">
                                                    {opt.desc}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Syntax preview */}
                            <div className="mt-4">
                                <p className="text-xs text-[#0D1C42]/50 mb-2 font-medium">
                                    Extracted as Markdown:
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    {SYNTAX_HINTS.map(({ Icon, label }) => (
                                        <span
                                            key={label}
                                            className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[#0D1C42]/60 bg-[#FCF1D0]/60 border border-[#e5dcb8] px-2 py-1 rounded-md"
                                        >
                                            <Icon className="w-3 h-3" strokeWidth={2.5} />
                                            <span>{label}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Info */}
                            <div className="mt-4 px-3 py-2 bg-[#FCF1D0]/60 border border-[#e5dcb8] rounded-xl flex items-start gap-2">
                                <AlertCircle className="w-3.5 h-3.5 text-[#0D1C42]/50 shrink-0 mt-0.5" />
                                <p className="text-xs text-[#0D1C42]/60">
                                    Perfect for feeding docs to LLMs, taking notes, or migrating
                                    content. Scanned PDFs need OCR first.
                                </p>
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
                        onClick={handleConvert}
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
                                <FileText className="w-5 h-5" />
                                <span>Convert to Markdown</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-teal-500/5 via-transparent to-teal-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-teal-500 to-teal-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Extracting content"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-teal-500 to-teal-600 rounded-full animate-progress" />
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
                            Conversion complete
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Your Markdown file is ready. Open it in any editor or feed it to
                            an LLM.
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download Markdown</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Convert another PDF</span>
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
                                Conversion failed
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