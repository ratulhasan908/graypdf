"use client";

import { useState } from "react";
import ToolLayout, { FormError } from "@/components/ToolLayout";
import { FilePicker, SortableFiles } from "@/components/tools/FilePicker";
import { getToolBySlug } from "@/lib/tools";
import { useToolJob } from "@/lib/useToolJob";

export function MergeTool() {
    const run = useToolJob(getToolBySlug("merge-pdf")?.endpoint ?? "");
    const [files, setFiles] = useState<File[]>([]);

    function handleSubmit() {
        const body = new FormData();
        files.forEach((file) => body.append("files", file));
        run.submit(body);
    }

    return (
        <ToolLayout slug="merge-pdf" run={run} onReset={() => setFiles([])}>
            {files.length === 0 ? (
                <FilePicker
                    extensions={[".pdf"]}
                    label="Choose PDFs"
                    multiple
                    onFiles={setFiles}
                    onError={run.setError}
                />
            ) : (
                <div className="space-y-2">
                    <SortableFiles files={files} onChange={setFiles} />
                    <FilePicker
                        extensions={[".pdf"]}
                        label="Add more PDFs"
                        multiple
                        compact
                        onFiles={(added) => setFiles([...files, ...added])}
                        onError={run.setError}
                    />
                </div>
            )}
            <FormError run={run} />
            {files.length > 0 && (
                <button
                    type="button"
                    disabled={files.length < 2}
                    onClick={handleSubmit}
                    className="btn btn-primary btn-lg w-full mt-6"
                >
                    {files.length < 2 ? "Add at least one more PDF" : `Merge ${files.length} PDFs`}
                </button>
            )}
        </ToolLayout>
    );
}
