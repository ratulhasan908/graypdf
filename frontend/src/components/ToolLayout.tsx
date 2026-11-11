"use client";

import Link from "next/link";
import { ReactNode } from "react";
import {
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    ChevronRight,
    Download,
    Loader2,
    RotateCcw,
    ShieldCheck,
    Sparkles,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { apiUrl } from "@/lib/api";
import { getToolBySlug, Tool, tools } from "@/lib/tools";
import type { Job, ToolRun } from "@/lib/useToolJob";

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ToolIcon({ tool, size = "md" }: { tool: Tool; size?: "sm" | "md" | "lg" }) {
    const Icon = tool.icon;
    const box = { sm: "w-9 h-9", md: "w-11 h-11", lg: "w-14 h-14" }[size];
    const glyph = { sm: "w-4 h-4", md: "w-5 h-5", lg: "w-6 h-6" }[size];
    return (
        <span className={`${tool.featured ? "chip-featured" : `chip-${tool.category}`} ${box} rounded-xl inline-flex items-center justify-center shrink-0`}>
            <Icon className={glyph} strokeWidth={2} aria-hidden />
        </span>
    );
}

/** Marks a feature that other PDF apps charge for. */
export function FreeBadge({ className = "" }: { className?: string }) {
    return (
        <span className={`free-badge inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold tracking-normal text-white ${className}`}>
            <Sparkles className="w-3 h-3" aria-hidden />
            Free here · usually paid
        </span>
    );
}

function plural(count: number, noun: string) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function resultSummary(result: Job["result"]): string {
    const fallback = "It stays available for the next 2 hours.";
    if (!result) return fallback;
    if (result.original_size !== undefined && result.compressed_size !== undefined) {
        return (result.savings_percent ?? 0) > 0
            ? `${formatBytes(result.original_size)} → ${formatBytes(result.compressed_size)}, ${result.savings_percent}% smaller.`
            : "This PDF is already well optimized, so we kept it as it was.";
    }
    if (result.tables !== undefined) return `Found ${plural(result.tables, "table")}, one per sheet.`;
    if (result.redactions !== undefined) {
        return `${plural(result.redactions, "area")} permanently removed. Check the file before you share it.`;
    }
    if (result.words_added !== undefined) {
        if (!result.pages_changed) return "No text differences found between these two PDFs.";
        return `${plural(result.words_added, "word")} added and ${result.words_removed} removed, on ${plural(result.pages_changed, "page")}.`;
    }
    if (result.was_damaged !== undefined) {
        const pages = plural(result.pages ?? 0, "page");
        return result.was_damaged ? `Repaired. We recovered ${pages}.` : `This PDF wasn't damaged. We rebuilt all ${pages} anyway.`;
    }
    if (result.text_pages !== undefined) {
        return result.text_pages > 0
            ? `Text found on ${result.text_pages} of ${plural(result.pages ?? 0, "page")}. You can now search and copy it.`
            : "We couldn't find any readable text. Check the language you chose, or try a clearer scan.";
    }
    if (result.edits !== undefined) {
        const replaced = result.replaced ? ` ${plural(result.replaced, "word")} replaced.` : "";
        return `${plural(result.edits, "change")} saved, with no watermark added.${replaced}`;
    }
    if (result.pages !== undefined) return `Your new PDF has ${plural(result.pages, "page")}.`;
    return fallback;
}

function RunningPanel({ run }: { run: ToolRun }) {
    const uploading = run.phase === "uploading";
    return (
        <div className="card p-10 text-center rise" role="status">
            <Loader2 className="w-8 h-8 text-accent animate-spin mx-auto mb-4" aria-hidden />
            <h2 className="text-xl font-semibold mb-1">
                {uploading ? "Uploading your file" : "Working on it"}
            </h2>
            <p className="text-ink-2 text-sm mb-6">
                {uploading ? `${run.progress}% uploaded` : "This usually takes a few seconds."}
            </p>
            <div className="h-1.5 max-w-xs mx-auto bg-surface-2 rounded-full overflow-hidden">
                {uploading ? (
                    <div
                        className="h-full bg-accent rounded-full transition-[width]"
                        style={{ width: `${run.progress}%` }}
                    />
                ) : (
                    <div className="h-full w-1/3 bg-accent rounded-full sweep" />
                )}
            </div>
        </div>
    );
}

function DonePanel({ run, tool, onReset }: { run: ToolRun; tool: Tool; onReset: () => void }) {
    const { user } = useAuth();
    const next = tool.related.map(getToolBySlug).filter((item): item is Tool => Boolean(item));

    return (
        <div className="rise space-y-4">
            <div className="card p-8 md:p-10 text-center">
                <span className="w-12 h-12 rounded-full bg-success-soft text-success inline-flex items-center justify-center mb-4">
                    <CheckCircle2 className="w-6 h-6" aria-hidden />
                </span>
                <h2 className="text-2xl font-semibold tracking-tight mb-1">Your file is ready</h2>

                <p className="text-ink-2 mb-6">{resultSummary(run.job?.result ?? null)}</p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                    {run.job?.download_url && (
                        <a href={apiUrl(run.job.download_url)} className="btn btn-primary btn-lg w-full sm:w-auto">
                            <Download className="w-5 h-5" aria-hidden />
                            Download
                        </a>
                    )}
                    <button type="button" onClick={onReset} className="btn btn-ghost btn-lg w-full sm:w-auto">
                        <RotateCcw className="w-4 h-4" aria-hidden />
                        Start over
                    </button>
                </div>
            </div>

            {!user && (
                <div className="card px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-sm text-ink-2">
                        Create a free account for unlimited files and a history of your work.
                    </p>
                    <Link href="/register" className="btn btn-dark shrink-0">
                        Sign up free
                    </Link>
                </div>
            )}

            {next.length > 0 && (
                <div>
                    <h3 className="text-sm font-medium text-ink-2 mb-2">Keep going</h3>
                    <div className="grid sm:grid-cols-3 gap-2">
                        {next.map((item) => (
                            <Link
                                key={item.slug}
                                href={`/tools/${item.slug}`}
                                className="card px-3 py-2.5 flex items-center gap-2.5 hover:border-line-strong transition-colors"
                            >
                                <ToolIcon tool={item} size="sm" />
                                <span className="text-sm font-medium">{item.name}</span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function FailedPanel({ run, onRetry }: { run: ToolRun; onRetry: () => void }) {
    return (
        <div className="card p-8 text-center rise" role="alert">
            <span className="w-12 h-12 rounded-full bg-danger-soft text-danger inline-flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6" aria-hidden />
            </span>
            <h2 className="text-xl font-semibold mb-1">That didn&apos;t work</h2>
            <p className="text-ink-2 mb-6 max-w-md mx-auto">{run.error}</p>
            <button type="button" onClick={onRetry} className="btn btn-dark">
                <RotateCcw className="w-4 h-4" aria-hidden />
                Try again
            </button>
        </div>
    );
}

export function FormError({ run }: { run: ToolRun }) {
    if (!run.error) return null;
    return (
        <div className="mt-4 rounded-xl bg-danger-soft text-danger px-4 py-3 text-sm rise" role="alert">
            <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
                <span>{run.error}</span>
            </div>
            {run.limitReached && (
                <Link href="/register" className="btn btn-dark mt-3">
                    Sign up free for unlimited use
                    <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
            )}
        </div>
    );
}

type ToolLayoutProps = {
    slug: string;
    run: ToolRun;
    /** Called on Start over or Try again, so the tool can clear its own state. */
    onReset?: () => void;
    /** "xl" is for editors that need the whole screen. */
    wide?: boolean | "xl";
    /** Keep the tool mounted (hidden) while a job runs, so an editor keeps its work. */
    persistent?: boolean;
    children: ReactNode;
};

export default function ToolLayout({ slug, run, onReset, wide, persistent, children }: ToolLayoutProps) {
    const tool = tools.find((item) => item.slug === slug);
    if (!tool) return null;

    function reset() {
        run.reset();
        onReset?.();
    }

    return (
        <main className={`mx-auto px-4 sm:px-6 py-8 md:py-12 ${wide === "xl" ? "max-w-6xl" : wide ? "max-w-4xl" : "max-w-2xl"}`}>
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-ink-3 mb-5">
                <Link href="/#tools" className="hover:text-ink transition-colors">
                    All tools
                </Link>
                <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                <span className="text-ink-2">{tool.name}</span>
            </nav>

            <header className="flex items-start gap-4 mb-7">
                <ToolIcon tool={tool} size="lg" />
                <div>
                    <h1 className="text-3xl md:text-4xl font-semibold tracking-tight flex flex-wrap items-center gap-x-3 gap-y-2">
                        {tool.name}
                        {tool.featured && <FreeBadge />}
                    </h1>
                    <p className="text-ink-2 mt-1.5 leading-relaxed">{tool.blurb}</p>
                </div>
            </header>

            {persistent ? (
                <div className={run.phase === "idle" ? "rise" : "hidden"}>{children}</div>
            ) : (
                run.phase === "idle" && <div className="rise">{children}</div>
            )}
            {(run.phase === "uploading" || run.phase === "processing") && <RunningPanel run={run} />}
            {run.phase === "done" && <DonePanel run={run} tool={tool} onReset={reset} />}
            {run.phase === "failed" && <FailedPanel run={run} onRetry={reset} />}

            {run.phase === "idle" && (
                <section className="mt-12" aria-labelledby="how-it-works">
                    <h2 id="how-it-works" className="text-sm font-medium text-ink-2 mb-3">
                        How it works
                    </h2>
                    <ol className="grid sm:grid-cols-3 gap-3">
                        {tool.steps.map((step, index) => (
                            <li key={step} className="flex sm:block items-baseline gap-2 text-sm">
                                <span className="font-mono text-ink-3 sm:block sm:mb-1">{index + 1}</span>
                                <span className="text-ink">{step}</span>
                            </li>
                        ))}
                    </ol>
                    <p className="mt-6 flex items-center gap-2 text-sm text-ink-3">
                        <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
                        Your files are deleted automatically after 2 hours.
                    </p>
                </section>
            )}
        </main>
    );
}
