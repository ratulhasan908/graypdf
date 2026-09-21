"use client";

import { useState, useRef } from "react";
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
            icon="🌐"
            title="HTML to PDF"
            description="Paste HTML and convert it into a clean PDF document."
            color="from-slate-500 to-slate-600"
        >
            {!job && (
                <>
                    <div className="card p-5">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-[#010736]">
                                HTML content
                            </p>
                            <button
                                type="button"
                                onClick={() => setHtml(SAMPLE_HTML)}
                                className="text-xs font-medium text-[#22396F] hover:underline"
                            >
                                Load sample
                            </button>
                        </div>
                        <textarea
                            value={html}
                            onChange={(e) => setHtml(e.target.value)}
                            rows={14}
                            spellCheck={false}
                            className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-[#FCF1D0]/40 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736] font-mono text-sm resize-y"
                            placeholder="<h1>Hello</h1><p>Paste your HTML here...</p>"
                        />
                        <p className="text-xs text-[#0D1C42]/60 mt-2">
                            Supports headings, paragraphs, lists, tables, bold, italic, and
                            links. Inline CSS is partially supported.
                        </p>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleConvert}
                        disabled={!html.trim() || loading}
                        className="btn-primary mt-6 w-full"
                    >
                        {loading ? "Uploading..." : "Convert to PDF"}
                    </button>
                </>
            )}

            {job && (job.status === "pending" || job.status === "processing") && (
                <div className="card p-12 text-center animate-fade-in">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#22396F] border-t-transparent mb-4"></div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        {job.status === "pending" ? "Queued..." : "Rendering..."}
                    </h2>
                    <p className="text-[#0D1C42]/60">
                        This usually takes a few seconds.
                    </p>
                </div>
            )}

            {job && job.status === "completed" && job.download_url && (
                <div className="card p-8 text-center animate-scale-in">
                    <div className="text-5xl mb-4">✅</div>
                    <h2 className="text-xl font-bold mb-2 text-[#010736]">
                        Conversion complete
                    </h2>
                    <p className="text-[#0D1C42]/60 mb-6">
                        Your HTML has been rendered into a PDF.
                    </p>
                    <a
                        href={job.download_url}
                        className="inline-flex items-center gap-2 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white font-semibold py-3 px-8 rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                        Download PDF
                    </a>
                    <button
                        onClick={reset}
                        className="block mx-auto mt-4 text-sm font-medium text-[#22396F] hover:underline"
                    >
                        Convert more HTML
                    </button>
                </div>
            )}

            {job && job.status === "failed" && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
                    <p className="font-bold mb-1">Conversion failed</p>
                    <p className="text-sm">{job.error_message}</p>
                    <button onClick={reset} className="mt-3 text-sm font-medium underline">
                        Try again
                    </button>
                </div>
            )}
        </ToolLayout>
    );
}