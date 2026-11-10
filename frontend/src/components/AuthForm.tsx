"use client";

import Link from "next/link";
import { ReactNode, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import Logo from "@/components/Logo";

export function AuthShell({
    title,
    subtitle,
    footer,
    children,
}: {
    title: string;
    subtitle: string;
    footer: ReactNode;
    children: ReactNode;
}) {
    return (
        <main className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
            <div className="w-full max-w-sm rise">
                <div className="mb-6">
                    <Link href="/" aria-label="GreyPDF home" className="inline-block mb-6 sm:hidden">
                        <Logo />
                    </Link>
                    <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
                    <p className="text-ink-2 mt-1.5">{subtitle}</p>
                </div>
                {children}
                <p className="text-sm text-ink-2 mt-6">{footer}</p>
            </div>
        </main>
    );
}

export function TextField({
    label,
    hint,
    ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <label className="block">
            <span className="block text-sm font-medium mb-1.5">{label}</span>
            <input className="input" required {...input} />
            {hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
        </label>
    );
}

export function PasswordField({
    label,
    hint,
    ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
    const [show, setShow] = useState(false);
    return (
        <label className="block">
            <span className="block text-sm font-medium mb-1.5">{label}</span>
            <span className="relative block">
                <input className="input pr-10" required type={show ? "text" : "password"} {...input} />
                <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-3 hover:text-ink"
                >
                    {show ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                </button>
            </span>
            {hint && <span className="block text-xs text-ink-3 mt-1">{hint}</span>}
        </label>
    );
}

export function FormAlert({ message }: { message: string | null }) {
    if (!message) return null;
    return (
        <p className="rounded-xl bg-danger-soft text-danger px-4 py-3 text-sm rise" role="alert">
            {message}
        </p>
    );
}
