"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function DashboardPage() {
    const router = useRouter();
    const { user, loading, logout } = useAuth();

    useEffect(() => {
        if (!loading && !user) {
            router.push("/login");
        }
    }, [user, loading, router]);

    async function handleLogout() {
        await logout();
        router.push("/");
    }

    if (loading) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <p className="text-gray-500">Loading...</p>
            </main>
        );
    }

    if (!user) return null;

    return (
        <main className="min-h-screen bg-gray-50 px-4 py-8">
            <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <Link href="/" className="text-2xl font-bold text-blue-600">
                        GrayPDF
                    </Link>
                    <button
                        onClick={handleLogout}
                        className="text-sm text-gray-600 hover:text-red-600"
                    >
                        Log out
                    </button>
                </div>

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

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white rounded-lg shadow p-6">
                        <p className="text-sm text-gray-500 mb-1">Files today</p>
                        <p className="text-2xl font-bold">0 / 20</p>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                        <p className="text-sm text-gray-500 mb-1">Total files</p>
                        <p className="text-2xl font-bold">0</p>
                    </div>
                    <div className="bg-white rounded-lg shadow p-6">
                        <p className="text-sm text-gray-500 mb-1">Plan</p>
                        <p className="text-2xl font-bold">
                            {user.is_premium ? "Premium" : "Free"}
                        </p>
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow p-6 mt-6">
                    <h2 className="text-lg font-bold mb-3">Your recent files</h2>
                    <p className="text-gray-400 text-sm">
                        No files yet. Start using a tool to see them here.
                    </p>
                </div>
            </div>
        </main>
    );
}