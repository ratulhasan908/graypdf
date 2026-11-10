"use client";

import { useState } from "react";
import { Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

export function UnlockTool() {
    const [password, setPassword] = useState("");
    return (
        <SinglePdfTool slug="unlock-pdf" action="Unlock PDF" fields={{ password }} onReset={() => setPassword("")}>
            <Section title="Password" hint="Leave this empty if the PDF opens without a password but restricts printing or copying.">
                <input
                    type="password"
                    className="input"
                    value={password}
                    autoComplete="off"
                    onChange={(event) => setPassword(event.target.value)}
                    aria-label="PDF password"
                />
            </Section>
        </SinglePdfTool>
    );
}
