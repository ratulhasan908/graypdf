"use client";

import {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";

export type User = {
    id: number;
    email: string;
    username: string;
    is_premium: boolean;
};

export type Usage = {
    used: number;
    limit: number;
    remaining: number;
    is_guest: boolean;
};

type AuthContextType = {
    user: User | null;
    usage: Usage | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (
        email: string,
        username: string,
        password: string,
        password_confirm: string
    ) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    refreshUsage: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [usage, setUsage] = useState<Usage | null>(null);
    const [loading, setLoading] = useState(true);

    async function refreshUser() {
        try {
            const data = await apiFetch<User & { usage?: Usage }>("/auth/me/");
            setUser(data);
            if (data.usage) setUsage(data.usage);
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    async function refreshUsage() {
        try {
            const data = await apiFetch<Usage>("/usage/");
            setUsage(data);
        } catch {
            // ignore
        }
    }

    useEffect(() => {
        let cancelled = false;
        (async () => {
            await refreshUser();
            if (cancelled) return;
            await refreshUsage();
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    async function login(email: string, password: string) {
        const data = await apiFetch<User>("/auth/login/", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
        setUser(data);
        await refreshUsage();
    }

    async function register(
        email: string,
        username: string,
        password: string,
        password_confirm: string
    ) {
        await apiFetch("/auth/register/", {
            method: "POST",
            body: JSON.stringify({ email, username, password, password_confirm }),
        });
        await login(email, password);
    }

    async function logout() {
        try {
            await apiFetch("/auth/logout/", { method: "POST" });
        } catch {
            // ignore
        }
        setUser(null);
        await refreshUsage();
    }

    return (
        <AuthContext.Provider
            value={{
                user,
                usage,
                loading,
                login,
                register,
                logout,
                refreshUser,
                refreshUsage,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
    return ctx;
}