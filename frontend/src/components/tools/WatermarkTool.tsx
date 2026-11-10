"use client";

import { useState } from "react";
import { ChoiceCards, RangeField, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Position = "diagonal" | "center";

const POSITIONS = [
    { value: "diagonal" as Position, title: "Diagonal" },
    { value: "center" as Position, title: "Straight" },
];

const COLORS = ["#E5484D", "#2748D6", "#16181D", "#8A8D94", "#12795A"];

export function WatermarkTool() {
    const [text, setText] = useState("CONFIDENTIAL");
    const [fontSize, setFontSize] = useState(60);
    const [opacity, setOpacity] = useState(0.3);
    const [color, setColor] = useState(COLORS[0]);
    const [position, setPosition] = useState<Position>("diagonal");

    return (
        <SinglePdfTool
            slug="watermark"
            action="Add watermark"
            fields={{ text: text.trim(), font_size: String(fontSize), opacity: String(opacity), color, position }}
            validate={() => (text.trim() ? null : "Enter the text for your watermark.")}
        >
            <div className="grid sm:grid-cols-[1fr_180px] gap-6 mt-6">
                <div className="space-y-5">
                    <label className="block text-sm">
                        <span className="block font-medium mb-2">Text</span>
                        <input className="input" value={text} maxLength={80} onChange={(event) => setText(event.target.value)} />
                    </label>
                    <RangeField label="Size" display={`${fontSize} pt`} value={fontSize} min={10} max={200} step={2} onChange={setFontSize} />
                    <RangeField label="Opacity" display={`${Math.round(opacity * 100)}%`} value={opacity} min={0.05} max={1} step={0.05} onChange={setOpacity} />
                    <div>
                        <span className="block text-sm font-medium mb-2">Colour</span>
                        <div className="flex items-center gap-2">
                            {COLORS.map((swatch) => (
                                <button
                                    key={swatch}
                                    type="button"
                                    aria-label={`Use colour ${swatch}`}
                                    aria-pressed={color === swatch}
                                    onClick={() => setColor(swatch)}
                                    style={{ background: swatch }}
                                    className={`w-7 h-7 rounded-full ring-offset-2 ${color === swatch ? "ring-2 ring-ink" : ""}`}
                                />
                            ))}
                            <input
                                type="color"
                                value={color}
                                onChange={(event) => setColor(event.target.value)}
                                aria-label="Custom colour"
                                className="w-8 h-8 bg-transparent cursor-pointer"
                            />
                        </div>
                    </div>
                </div>
                <div aria-hidden className="hidden sm:flex card aspect-[1/1.41] items-center justify-center overflow-hidden self-start">
                    <span
                        className="font-bold whitespace-nowrap"
                        style={{
                            color,
                            opacity,
                            fontSize: fontSize * 0.3,
                            transform: position === "diagonal" ? "rotate(-45deg)" : undefined,
                        }}
                    >
                        {text}
                    </span>
                </div>
            </div>
            <Section title="Direction" hint="Latin characters only for now.">
                <ChoiceCards value={position} options={POSITIONS} onChange={setPosition} columns={2} />
            </Section>
        </SinglePdfTool>
    );
}
