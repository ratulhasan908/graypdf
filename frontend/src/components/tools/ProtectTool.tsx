"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Section, Toggle } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

function strength(password: string) {
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;
    if (score <= 2) return { bars: 1, label: "Weak", color: "bg-danger" };
    if (score === 3) return { bars: 2, label: "Fair", color: "bg-warning" };
    if (score === 4) return { bars: 3, label: "Good", color: "bg-success" };
    return { bars: 4, label: "Strong", color: "bg-success" };
}

export function ProtectTool() {
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [show, setShow] = useState(false);
    const [printing, setPrinting] = useState(true);
    const [copying, setCopying] = useState(true);
    const rating = strength(password);

    function clear() {
        setPassword("");
        setConfirm("");
    }

    return (
        <SinglePdfTool
            slug="protect-pdf"
            action="Protect PDF"
            fields={{ password, allow_printing: String(printing), allow_copying: String(copying) }}
            onReset={clear}
            validate={() => {
                if (password.length < 4) return "Use a password of at least 4 characters.";
                if (password !== confirm) return "The two passwords don't match.";
                return null;
            }}
        >
            <Section title="Password" hint="There is no way to recover this password, so keep it somewhere safe.">
                <div className="relative">
                    <input
                        type={show ? "text" : "password"}
                        className="input pr-10"
                        value={password}
                        autoComplete="new-password"
                        onChange={(event) => setPassword(event.target.value)}
                        aria-label="Password"
                    />
                    <button
                        type="button"
                        onClick={() => setShow(!show)}
                        aria-label={show ? "Hide password" : "Show password"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-ink-3 hover:text-ink"
                    >
                        {show ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                    </button>
                </div>
                {password && (
                    <div className="flex items-center gap-2 mt-2">
                        <div className="flex gap-1 flex-1">
                            {[1, 2, 3, 4].map((bar) => (
                                <span key={bar} className={`h-1 flex-1 rounded-full ${bar <= rating.bars ? rating.color : "bg-surface-2"}`} />
                            ))}
                        </div>
                        <span className="text-xs text-ink-2 w-12 text-right">{rating.label}</span>
                    </div>
                )}
                <input
                    type={show ? "text" : "password"}
                    className="input mt-2"
                    value={confirm}
                    autoComplete="new-password"
                    placeholder="Repeat password"
                    onChange={(event) => setConfirm(event.target.value)}
                    aria-label="Repeat password"
                />
            </Section>
            <Section title="Permissions">
                <div className="card px-4 py-1 divide-y divide-line">
                    <Toggle label="Allow printing" checked={printing} onChange={setPrinting} />
                    <Toggle label="Allow copying text" checked={copying} onChange={setCopying} />
                </div>
            </Section>
        </SinglePdfTool>
    );
}
