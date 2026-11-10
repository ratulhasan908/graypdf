"use client";

import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

export function WordToPdfTool() {
    return (
        <SinglePdfTool
            slug="word-to-pdf"
            action="Convert to PDF"
            extensions={[".docx", ".doc", ".odt", ".rtf"]}
            pickLabel="Choose a Word file"
        />
    );
}
