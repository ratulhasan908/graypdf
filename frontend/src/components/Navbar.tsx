"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";

function getInitials(name: string): string {
    const parts = name.trim().split(/[\s._-]+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Navbar() {
    const { user, usage, loading, logout } = useAuth();
    const router = useRouter();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    async function handleLogout() {
        await logout();
        router.push("/");
    }

    return (
        <nav className="sticky top-0 z-50 glass border-b border-[#e5dcb8]/60">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
                {/* Logo */}
                <Link
                    href="/"
                    className="flex items-center gap-2.5 group"
                    aria-label="GrayPDF home"
                >
                    <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[#010736] via-[#0d1c42] to-[#22396f] flex items-center justify-center shadow-md group-hover:shadow-lg transition-all duration-300 group-hover:scale-105">
                        <span className="text-[#FCF1D0] font-bold text-lg tracking-tight">
                            G
                        </span>
                        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6] opacity-0 group-hover:opacity-30 transition-opacity duration-300 blur-md -z-10" />
                    </div>
                    <span className="text-lg font-bold tracking-tight text-[#010736]">
                        Gray<span className="text-[#22396F]">PDF</span>
                    </span>
                </Link>

                {/* Right side */}
                <div className="flex items-center gap-2 sm:gap-3">
                    {/*
            Render NOTHING server-side and during the initial client render.
            Only after `mounted` is true (after hydration) do we render
            anything that depends on `user`, `usage`, or `loading`.
            This prevents "server HTML != client HTML" hydration mismatches.
          */}
                    {mounted && (
                        <>
                            {/* Usage badge */}
                            {usage && (
                                <Link
                                    href={user ? "/dashboard" : "/register"}
                                    className={`hidden sm:inline-flex text-xs px-3 py-1.5 rounded-full font-medium transition-all border ${usage.remaining === 0
                                            ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                                            : usage.remaining <= 2
                                                ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                                                : "bg-white/70 text-[#0D1C42] border-[#e5dcb8] hover:bg-white"
                                        }`}
                                    title={
                                        usage.is_guest
                                            ? "Sign up for 20 files/day"
                                            : "Your daily usage"
                                    }
                                >
                                    {usage.used}/{usage.limit} today
                                </Link>
                            )}

                            {loading ? (
                                <div className="w-20 h-8 skeleton rounded-lg" />
                            ) : user ? (
                                <>
                                    <Link
                                        href="/dashboard"
                                        className="hidden sm:inline-block text-sm font-medium text-[#0D1C42] hover:text-[#22396F] transition-colors px-3 py-2"
                                    >
                                        Dashboard
                                    </Link>

                                    <div className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-white/70 border border-[#e5dcb8]">
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#22396F] to-[#0D1C42] flex items-center justify-center text-[#FCF1D0] text-xs font-bold">
                                            {getInitials(user.username)}
                                        </div>
                                        <span className="text-sm font-medium text-[#010736] hidden sm:inline max-w-[120px] truncate">
                                            {user.username}
                                        </span>
                                    </div>

                                    <button
                                        onClick={handleLogout}
                                        className="text-sm font-medium text-[#0D1C42] hover:text-red-600 transition-colors px-2"
                                    >
                                        Log out
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Link
                                        href="/login"
                                        className="text-sm font-medium text-[#0D1C42] hover:text-[#22396F] transition-colors px-3 py-2"
                                    >
                                        Log in
                                    </Link>
                                    <Link
                                        href="/register"
                                        className="relative text-sm font-semibold bg-gradient-to-br from-[#010736] to-[#22396f] hover:brightness-110 text-[#FCF1D0] px-4 py-2 rounded-lg transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5"
                                    >
                                        Sign up free
                                    </Link>
                                </>
                            )}
                        </>
                    )}

                    {/*
            During SSR and the first client render, render an invisible
            placeholder so the layout doesn't collapse.
          */}
                    {!mounted && <div className="w-20 h-8" />}
                </div>
            </div>
        </nav>
    );
}