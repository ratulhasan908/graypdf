"use client";

import { useState } from "react";
import ToolLayout, { FormError } from "@/components/ToolLayout";
import { FileCard, FilePicker } from "@/components/tools/FilePicker";
import { getToolBySlug } from "@/lib/tools";
import { useToolJob } from "@/lib/useToolJob";

function Slot({
    title,
    file,
    onChange,
    onError,
}: {
    title: string;
    file: File | null;
    onChange: (file: File | null) => void;
    onError: (message: string | null) => void;
}) {
    return (
        <div>
            <h2 className="text-sm font-medium mb-2">{title}</h2>
            {file ? (
                <FileCard file={file} onRemove={() => onChange(null)} />
            ) : (
                <FilePicker
                    extensions={[".pdf"]}
                    label={`Choose ${title.toLowerCase()}`}
                    onFiles={([chosen]) => onChange(chosen)}
                    onError={onError}
                />
            )}
        </div>
    );
}

export function CompareTool() {
    const run = useToolJob(getToolBySlug("compare-pdf")?.endpoint ?? "");
    const [original, setOriginal] = useState<File | null>(null);
    const [changed, setChanged] = useState<File | null>(null);

    function handleSubmit() {
        if (!original || !changed) return;
        const body = new FormData();
        body.append("files", original);
        body.append("files", changed);
        run.submit(body);
    }

    return (
        <ToolLayout
            slug="compare-pdf"
            run={run}
            wide
            onReset={() => {
                setOriginal(null);
                setChanged(null);
            }}
        >
            <div className="grid md:grid-cols-2 gap-4">
                <Slot title="Original PDF" file={original} onChange={setOriginal} onError={run.setError} />
                <Slot title="Changed PDF" file={changed} onChange={setChanged} onError={run.setError} />
            </div>
            <p className="text-xs text-ink-3 mt-3">
                Compares the text of both files. Changes to images or layout aren&apos;t highlighted.
            </p>
            <FormError run={run} />
            <button
                type="button"
                disabled={!original || !changed}
                onClick={handleSubmit}
                className="btn btn-primary btn-lg w-full mt-6"
            >
                Compare PDFs
            </button>
        </ToolLayout>
    );
}
