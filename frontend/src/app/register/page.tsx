"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Mail, Lock, User, Sparkles, Check } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const PERKS = [
    "20 files per day (vs 5 for guests)",
    "Full dashboard with history",
    "50 MB file size limit",
];

export default function RegisterPage() {
    const router = useRouter();
    const { register } = useAuth();

    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        setError(null);

        if (password !== passwordConfirm) {
            setError("Passwords do not match.");
            return;
        }

        if (password.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }

        setLoading(true);
        try {
            await register(email, username, password, passwordConfirm);
            router.push("/dashboard");
        } catch (err: any) {
            if (err.status === 400) {
                setError(err.message || "Invalid details. Check all fields.");
            } else if (err.status === 429) {
                setError("Too many attempts. Please try again later.");
            } else {
                setError("Could not create account. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="mesh-bg grain relative min-h-screen flex items-center justify-center px-4 py-12">
            {/* Decorative orbs */}
            <div className="absolute top-20 right-[10%] w-[400px] h-[400px] rounded-full bg-[#8b5cf6]/15 blur-[100px] animate-orb-1 pointer-events-none" />
            <div className="absolute bottom-20 left-[10%] w-[400px] h-[400px] rounded-full bg-[#4f7cff]/15 blur-[100px] animate-orb-2 pointer-events-none" />

            <div className="relative w-full max-w-md animate-fade-in">
                {/* Logo */}
                <div className="text-center mb-8">
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2.5 mb-6 group"
                        aria-label="GrayPDF home"
                    >
                        <div className="relative w-11 h-11 rounded-2xl bg-gradient-to-br from-[#010736] via-[#0d1c42] to-[#22396f] flex items-center justify-center shadow-lg group-hover:shadow-xl transition-all group-hover:scale-105">
                            <span className="text-[#FCF1D0] font-bold text-xl">G</span>
                            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#4f7cff] to-[#8b5cf6] opacity-0 group-hover:opacity-30 blur-md -z-10 transition-opacity" />
                        </div>
                        <span className="text-2xl font-bold tracking-tight text-[#010736]">
                            Gray<span className="text-[#22396F]">PDF</span>
                        </span>
                    </Link>

                    <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[#010736] mb-2">
                        Create your account
                    </h1>
                    <p className="text-[#0D1C42]/60">
                        Get more out of GrayPDF — free forever
                    </p>
                </div>

                {/* Card */}
                <div className="glass rounded-3xl border border-white/80 shadow-[0_20px_60px_rgba(1,7,54,0.1)] p-8">
                    {/* Perks */}
                    <div className="bg-[#FCF1D0]/60 border border-[#e5dcb8] rounded-xl p-4 mb-6">
                        <p className="text-xs font-semibold text-[#0D1C42]/60 uppercase tracking-wider mb-2.5">
                            What you get
                        </p>
                        <ul className="space-y-1.5">
                            {PERKS.map((perk) => (
                                <li key={perk} className="flex items-start gap-2 text-sm text-[#010736]">
                                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" strokeWidth={3} />
                                    <span>{perk}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl mb-5 text-sm animate-fade-in">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[#010736] mb-2">
                                Email
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0D1C42]/40 pointer-events-none" />
                                <input
                                    type="email"
                                    required
                                    autoComplete="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full pl-10 pr-3 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#22396F] focus:bg-white text-[#010736] transition-all"
                                    placeholder="you@example.com"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-[#010736] mb-2">
                                Username
                            </label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0D1C42]/40 pointer-events-none" />
                                <input
                                    type="text"
                                    required
                                    autoComplete="username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full pl-10 pr-3 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#22396F] focus:bg-white text-[#010736] transition-all"
                                    placeholder="yourname"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-[#010736] mb-2">
                                Password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0D1C42]/40 pointer-events-none" />
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-10 pr-3 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#22396F] focus:bg-white text-[#010736] transition-all"
                                    placeholder="At least 8 characters"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-[#010736] mb-2">
                                Confirm password
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0D1C42]/40 pointer-events-none" />
                                <input
                                    type="password"
                                    required
                                    minLength={8}
                                    autoComplete="new-password"
                                    value={passwordConfirm}
                                    onChange={(e) => setPasswordConfirm(e.target.value)}
                                    className="w-full pl-10 pr-3 py-3 border border-[#e5dcb8] rounded-xl bg-white/80 focus:outline-none focus:ring-2 focus:ring-[#22396F] focus:bg-white text-[#010736] transition-all"
                                    placeholder="Repeat password"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary w-full flex items-center justify-center gap-2 group mt-2"
                        >
                            <span>{loading ? "Creating account..." : "Create account"}</span>
                            {!loading && (
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            )}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-sm text-[#0D1C42]/60">
                        Already have an account?{" "}
                        <Link
                            href="/login"
                            className="font-semibold text-[#22396F] hover:underline"
                        >
                            Log in
                        </Link>
                    </div>
                </div>

                {/* Trust signals */}
                <div className="mt-6 flex items-center justify-center gap-6 text-xs text-[#0D1C42]/50">
                    <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>No credit card</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Secure signup</span>
                    </div>
                </div>
            </div>
        </main>
    );
}