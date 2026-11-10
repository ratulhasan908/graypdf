"use client";

import { useState } from "react";
import { Section } from "@/components/tools/fields";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";

const MAX_LANGUAGES = 3;

const LANGUAGES = [
    { code: "eng", name: "English" },
    { code: "ben", name: "বাংলা (Bangla)" },
    { code: "hin", name: "हिन्दी (Hindi)" },
    { code: "urd", name: "اردو (Urdu)" },
    { code: "ara", name: "العربية (Arabic)" },
    { code: "chi_sim", name: "简体中文 (Chinese)" },
    { code: "fra", name: "Français" },
    { code: "spa", name: "Español" },
    { code: "deu", name: "Deutsch" },
    { code: "por", name: "Português" },
    { code: "ita", name: "Italiano" },
    { code: "rus", name: "Русский" },
];

export function OcrTool() {
    const [languages, setLanguages] = useState(["eng"]);

    function toggle(code: string) {
        setLanguages((current) => {
            if (current.includes(code)) return current.filter((item) => item !== code);
            return current.length < MAX_LANGUAGES ? [...current, code] : current;
        });
    }

    return (
        <SinglePdfTool
            slug="ocr-pdf"
            action="Make searchable"
            fields={{ languages: JSON.stringify(languages) }}
            validate={() => (languages.length ? null : "Choose the language of your document.")}
        >
            <Section
                title="What language is your document in?"
                hint="Choose up to 3. Fewer languages give faster, more accurate results. Up to 100 pages, and it can take a few minutes."
            >
                <div className="flex flex-wrap gap-2" role="group" aria-label="Document languages">
                    {LANGUAGES.map(({ code, name }) => {
                        const active = languages.includes(code);
                        return (
                            <button
                                key={code}
                                type="button"
                                aria-pressed={active}
                                disabled={!active && languages.length >= MAX_LANGUAGES}
                                onClick={() => toggle(code)}
                                className={`px-3 py-1.5 rounded-lg border text-sm transition-colors disabled:opacity-40 ${
                                    active ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong"
                                }`}
                            >
                                {name}
                            </button>
                        );
                    })}
                </div>
            </Section>
        </SinglePdfTool>
    );
}
