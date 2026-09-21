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

/**
 * Try to refresh the access token using the refresh cookie.
 * Returns true if a new access_token was set.
 */
async function tryRefresh(): Promise<boolean> {
    try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh/`, {
            method: "POST",
            credentials: "include",
        });
        return res.ok;
    } catch {
        return false;
    }
}

/**
 * A fetch wrapper that:
 *  1. Includes credentials (cookies)
 *  2. On 401, tries to refresh the access token once
 *  3. Retries the original request if refresh succeeded
 *
 * Skips refresh for auth endpoints to avoid infinite loops.
 */
async function doFetch(
    url: string,
    options: RequestInit
): Promise<Response> {
    let res = await fetch(url, options);

    const isAuthEndpoint =
        url.includes("/auth/login/") ||
        url.includes("/auth/register/") ||
        url.includes("/auth/refresh/") ||
        url.includes("/auth/logout/");

    // Only try refresh if we got 401 and it's NOT an auth endpoint
    if (res.status === 401 && !isAuthEndpoint) {
        const refreshed = await tryRefresh();
        if (refreshed) {
            // Retry the original request with the new cookie
            res = await fetch(url, options);
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

    // For FormData, DO NOT set Content-Type — the browser sets it with the
    // multipart boundary automatically.
    const options: RequestInit = {
        method: "POST",
        credentials: "include",
        body: formData,
    };

    const res = await doFetch(url, options);

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