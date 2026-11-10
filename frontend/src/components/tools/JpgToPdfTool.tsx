"use client";

import { useState } from "react";
import ToolLayout, { FormError } from "@/components/ToolLayout";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { FilePicker, SortableFiles } from "@/components/tools/FilePicker";
import { getToolBySlug } from "@/lib/tools";
import { useToolJob } from "@/lib/useToolJob";

type PageSize = "auto" | "A4" | "Letter";

const IMAGE_TYPES = [".jpg", ".jpeg", ".png"];

const SIZES = [
    { value: "auto" as PageSize, title: "Match image", desc: "Each page fits its image" },
    { value: "A4" as PageSize, title: "A4", desc: "210 × 297 mm" },
    { value: "Letter" as PageSize, title: "US Letter", desc: "8.5 × 11 in" },
];

export function JpgToPdfTool() {
    const run = useToolJob(getToolBySlug("jpg-to-pdf")?.endpoint ?? "");
    const [files, setFiles] = useState<File[]>([]);
    const [pageSize, setPageSize] = useState<PageSize>("auto");

    function handleSubmit() {
        const body = new FormData();
        files.forEach((file) => body.append("files", file));
        body.append("page_size", pageSize);
        run.submit(body);
    }

    return (
        <ToolLayout slug="jpg-to-pdf" run={run} onReset={() => setFiles([])}>
            {files.length === 0 ? (
                <FilePicker extensions={IMAGE_TYPES} label="Choose images" multiple onFiles={setFiles} onError={run.setError} />
            ) : (
                <>
                    <div className="space-y-2">
                        <SortableFiles files={files} onChange={setFiles} />
                        <FilePicker
                            extensions={IMAGE_TYPES}
                            label="Add more images"
                            multiple
                            compact
                            onFiles={(added) => setFiles([...files, ...added])}
                            onError={run.setError}
                        />
                    </div>
                    <Section title="Page size">
                        <ChoiceCards value={pageSize} options={SIZES} onChange={setPageSize} columns={3} />
                    </Section>
                </>
            )}
            <FormError run={run} />
            {files.length > 0 && (
                <button type="button" onClick={handleSubmit} className="btn btn-primary btn-lg w-full mt-6">
                    Convert to PDF
                </button>
            )}
        </ToolLayout>
    );
}
