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

type Position = "diagonal" | "center";

const COLOR_PRESETS = [
    { name: "Red", value: "#FF0000" },
    { name: "Blue", value: "#0000FF" },
    { name: "Gray", value: "#888888" },
    { name: "Black", value: "#000000" },
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

    return (
        <ToolLayout
            icon="💧"
            title="Watermark PDF"
            description="Stamp text over your PDF. Choose font size, color, opacity, and position."
            color="from-sky-500 to-sky-600"
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

                    <div className="mt-6 card p-5 space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-[#010736] mb-2">
                                Watermark text
                            </label>
                            <input
                                type="text"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736]"
                                placeholder="e.g., CONFIDENTIAL"
                                maxLength={50}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-[#010736] mb-2">
                                Font size: {fontSize}px
                            </label>
                            <input
                                type="range"
                                min={20}
                                max={150}
                                value={fontSize}
                                onChange={(e) => setFontSize(Number(e.target.value))}
                                className="w-full accent-[#22396F]"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-[#010736] mb-2">
                                Opacity: {Math.round(opacity * 100)}%
                            </label>
                            <input
                                type="range"
                                min={5}
                                max={100}
                                value={opacity * 100}
                                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                                className="w-full accent-[#22396F]"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-[#010736] mb-2">
                                Color
                            </label>
                            <div className="flex items-center gap-3 flex-wrap">
                                {COLOR_PRESETS.map((c) => (
                                    <button
                                        key={c.value}
                                        type="button"
                                        onClick={() => setColor(c.value)}
                                        className={`w-10 h-10 rounded-full border-2 transition ${color === c.value
                                                ? "border-[#010736] scale-110"
                                                : "border-[#e5dcb8]"
                                            }`}
                                        style={{ backgroundColor: c.value }}
                                        title={c.name}
                                    />
                                ))}
                                <input
                                    type="color"
                                    value={color}
                                    onChange={(e) => setColor(e.target.value)}
                                    className="w-10 h-10 rounded border border-[#e5dcb8] cursor-pointer"
                                    title="Custom color"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-[#010736] mb-2">
                                Position
                            </label>
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setPosition("diagonal")}
                                    className={`flex-1 py-3 rounded-xl border-2 transition ${position === "diagonal"
                                            ? "border-[#22396F] bg-[#FCF1D0] text-[#010736]"
                                            : "border-[#e5dcb8] bg-white/70 text-[#0D1C42]"
                                        }`}
                                >
                                    <div className="text-lg">⟋</div>
                                    <div className="text-xs mt-1">Diagonal</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPosition("center")}
                                    className={`flex-1 py-3 rounded-xl border-2 transition ${position === "center"
                                            ? "border-[#22396F] bg-[#FCF1D0] text-[#010736]"
                                            : "border-[#e5dcb8] bg-white/70 text-[#0D1C42]"
                                        }`}
                                >
                                    <div className="text-lg">⊞</div>
                                    <div className="text-xs mt-1">Center</div>
                                </button>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleWatermark}
                        disabled={!file || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Add watermark"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Watermarking..."}
                    </h2>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">💧</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Watermark added
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your watermarked PDF is ready to download.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download watermarked PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Watermark another PDF
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Watermark failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}