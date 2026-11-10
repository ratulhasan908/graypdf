"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, FileQuestion, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { ToolIcon } from "@/components/ToolLayout";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { getToolByJobKey, getToolBySlug, popularSlugs, Tool } from "@/lib/tools";
import type { Job } from "@/lib/useToolJob";

type History = {
    jobs: Job[];
    total: number;
    this_week: number;
    top_tools: { tool: string; count: number }[];
};

type Filter = "all" | "ready" | "failed";

const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "ready", label: "Ready to download" },
    { id: "failed", label: "Failed" },
];

function timeAgo(iso: string, now: number): string {
    const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
    return new Date(iso).toLocaleDateString();
}

function timeLeft(iso: string, now: number): string {
    const minutes = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
}

function jobTitle(job: Job, tool?: Tool): string {
    if (!job.source_name) return tool?.name ?? job.tool;
    return job.source_count > 1 ? `${job.source_name} + ${job.source_count - 1} more` : job.source_name;
}

function Stat({ label, value, note }: { label: string; value: string | number; note: string }) {
    return (
        <div className="card p-4">
            <p className="text-sm text-ink-2">{label}</p>
            <p className="text-3xl font-semibold tracking-tight mt-1">{value}</p>
            <p className="text-xs text-ink-3 mt-1">{note}</p>
        </div>
    );
}

function JobRow({ job, now }: { job: Job; now: number }) {
    const tool = getToolByJobKey(job.tool);
    const running = job.status === "pending" || job.status === "processing";

    return (
        <li className="flex items-center gap-3 px-4 py-3">
            {tool ? (
                <ToolIcon tool={tool} size="sm" />
            ) : (
                <FileQuestion className="w-9 h-9 p-2 text-ink-3" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{jobTitle(job, tool)}</p>
                <p className="text-xs text-ink-3 truncate">
                    {job.source_name ? `${tool?.name} · ` : ""}
                    {timeAgo(job.created_at, now)}
                    {job.status === "failed" && job.error_message && (
                        <span className="text-danger"> · {job.error_message}</span>
                    )}
                    {job.download_url && job.expires_at && ` · deleted in ${timeLeft(job.expires_at, now)}`}
                    {job.status === "completed" && !job.download_url && " · file deleted"}
                </p>
            </div>
            {job.download_url && (
                <a href={job.download_url} className="btn btn-ghost !py-1.5 !px-2.5 !text-sm shrink-0" aria-label={`Download ${jobTitle(job, tool)}`}>
                    <Download className="w-4 h-4" aria-hidden />
                    <span className="hidden sm:inline">Download</span>
                </a>
            )}
            {running && <span className="text-xs text-ink-3 shrink-0">Working…</span>}
            {!job.download_url && !running && tool && (
                <Link href={`/tools/${tool.slug}`} className="btn btn-ghost !py-1.5 !px-2.5 !text-sm shrink-0" aria-label={`Use ${tool.name} again`}>
                    <RotateCcw className="w-4 h-4" aria-hidden />
                    <span className="hidden sm:inline">Run again</span>
                </Link>
            )}
        </li>
    );
}

export default function DashboardPage() {
    const router = useRouter();
    const { user, usage, loading, refreshUsage } = useAuth();

    const [history, setHistory] = useState<History | null>(null);
    const [failedToLoad, setFailedToLoad] = useState(false);
    const [filter, setFilter] = useState<Filter>("all");
    const [query, setQuery] = useState("");
    const [now, setNow] = useState(() => Date.now());

    const load = useCallback(async () => {
        try {
            setHistory(await apiFetch<History>("/auth/my-jobs/"));
            setFailedToLoad(false);
        } catch {
            setFailedToLoad(true);
        }
        setNow(Date.now());
    }, []);

    useEffect(() => {
        if (!loading && !user) router.replace("/login");
    }, [user, loading, router]);

    useEffect(() => {
        if (!user) return;
        refreshUsage();
        const first = setTimeout(load, 0);
        return () => clearTimeout(first);
    }, [user, refreshUsage, load]);

    // Keep countdowns honest, and pick up jobs that finish while we watch.
    const anyRunning = history?.jobs.some((job) => job.status === "pending" || job.status === "processing");
    useEffect(() => {
        if (!user) return;
        const timer = setInterval(load, anyRunning ? 3000 : 60000);
        return () => clearInterval(timer);
    }, [user, anyRunning, load]);

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return (history?.jobs ?? []).filter((job) => {
            if (filter === "ready" && !job.download_url) return false;
            if (filter === "failed" && job.status !== "failed") return false;
            const tool = getToolByJobKey(job.tool);
            return !needle || `${job.source_name ?? ""} ${tool?.name ?? ""}`.toLowerCase().includes(needle);
        });
    }, [history, filter, query]);

    const quickTools = useMemo(() => {
        const used = (history?.top_tools ?? []).map((item) => getToolByJobKey(item.tool));
        const fallback = popularSlugs.map(getToolBySlug);
        const unique = new Map<string, Tool>();
        [...used, ...fallback].forEach((tool) => tool && unique.set(tool.slug, tool));
        return [...unique.values()].slice(0, 6);
    }, [history]);

    if (loading || !user) {
        return (
            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-4" aria-busy="true">
                <div className="skeleton h-9 w-64" />
                <div className="skeleton h-28" />
                <div className="skeleton h-72" />
            </main>
        );
    }

    const ready = history?.jobs.filter((job) => job.download_url).length ?? 0;

    return (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-10">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Hi, {user.username}</h1>
                    <p className="text-ink-2 mt-1">Your files and recent work, in one place.</p>
                </div>
                <Link href="/#tools" className="btn btn-primary">
                    Start a new task
                    <ArrowRight className="w-4 h-4" aria-hidden />
                </Link>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <Stat label="Files today" value={usage?.used ?? 0} note="No daily limit on your account" />
                <Stat label="This week" value={history?.this_week ?? "–"} note="Tasks in the last 7 days" />
                <Stat label="Last 30 days" value={history?.total ?? "–"} note="Tasks in your history" />
                <Stat label="Ready to download" value={history ? ready : "–"} note="Files are kept for 2 hours" />
            </div>

            <div className="grid lg:grid-cols-[1fr_300px] gap-6 items-start">
                <section className="card overflow-hidden" aria-labelledby="history">
                    <div className="px-4 pt-4 pb-3 border-b border-line">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <h2 id="history" className="font-semibold">
                                Your files
                            </h2>
                            <div className="relative sm:w-56">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" aria-hidden />
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search files"
                                    aria-label="Search your files"
                                    className="input !py-1.5 !pl-8 !text-sm"
                                />
                            </div>
                        </div>
                        <div className="flex gap-1 mt-3 overflow-x-auto" role="group" aria-label="Filter files">
                            {FILTERS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    aria-pressed={filter === item.id}
                                    onClick={() => setFilter(item.id)}
                                    className={`px-2.5 py-1 rounded-lg text-sm whitespace-nowrap transition-colors ${
                                        filter === item.id ? "bg-ink text-white" : "text-ink-2 hover:bg-surface-2"
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {failedToLoad && !history ? (
                        <div className="p-10 text-center">
                            <p className="text-ink-2 mb-4">We couldn&apos;t load your files.</p>
                            <button type="button" onClick={load} className="btn btn-ghost">
                                Try again
                            </button>
                        </div>
                    ) : !history ? (
                        <div className="p-4 space-y-3" aria-busy="true">
                            {[1, 2, 3].map((row) => (
                                <div key={row} className="skeleton h-10" />
                            ))}
                        </div>
                    ) : history.jobs.length === 0 ? (
                        <div className="p-10 text-center">
                            <p className="font-medium mb-1">Nothing here yet</p>
                            <p className="text-sm text-ink-2 mb-4">Files you process will show up here.</p>
                            <Link href="/#tools" className="btn btn-dark">
                                Browse tools
                            </Link>
                        </div>
                    ) : visible.length === 0 ? (
                        <p className="p-10 text-center text-sm text-ink-2">No files match.</p>
                    ) : (
                        <ul className="divide-y divide-line">
                            {visible.map((job) => (
                                <JobRow key={job.id} job={job} now={now} />
                            ))}
                        </ul>
                    )}
                </section>

                <aside className="space-y-4">
                    <section className="card p-4" aria-labelledby="quick-tools">
                        <h2 id="quick-tools" className="font-semibold mb-3">
                            {history?.top_tools.length ? "Your tools" : "Popular tools"}
                        </h2>
                        <ul className="space-y-1">
                            {quickTools.map((tool) => (
                                <li key={tool.slug}>
                                    <Link
                                        href={`/tools/${tool.slug}`}
                                        className="flex items-center gap-2.5 p-1.5 -mx-1.5 rounded-lg hover:bg-surface-2 transition-colors"
                                    >
                                        <ToolIcon tool={tool} size="sm" />
                                        <span className="text-sm font-medium">{tool.name}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                    <p className="flex gap-2 text-xs text-ink-2 leading-relaxed px-1">
                        <ShieldCheck className="w-4 h-4 shrink-0 text-ink-3" aria-hidden />
                        Files are deleted automatically after 2 hours. We keep only this list for 30 days.
                    </p>
                </aside>
            </div>
        </main>
    );
}
