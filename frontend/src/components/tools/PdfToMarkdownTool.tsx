"use client";

import { useState } from "react";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Layout = "preserve" | "simple";

const LAYOUTS = [
    {
        value: "preserve" as Layout,
        title: "Keep structure",
        desc: "Headings, lists, tables and links as Markdown.",
        badge: "Recommended",
    },
    { value: "simple" as Layout, title: "Plain text", desc: "Just the text, with a heading for each page." },
];

export function PdfToMarkdownTool() {
    const [layout, setLayout] = useState<Layout>("preserve");
    return (
        <SinglePdfTool slug="pdf-to-markdown" action="Convert to Markdown" fields={{ layout }}>
            <Section title="Output style" hint="Images are left out. For scans, run OCR PDF first.">
                <ChoiceCards value={layout} options={LAYOUTS} onChange={setLayout} />
            </Section>
        </SinglePdfTool>
    );
}
