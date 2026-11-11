"use client";

import { apiFetch, apiUpload, apiUrl } from "@/lib/api";

/**
 * The PDF editor's connection to the server. A PDF is uploaded once to start
 * a session; after that each page, font and search is fetched only when it
 * is needed, so documents of any length open fast.
 */

export type Generic = "sans" | "serif" | "mono";

/** A font as the backend describes it. `ref` is the embedded font, when there is one. */
export type FontSpec = {
    ref: number | null;
    /** The page the embedded font was seen on (the browser copy covers that page's characters). */
    refPage: number | null;
    family: string;
    weight: number;
    italic: boolean;
    generic: Generic;
};

export type TextLine = {
    x: number;
    y: number;
    w: number;
    h: number;
    baseline: number;
    text: string;
    size: number;
    color: string;
    font: FontSpec;
    /** Points the text below moves up if this line is deleted (0: it can't safely close up). */
    collapse: number;
    /** Where the page opens up when this line grows: below its whole row (fraction of the height). */
    flow: number;
};

export type PageData = { width: number; height: number; image: string; lines?: TextLine[] };
export type Session = { session: string; pages: [number, number][] };
export type SearchResult = { matches: { page: number; count: number }[]; total: number };

export function openSession(file: File, onProgress: (percent: number) => void) {
    const body = new FormData();
    body.append("files", file);
    return apiUpload<Session>("/tools/edit/open/", body, onProgress);
}

export async function fetchPage(session: string, page: number, full: boolean): Promise<PageData> {
    const query = full ? "?dpi=110&text=1" : "?dpi=24";
    const data = await apiFetch<PageData & { lines?: (Omit<TextLine, "font"> & { font: Omit<FontSpec, "refPage"> })[] }>(
        `/tools/edit/${session}/pages/${page}/${query}`
    );
    return {
        ...data,
        lines: data.lines?.map((line) => ({ ...line, font: { ...line.font, refPage: line.font.ref ? page : null } })),
    };
}

export function searchSession(session: string, find: string, matchCase: boolean) {
    const query = new URLSearchParams({ q: find, case: matchCase ? "1" : "0" });
    return apiFetch<SearchResult>(`/tools/edit/${session}/search/?${query}`);
}

// ---------------------------------------------------------------------------
// Fonts: the PDF's own font first, then the complete family, then generic,
// which is exactly the order the server uses when it writes the PDF.
// ---------------------------------------------------------------------------

const GENERIC_CSS: Record<Generic, string> = { sans: "sans-serif", serif: "serif", mono: "monospace" };
const faces = new Map<string, Promise<boolean>>();

const slug = (text: string) => text.replace(/[^A-Za-z0-9]/g, "_");

function pdfFace(session: string, font: FontSpec) {
    return font.ref && font.refPage ? `gp-pdf-${session.slice(0, 8)}-${font.ref}-${font.refPage}` : null;
}

function fullFace(font: FontSpec) {
    return `gp-full-${slug(font.family || "x")}-${font.weight}-${font.italic ? 1 : 0}-${font.generic}`;
}

// Scripts whose letters change shape with their neighbours always use a
// complete, properly shaping font. Keep in step with COMPLEX_SCRIPTS in edit_fonts.py.
const SCRIPTS: [number, number, string, string][] = [
    [0x0980, 0x09ff, "Noto Sans Bengali", "Noto Serif Bengali"],
    [0x0900, 0x097f, "Noto Sans Devanagari", "Noto Serif Devanagari"],
    [0x0a00, 0x0a7f, "Noto Sans Gurmukhi", "Noto Serif Gurmukhi"],
    [0x0a80, 0x0aff, "Noto Sans Gujarati", "Noto Serif Gujarati"],
    [0x0b00, 0x0b7f, "Noto Sans Oriya", "Noto Sans Oriya"],
    [0x0b80, 0x0bff, "Noto Sans Tamil", "Noto Serif Tamil"],
    [0x0c00, 0x0c7f, "Noto Sans Telugu", "Noto Serif Telugu"],
    [0x0c80, 0x0cff, "Noto Sans Kannada", "Noto Serif Kannada"],
    [0x0d00, 0x0d7f, "Noto Sans Malayalam", "Noto Serif Malayalam"],
    [0x0d80, 0x0dff, "Noto Sans Sinhala", "Noto Serif Sinhala"],
    [0x0600, 0x06ff, "Noto Naskh Arabic", "Noto Naskh Arabic"],
    [0x0750, 0x077f, "Noto Naskh Arabic", "Noto Naskh Arabic"],
    [0x0e00, 0x0e7f, "Noto Sans Thai", "Noto Serif Thai"],
    [0x1000, 0x109f, "Noto Sans Myanmar", "Noto Serif Myanmar"],
    [0x1780, 0x17ff, "Noto Sans Khmer", "Noto Serif Khmer"],
];

/** The complete script fonts `text` needs (Bangla, Hindi, Arabic...), as font specs. */
export function scriptFonts(text: string, font: FontSpec): FontSpec[] {
    const families: string[] = [];
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        for (const [first, last, sans, serif] of SCRIPTS) {
            const family = font.generic === "serif" ? serif : sans;
            if (code >= first && code <= last && !families.includes(family)) families.push(family);
        }
    }
    return families.map((family) => ({ ...font, family, ref: null, refPage: null }));
}

/** The CSS font stack for text: the PDF's font, its full family, script fonts, then generic. */
export function fontStack(session: string, font: FontSpec, text = "") {
    const pdf = pdfFace(session, font);
    return [
        pdf && `"${pdf}"`,
        `"${fullFace(font)}"`,
        ...scriptFonts(text, font).map((script) => `"${fullFace(script)}"`),
        GENERIC_CSS[font.generic],
    ]
        .filter(Boolean)
        .join(", ");
}

function loadFace(name: string, url: string, font: FontSpec): Promise<boolean> {
    let face = faces.get(name);
    if (!face) {
        face = fetch(url, { credentials: "include" })
            .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("no font"))))
            .then((data) =>
                new FontFace(name, data, { weight: String(font.weight), style: font.italic ? "italic" : "normal" }).load()
            )
            .then((loaded) => {
                document.fonts.add(loaded);
                return true;
            })
            .catch(() => false);
        faces.set(name, face);
    }
    return face;
}

function familyUrl(font: FontSpec) {
    const query = new URLSearchParams({
        family: font.family,
        weight: String(font.weight),
        italic: font.italic ? "1" : "0",
        generic: font.generic,
    });
    return apiUrl(`/api/tools/edit/fonts/family/?${query}`);
}

/** Load the faces a text change needs. Resolves once they're usable (or known missing). */
export function loadFonts(session: string, font: FontSpec, text = ""): Promise<unknown> {
    const jobs: Promise<boolean>[] = [];
    const pdf = pdfFace(session, font);
    if (pdf) jobs.push(loadFace(pdf, apiUrl(`/api/tools/edit/${session}/fonts/${font.ref}/?page=${font.refPage}`), font));
    jobs.push(loadFace(fullFace(font), familyUrl(font), font));
    for (const script of scriptFonts(text, font)) jobs.push(loadFace(fullFace(script), familyUrl(script), script));
    return Promise.all(jobs);
}

let canvas: HTMLCanvasElement | null = null;

/**
 * How far below the top of a 1.2 line box the browser puts the baseline for
 * this font and size. Text is placed by its baseline, so the editor and the
 * saved PDF agree whatever the font's proportions.
 */
export function baselineOffset(stack: string, sizePx: number, weight: number, italic: boolean): number {
    canvas ??= document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return sizePx * 0.946;
    context.font = `${italic ? "italic " : ""}${weight} ${sizePx}px ${stack}`;
    const metrics = context.measureText("Hg");
    const ascent = metrics.fontBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return sizePx * 0.946;
    return (1.2 * sizePx - (ascent + descent)) / 2 + ascent;
}
