"use client";

import { useState } from "react";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Mode = "each" | "range";

const MODES = [
    { value: "each" as Mode, title: "Every page", desc: "One file per page" },
    { value: "range" as Mode, title: "Page ranges", desc: "One file per range" },
];

export function SplitTool() {
    const [mode, setMode] = useState<Mode>("each");
    const [ranges, setRanges] = useState("");

    return (
        <SinglePdfTool
            slug="split-pdf"
            action="Split PDF"
            fields={{ mode, ranges }}
            validate={() => (mode === "range" && !ranges.trim() ? "Enter the pages you want, like 1-3,5." : null)}
        >
            <Section title="How do you want to split it?">
                <ChoiceCards value={mode} options={MODES} onChange={setMode} columns={2} />
            </Section>
            {mode === "range" && (
                <Section title="Pages" hint="Separate ranges with commas. 1-3,5 makes two files.">
                    <input
                        className="input"
                        value={ranges}
                        onChange={(event) => setRanges(event.target.value)}
                        placeholder="1-3,5,8-10"
                        aria-label="Page ranges"
                    />
                </Section>
            )}
        </SinglePdfTool>
    );
}
