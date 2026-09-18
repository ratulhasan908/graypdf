"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function Navbar() {
    const { user, loading, logout } = useAuth();
    const router = useRouter();

    async function handleLogout() {
        await logout();
        router.push("/");
    }

    return (
        <nav className="bg-white border-b border-gray-200">
            <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
                <Link href="/" className="text-2xl font-bold text-blue-600">
                    GrayPDF
                </Link>

                <div className="flex items-center gap-4">
                    {loading ? null : user ? (
                        <>
                            <Link
                                href="/dashboard"
                                className="text-sm text-gray-700 hover:text-blue-600"
                            >
                                Dashboard
                            </Link>
                            <span className="text-sm text-gray-400">{user.username}</span>
                            <button
                                onClick={handleLogout}
                                className="text-sm text-gray-700 hover:text-red-600"
                            >
                                Log out
                            </button>
                        </>
                    ) : (
                        <>
                            <Link
                                href="/login"
                                className="text-sm text-gray-700 hover:text-blue-600"
                            >
                                Log in
                            </Link>
                            <Link
                                href="/register"
                                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition"
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