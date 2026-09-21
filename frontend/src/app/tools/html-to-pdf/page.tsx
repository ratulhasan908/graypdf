"use client";

import { useState, useRef } from "react";
import {
    Code,
    CheckCircle2,
    Loader2,
    AlertCircle,
    Download,
    RotateCcw,
    Sparkles,
    Wand2,
    FileCode,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
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

const SAMPLE_HTML = `<h1>Hello GrayPDF</h1>
<p>This is a <strong>sample</strong> HTML document.</p>
<ul>
  <li>Point one</li>
  <li>Point two</li>
  <li>Point three</li>
</ul>
<table border="1" cellpadding="6">
  <tr><th>Item</th><th>Price</th></tr>
  <tr><td>Widget</td><td>$10</td></tr>
  <tr><td>Gadget</td><td>$25</td></tr>
</table>`;

export default function HtmlToPdfPage() {
    const [html, setHtml] = useState(SAMPLE_HTML);
    const [loading, setLoading] = useState(false);
    const [job, setJob] = useState<Job | null>(null);
    const [error, setError] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { refreshUsage } = useAuth();

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
        if (!html.trim()) {
            setError("Please enter some HTML content.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const result = await apiFetch<Job>("/tools/html-to-pdf/", {
                method: "POST",
                body: JSON.stringify({ html }),
            });
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
        setHtml(SAMPLE_HTML);
        setJob(null);
        setError(null);
        setLoading(false);
    }

    return (
        <ToolLayout
            icon={Code}
            title="HTML to PDF"
            description="Paste HTML and convert it into a clean PDF document."
            color="from-slate-500 to-slate-600"
        >
            {!job && (
                <>
                    {/* Editor card */}
                    <div className="card p-5 animate-fade-in">
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-500 to-slate-600 flex items-center justify-center shadow-sm">
                                    <FileCode className="w-4 h-4 text-white" strokeWidth={2.5} />
                                </div>
                                <span className="text-sm font-semibold text-[#010736]">
                                    HTML content
                                </span>
                            </div>

                            <button
                                type="button"
                                onClick={() => setHtml(SAMPLE_HTML)}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#22396F] hover:underline"
                            >
                                <Wand2 className="w-3.5 h-3.5" />
                                <span>Load sample</span>
                            </button>
                        </div>

                        {/* Code editor */}
                        <div className="relative">
                            {/* Line numbers */}
                            <div className="absolute left-0 top-0 bottom-0 w-10 bg-[#FCF1D0]/60 border-r border-[#e5dcb8] rounded-l-xl py-3 text-right pr-2 pointer-events-none">
                                {html.split("\n").map((_, i) => (
                                    <div
                                        key={i}
                                        className="text-[11px] leading-5 font-mono text-[#0D1C42]/30"
                                    >
                                        {i + 1}
                                    </div>
                                ))}
                            </div>

                            <textarea
                                value={html}
                                onChange={(e) => setHtml(e.target.value)}
                                rows={14}
                                spellCheck={false}
                                className="w-full pl-12 pr-4 py-3 border border-[#e5dcb8] rounded-xl bg-[#FCF1D0]/30 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:bg-white text-[#010736] font-mono text-sm resize-y leading-5 transition-all"
                                placeholder="<h1>Hello</h1><p>Paste your HTML here...</p>"
                            />
                        </div>

                        <div className="flex items-start gap-2 mt-3 px-3 py-2 bg-[#FCF1D0]/60 border border-[#e5dcb8] rounded-lg">
                            <Sparkles className="w-3.5 h-3.5 text-[#0D1C42]/50 shrink-0 mt-0.5" />
                            <p className="text-xs text-[#0D1C42]/60">
                                Supports headings, paragraphs, lists, tables, bold, italic,
                                links, and basic inline CSS.
                            </p>
                        </div>
                    </div>

                    {/* Stats bar */}
                    <div className="mt-4 flex items-center justify-between text-xs text-[#0D1C42]/50 px-2">
                        <span>{html.length} characters</span>
                        <span>{html.split("\n").length} lines</span>
                    </div>

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
                        disabled={!html.trim() || loading}
                        className="btn-primary mt-6 w-full flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Uploading...</span>
                            </>
                        ) : (
                            <>
                                <Code className="w-5 h-5" />
                                <span>Convert to PDF</span>
                            </>
                        )}
                    </button>
                </>
            )}

            {/* Processing */}
            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-slate-500/5 via-transparent to-slate-500/5 animate-pulse-soft" />

                    <div className="relative">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-500 to-slate-600 shadow-xl mb-5">
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                        </div>

                        <h2 className="text-2xl font-bold text-[#010736] mb-2">
                            {job.status === "pending" ? "Queued..." : "Rendering HTML"}
                        </h2>
                        <p className="text-[#0D1C42]/60 mb-6">
                            This usually takes a few seconds
                        </p>

                        <div className="max-w-xs mx-auto">
                            <div className="h-1.5 bg-[#FCF1D0] rounded-full overflow-hidden border border-[#e5dcb8]">
                                <div className="h-full w-1/3 bg-gradient-to-r from-slate-500 to-slate-600 rounded-full animate-progress" />
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
                            Your HTML has been rendered into a PDF
                        </p>

                        <a
                            href={job.download_url}
                            className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 hover:-translate-y-0.5 text-white font-semibold py-3.5 px-8 rounded-xl transition-all shadow-md hover:shadow-xl"
                        >
                            <Download className="w-5 h-5" />
                            <span>Download PDF</span>
                        </a>

                        <button
                            onClick={reset}
                            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[#22396F] hover:underline"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Convert more HTML</span>
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