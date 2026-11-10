"use client";

import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

export function PdfToPowerPointTool() {
    return (
        <SinglePdfTool slug="pdf-to-powerpoint" action="Convert to PowerPoint">
            <p className="text-xs text-ink-3 mt-3">
                Text stays editable. Images, tables and shapes become a picture behind the text.
            </p>
        </SinglePdfTool>
    );
}
