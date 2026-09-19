"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { tools } from "@/lib/tools";

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

const TOOL_LABELS: Record<string, { name: string; icon: string }> = {
    merge: { name: "Merge PDF", icon: "🔗" },
    split: { name: "Split PDF", icon: "✂️" },
    compress: { name: "Compress PDF", icon: "📉" },
    rotate: { name: "Rotate PDF", icon: "🔄" },
    "pdf-to-jpg": { name: "PDF to JPG", icon: "🖼️" },
    "jpg-to-pdf": { name: "JPG to PDF", icon: "📷" },
    protect: { name: "Protect PDF", icon: "🔒" },
    unlock: { name: "Unlock PDF", icon: "🔓" },
    watermark: { name: "Watermark", icon: "💧" },
    "page-numbers": { name: "Page Numbers", icon: "🔢" },
    organize: { name: "Organize PDF", icon: "📑" },
    crop: { name: "Crop PDF", icon: "✂️" },
};

function getToolInfo(slug: string) {
    return TOOL_LABELS[slug] || { name: slug, icon: "📄" };
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
            <main className="min-h-screen flex items-center justify-center">
                <p className="text-gray-500">Loading...</p>
            </main>
        );
    }

    if (!user) return null;

    const dailyUsed = usage?.used ?? 0;
    const dailyLimit = usage?.limit ?? 20;
    const dailyPercent = Math.min(100, (dailyUsed / dailyLimit) * 100);

    return (
        <main className="min-h-screen bg-gray-50 px-4 py-8">
            <div className="max-w-5xl mx-auto">
                {/* Header card */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h1 className="text-2xl font-bold mb-1">
                        Welcome, {user.username}!
                    </h1>
                    <p className="text-gray-500">{user.email}</p>
                    {user.is_premium && (
                        <span className="inline-block mt-2 bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-1 rounded">
                            Premium
                        </span>
                    )}
                </div>

                {/* Quick tools */}
                <div className="mb-6">
                    <h2 className="text-lg font-bold mb-3">Quick tools</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                        {tools.map((tool) =>
                            tool.available ? (
                                <Link
                                    key={tool.slug}
                                    href={`/tools/${tool.slug}`}
                                    className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 text-center hover:shadow-md hover:border-blue-400 transition"
                                >
                                    <div className="text-2xl mb-1">{tool.icon}</div>
                                    <div className="text-xs font-medium text-gray-800 leading-tight">
                                        {tool.name}
                                    </div>
                                </Link>
                            ) : (
                                <div
                                    key={tool.slug}
                                    className="bg-white rounded-lg border border-gray-200 p-3 text-center opacity-50 cursor-not-allowed"
                                >
                                    <div className="text-2xl mb-1">{tool.icon}</div>
                                    <div className="text-xs text-gray-500 leading-tight">
                                        {tool.name}
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-white rounded-lg shadow p-6">
                        <p className="text-sm text-gray-500 mb-1">Files today</p>
                        <p className="text-2xl font-bold">
                            {dailyUsed} / {dailyLimit}
                        </p>
                        <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
                            <div
                                className={`h-2 rounded-full transition-all ${dailyPercent >= 100
                                        ? "bg-red-500"
                                        : dailyPercent >= 80
                                            ? "bg-yellow-500"
                                            : "bg-blue-500"
                                    }`}
                                style={{ width: `${dailyPercent}%` }}
                            ></div>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg shadow p-6">
                        <p className="text-sm text-gray-500 mb-1">Total files</p>
                        <p className="text-2xl font-bold">{totalJobs}</p>
                        <p className="text-xs text-gray-400 mt-3">All-time processed</p>
                    </div>

                    <div className="bg-white rounded-lg shadow p-6">
                        <p className="text-sm text-gray-500 mb-1">Plan</p>
                        <p className="text-2xl font-bold">
                            {user.is_premium ? "Premium" : "Free"}
                        </p>
                        <p className="text-xs text-gray-400 mt-3">
                            {user.is_premium ? "Unlimited" : "20 files/day"}
                        </p>
                    </div>
                </div>

                {/* Recent files */}
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-bold">Your recent files</h2>
                        <button
                            onClick={fetchJobs}
                            className="text-xs text-blue-600 hover:underline"
                        >
                            Refresh
                        </button>
                    </div>

                    {loadingJobs ? (
                        <p className="text-sm text-gray-400 py-4">Loading...</p>
                    ) : jobs.length === 0 ? (
                        <div className="text-center py-8">
                            <div className="text-4xl mb-3">📂</div>
                            <p className="text-gray-500 text-sm mb-4">
                                No files yet. Start using a tool to see them here.
                            </p>
                            <Link
                                href="/"
                                className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded transition"
                            >
                                Browse tools
                            </Link>
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {jobs.map((job) => {
                                const info = getToolInfo(job.tool);
                                const isReady = job.status === "completed" && job.download_url;

                                return (
                                    <li key={job.id} className="py-3 flex items-center gap-3">
                                        <div className="text-2xl">{info.icon}</div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">
                                                {info.name}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                {formatDate(job.created_at)}
                                                <span
                                                    className={`ml-2 ${job.status === "completed"
                                                            ? "text-green-600"
                                                            : job.status === "failed"
                                                                ? "text-red-600"
                                                                : "text-yellow-600"
                                                        }`}
                                                >
                                                    • {job.status}
                                                </span>
                                            </p>
                                        </div>
                                        {isReady ? (
                                            <a
                                                href={job.download_url!}
                                                className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded transition whitespace-nowrap"
                                            >
                                                Download
                                            </a>
                                        ) : job.status === "failed" ? (
                                            <span
                                                className="text-xs text-red-500"
                                                title={job.error_message || ""}
                                            >
                                                Failed
                                            </span>
                                        ) : (
                                            <span className="text-xs text-gray-400">Processing</span>
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