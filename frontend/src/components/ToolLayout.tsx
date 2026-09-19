"use client";

import Link from "next/link";
import { ReactNode } from "react";

type ToolLayoutProps = {
    icon: string;
    title: string;
    description: string;
    color: string; // gradient classes e.g. "from-blue-500 to-blue-600"
    children: ReactNode;
};

export default function ToolLayout({
    icon,
    title,
    description,
    color,
    children,
}: ToolLayoutProps) {
    return (
        <main className="min-h-screen hero-bg px-4 py-10">
            <div className="max-w-2xl mx-auto">
                {/* Back link */}
                <Link
                    href="/"
                    className="inline-flex items-center gap-1 text-sm font-medium text-[#0D1C42]/70 hover:text-[#0D1C42] transition-colors mb-6"
                >
                    <span>←</span>
                    <span>All tools</span>
                </Link>

                {/* Header */}
                <div className="flex items-start gap-4 mb-8 animate-fade-in">
                    <div
                        className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center text-3xl shadow-sm shrink-0`}
                    >
                        {icon}
                    </div>
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#010736] mb-1">
                            {title}
                        </h1>
                        <p className="text-[#0D1C42]/60">{description}</p>
                    </div>
                </div>

                {/* Content */}
                <div className="animate-fade-in">{children}</div>
            </div>
        </main>
    );
}