"use client";

import { useState } from "react";
import { PagePicker } from "@/components/tools/PagePicker";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";
import { usePagePreviews } from "@/lib/usePagePreviews";

export function ExtractPagesTool() {
    const previews = usePagePreviews(60);
    const [pages, setPages] = useState("");

    return (
        <SinglePdfTool
            slug="extract-pages"
            action="Extract pages"
            wide
            fields={{ pages }}
            validate={() => (pages.trim() ? null : "Choose the pages to extract.")}
            onFile={(file) => {
                setPages("");
                if (file) previews.load(file);
                else previews.clear();
            }}
        >
            <PagePicker previews={previews} value={pages} onChange={setPages} mode="keep" />
        </SinglePdfTool>
    );
}
