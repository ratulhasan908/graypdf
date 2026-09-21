const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}

// Single-flight lock: only one refresh in-flight at a time
let refreshPromise: Promise<boolean> | null = null;
const REQUEST_TIMEOUT_MS = 15000;

async function fetchWithTimeout(
    url: string,
    options: RequestInit
): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/auth/refresh/`, {
                method: "POST",
                credentials: "include",
            });
            return res.ok;
        } catch {
            return false;
        } finally {
            // Release the lock after a short delay so parallel requests
            // don't all trigger refresh at once
            setTimeout(() => {
                refreshPromise = null;
            }, 500);
        }
    })();

    return refreshPromise;
}

/**
 * List of endpoints that should NEVER trigger a refresh.
 * These are either auth endpoints or /me (which is the whole point
 * of checking whether we're logged in).
 */
function isNoRefreshEndpoint(url: string): boolean {
    return (
        url.includes("/auth/login/") ||
        url.includes("/auth/register/") ||
        url.includes("/auth/refresh/") ||
        url.includes("/auth/logout/") ||
        url.includes("/auth/me/")
    );
}

async function doFetch(url: string, options: RequestInit): Promise<Response> {
    let res = await fetchWithTimeout(url, options);

    if (res.status === 401 && !isNoRefreshEndpoint(url)) {
        const refreshed = await tryRefresh();
        if (refreshed) {
            res = await fetchWithTimeout(url, options);
        }
    }

    return res;
}

export async function apiFetch<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const res = await doFetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const error = await res.json();
            detail = error.detail || detail;
        } catch {
            // not JSON
        }
        throw new ApiError(detail, res.status);
    }

    return res.json();
}

export async function apiUpload<T>(
    endpoint: string,
    formData: FormData
): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    const res = await doFetch(url, {
        method: "POST",
        credentials: "include",
        body: formData,
    });

    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const error = await res.json();
            detail = error.detail || detail;
        } catch {
            // not JSON
        }
        throw new ApiError(detail, res.status);
    }

    return res.json();
}

export function getApiBaseUrl(): string {
    return API_BASE_URL;
}