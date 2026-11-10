"use client";

import { PointerEvent, useRef, useState } from "react";
import { X } from "lucide-react";
import { RangeField, Section } from "@/components/tools/fields";
import { PageStage } from "@/components/tools/PageStage";
import { Signature, SignaturePad } from "@/components/tools/SignaturePad";
import { SinglePdfTool } from "@/components/tools/SinglePdfTool";
import { usePagePreviews } from "@/lib/usePagePreviews";

type Placement = { id: number; page: number; x: number; y: number };

function clamp(value: number, max: number) {
    return Math.min(Math.max(value, 0), Math.max(max, 0));
}

export function SignTool() {
    const previews = usePagePreviews(100);
    const [signature, setSignature] = useState<Signature | null>(null);
    const [placements, setPlacements] = useState<Placement[]>([]);
    const [page, setPage] = useState(1);
    const [width, setWidth] = useState(0.3); // share of the page width
    const stage = useRef<HTMLDivElement>(null);
    const dragging = useRef<{ id: number; dx: number; dy: number } | null>(null);
    const nextId = useRef(1);

    const preview = previews.pages[page - 1];
    const heightOf = (target: { width: number; height: number }) =>
        signature ? width * signature.ratio * (target.width / target.height) : 0;

    function position(event: PointerEvent<HTMLDivElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    }

    function handleStageDown(event: PointerEvent<HTMLDivElement>) {
        if (!signature || !preview || dragging.current) return;
        const { x, y } = position(event);
        const height = heightOf(preview);
        const id = nextId.current++;
        setPlacements([
            ...placements,
            { id, page, x: clamp(x - width / 2, 1 - width), y: clamp(y - height / 2, 1 - height) },
        ]);
    }

    function startDrag(event: PointerEvent<HTMLDivElement>, item: Placement) {
        event.stopPropagation();
        if (!stage.current) return;
        stage.current.setPointerCapture(event.pointerId);
        const rect = stage.current.getBoundingClientRect();
        dragging.current = {
            id: item.id,
            dx: (event.clientX - rect.left) / rect.width - item.x,
            dy: (event.clientY - rect.top) / rect.height - item.y,
        };
    }

    function handleMove(event: PointerEvent<HTMLDivElement>) {
        const drag = dragging.current;
        if (!drag || !preview) return;
        const { x, y } = position(event);
        const height = heightOf(preview);
        setPlacements(
            placements.map((item) =>
                item.id === drag.id
                    ? { ...item, x: clamp(x - drag.dx, 1 - width), y: clamp(y - drag.dy, 1 - height) }
                    : item
            )
        );
    }

    function addToEveryPage() {
        const source = placements.find((item) => item.page === page);
        if (!source) return;
        const others = previews.pages
            .map((_, index) => index + 1)
            .filter((number) => !placements.some((item) => item.page === number))
            .map((number) => ({ ...source, id: nextId.current++, page: number }));
        setPlacements([...placements, ...others]);
    }

    function reset() {
        setPlacements([]);
        setSignature(null);
        setPage(1);
    }

    const payload = placements.map((item) => {
        const target = previews.pages[item.page - 1];
        return { page: item.page, x: item.x, y: item.y, w: width, h: target ? heightOf(target) : 0 };
    });

    return (
        <SinglePdfTool
            slug="sign-pdf"
            action="Sign PDF"
            wide
            fields={{ placements: JSON.stringify(payload) }}
            onReset={reset}
            onFile={(file) => {
                reset();
                if (file) previews.load(file);
                else previews.clear();
            }}
            validate={() => {
                if (!signature) return "Create your signature first.";
                return placements.length ? null : "Click the page to place your signature.";
            }}
            extendBody={async (body) => {
                if (!signature) return;
                const blob = await (await fetch(signature.url)).blob();
                body.append("signature", blob, "signature.png");
            }}
        >
            <div className="grid md:grid-cols-[300px_1fr] gap-6 mt-6 items-start">
                <div>
                    <Section title="1. Create your signature">
                        <SignaturePad
                            onChange={(next) => {
                                setSignature(next);
                                setPlacements([]);
                            }}
                        />
                    </Section>
                    {signature && (
                        <Section title="2. Place it" hint="Click the page to add it, then drag to move it.">
                            <RangeField
                                label="Size"
                                display={`${Math.round(width * 100)}%`}
                                value={width}
                                min={0.1}
                                max={0.6}
                                step={0.01}
                                onChange={setWidth}
                            />
                            {placements.some((item) => item.page === page) && previews.pages.length > 1 && (
                                <button type="button" onClick={addToEveryPage} className="text-sm text-accent hover:underline mt-3">
                                    Add to every page
                                </button>
                            )}
                        </Section>
                    )}
                    <p className="text-xs text-ink-3 mt-4">
                        This adds a visible signature. It isn&apos;t a certificate-based digital signature.
                    </p>
                </div>
                <div className="mt-6 md:mt-0">
                    <PageStage
                        previews={previews}
                        page={page}
                        onPage={setPage}
                        stageRef={stage}
                        onPointerDown={handleStageDown}
                        onPointerMove={handleMove}
                        onPointerUp={() => {
                            dragging.current = null;
                        }}
                        cursor={signature ? "cursor-copy" : "cursor-default"}
                    >
                        {signature &&
                            preview &&
                            placements
                                .filter((item) => item.page === page)
                                .map((item) => (
                                    <div
                                        key={item.id}
                                        onPointerDown={(event) => startDrag(event, item)}
                                        className="absolute outline-1 outline-dashed outline-accent cursor-move"
                                        style={{
                                            left: `${item.x * 100}%`,
                                            top: `${item.y * 100}%`,
                                            width: `${width * 100}%`,
                                            height: `${heightOf(preview) * 100}%`,
                                        }}
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={signature.url} alt="Your signature" draggable={false} className="w-full h-full" />
                                        <button
                                            type="button"
                                            aria-label="Remove this signature"
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={() => setPlacements(placements.filter((other) => other.id !== item.id))}
                                            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-ink text-white flex items-center justify-center"
                                        >
                                            <X className="w-3 h-3" aria-hidden />
                                        </button>
                                    </div>
                                ))}
                    </PageStage>
                </div>
            </div>
        </SinglePdfTool>
    );
}
