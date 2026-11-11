"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FilePen, LayoutDashboard, LogOut } from "lucide-react";
import Logo from "@/components/Logo";
import { useAuth } from "@/context/AuthContext";

function GuestAllowance() {
    const { usage } = useAuth();
    if (!usage?.is_guest || usage.remaining === null) return null;
    const out = usage.remaining === 0;
    return (
        <Link
            href="/register"
            title="Sign up free for unlimited files"
            className={`hidden sm:inline-flex text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                out ? "bg-danger-soft text-danger" : "bg-surface-2 text-ink-2 hover:text-ink"
            }`}
        >
            {usage.remaining} of {usage.limit} files left today
        </Link>
    );
}

function AccountMenu() {
    const { user, logout } = useAuth();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const menu = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function close(event: MouseEvent | KeyboardEvent) {
            if (event instanceof KeyboardEvent) {
                if (event.key === "Escape") setOpen(false);
            } else if (!menu.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", close);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", close);
        };
    }, [open]);

    if (!user) return null;

    async function handleLogout() {
        setOpen(false);
        await logout();
        router.push("/");
    }

    const item = "flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-surface-2 transition-colors";

    return (
        <div className="relative" ref={menu}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-haspopup="menu"
                className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full hover:bg-surface-2 transition-colors"
            >
                <span className="w-7 h-7 rounded-full bg-ink text-white text-xs font-semibold flex items-center justify-center uppercase">
                    {user.username.slice(0, 1)}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-ink-3" aria-hidden />
                <span className="sr-only">Account menu</span>
            </button>
            {open && (
                <div role="menu" className="absolute right-0 mt-2 w-56 card p-1.5 shadow-lg rise">
                    <p className="px-3 py-2 text-xs text-ink-3 truncate">{user.email}</p>
                    <Link href="/dashboard" role="menuitem" className={item} onClick={() => setOpen(false)}>
                        <LayoutDashboard className="w-4 h-4" aria-hidden />
                        Dashboard
                    </Link>
                    <button type="button" role="menuitem" className={item} onClick={handleLogout}>
                        <LogOut className="w-4 h-4" aria-hidden />
                        Log out
                    </button>
                </div>
            )}
        </div>
    );
}

export default function Navbar() {
    const { user, loading } = useAuth();

    const navLink =
        "h-9 inline-flex items-center px-3 rounded-lg text-ink-2 hover:text-ink hover:bg-ink/5 transition-colors";

    return (
        <header className="sticky top-0 z-40 px-3 sm:px-4 pt-3">
            <div className="nav-glass max-w-6xl mx-auto h-14 rounded-2xl pl-4 pr-2 flex items-center justify-between gap-4">
                <div className="flex items-center gap-5 h-full">
                    <Link href="/" aria-label="GreyPDF home" className="flex items-center h-full">
                        <Logo />
                    </Link>
                    <nav aria-label="Main" className="hidden md:flex items-center gap-0.5 text-sm">
                        <Link
                            href="/tools/edit-pdf"
                            className="nav-edit h-9 inline-flex items-center gap-1.5 px-3 mr-1 rounded-lg font-medium text-ink transition-colors"
                        >
                            <FilePen className="w-4 h-4 text-[#e8287a]" aria-hidden />
                            Edit PDF
                            <span className="free-badge text-[10px] font-bold tracking-wide text-white rounded-full px-1.5 py-px">FREE</span>
                        </Link>
                        <Link href="/#tools" className={navLink}>
                            Tools
                        </Link>
                        <Link href="/#how" className={navLink}>
                            How it works
                        </Link>
                        <Link href="/#faq" className={navLink}>
                            FAQ
                        </Link>
                        {user && (
                            <Link href="/dashboard" className={navLink}>
                                Dashboard
                            </Link>
                        )}
                    </nav>
                </div>

                <div className="flex items-center gap-1.5">
                    <GuestAllowance />
                    {loading ? (
                        <div className="w-28 h-9 skeleton" />
                    ) : user ? (
                        <AccountMenu />
                    ) : (
                        <>
                            <Link href="/login" className={`${navLink} text-sm`}>
                                Log in
                            </Link>
                            <Link
                                href="/register"
                                className="btn btn-dark h-9 py-0! px-4! text-sm! rounded-xl! shadow-[0_6px_16px_-8px_rgba(10,12,30,0.8)]"
                            >
                                Sign up free
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </header>
    );
}
