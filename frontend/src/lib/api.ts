const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

// Warn if using the fallback in production
if (
    process.env.NODE_ENV === "production" &&
    !process.env.NEXT_PUBLIC_API_URL
) {
    console.warn(
        "[GreyPDF] NEXT_PUBLIC_API_URL is not set — falling back to localhost. " +
        "This will break in production."
    );
}

export class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}

export function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

/** DRF sends {detail} or per-field lists like {email: ["..."]}. */
function errorDetail(body: unknown, fallback: string): string {
    if (!body || typeof body !== "object") return fallback;
    const record = body as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    for (const value of Object.values(record)) {
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
        if (typeof value === "string") return value;
    }
    return fallback;
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
        url.includes("/auth/logout/")
        // NOTE: /auth/me/ IS allowed to trigger refresh now.
        // The single-flight lock in tryRefresh() prevents loops.
    );
}

async function doFetch(url: string, options: RequestInit): Promise<Response> {
    let res = await fetchWithTimeout(url, options);

    if (res.status === 401 && !isNoRefreshEndpoint(url)) {
        const refreshed = await tryRefresh();
        if (refreshed) {
            // Retry ONCE. If it still fails, we won't refresh again —
            // the response is returned as-is (likely 401 if the new token is also bad).
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
        const fallback = `Request failed (${res.status}).`;
        const body = await res.json().catch(() => null);
        throw new ApiError(errorDetail(body, fallback), res.status);
    }

    return res.json();
}

/**
 * Upload with progress. This has no time limit: a large file on a slow
 * connection can legitimately take minutes, which is why it does not go
 * through the short-timeout fetch helper above.
 */
export function apiUpload<T>(
    endpoint: string,
    formData: FormData,
    onProgress?: (percent: number) => void
): Promise<T> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE_URL}${endpoint}`);
        xhr.withCredentials = true;
        xhr.responseType = "json";

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
                onProgress(Math.round((event.loaded / event.total) * 100));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response as T);
            } else {
                const fallback =
                    xhr.status === 413
                        ? "This file is too large."
                        : `Upload failed (${xhr.status}).`;
                reject(new ApiError(errorDetail(xhr.response, fallback), xhr.status));
            }
        };
        xhr.onerror = () =>
            reject(new ApiError("Upload failed. Check your connection and try again.", 0));
        xhr.send(formData);
    });
}

export function getApiBaseUrl(): string {
    return API_BASE_URL;
}

/** The API sends download links as "/api/...". Point them at wherever the API lives. */
export function apiUrl(path: string): string {
    return path.startsWith("/api/") ? `${API_BASE_URL}${path.slice(4)}` : path;
}