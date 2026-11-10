"use client";

import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

export function PowerPointToPdfTool() {
    return (
        <SinglePdfTool
            slug="powerpoint-to-pdf"
            action="Convert to PDF"
            extensions={[".pptx", ".ppt", ".odp"]}
            pickLabel="Choose a presentation"
        >
            <p className="text-xs text-ink-3 mt-3">Animations and videos become still images.</p>
        </SinglePdfTool>
    );
}
