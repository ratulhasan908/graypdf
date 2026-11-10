"use client";

import { useState } from "react";
import { ChoiceCards, NumberField, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Unit = "mm" | "in" | "pt";
type ApplyTo = "all" | "first" | "last";

const TO_POINTS: Record<Unit, number> = { mm: 72 / 25.4, in: 72, pt: 1 };

const UNITS = [
    { value: "mm" as Unit, title: "mm" },
    { value: "in" as Unit, title: "inches" },
    { value: "pt" as Unit, title: "points" },
];

const APPLY_TO = [
    { value: "all" as ApplyTo, title: "All pages" },
    { value: "first" as ApplyTo, title: "First page" },
    { value: "last" as ApplyTo, title: "Last page" },
];

const PREVIEW_MAX = 45; // percent of the sample page

export function CropTool() {
    const [unit, setUnit] = useState<Unit>("mm");
    const [sides, setSides] = useState({ top: 10, bottom: 10, left: 10, right: 10 });
    const [applyTo, setApplyTo] = useState<ApplyTo>("all");

    const points = (value: number) => (value * TO_POINTS[unit]).toFixed(2);
    // Sized against A4 so the preview roughly tracks the numbers.
    const inset = (value: number, pagePoints: number) =>
        `${Math.min((value * TO_POINTS[unit] * 100) / pagePoints, PREVIEW_MAX)}%`;

    function setSide(side: keyof typeof sides, value: number) {
        setSides({ ...sides, [side]: Math.max(0, value) });
    }

    return (
        <SinglePdfTool
            slug="crop-pdf"
            action="Crop PDF"
            fields={{
                top: points(sides.top),
                bottom: points(sides.bottom),
                left: points(sides.left),
                right: points(sides.right),
                apply_to: applyTo,
            }}
            validate={() =>
                Object.values(sides).some((value) => value > 0) ? null : "Enter an amount to trim from at least one side."
            }
        >
            <Section title="Units">
                <ChoiceCards value={unit} options={UNITS} onChange={setUnit} columns={3} />
            </Section>
            <div className="grid sm:grid-cols-[1fr_150px] gap-6 mt-6">
                <div className="grid grid-cols-2 gap-3 content-start">
                    <NumberField label="Top" value={sides.top} min={0} step={0.1} onChange={(value) => setSide("top", value)} />
                    <NumberField label="Bottom" value={sides.bottom} min={0} step={0.1} onChange={(value) => setSide("bottom", value)} />
                    <NumberField label="Left" value={sides.left} min={0} step={0.1} onChange={(value) => setSide("left", value)} />
                    <NumberField label="Right" value={sides.right} min={0} step={0.1} onChange={(value) => setSide("right", value)} />
                </div>
                <div aria-hidden className="hidden sm:block relative card aspect-[1/1.41] bg-surface-2 overflow-hidden">
                    <div
                        className="absolute bg-surface border border-dashed border-accent"
                        style={{
                            top: inset(sides.top, 842),
                            bottom: inset(sides.bottom, 842),
                            left: inset(sides.left, 595),
                            right: inset(sides.right, 595),
                        }}
                    />
                </div>
            </div>
            <Section title="Apply to">
                <ChoiceCards value={applyTo} options={APPLY_TO} onChange={setApplyTo} columns={3} />
            </Section>
        </SinglePdfTool>
    );
}
