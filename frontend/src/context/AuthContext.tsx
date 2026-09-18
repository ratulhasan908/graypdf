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

type AuthContextType = {
    user: User | null;
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
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    async function refreshUser() {
        try {
            const data = await apiFetch<User>("/auth/me/");
            setUser(data);
        } catch {
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        refreshUser();
    }, []);

    async function login(email: string, password: string) {
        const data = await apiFetch<User>("/auth/login/", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
        setUser(data);
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
        // auto-login after register
        await login(email, password);
    }

    async function logout() {
        await apiFetch("/auth/logout/", { method: "POST" });
        setUser(null);
    }

    return (
        <AuthContext.Provider
            value={{ user, loading, login, register, logout, refreshUser }}
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