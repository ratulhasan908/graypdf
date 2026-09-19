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

export default function ProtectPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
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
        setAllowPrinting(true);
        setAllowCopying(true);
        setJob(null);
        setError(null);
        setLoading(false);
    }

    return (
        <ToolLayout
            icon="🔒"
            title="Protect PDF"
            description="Add password protection and permissions to your PDF."
            color="from-red-500 to-red-600"
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

                    <div className="mt-6 card p-5">
                        <p className="text-sm font-semibold text-[#010736] mb-3">
                            Password protection
                        </p>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-[#0D1C42]/60 mb-1">
                                    Password (min 4 characters)
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                                    placeholder="••••••••"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-[#0D1C42]/60 mb-1">
                                    Confirm password
                                </label>
                                <input
                                    type="password"
                                    value={passwordConfirm}
                                    onChange={(e) => setPasswordConfirm(e.target.value)}
                                    className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5 mt-3">
                            ⚠️ Remember your password — it cannot be recovered.
                        </p>
                    </div>

                    <div className="mt-6 card p-5">
                        <p className="text-sm font-semibold text-[#010736] mb-3">
                            Permissions
                        </p>
                        <label className="flex items-center gap-3 cursor-pointer mb-3">
                            <input
                                type="checkbox"
                                checked={allowPrinting}
                                onChange={(e) => setAllowPrinting(e.target.checked)}
                                className="accent-[#22396F]"
                            />
                            <span className="text-sm text-[#010736]">Allow printing</span>
                        </label>
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={allowCopying}
                                onChange={(e) => setAllowCopying(e.target.checked)}
                                className="accent-[#22396F]"
                            />
                            <span className="text-sm text-[#010736]">
                                Allow text copying
                            </span>
                        </label>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleProtect}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Protect PDF"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Protecting..."}
                    </h2>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">🔒</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        PDF protected
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your PDF is now password-protected. Download it and use the
                        password to open it.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download protected PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Protect another PDF
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Protect failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}