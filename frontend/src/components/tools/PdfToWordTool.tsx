"use client";

import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

export function PdfToWordTool() {
    return (
        <SinglePdfTool slug="pdf-to-word" action="Convert to Word">
            <p className="text-xs text-ink-3 mt-3">
                Works best on PDFs with real text. For scans, run OCR PDF first.
            </p>
        </SinglePdfTool>
    );
}
