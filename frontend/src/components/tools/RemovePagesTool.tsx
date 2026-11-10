"use client";

import { useState } from "react";
import { PagePicker } from "@/components/tools/PagePicker";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";
import { usePagePreviews } from "@/lib/usePagePreviews";

export function RemovePagesTool() {
    const previews = usePagePreviews(60);
    const [pages, setPages] = useState("");

    return (
        <SinglePdfTool
            slug="remove-pages"
            action="Remove pages"
            wide
            fields={{ pages }}
            validate={() => (pages.trim() ? null : "Choose the pages to remove.")}
            onFile={(file) => {
                setPages("");
                if (file) previews.load(file);
                else previews.clear();
            }}
        >
            <PagePicker previews={previews} value={pages} onChange={setPages} mode="remove" />
        </SinglePdfTool>
    );
}
