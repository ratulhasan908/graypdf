"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

type ToolLayoutProps = {
    icon: any; // Lucide icon component
    title: string;
    description: string;
    color: string; // gradient classes e.g. "from-blue-500 to-blue-600"
    children: ReactNode;
};

export default function ToolLayout({
    icon: Icon,
    title,
    description,
    color,
    children,
}: ToolLayoutProps) {
    return (
        <main className="mesh-bg grain relative min-h-screen px-4 py-10">
            {/* Decorative orbs */}
            <div className="absolute top-20 right-[10%] w-[300px] h-[300px] rounded-full bg-[#4f7cff]/10 blur-[100px] animate-orb-1 pointer-events-none" />
            <div className="absolute bottom-20 left-[10%] w-[300px] h-[300px] rounded-full bg-[#8b5cf6]/10 blur-[100px] animate-orb-2 pointer-events-none" />

            <div className="relative max-w-2xl mx-auto">
                {/* Back link */}
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0D1C42]/70 hover:text-[#0D1C42] transition-colors mb-6 group"
                >
                    <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                    <span>All tools</span>
                </Link>

                {/* Header */}
                <div className="flex items-start gap-4 mb-8 animate-fade-in">
                    <div className="relative shrink-0">
                        <div
                            className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${color} flex items-center justify-center shadow-md`}
                        >
                            <Icon className="w-6 h-6 text-white" strokeWidth={2.5} />
                        </div>
                        <div
                            className={`absolute inset-0 w-14 h-14 rounded-2xl bg-gradient-to-br ${color} blur-xl opacity-40 -z-10`}
                        />
                    </div>
                    <div className="pt-1">
                        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#010736] mb-1">
                            {title}
                        </h1>
                        <p className="text-[#0D1C42]/60 leading-relaxed">{description}</p>
                    </div>
                </div>

                {/* Content */}
                <div className="animate-fade-in">{children}</div>
            </div>
        </main>
    );
}