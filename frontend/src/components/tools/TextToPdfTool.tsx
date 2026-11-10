"use client";

import { ChangeEvent, useState } from "react";
import { FolderOpen } from "lucide-react";
import ToolLayout, { FormError } from "@/components/ToolLayout";
import { getToolBySlug } from "@/lib/tools";
import { useToolJob } from "@/lib/useToolJob";

type TextToPdfToolProps = {
    slug: string;
    /** Request field that carries the text. */
    field: "html" | "markdown";
    label: string;
    extensions: string[];
    sample: string;
};

export function TextToPdfTool({ slug, field, label, extensions, sample }: TextToPdfToolProps) {
    const run = useToolJob(getToolBySlug(slug)?.endpoint ?? "");
    const [text, setText] = useState(sample);

    async function handleOpen(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) setText(await file.text());
    }

    return (
        <ToolLayout slug={slug} run={run} wide onReset={() => setText(sample)}>
            <div className="card overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line">
                    <span className="text-sm font-medium">{label}</span>
                    <label className="inline-flex items-center gap-1.5 text-sm text-accent cursor-pointer hover:underline focus-within:outline-2 focus-within:outline-accent rounded">
                        <FolderOpen className="w-4 h-4" aria-hidden />
                        Open a file
                        <input type="file" accept={extensions.join(",")} onChange={handleOpen} className="sr-only" />
                    </label>
                </div>
                <textarea
                    aria-label={label}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    spellCheck={false}
                    className="w-full h-96 p-4 font-mono text-sm leading-relaxed resize-y focus:outline-none bg-surface"
                />
            </div>
            <p className="text-xs text-ink-3 mt-2">
                Latin, Greek and Cyrillic text work well. Bangla and Chinese text is left out for now, and
                other scripts may not display correctly.
            </p>
            <FormError run={run} />
            <button
                type="button"
                disabled={!text.trim()}
                onClick={() => run.submit({ [field]: text })}
                className="btn btn-primary btn-lg w-full mt-6"
            >
                Convert to PDF
            </button>
        </ToolLayout>
    );
}
