"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiUpload, ApiError, getErrorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export type Job = {
    id: string;
    tool: string;
    status: "pending" | "processing" | "completed" | "failed";
    output_file: string | null;
    download_url: string | null;
    error_message: string | null;
    created_at: string;
    completed_at: string | null;
    source_name: string | null;
    source_count: number;
    expires_at: string | null;
    result: {
        original_size?: number;
        compressed_size?: number;
        savings_percent?: number;
        tables?: number;
        redactions?: number;
        pages?: number;
        was_damaged?: boolean;
        words_added?: number;
        words_removed?: number;
        pages_changed?: number;
        text_pages?: number;
        edits?: number;
        replaced?: number;
    } | null;
};

export type ToolPhase = "idle" | "uploading" | "processing" | "done" | "failed";

const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 11 * 60 * 1000; // OCR can run for up to 10 minutes
const MAX_POLL_ERRORS = 5;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs one tool job: upload, wait for the worker, report the outcome. */
export function useToolJob(endpoint: string) {
    const { refreshUsage } = useAuth();
    const [phase, setPhase] = useState<ToolPhase>("idle");
    const [progress, setProgress] = useState(0);
    const [job, setJob] = useState<Job | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [limitReached, setLimitReached] = useState(false);
    // Bumped to abandon an in-flight run on reset or unmount.
    const runId = useRef(0);

    useEffect(() => {
        return () => {
            runId.current += 1;
        };
    }, []);

    const watch = useCallback(async (jobId: string, run: number) => {
        const startedAt = Date.now();
        let failures = 0;
        while (run === runId.current) {
            if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
                setError("This is taking longer than expected. Please try again.");
                setPhase("failed");
                return;
            }
            await sleep(POLL_INTERVAL_MS);
            if (run !== runId.current) return;
            try {
                const latest = await apiFetch<Job>(`/jobs/${jobId}/status/`);
                failures = 0;
                setJob(latest);
                if (latest.status === "completed") {
                    setPhase("done");
                    return;
                }
                if (latest.status === "failed") {
                    setError(latest.error_message || "Something went wrong.");
                    setPhase("failed");
                    return;
                }
            } catch (err: unknown) {
                failures += 1;
                if (failures >= MAX_POLL_ERRORS) {
                    setError(getErrorMessage(err, "Could not check on your file."));
                    setPhase("failed");
                    return;
                }
            }
        }
    }, []);

    const submit = useCallback(
        async (body: FormData | Record<string, string>) => {
            const run = ++runId.current;
            setError(null);
            setLimitReached(false);
            setJob(null);
            setProgress(0);
            setPhase("uploading");

            try {
                const created =
                    body instanceof FormData
                        ? await apiUpload<Job>(endpoint, body, setProgress)
                        : await apiFetch<Job>(endpoint, {
                              method: "POST",
                              body: JSON.stringify(body),
                          });
                if (run !== runId.current) return;
                setJob(created);
                setPhase("processing");
                refreshUsage();
                if (created.status === "failed") {
                    setError(created.error_message || "Something went wrong.");
                    setPhase("failed");
                    return;
                }
                await watch(created.id, run);
            } catch (err: unknown) {
                if (run !== runId.current) return;
                setLimitReached(err instanceof ApiError && err.status === 429);
                setError(getErrorMessage(err, "Something went wrong. Please try again."));
                // Validation problems are fixed on the form, so go back to it.
                setPhase("idle");
            }
        },
        [endpoint, refreshUsage, watch]
    );

    const reset = useCallback(() => {
        runId.current += 1;
        setPhase("idle");
        setProgress(0);
        setJob(null);
        setError(null);
        setLimitReached(false);
    }, []);

    return { phase, progress, job, error, limitReached, submit, reset, setError };
}

export type ToolRun = ReturnType<typeof useToolJob>;
