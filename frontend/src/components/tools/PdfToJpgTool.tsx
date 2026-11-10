"use client";

import { useState } from "react";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

const QUALITY = [
    { value: 72, title: "Low", desc: "72 DPI, smallest files" },
    { value: 150, title: "Medium", desc: "150 DPI, good balance", badge: "Recommended" },
    { value: 300, title: "High", desc: "300 DPI, ready for print" },
];

export function PdfToJpgTool() {
    const [dpi, setDpi] = useState(150);
    return (
        <SinglePdfTool slug="pdf-to-jpg" action="Convert to JPG" fields={{ dpi: String(dpi) }}>
            <Section title="Image quality">
                <ChoiceCards value={dpi} options={QUALITY} onChange={setDpi} />
            </Section>
        </SinglePdfTool>
    );
}
