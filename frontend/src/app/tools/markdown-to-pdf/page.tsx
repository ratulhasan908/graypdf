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

const SAMPLE_MD = `# Welcome to GrayPDF

This is a **Markdown to PDF** converter.

## Features

- Simple syntax
- **Bold** and *italic* text
- Lists, quotes, and code

## Code example

\`\`\`
print("Hello, world!")
\`\`\`

> Tip: Use Markdown for notes, docs, and READMEs.

## Table

| Tool | Status |
|------|--------|
| Merge PDF | ✅ |
| Split PDF | ✅ |
| Markdown to PDF | ✅ |

Visit [GrayPDF](https://example.com) for more.`;

export default function MarkdownToPdfPage() {
    const [markdown, setMarkdown] = useState(SAMPLE_MD);
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
        if (!markdown.trim()) {
            setError("Please enter some Markdown content.");
            return;
        }

        setLoading(true);
        setError(null);
        setJob(null);

        try {
            const result = await apiFetch<Job>("/tools/markdown-to-pdf/", {
                method: "POST",
                body: JSON.stringify({ markdown }),
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
        setMarkdown(SAMPLE_MD);
        setJob(null);
        setError(null);
        setLoading(false);
    }

    return (
        <ToolLayout
            icon="📝"
            title="Markdown to PDF"
            description="Write Markdown and export it as a clean, readable PDF."
            color="from-purple-500 to-purple-600"
        >
            {!job && (
                <>
                    <div className="card p-5">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-sm font-semibold text-[#010736]">
                                Markdown content
                            </p>
                            <button
                                type="button"
                                onClick={() => setMarkdown(SAMPLE_MD)}
                                className="text-xs font-medium text-[#22396F] hover:underline"
                            >
                                Load sample
                            </button>
                        </div>
                        <textarea
                            value={markdown}
                            onChange={(e) => setMarkdown(e.target.value)}
                            rows={16}
                            spellCheck={false}
                            className="w-full px-3 py-2 border border-[#e5dcb8] rounded-lg bg-[#FCF1D0]/40 focus:outline-none focus:ring-2 focus:ring-[#22396F] text-[#010736] font-mono text-sm resize-y"
                            placeholder="# Hello&#10;&#10;Write your **Markdown** here..."
                        />
                        <p className="text-xs text-[#0D1C42]/60 mt-2">
                            Supports headings, bold, italic, lists, tables, code blocks,
                            quotes, and links.
                        </p>
                    </div>

                    {error && (
                        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleConvert}
                        disabled={!markdown.trim() || loading}
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
                        Your Markdown has been rendered into a PDF.
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
                        Convert more Markdown
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