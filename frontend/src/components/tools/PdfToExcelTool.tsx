"use client";

import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

export function PdfToExcelTool() {
    return (
        <SinglePdfTool slug="pdf-to-excel" action="Convert to Excel">
            <p className="text-xs text-ink-3 mt-3">
                Each table gets its own sheet. For scans, run OCR PDF first.
            </p>
        </SinglePdfTool>
    );
}
