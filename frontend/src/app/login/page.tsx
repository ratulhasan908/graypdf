"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell, FormAlert, PasswordField, TextField } from "@/components/AuthForm";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
    const router = useRouter();
    const { login } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await login(email, password);
            router.push("/dashboard");
        } catch (err: unknown) {
            setError(
                err instanceof ApiError && err.status === 401
                    ? "That email and password don't match."
                    : "Could not log in. Please try again."
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthShell
            title="Welcome back"
            subtitle="Log in to see your files and history."
            footer={
                <>
                    New here?{" "}
                    <Link href="/register" className="text-accent font-medium hover:underline">
                        Create a free account
                    </Link>
                </>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <FormAlert message={error} />
                <TextField
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                />
                <PasswordField
                    label="Password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                />
                <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
                    {loading ? "Logging in…" : "Log in"}
                </button>
            </form>
        </AuthShell>
    );
}
