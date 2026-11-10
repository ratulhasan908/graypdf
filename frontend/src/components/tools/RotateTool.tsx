"use client";

import { useState } from "react";
import { ChoiceCards, Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

type Scope = "all" | "some";

const ANGLES = [
    { value: 90, title: "90° right" },
    { value: 180, title: "180°" },
    { value: 270, title: "90° left" },
];

const SCOPES = [
    { value: "all" as Scope, title: "All pages" },
    { value: "some" as Scope, title: "Specific pages" },
];

export function RotateTool() {
    const [angle, setAngle] = useState(90);
    const [scope, setScope] = useState<Scope>("all");
    const [pages, setPages] = useState("");

    return (
        <SinglePdfTool
            slug="rotate-pdf"
            action="Rotate PDF"
            fields={{ angle: String(angle), pages: scope === "all" ? "all" : pages.trim() }}
            validate={() => (scope === "some" && !pages.trim() ? "Enter the pages to rotate, like 1,3,5-7." : null)}
        >
            <Section title="Rotation">
                <ChoiceCards value={angle} options={ANGLES} onChange={setAngle} columns={3} />
            </Section>
            <Section title="Pages">
                <ChoiceCards value={scope} options={SCOPES} onChange={setScope} columns={2} />
                {scope === "some" && (
                    <input
                        className="input mt-2"
                        value={pages}
                        onChange={(event) => setPages(event.target.value)}
                        placeholder="1,3,5-7"
                        aria-label="Pages to rotate"
                    />
                )}
            </Section>
        </SinglePdfTool>
    );
}
