import type { FontSpec, Generic } from "@/lib/editSession";

/**
 * The editor's changes. Positions are fractions of the visible page (0..1),
 * sizes are points: exactly what backend/api/pdf_tools.py `edit` expects.
 */

export type Box = { x: number; y: number; w: number; h: number };

type Base = { id: number; page: number };

export type TextItem = Base & {
    kind: "text";
    x: number;
    /** The first line's baseline. Text is placed by baseline so any font lines up. */
    baseline: number;
    text: string;
    size: number;
    color: string;
    font: FontSpec;
    /** For a retyped line: where the original was, what it said and the colour behind it. */
    source?: Box;
    original?: string;
    background?: string;
    /** For a retyped line: the width it wraps at, as a fraction of the page width. */
    width?: number;
    /** For a retyped line: points the text below moves up when it is cleared. */
    collapse?: number;
    /** For a retyped line: where the page opens up when it grows, below its whole row. */
    cut?: number;
};
export type BoxKind = "whiteout" | "highlight" | "underline" | "strikeout" | "rect" | "ellipse" | "link";
export type BoxItem = Base & Box & { kind: BoxKind; color: string; fill: string | null; stroke: number; url?: string };
export type LineItem = Base & { kind: "line" | "arrow"; x1: number; y1: number; x2: number; y2: number; color: string; stroke: number };
export type DrawItem = Base & { kind: "draw"; points: [number, number][]; color: string; stroke: number };
export type ImageItem = Base & Box & { kind: "image"; file: File; url: string; ratio: number };
export type NoteItem = Base & { kind: "note"; x: number; y: number; text: string; color: string };
export type PageItem = Base & { kind: "rotate-page"; degrees: number } | Base & { kind: "delete-page" };
export type ReplaceItem = Base & { kind: "replace"; find: string; replace: string; matchCase: boolean; count: number };

export type Item = TextItem | BoxItem | LineItem | DrawItem | ImageItem | NoteItem | PageItem | ReplaceItem;

/** Changes drawn on a page (as opposed to page and whole-document changes). */
export type PlacedItem = TextItem | BoxItem | LineItem | DrawItem | ImageItem | NoteItem;

export function isPlaced(item: Item): item is PlacedItem {
    return item.kind !== "rotate-page" && item.kind !== "delete-page" && item.kind !== "replace";
}

export const round = (value: number) => Math.round(value * 100000) / 100000;
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
export const sameList = (a: Item[], b: Item[]) => a.length === b.length && a.every((item, index) => item === b[index]);
export const sourceKey = (box: Box) => `${box.x}:${box.y}`;

export function fontKey(font: FontSpec) {
    return `${font.family}|${font.weight}|${font.italic ? 1 : 0}|${font.generic}`;
}

export function bounds(item: PlacedItem): Box {
    switch (item.kind) {
        case "draw": {
            const xs = item.points.map(([x]) => x);
            const ys = item.points.map(([, y]) => y);
            const x = Math.min(...xs);
            const y = Math.min(...ys);
            return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
        }
        case "line":
        case "arrow":
            return {
                x: Math.min(item.x1, item.x2),
                y: Math.min(item.y1, item.y2),
                w: Math.abs(item.x2 - item.x1),
                h: Math.abs(item.y2 - item.y1),
            };
        case "text":
            return { x: item.x, y: item.baseline, w: 0, h: 0 };
        case "note":
            return { x: item.x, y: item.y, w: 0.03, h: 0.03 };
        default:
            return item;
    }
}

/** Move a change by (dx, dy), as fractions of the page. */
export function moved(item: PlacedItem, dx: number, dy: number): PlacedItem {
    switch (item.kind) {
        case "draw":
            return { ...item, points: item.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
        case "line":
        case "arrow":
            return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy };
        case "text":
            return { ...item, x: clamp(item.x + dx, 0, 0.98), baseline: clamp(item.baseline + dy, 0.005, 1) };
        case "note":
            return { ...item, x: clamp(item.x + dx, 0, 0.97), y: clamp(item.y + dy, 0, 0.97) };
        default:
            return { ...item, x: clamp(item.x + dx, 0, 1 - item.w), y: clamp(item.y + dy, 0, 1 - item.h) };
    }
}

// ---------------------------------------------------------------------------
// Reflow: when a retyped line grows taller, everything below it moves down.
// Changes are stored in the page's original coordinates and shown shifted;
// the server applies the same rule (pdf_tools._flows / _anchor / _shifted).
// ---------------------------------------------------------------------------

/** Where a retyped line splits the page: just above its baseline. Keep in step with FLOW_CUT in pdf_tools.py. */
export const FLOW_CUT = 0.78;

/** Where a deleted line's slot starts above its baseline, per point of size. Keep in step with COLLAPSE_TOP in pdf_tools.py. */
export const COLLAPSE_TOP = 0.75;

/**
 * Where the page splits (fraction) and by how much (points): positive when a
 * retyped line grew and the page opens up, negative when a line was deleted
 * and the band below `cut` is removed so the text closes up.
 */
export type Flow = { cut: number; grow: number; background: string };

export function flowCut(source: Box) {
    return source.y + FLOW_CUT * source.h;
}

/**
 * Where a growing retyped line opens the page: under its whole row (from the
 * server), so a label beside it on the same row is never split.
 */
export function rowCut(item: TextItem) {
    return item.cut ?? flowCut(item.source!);
}

/** A retyped line that was cleared and closes up the space it used. */
export function isCollapsed(item: PlacedItem, editing: number | null): boolean {
    return item.kind === "text" && Boolean(item.source) && !item.text.trim() && (item.collapse ?? 0) > 0.5 && editing !== item.id;
}

/** Points a retyped line adds (or, deleted, removes) below it. */
export function growOf(item: PlacedItem, grows: Record<number, number>, editing: number | null) {
    if (item.kind === "text" && isCollapsed(item, editing)) return -(item.collapse ?? 0);
    return item.kind === "text" && item.source ? (grows[item.id] ?? 0) : 0;
}

export function flowsFor(items: PlacedItem[], grows: Record<number, number>, editing: number | null, pageHeight: number): Flow[] {
    return items
        .flatMap((item) => {
            if (item.kind !== "text" || !item.source) return [];
            const grow = growOf(item, grows, editing);
            if (grow > 0.5) return [{ cut: rowCut(item), grow, background: item.background ?? "#ffffff" }];
            if (grow < -0.5) return [{ cut: flowCut(item.source) - (COLLAPSE_TOP * item.size) / pageHeight, grow, background: "" }];
            return [];
        })
        .sort((a, b) => a.cut - b.cut);
}

/** How far (points) content at y (fraction of the page height) moves down. */
export function shiftAt(flows: Flow[], y: number) {
    return flows.reduce((total, flow) => (flow.cut < y ? total + flow.grow : total), 0);
}

/** The point of a change that decides whether it moves. Keep in step with _anchor in pdf_tools.py. */
export function anchorOf(item: PlacedItem): number {
    switch (item.kind) {
        case "text":
            return item.source ? rowCut(item) - 0.00001 : item.baseline;
        case "line":
        case "arrow":
            return Math.min(item.y1, item.y2);
        case "draw":
            return Math.min(...item.points.map(([, y]) => y));
        default:
            return item.y;
    }
}

/** A point on screen (fraction of the original page height) back in original coordinates. */
export function fromDisplay(flows: Flow[], y: number, pageHeight: number) {
    let moved = 0;
    for (const flow of flows) {
        const top = flow.cut + moved / pageHeight;
        if (y < top) break;
        if (flow.grow > 0 && y < top + flow.grow / pageHeight) return flow.cut; // inside the new space
        moved += flow.grow;
    }
    return y - moved / pageHeight;
}

/** What the backend gets for one change. Images are numbered in upload order. */
export function toEdit(item: Item, imageIndex: number, grow = 0): Record<string, unknown> {
    const page = item.page;
    switch (item.kind) {
        case "text":
            return {
                type: "text",
                page,
                x: round(item.x),
                baseline: round(item.baseline),
                text: item.text,
                size: item.size,
                color: item.color,
                weight: item.font.weight,
                italic: item.font.italic,
                family: item.font.family,
                generic: item.font.generic,
                ref: item.font.ref,
                ...(item.source ? { source: item.source } : {}),
                ...(item.width ? { width: round(item.width) } : {}),
                ...(item.source && item.cut !== undefined ? { cut: round(item.cut) } : {}),
                ...(item.source && Math.abs(grow) > 0.5 ? { grow: Math.round(grow * 10) / 10 } : {}),
            };
        case "draw":
            return { type: "draw", page, points: item.points.map(([x, y]) => [round(x), round(y)]), color: item.color, stroke: item.stroke };
        case "line":
        case "arrow":
            return {
                type: item.kind,
                page,
                x1: round(item.x1),
                y1: round(item.y1),
                x2: round(item.x2),
                y2: round(item.y2),
                color: item.color,
                stroke: item.stroke,
            };
        case "image":
            return { type: "image", page, x: round(item.x), y: round(item.y), w: round(item.w), h: round(item.h), image: imageIndex };
        case "note":
            return { type: "note", page, x: round(item.x), y: round(item.y), text: item.text, color: item.color };
        case "rotate-page":
            return { type: "rotate-page", page, degrees: item.degrees };
        case "delete-page":
            return { type: "delete-page", page };
        case "replace":
            return { type: "replace", find: item.find, replace: item.replace, case: item.matchCase };
        default:
            return {
                type: item.kind,
                page,
                x: round(item.x),
                y: round(item.y),
                w: round(item.w),
                h: round(item.h),
                color: item.color,
                stroke: item.stroke,
                ...(item.fill ? { fill: item.fill } : {}),
                ...(item.kind === "link" ? { url: item.url ?? "" } : {}),
            };
    }
}

/** "example.com" -> "https://example.com"; null when it can't be a link. */
export function normaliseUrl(value: string): string | null {
    const url = value.trim();
    if (!url) return null;
    if (/^(https?:\/\/|mailto:)\S+$/i.test(url)) return url;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url)) return `mailto:${url}`;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url)) return `https://${url}`;
    return null;
}

/** Fonts people can pick besides the ones in their PDF. Each maps to a free font server-side. */
export const FONT_CHOICES: { family: string; generic: Generic }[] = [
    { family: "Arial", generic: "sans" },
    { family: "Calibri", generic: "sans" },
    { family: "Times New Roman", generic: "serif" },
    { family: "Cambria", generic: "serif" },
    { family: "Georgia", generic: "serif" },
    { family: "Courier New", generic: "mono" },
    { family: "Roboto", generic: "sans" },
    { family: "Open Sans", generic: "sans" },
    { family: "Lato", generic: "sans" },
    { family: "Montserrat", generic: "sans" },
    { family: "Poppins", generic: "sans" },
    { family: "Inter", generic: "sans" },
    { family: "Merriweather", generic: "serif" },
    { family: "Playfair Display", generic: "serif" },
    { family: "Hind Siliguri", generic: "sans" },
    { family: "Noto Sans Bengali", generic: "sans" },
];

/**
 * The colour behind a box on the page image, so a retyped line or a white-out
 * on a coloured background blends in.
 */
export function backgroundAround(image: HTMLImageElement | null, box: Box): string {
    if (!image?.complete || !image.naturalWidth) return "#ffffff";
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "#ffffff";
    context.drawImage(image, 0, 0);
    const x0 = clamp(Math.floor(box.x * width) - 2, 0, width - 1);
    const y0 = clamp(Math.floor(box.y * height) - 2, 0, height - 1);
    const x1 = clamp(Math.ceil((box.x + box.w) * width) + 2, x0 + 1, width - 1);
    const y1 = clamp(Math.ceil((box.y + box.h) * height) + 2, y0 + 1, height - 1);
    const { data } = context.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    const rowWidth = x1 - x0 + 1;
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
    const take = (x: number, y: number) => {
        const at = (y * rowWidth + x) * 4;
        const [r, g, b] = [data[at], data[at + 1], data[at + 2]];
        const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
        const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
        buckets.set(key, { count: bucket.count + 1, r: bucket.r + r, g: bucket.g + g, b: bucket.b + b });
    };
    for (let x = 0; x < rowWidth; x++) {
        take(x, 0);
        take(x, y1 - y0);
    }
    for (let y = 0; y <= y1 - y0; y++) {
        take(0, y);
        take(rowWidth - 1, y);
    }
    const top = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
    if (!top) return "#ffffff";
    // JPEG previews turn white paper slightly grey; don't paint grey patches on a white page.
    if (top.r / top.count > 238 && top.g / top.count > 238 && top.b / top.count > 238) return "#ffffff";
    const hex = (sum: number) => Math.round(sum / top.count).toString(16).padStart(2, "0");
    return `#${hex(top.r)}${hex(top.g)}${hex(top.b)}`;
}
