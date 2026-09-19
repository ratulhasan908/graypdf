"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

function getInitials(name: string): string {
    const parts = name.trim().split(/[\s._-]+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Navbar() {
    const { user, usage, loading, logout } = useAuth();
    const router = useRouter();

    async function handleLogout() {
        await logout();
        router.push("/");
    }

    return (
        <nav className="sticky top-0 z-50 glass border-b border-[#e5dcb8]">
            <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
                {/* Logo */}
                <Link
                    href="/"
                    className="flex items-center gap-2 group"
                    aria-label="GrayPDF home"
                >
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#010736] to-[#22396f] flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
                        <span className="text-[#FCF1D0] font-bold text-lg">G</span>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-[#010736]">
                        Gray<span className="text-[#22396F]">PDF</span>
                    </span>
                </Link>

                {/* Right side */}
                <div className="flex items-center gap-2 sm:gap-3">
                    {/* Usage badge */}
                    {usage && (
                        <Link
                            href={user ? "/dashboard" : "/register"}
                            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all border ${usage.remaining === 0
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
                                className="hidden sm:inline-block text-sm font-medium text-[#0D1C42] hover:text-[#22396F] transition-colors"
                            >
                                Dashboard
                            </Link>

                            {/* User chip with avatar */}
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
                                className="text-sm font-medium text-[#0D1C42] hover:text-red-600 transition-colors"
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
                                className="text-sm font-semibold bg-gradient-to-br from-[#010736] to-[#22396f] hover:brightness-110 text-[#FCF1D0] px-4 py-2 rounded-lg transition-all shadow-sm hover:shadow-md"
                            >
                                Sign up
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
}