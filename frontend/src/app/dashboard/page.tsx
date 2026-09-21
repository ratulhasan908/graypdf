"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { tools, getToolBySlug } from "@/lib/tools";

type Job = {
    id: string;
    tool: string;
    status: "pending" | "processing" | "completed" | "failed";
    output_file: string | null;
    download_url: string | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
};

function getInitials(name: string): string {
    const parts = name.trim().split(/[\s._-]+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString();
}

// Map internal tool slug to tools.ts slug (they mostly match)
function slugToToolSlug(slug: string): string {
    const map: Record<string, string> = {
        merge: "merge-pdf",
        split: "split-pdf",
        compress: "compress-pdf",
        rotate: "rotate-pdf",
        "pdf-to-jpg": "pdf-to-jpg",
        "jpg-to-pdf": "jpg-to-pdf",
        protect: "protect-pdf",
        unlock: "unlock-pdf",
        watermark: "watermark",
        "page-numbers": "page-numbers",
        organize: "organize-pdf",
        crop: "crop-pdf",
        "html-to-pdf": "html-to-pdf",
        "pdf-to-html": "pdf-to-html",
        "markdown-to-pdf": "markdown-to-pdf",
        "pdf-to-markdown": "pdf-to-markdown",
    };
    return map[slug] || slug;
}

function getToolInfo(slug: string) {
    const toolSlug = slugToToolSlug(slug);
    const tool = getToolBySlug(toolSlug);
    if (tool) {
        return {
            name: tool.name,
            Icon: tool.icon,
            color: tool.color,
        };
    }
    return {
        name: slug,
        Icon: null,
        color: "from-gray-500 to-gray-600",
    };
}

export default function DashboardPage() {
    const router = useRouter();
    const { user, usage, loading, refreshUsage } = useAuth();

    const [jobs, setJobs] = useState<Job[]>([]);
    const [totalJobs, setTotalJobs] = useState(0);
    const [loadingJobs, setLoadingJobs] = useState(true);

    useEffect(() => {
        if (!loading && !user) {
            router.push("/login");
        }
    }, [user, loading, router]);

    useEffect(() => {
        if (user) {
            refreshUsage();
            fetchJobs();
        }
    }, [user]);

    async function fetchJobs() {
        setLoadingJobs(true);
        try {
            const data = await apiFetch<{ jobs: Job[]; total: number }>(
                "/auth/my-jobs/"
            );
            setJobs(data.jobs);
            setTotalJobs(data.total);
        } catch {
            // ignore
        } finally {
            setLoadingJobs(false);
        }
    }

    if (loading) {
        return (
            <main className="min-h-screen mesh-bg flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-[#22396F] border-t-transparent mb-3"></div>
                    <p className="text-[#0D1C42]/60 text-sm">Loading...</p>
                </div>
            </main>
        );
    }

    if (!user) return null;

    const dailyUsed = usage?.used ?? 0;
    const dailyLimit = usage?.limit ?? 20;
    const dailyPercent = Math.min(100, (dailyUsed / dailyLimit) * 100);

    return (
        <main className="min-h-screen mesh-bg grain relative px-4 py-10">
            {/* Decorative orbs */}
            <div className="absolute top-20 right-[15%] w-[300px] h-[300px] rounded-full bg-[#4f7cff]/10 blur-[100px] pointer-events-none" />
            <div className="absolute bottom-20 left-[10%] w-[300px] h-[300px] rounded-full bg-[#8b5cf6]/10 blur-[100px] pointer-events-none" />

            <div className="relative max-w-5xl mx-auto">
                {/* Welcome header */}
                <div className="card p-6 md:p-8 mb-6 animate-fade-in">
                    <div className="flex items-center gap-4 flex-wrap">
                        <div className="relative">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#010736] to-[#22396f] flex items-center justify-center text-[#FCF1D0] text-xl font-bold shadow-md">
                                {getInitials(user.username)}
                            </div>
                            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6] opacity-20 blur-lg -z-10" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#010736] mb-0.5 truncate">
                                Welcome back, {user.username}!
                            </h1>
                            <p className="text-[#0D1C42]/60 text-sm truncate">
                                {user.email}
                            </p>
                        </div>
                        {user.is_premium && (
                            <span className="shrink-0 bg-gradient-to-br from-amber-400 to-amber-500 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
                                ⭐ Premium
                            </span>
                        )}
                    </div>
                </div>

                {/* Quick tools */}
                <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-bold text-[#010736]">Quick tools</h2>
                        <Link
                            href="/"
                            className="text-xs font-medium text-[#22396F] hover:underline"
                        >
                            View all →
                        </Link>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {tools.slice(0, 12).map((tool) => {
                            const Icon = tool.icon;
                            return (
                                <Link
                                    key={tool.slug}
                                    href={`/tools/${tool.slug}`}
                                    className="card card-hover p-3 text-center group"
                                >
                                    <div className="relative inline-block mb-2">
                                        <div
                                            className={`w-10 h-10 mx-auto rounded-xl bg-gradient-to-br ${tool.color} flex items-center justify-center shadow-sm transition-transform duration-300 group-hover:scale-110`}
                                        >
                                            <Icon
                                                className="w-4 h-4 text-white"
                                                strokeWidth={2.5}
                                            />
                                        </div>
                                        <div
                                            className={`absolute inset-0 w-10 h-10 mx-auto rounded-xl bg-gradient-to-br ${tool.color} blur-md opacity-0 group-hover:opacity-60 transition-opacity -z-10`}
                                        />
                                    </div>
                                    <div className="text-xs font-medium text-[#010736] leading-tight">
                                        {tool.name}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="card p-6">
                        <p className="text-xs uppercase tracking-wider text-[#0D1C42]/50 font-semibold mb-1">
                            Files today
                        </p>
                        <p className="text-3xl font-bold text-[#010736] mb-3">
                            {dailyUsed}
                            <span className="text-lg text-[#0D1C42]/40"> / {dailyLimit}</span>
                        </p>
                        <div className="w-full bg-[#FCF1D0] rounded-full h-2 overflow-hidden border border-[#e5dcb8]">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${dailyPercent >= 100
                                        ? "bg-gradient-to-r from-red-500 to-red-600"
                                        : dailyPercent >= 80
                                            ? "bg-gradient-to-r from-amber-400 to-amber-500"
                                            : "bg-gradient-to-r from-[#0D1C42] to-[#22396F]"
                                    }`}
                                style={{ width: `${dailyPercent}%` }}
                            />
                        </div>
                    </div>

                    <div className="card p-6">
                        <p className="text-xs uppercase tracking-wider text-[#0D1C42]/50 font-semibold mb-1">
                            Total files
                        </p>
                        <p className="text-3xl font-bold text-[#010736]">{totalJobs}</p>
                        <p className="text-xs text-[#0D1C42]/50 mt-3">
                            All-time processed
                        </p>
                    </div>

                    <div className="card p-6">
                        <p className="text-xs uppercase tracking-wider text-[#0D1C42]/50 font-semibold mb-1">
                            Plan
                        </p>
                        <p className="text-3xl font-bold text-[#010736]">
                            {user.is_premium ? "Premium" : "Free"}
                        </p>
                        <p className="text-xs text-[#0D1C42]/50 mt-3">
                            {user.is_premium ? "Unlimited" : "20 files/day"}
                        </p>
                    </div>
                </div>

                {/* Recent files */}
                <div className="card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold text-[#010736]">
                            Your recent files
                        </h2>
                        <button
                            onClick={fetchJobs}
                            className="text-xs font-medium text-[#22396F] hover:underline"
                        >
                            Refresh
                        </button>
                    </div>

                    {loadingJobs ? (
                        <div className="space-y-3 py-2">
                            {[1, 2, 3].map((i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <div className="w-10 h-10 skeleton rounded-xl" />
                                    <div className="flex-1 space-y-2">
                                        <div className="h-3 skeleton rounded w-1/3" />
                                        <div className="h-2 skeleton rounded w-1/4" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : jobs.length === 0 ? (
                        <div className="text-center py-10">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#FCF1D0] border border-[#e5dcb8] mb-4">
                                <ArrowRight className="w-6 h-6 text-[#0D1C42]/40" />
                            </div>
                            <p className="text-[#0D1C42]/60 text-sm mb-4">
                                No files yet. Start using a tool to see them here.
                            </p>
                            <Link
                                href="/"
                                className="inline-flex btn-primary text-sm"
                            >
                                <span>Browse tools</span>
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                        </div>
                    ) : (
                        <ul className="divide-y divide-[#e5dcb8]/60">
                            {jobs.map((job) => {
                                const info = getToolInfo(job.tool);
                                const Icon = info.Icon;
                                const isReady =
                                    job.status === "completed" && job.download_url;

                                return (
                                    <li
                                        key={job.id}
                                        className="py-3 flex items-center gap-3 first:pt-0 last:pb-0"
                                    >
                                        <div
                                            className={`w-10 h-10 rounded-xl bg-gradient-to-br ${info.color} flex items-center justify-center shrink-0 shadow-sm`}
                                        >
                                            {Icon ? (
                                                <Icon
                                                    className="w-4 h-4 text-white"
                                                    strokeWidth={2.5}
                                                />
                                            ) : (
                                                <span className="text-white text-xs">?</span>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm text-[#010736] truncate">
                                                {info.name}
                                            </p>
                                            <p className="text-xs text-[#0D1C42]/60">
                                                {formatDate(job.created_at)}
                                                <span
                                                    className={`ml-2 font-medium ${job.status === "completed"
                                                            ? "text-emerald-600"
                                                            : job.status === "failed"
                                                                ? "text-red-600"
                                                                : "text-amber-600"
                                                        }`}
                                                >
                                                    • {job.status}
                                                </span>
                                            </p>
                                        </div>
                                        {isReady ? (
                                            <a
                                                href={job.download_url!}
                                                className="text-xs font-semibold bg-gradient-to-br from-emerald-500 to-emerald-600 hover:brightness-110 text-white px-3 py-1.5 rounded-lg transition-all shadow-sm hover:shadow-md whitespace-nowrap"
                                            >
                                                Download
                                            </a>
                                        ) : job.status === "failed" ? (
                                            <span
                                                className="text-xs text-red-500 font-medium"
                                                title={job.error_message || ""}
                                            >
                                                Failed
                                            </span>
                                        ) : (
                                            <span className="text-xs text-[#0D1C42]/40 font-medium">
                                                Processing
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </div>
        </main>
    );
}