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

    return (
        <ToolLayout
            icon="🔢"
            title="Add Page Numbers"
            description="Insert page numbers into your PDF with full control over position and format."
            color="from-indigo-500 to-indigo-600"
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
                            Position
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                            {POSITIONS.map((p) => (
                                <button
                                    key={p.value}
                                    type="button"
                                    onClick={() => setPosition(p.value)}
                                    className={`py-3 rounded-xl border-2 text-center transition ${position === p.value
                                            ? "border-[#22396F] bg-[#FCF1D0] text-[#010736]"
                                            : "border-[#e5dcb8] bg-white/70 text-[#0D1C42] hover:border-[#22396F]"
                                        }`}
                                >
                                    <div className="text-xl">{p.grid}</div>
                                    <div className="text-xs mt-1 font-medium">{p.label}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mt-6 card p-5">
                        <p className="text-sm font-semibold text-[#010736] mb-3">
                            Format
                        </p>
                        <div className="space-y-3">
                            {FORMATS.map((f) => (
                                <label
                                    key={f.value}
                                    className="flex items-start gap-3 cursor-pointer"
                                >
                                    <input
                                        type="radio"
                                        name="format"
                                        value={f.value}
                                        checked={format === f.value}
                                        onChange={() => setFormat(f.value)}
                                        className="mt-1"
                                    />
                                    <div>
                                        <p className="font-medium text-sm text-[#010736]">
                                            {f.label}
                                        </p>
                                        <p className="text-xs text-[#0D1C42]/60">
                                            Example: {f.example}
                                        </p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="mt-6 card p-5 space-y-4">
                        <p className="text-sm font-semibold text-[#010736]">
                            Fine-tuning
                        </p>

                        <div>
                            <label className="block text-sm text-[#010736] mb-1">
                                Starting number: {start}
                            </label>
                            <input
                                type="number"
                                min={0}
                                max={9999}
                                value={start}
                                onChange={(e) => setStart(Number(e.target.value) || 1)}
                                className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-[#010736] mb-1">
                                Font size: {fontSize}px
                            </label>
                            <input
                                type="range"
                                min={8}
                                max={30}
                                value={fontSize}
                                onChange={(e) => setFontSize(Number(e.target.value))}
                                className="w-full accent-[#22396F]"
                            />
                        </div>

                        <div>
                            <label className="block text-sm text-[#010736] mb-1">
                                Margin from edge: {margin}px
                            </label>
                            <input
                                type="range"
                                min={20}
                                max={100}
                                value={margin}
                                onChange={(e) => setMargin(Number(e.target.value))}
                                className="w-full accent-[#22396F]"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleApply}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Add page numbers"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Adding numbers..."}
                    </h2>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">🔢</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Page numbers added
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your PDF is ready to download.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download numbered PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Add to another PDF
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}