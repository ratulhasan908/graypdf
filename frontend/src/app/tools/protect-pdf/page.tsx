"use client";

import { useState, ChangeEvent, DragEvent, useRef } from "react";
import {
    Lock,
    Upload,
    FileText,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Shield,
    Printer,
    Copy,
    Eye,
    EyeOff,
    Key,
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

export default function ProtectPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [allowPrinting, setAllowPrinting] = useState(true);
    const [allowCopying, setAllowCopying] = useState(true);
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

    async function handleProtect() {
        if (!file) {
            setError("Please select a PDF file.");
            return;
        }
        if (password.length < 4) {
            setError("Password must be at least 4 characters.");
            return;
        }
        if (password !== passwordConfirm) {
            setError("Passwords do not match.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const formData = new FormData();
            formData.append("files", file);
            formData.append("password", password);
            formData.append("allow_printing", String(allowPrinting));
            formData.append("allow_copying", String(allowCopying));

            const result = await apiUpload<Job>("/tools/protect/", formData);
            setJob(result);
            refreshUsage();

            if (result.status === "completed" || result.status === "failed") {
                setLoading(false);
            } else {
                startPolling(result.id);
            }
        } catch (err: any) {
            setError(err.message || "Protect failed.");
            setLoading(false);
        }
    }

    function reset() {
        stopPolling();
        setFile(null);
        setPassword("");
        setPasswordConfirm("");
        setShowPassword(false);
        setAllowPrinting(true);
        setAllowCopying(true);
        setJob(null);
        setError(null);
        setLoading(false);
    }

    function formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    // Password strength indicator
    function getStrength(pwd: string): {
        score: number;
        label: string;
        color: string;
    } {
        if (pwd.length === 0) return { score: 0, label: "", color: "" };
        let score = 0;
        if (pwd.length >= 4) score++;
        if (pwd.length >= 8) score++;
        if (/[A-Z]/.test(pwd)) score++;
        if (/[0-9]/.test(pwd)) score++;
        if (/[^A-Za-z0-9]/.test(pwd)) score++;

        if (score <= 2) return { score, label: "Weak", color: "bg-red-500" };
        if (score <= 3) return { score, label: "Fair", color: "bg-amber-500" };
        if (score <= 4) return { score, label: "Good", color: "bg-emerald-500" };
        return { score, label: "Strong", color: "bg-emerald-600" };
    }

    const strength = getStrength(password);

    return (
        <ToolLayout
            icon={Lock}
            title="Protect PDF"
            description="Add password protection and permissions to your PDF."
            color="from-red-500 to-red-600"
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
                            border: dragActive ? "2px solid #ef4444" : "2px dashed #e5dcb8",
                            boxShadow: dragActive
                                ? "0 20px 60px rgba(239, 68, 68, 0.2), 0 0 0 4px rgba(239, 68, 68, 0.1)"
                                : undefined,
                        }}
                    >
                        <div
                            className={`absolute inset-0 rounded-3xl bg-gradient-to-br from-red-500/5 via-transparent to-rose-500/5 transition-opacity ${dragActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                        />

                        <div className="relative">
                            {file ? (
                                <>
                                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 shadow-lg mb-5">
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

                    {/* Options */}
                    {file && (
                        <div className="mt-6 space-y-5 animate-fade-in">
                            {/* Password */}
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3 flex items-center gap-2">
                                    <Key className="w-4 h-4 text-red-500" />
                                    <span>Set password</span>
                                </h3>

                                <div className="space-y-3">
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0D1C42]/40 pointer-events-none" />
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            placeholder="Password (min 4 characters)"
                                            className="w-full pl-10 pr-10 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white text-[#010736] transition-all"
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

                                    {/* Password strength */}
                                    {password.length > 0 && (
                                        <div className="animate-fade-in">
                                            <div className="flex gap-1 mb-1.5">
                                                {[1, 2, 3, 4, 5].map((i) => (
                                                    <div
                                                        key={i}
                                                        className={`h-1 flex-1 rounded-full transition-all ${i <= strength.score ? strength.color : "bg-[#e5dcb8]"
                                                            }`}
                                                    />
                                                ))}
                                            </div>
                                            <p className="text-xs text-[#0D1C42]/60">
                                                Strength:{" "}
                                                <span className="font-medium">{strength.label}</span>
                                            </p>
                                        </div>
                                    )}

                                    <div className="relative">
                                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0D1C42]/40 pointer-events-none" />
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            value={passwordConfirm}
                                            onChange={(e) => setPasswordConfirm(e.target.value)}
                                            placeholder="Confirm password"
                                            className={`w-full pl-10 pr-3 py-3 border rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white text-[#010736] transition-all ${passwordConfirm.length > 0 &&
                                                    password !== passwordConfirm
                                                    ? "border-red-300 bg-red-50/50"
                                                    : "border-[#e5dcb8]"
                                                }`}
                                        />
                                    </div>

                                    {passwordConfirm.length > 0 && password !== passwordConfirm && (
                                        <p className="text-xs text-red-600 flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            Passwords do not match
                                        </p>
                                    )}
                                </div>

                                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-800">
                                        <strong>Remember your password</strong> — it cannot be
                                        recovered. Store it somewhere safe.
                                    </p>
                                </div>
                            </div>

                            {/* Permissions */}
                            <div>
                                <h3 className="text-sm font-semibold text-[#010736] mb-3">
                                    Permissions
                                </h3>

                                <div className="space-y-2">
                                    {/* Allow printing */}
                                    <button
                                        type="button"
                                        onClick={() => setAllowPrinting(!allowPrinting)}
                                        className="w-full text-left p-4 rounded-2xl border-2 border-[#e5dcb8] bg-white/70 hover:border-red-300 hover:bg-white transition-all flex items-center gap-3"
                                    >
                                        <div
                                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${allowPrinting
                                                    ? "bg-gradient-to-br from-red-500 to-red-600 shadow-sm"
                                                    : "bg-[#FCF1D0]"
                                                }`}
                                        >
                                            <Printer
                                                className={`w-5 h-5 ${allowPrinting ? "text-white" : "text-[#0D1C42]/50"
                                                    }`}
                                                strokeWidth={2.5}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm text-[#010736]">
                                                Allow printing
                                            </p>
                                            <p className="text-xs text-[#0D1C42]/60">
                                                Users can print the document
                                            </p>
                                        </div>
                                        {/* Toggle */}
                                        <div
                                            className={`relative w-11 h-6 rounded-full transition-all shrink-0 ${allowPrinting
                                                    ? "bg-gradient-to-r from-red-500 to-red-600"
                                                    : "bg-[#e5dcb8]"
                                                }`}
                                        >
                                            <div
                                                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all ${allowPrinting ? "left-5.5" : "left-0.5"
                                                    }`}
                                                style={{ left: allowPrinting ? "22px" : "2px" }}
                                            />
                                        </div>
                                    </button>

                                    {/* Allow copying */}
                                    <button
                                        type="button"
                                        onClick={() => setAllowCopying(!allowCopying)}
                                        className="w-full text-left p-4 rounded-2xl border-2 border-[#e5dcb8] bg-white/70 hover:border-red-300 hover:bg-white transition-all flex items-center gap-3"
                                    >
                                        <div
                                            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${allowCopying
                                                    ? "bg-gradient-to-br from-red-500 to-red-600 shadow-sm"
                                                    : "bg-[#FCF1D0]"
                                                }`}
                                        >
                                            <Copy
                                                className={`w-5 h-5 ${allowCopying ? "text-white" : "text-[#0D1C42]/50"
                                                    }`}
                                                strokeWidth={2.5}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-sm text-[#010736]">
                                                Allow text copying
                                            </p>
                                            <p className="text-xs text-[#0D1C42]/60">
                                                Users can copy text from the document
                                            </p>
                                        </div>
                                        <div
                                            className={`relative w-11 h-6 rounded-full transition-all shrink-0 ${allowCopying
                                                    ? "bg-gradient-to-r from-red-500 to-red-600"
                                                    : "bg-[#e5dcb8]"
                                                }`}
                                        >
                                            <div
                                                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all`}
                                                style={{ left: allowCopying ? "22px" : "2px" }}
                                            />
                                        </div>
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
                        onClick={handleProtect}
                        disabled={
                            !file ||
                            loading ||
                            password.length < 4 ||
                            password !== passwordConfirm
                        }
                        className="btn-primary mt-6 w-full flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Uploading...</span>
                            </>
                        ) : (
                            <>
                                <Lock className="w-5 h-5" />
                                <span>Protect PDF</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 via-transparent to-red-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-red-500 to-red-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Encrypting PDF"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-red-500 to-red-600 rounded-full animate-progress" />
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
                            <Shield className="w-9 h-9 text-white" strokeWidth={2.5} />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            PDF is protected
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-8">
                            Your PDF now requires a password to open
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download protected PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Protect another PDF</span>
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
                                Protection failed
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