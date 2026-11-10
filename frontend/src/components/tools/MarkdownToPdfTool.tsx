"use client";

import { TextToPdfTool } from "@/components/tools/TextToPdfTool";

const SAMPLE = `# Hello from GreyPDF

This is **Markdown**. Replace it with your own.

## A list

- Simple syntax
- **Bold** and *italic* text

## A table

| Tool | Use |
|------|-----|
| Merge | Combine PDFs |
| Split | Separate pages |

> Tip: Markdown is great for notes and READMEs.`;

export function MarkdownToPdfTool() {
    return (
        <TextToPdfTool
            slug="markdown-to-pdf"
            field="markdown"
            label="Markdown"
            extensions={[".md", ".markdown", ".txt"]}
            sample={SAMPLE}
        />
    );
}
