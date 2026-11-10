"use client";

import { PointerEvent, useState } from "react";
import { X } from "lucide-react";
import { Section, Toggle } from "@/components/tools/fields";
import { PageStage } from "@/components/tools/PageStage";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";
import { usePagePreviews } from "@/lib/usePagePreviews";

type Box = { id: number; page: number; x: number; y: number; w: number; h: number };
type Draft = { startX: number; startY: number; x: number; y: number; w: number; h: number };

const MIN_BOX = 0.005;

export function RedactTool() {
    const previews = usePagePreviews(100);
    const [terms, setTerms] = useState("");
    const [emails, setEmails] = useState(false);
    const [phones, setPhones] = useState(false);
    const [boxes, setBoxes] = useState<Box[]>([]);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [page, setPage] = useState(1);

    const termList = terms.split("\n").map((term) => term.trim()).filter(Boolean);
    const patterns = [...(emails ? ["email"] : []), ...(phones ? ["phone"] : [])];

    function position(event: PointerEvent<HTMLDivElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
            y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
        };
    }

    function start(event: PointerEvent<HTMLDivElement>) {
        event.currentTarget.setPointerCapture(event.pointerId);
        const { x, y } = position(event);
        setDraft({ startX: x, startY: y, x, y, w: 0, h: 0 });
    }

    function move(event: PointerEvent<HTMLDivElement>) {
        if (!draft) return;
        const { x, y } = position(event);
        setDraft({
            ...draft,
            x: Math.min(x, draft.startX),
            y: Math.min(y, draft.startY),
            w: Math.abs(x - draft.startX),
            h: Math.abs(y - draft.startY),
        });
    }

    function end() {
        if (draft && draft.w > MIN_BOX && draft.h > MIN_BOX) {
            setBoxes([...boxes, { id: Date.now(), page, x: draft.x, y: draft.y, w: draft.w, h: draft.h }]);
        }
        setDraft(null);
    }

    function reset() {
        setTerms("");
        setEmails(false);
        setPhones(false);
        setBoxes([]);
        setPage(1);
    }

    return (
        <SinglePdfTool
            slug="redact-pdf"
            action="Redact PDF"
            wide
            fields={{
                terms: JSON.stringify(termList),
                patterns: JSON.stringify(patterns),
                boxes: JSON.stringify(boxes.map(({ page: number, x, y, w, h }) => ({ page: number, x, y, w, h }))),
            }}
            onReset={reset}
            onFile={(file) => {
                reset();
                if (file) previews.load(file);
                else previews.clear();
            }}
            validate={() =>
                termList.length || patterns.length || boxes.length
                    ? null
                    : "Enter some words, choose emails or phone numbers, or draw over the page."
            }
        >
            <div className="grid md:grid-cols-[300px_1fr] gap-6 mt-6 items-start">
                <div>
                    <Section title="Words to remove" hint="One per line. Capital letters don't matter.">
                        <textarea
                            className="input h-28 resize-y"
                            value={terms}
                            onChange={(event) => setTerms(event.target.value)}
                            placeholder={"Jane Doe\nAccount 12345"}
                            aria-label="Words to remove"
                        />
                    </Section>
                    <Section title="Find automatically">
                        <div className="card px-4 py-1 divide-y divide-line">
                            <Toggle label="Email addresses" checked={emails} onChange={setEmails} />
                            <Toggle label="Phone numbers" checked={phones} onChange={setPhones} />
                        </div>
                    </Section>
                    <p className="text-xs text-ink-3 mt-4 leading-relaxed">
                        Content is deleted from the file, not just covered. Metadata, bookmarks and attachments
                        are removed too, and forms and comments become flat. On scanned pages, words can&apos;t be
                        found, so draw over them, or run OCR PDF first.
                    </p>
                </div>
                <div className="mt-6 md:mt-0">
                    <p className="text-sm text-ink-2 mb-2 text-center">Drag on the page to black out an area.</p>
                    <PageStage
                        previews={previews}
                        page={page}
                        onPage={setPage}
                        onPointerDown={start}
                        onPointerMove={move}
                        onPointerUp={end}
                    >
                        {boxes
                            .filter((box) => box.page === page)
                            .map((box) => (
                                <div
                                    key={box.id}
                                    className="absolute bg-black"
                                    style={{
                                        left: `${box.x * 100}%`,
                                        top: `${box.y * 100}%`,
                                        width: `${box.w * 100}%`,
                                        height: `${box.h * 100}%`,
                                    }}
                                >
                                    <button
                                        type="button"
                                        aria-label="Remove this area"
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onClick={() => setBoxes(boxes.filter((other) => other.id !== box.id))}
                                        className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-surface text-ink border border-line-strong flex items-center justify-center"
                                    >
                                        <X className="w-3 h-3" aria-hidden />
                                    </button>
                                </div>
                            ))}
                        {draft && (
                            <div
                                className="absolute bg-black/60"
                                style={{
                                    left: `${draft.x * 100}%`,
                                    top: `${draft.y * 100}%`,
                                    width: `${draft.w * 100}%`,
                                    height: `${draft.h * 100}%`,
                                }}
                            />
                        )}
                    </PageStage>
                </div>
            </div>
        </SinglePdfTool>
    );
}
