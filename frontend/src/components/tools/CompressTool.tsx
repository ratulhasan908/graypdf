"use client";

import { useState } from "react";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Quality = "screen" | "ebook" | "printer" | "prepress";

const LEVELS = [
    { value: "screen" as Quality, title: "Smallest file", desc: "Lowest image quality, good for sharing on screen" },
    { value: "ebook" as Quality, title: "Balanced", desc: "Good quality at a much smaller size", badge: "Recommended" },
    { value: "printer" as Quality, title: "High quality", desc: "Suitable for printing" },
    { value: "prepress" as Quality, title: "Maximum quality", desc: "Smallest reduction, best for professional print" },
];

export function CompressTool() {
    const [quality, setQuality] = useState<Quality>("ebook");
    return (
        <SinglePdfTool slug="compress-pdf" action="Compress PDF" fields={{ quality }}>
            <Section title="Compression level">
                <ChoiceCards value={quality} options={LEVELS} onChange={setQuality} />
            </Section>
        </SinglePdfTool>
    );
}
