"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    LockOpen,
    Upload,
    FileText,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Key,
    Eye,
    EyeOff,
    Shield,
    Unlock,
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

export default function UnlockPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
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
        setShowPassword(false);
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
            icon={LockOpen}
            title="Unlock PDF"
            description="Remove password protection from your PDF files."
            color="from-green-500 to-green-600"
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
                            border: dragActive ? "2px solid #10b981" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(16, 185, 129, 0.2), 0 0 0 4px rgba(16, 185, 129, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-green-500/5 via-transparent to-emerald-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {file ? (
                                <>
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 shadow-lg mb-5">
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
                                        <Shield className="w-3 h-3" />
                                        <span>Files stay private · auto-deleted</span>
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

                    {/* Password input */}
                    {file && (
                        <div className="mt-6 animate-fade-in">
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                    <Key className="w-4 h-4 text-green-500" />
                                    <span>PDF password</span>
                                </h3>

                                <div className="relative">
                                    <LockOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0D1C42]/40 pointer-events-none" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Enter the password to unlock"
                                        className="w-full pl-10 pr-10 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-green-500 focus:bg-white text-[#010736] transition-all"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0D1C42]/50 hover:text-[#0D1C42] transition"
                                        aria-label={showPassword ? "Hide password" : "Show password"}
                                    >
                                        {showPassword ? (
                                            <EyeOff className="w-4 h-4" />
                                        ) : (
                                            <Eye className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>

                                <p className="text-xs text-[#0D1C42]/60 mt-2">
                                    If your PDF has no password, leave this empty.
                                </p>
                            </div>

                            {/* Info box */}
                            <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2">
                                <Shield className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                                <p className="text-xs text-green-800">
                                    Passwords are never stored on our servers — they are used
                                    only to decrypt your file during processing.
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
                        onClick={handleUnlock}
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
                                <Unlock className="w-5 h-5" />
                                <span>Unlock PDF</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 via-transparent to-green-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-green-500 to-green-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Unlocking PDF"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-green-500 to-green-600 rounded-full animate-progress" />
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
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-green-500 to-emerald-600 shadow-xl mb-5 animate-scale-in">
                            <LockOpen className="w-9 h-9 text-white" strokeWidth={2.5} />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            PDF unlocked
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Password removed. Your file is ready.
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download unlocked PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Unlock another PDF</span>
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
                                Unlock failed
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