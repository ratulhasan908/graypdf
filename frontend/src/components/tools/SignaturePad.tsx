"use client";

import { ChangeEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { ChoiceCards } from "@/components/tools/fields";

type Mode = "draw" | "type" | "upload";

export type Signature = { url: string; ratio: number }; // ratio = height / width

const MODES = [
    { value: "draw" as Mode, title: "Draw" },
    { value: "type" as Mode, title: "Type" },
    { value: "upload" as Mode, title: "Upload" },
];

const WIDTH = 600;
const HEIGHT = 200;
const INK = "#10143a";

function typedSignature(text: string): Signature | null {
    if (!text.trim()) return null;
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return null;
    let size = 90;
    do {
        context.font = `italic ${size}px "Segoe Script", "Brush Script MT", "Snell Roundhand", cursive`;
        size -= 4;
    } while (context.measureText(text).width > WIDTH - 40 && size > 20);
    context.fillStyle = INK;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, WIDTH / 2, HEIGHT / 2);
    return { url: canvas.toDataURL("image/png"), ratio: HEIGHT / WIDTH };
}

export function SignaturePad({ onChange }: { onChange: (signature: Signature | null) => void }) {
    const [mode, setMode] = useState<Mode>("draw");
    const [name, setName] = useState("");
    const canvas = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);

    useEffect(() => {
        const context = canvas.current?.getContext("2d");
        if (!context) return;
        context.strokeStyle = INK;
        context.lineWidth = 4;
        context.lineCap = "round";
        context.lineJoin = "round";
    }, [mode]);

    function point(event: PointerEvent<HTMLCanvasElement>) {
        const rect = event.currentTarget.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) / rect.width) * WIDTH,
            y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
        };
    }

    function start(event: PointerEvent<HTMLCanvasElement>) {
        event.currentTarget.setPointerCapture(event.pointerId);
        drawing.current = true;
        const { x, y } = point(event);
        const context = event.currentTarget.getContext("2d");
        context?.beginPath();
        context?.moveTo(x, y);
    }

    function move(event: PointerEvent<HTMLCanvasElement>) {
        if (!drawing.current) return;
        const { x, y } = point(event);
        const context = event.currentTarget.getContext("2d");
        context?.lineTo(x, y);
        context?.stroke();
    }

    function end(event: PointerEvent<HTMLCanvasElement>) {
        if (!drawing.current) return;
        drawing.current = false;
        onChange({ url: event.currentTarget.toDataURL("image/png"), ratio: HEIGHT / WIDTH });
    }

    function clear() {
        const element = canvas.current;
        element?.getContext("2d")?.clearRect(0, 0, WIDTH, HEIGHT);
        onChange(null);
    }

    function choose(next: Mode) {
        setMode(next);
        setName("");
        onChange(null);
    }

    function upload(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const url = String(reader.result);
            const image = new Image();
            image.onload = () => onChange({ url, ratio: image.naturalHeight / image.naturalWidth });
            image.src = url;
        };
        reader.readAsDataURL(file);
    }

    return (
        <div>
            <ChoiceCards value={mode} options={MODES} onChange={choose} columns={3} />
            <div className="mt-2">
                {mode === "draw" && (
                    <div className="relative">
                        <canvas
                            ref={canvas}
                            width={WIDTH}
                            height={HEIGHT}
                            aria-label="Draw your signature"
                            onPointerDown={start}
                            onPointerMove={move}
                            onPointerUp={end}
                            className="block w-full card touch-none cursor-crosshair"
                        />
                        <button type="button" onClick={clear} className="absolute top-2 right-3 text-xs text-accent hover:underline">
                            Clear
                        </button>
                    </div>
                )}
                {mode === "type" && (
                    <input
                        className="input"
                        value={name}
                        placeholder="Type your name"
                        aria-label="Type your name"
                        onChange={(event) => {
                            setName(event.target.value);
                            onChange(typedSignature(event.target.value));
                        }}
                    />
                )}
                {mode === "upload" && (
                    <input
                        type="file"
                        accept="image/png,image/jpeg"
                        aria-label="Upload a signature image"
                        onChange={upload}
                        className="input"
                    />
                )}
            </div>
        </div>
    );
}
