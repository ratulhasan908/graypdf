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

export default function UnlockPdfPage() {
    const [file, setFile] = useState<File | null>(null);
    const [password, setPassword] = useState("");
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
        setJob(null);
        setError(null);
        setLoading(false);
    }

    return (
        <ToolLayout
            icon="🔓"
            title="Unlock PDF"
            description="Remove password protection from your PDF."
            color="from-green-500 to-green-600"
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
                        <label className="block text-sm font-semibold text-[#010736] mb-2">
                            Password (leave empty if PDF has no password)
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                            placeholder="Current PDF password"
                        />
                        <p className="text-xs text-[#0D1C42]/60 mt-2">
                            If the PDF is protected, enter the password to remove it.
                        </p>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleUnlock}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Unlock PDF"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Unlocking..."}
                    </h2>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">🔓</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        PDF unlocked
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Password removed. Your unlocked PDF is ready.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download unlocked PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Unlock another PDF
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Unlock failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}