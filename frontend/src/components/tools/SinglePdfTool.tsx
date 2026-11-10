"use client";

import { ReactNode, useState } from "react";
import ToolLayout, { FormError } from "@/components/ToolLayout";
import { FileCard, FilePicker } from "@/components/tools/FilePicker";
import { getToolBySlug } from "@/lib/tools";
import { useToolJob } from "@/lib/useToolJob";

type SinglePdfToolProps = {
    slug: string;
    action: string;
    /** Sent with the file. */
    fields?: Record<string, string>;
    /** Return a message to block submitting. */
    validate?: () => string | null;
    onReset?: () => void;
    /** Called when the file is chosen or removed. */
    onFile?: (file: File | null) => void;
    /** Add anything that isn't a plain field, such as a signature image. */
    extendBody?: (body: FormData) => Promise<void>;
    wide?: boolean;
    /** For tools that take something other than a PDF. */
    extensions?: string[];
    pickLabel?: string;
    children?: ReactNode;
};

/** The standard flow: pick one PDF, set options, run. */
export function SinglePdfTool({
    slug,
    action,
    fields,
    validate,
    onReset,
    onFile,
    extendBody,
    wide,
    extensions = [".pdf"],
    pickLabel = "Choose a PDF",
    children,
}: SinglePdfToolProps) {
    const run = useToolJob(getToolBySlug(slug)?.endpoint ?? "");
    const [file, setFile] = useState<File | null>(null);

    function choose(next: File | null) {
        setFile(next);
        onFile?.(next);
    }

    async function handleSubmit() {
        if (!file) return;
        const problem = validate?.();
        if (problem) {
            run.setError(problem);
            return;
        }
        const body = new FormData();
        body.append("files", file);
        Object.entries(fields ?? {}).forEach(([key, value]) => body.append(key, value));
        await extendBody?.(body);
        run.submit(body);
    }

    return (
        <ToolLayout
            slug={slug}
            run={run}
            wide={wide}
            onReset={() => {
                choose(null);
                onReset?.();
            }}
        >
            {file ? (
                <>
                    <FileCard file={file} onRemove={() => choose(null)} />
                    {children}
                    <FormError run={run} />
                    <button type="button" onClick={handleSubmit} className="btn btn-primary btn-lg w-full mt-6">
                        {action}
                    </button>
                </>
            ) : (
                <>
                    <FilePicker
                        extensions={extensions}
                        label={pickLabel}
                        onFiles={([chosen]) => choose(chosen)}
                        onError={run.setError}
                    />
                    <FormError run={run} />
                </>
            )}
        </ToolLayout>
    );
}
