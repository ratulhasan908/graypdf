"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check } from "lucide-react";
import { AuthShell, FormAlert, PasswordField, TextField } from "@/components/AuthForm";
import { useAuth } from "@/context/AuthContext";
import { getErrorMessage } from "@/lib/api";

const PERKS = ["Unlimited files, every day", "A history of your recent work", "Free forever, no credit card"];

export default function RegisterPage() {
    const router = useRouter();
    const { register } = useAuth();

    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [passwordConfirm, setPasswordConfirm] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(event: FormEvent) {
        event.preventDefault();
        setError(null);

        if (password !== passwordConfirm) {
            setError("The two passwords don't match.");
            return;
        }

        setLoading(true);
        try {
            await register(email, username, password, passwordConfirm);
            router.push("/dashboard");
        } catch (err: unknown) {
            setError(getErrorMessage(err, "Could not create your account. Please try again."));
        } finally {
            setLoading(false);
        }
    }

    return (
        <AuthShell
            title="Create your free account"
            subtitle="It takes less than a minute."
            footer={
                <>
                    Already have an account?{" "}
                    <Link href="/login" className="text-accent font-medium hover:underline">
                        Log in
                    </Link>
                </>
            }
        >
            <ul className="space-y-1.5 mb-6">
                {PERKS.map((perk) => (
                    <li key={perk} className="flex items-center gap-2 text-sm text-ink-2">
                        <Check className="w-4 h-4 text-success shrink-0" aria-hidden />
                        {perk}
                    </li>
                ))}
            </ul>
            <form onSubmit={handleSubmit} className="space-y-4">
                <FormAlert message={error} />
                <TextField
                    label="Email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                />
                <TextField
                    label="Username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                />
                <PasswordField
                    label="Password"
                    hint="At least 8 characters"
                    autoComplete="new-password"
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                />
                <PasswordField
                    label="Repeat password"
                    autoComplete="new-password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                />
                <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
                    {loading ? "Creating your account…" : "Create account"}
                </button>
            </form>
        </AuthShell>
    );
}
