"use client";

import { useState } from "react";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Layout = "simple" | "preserve";

const LAYOUTS = [
    {
        value: "simple" as Layout,
        title: "Clean HTML",
        desc: "Real headings, lists, tables and links. Easy to edit and reads well on phones.",
        badge: "Recommended",
    },
    {
        value: "preserve" as Layout,
        title: "Exact layout",
        desc: "Looks like the original pages, including table lines and shapes. Harder to edit.",
    },
];

export function PdfToHtmlTool() {
    const [layout, setLayout] = useState<Layout>("simple");
    return (
        <SinglePdfTool slug="pdf-to-html" action="Convert to HTML" fields={{ layout }}>
            <Section title="Output style" hint="Scanned PDFs come through as images, because they contain no text.">
                <ChoiceCards value={layout} options={LAYOUTS} onChange={setLayout} />
            </Section>
        </SinglePdfTool>
    );
}
