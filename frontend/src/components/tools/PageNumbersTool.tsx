"use client";

import { useState } from "react";
import { ChoiceCards, NumberField, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Format = "number" | "page-n" | "n-of-total";

const POSITIONS = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];

const FORMATS = [
    { value: "number" as Format, title: "1", desc: "Number only" },
    { value: "page-n" as Format, title: "Page 1", desc: "With a label" },
    { value: "n-of-total" as Format, title: "1 / 10", desc: "With the total" },
];

export function PageNumbersTool() {
    const [position, setPosition] = useState("bottom-center");
    const [format, setFormat] = useState<Format>("number");
    const [start, setStart] = useState(1);
    const [fontSize, setFontSize] = useState(12);
    const [margin, setMargin] = useState(40);

    return (
        <SinglePdfTool
            slug="page-numbers"
            action="Add page numbers"
            fields={{ position, format, start: String(start), font_size: String(fontSize), margin: String(margin) }}
        >
            <Section title="Position">
                <div className="card w-40 aspect-[1/1.2] p-2 grid grid-cols-3 content-between gap-1.5">
                    {POSITIONS.map((spot) => (
                        <button
                            key={spot}
                            type="button"
                            aria-label={spot.replace("-", " ")}
                            aria-pressed={position === spot}
                            onClick={() => setPosition(spot)}
                            className={`h-7 rounded-md transition-colors ${position === spot ? "bg-accent" : "bg-surface-2 hover:bg-line-strong"}`}
                        />
                    ))}
                </div>
            </Section>
            <Section title="Format">
                <ChoiceCards value={format} options={FORMATS} onChange={setFormat} columns={3} />
            </Section>
            <div className="grid grid-cols-3 gap-3 mt-6">
                <NumberField label="Start at" value={start} min={1} onChange={setStart} />
                <NumberField label="Font size" value={fontSize} min={8} max={30} onChange={setFontSize} />
                <NumberField label="Margin (pt)" value={margin} min={20} max={100} onChange={setMargin} />
            </div>
        </SinglePdfTool>
    );
}
