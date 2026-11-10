"use client";

import { useState } from "react";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Fit = "pages" | "single";

const FITS = [
    { value: "pages" as Fit, title: "Normal pages", desc: "Uses the print settings saved in your file", badge: "Recommended" },
    { value: "single" as Fit, title: "One page per sheet", desc: "Each sheet stays whole, however large it is" },
];

export function ExcelToPdfTool() {
    const [fit, setFit] = useState<Fit>("pages");
    return (
        <SinglePdfTool
            slug="excel-to-pdf"
            action="Convert to PDF"
            extensions={[".xlsx", ".xls", ".ods", ".csv"]}
            pickLabel="Choose a spreadsheet"
            fields={{ one_page_per_sheet: String(fit === "single") }}
        >
            <Section title="Page layout">
                <ChoiceCards value={fit} options={FITS} onChange={setFit} />
            </Section>
        </SinglePdfTool>
    );
}
