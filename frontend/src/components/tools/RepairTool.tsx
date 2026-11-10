"use client";

import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

export function RepairTool() {
    return (
        <SinglePdfTool slug="repair-pdf" action="Repair PDF">
            <p className="text-xs text-ink-3 mt-3">
                We recover everything we can, but a badly damaged file may lose some content.
            </p>
        </SinglePdfTool>
    );
}
