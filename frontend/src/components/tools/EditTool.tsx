"use client";

import { ChangeEvent, PointerEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ArrowUpRight,
    Bold,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Circle,
    Eraser,
    Highlighter,
    ImagePlus,
    Italic,
    Link2,
    Loader2,
    MessageSquare,
    Minus,
    MousePointer2,
    Pencil,
    Redo2,
    Replace,
    RotateCw,
    Square,
    Strikethrough,
    TextCursorInput,
    Trash,
    Type,
    Underline,
    Undo2,
    X,
} from "lucide-react";
import ToolLayout, { FormError } from "@/components/ToolLayout";
import { FileCard, FilePicker } from "@/components/tools/FilePicker";
import {
    backgroundAround,
    bounds,
    BoxItem,
    BoxKind,
    clamp,
    DrawItem,
    FONT_CHOICES,
    anchorOf,
    COLLAPSE_TOP,
    flowCut,
    flowsFor,
    fontKey,
    growOf,
    isCollapsed,
    rowCut,
    fromDisplay,
    shiftAt,
    ImageItem,
    isPlaced,
    Item,
    LineItem,
    moved,
    normaliseUrl,
    PlacedItem,
    ReplaceItem,
    sameList,
    sourceKey,
    TextItem,
    toEdit,
} from "@/components/tools/edit/model";
import { getErrorMessage } from "@/lib/api";
import {
    baselineOffset,
    fetchPage,
    FontSpec,
    fontStack,
    loadFonts,
    scriptFonts,
    openSession,
    PageData,
    searchSession,
    SearchResult,
    Session,
    TextLine,
} from "@/lib/editSession";
import { ToolRun, useToolJob } from "@/lib/useToolJob";

type Mode =
    | "edit"
    | "text"
    | "draw"
    | "highlight"
    | "underline"
    | "strikeout"
    | "whiteout"
    | "rect"
    | "ellipse"
    | "line"
    | "arrow"
    | "note"
    | "link"
    | "select";

type Style = {
    size: number;
    color: string;
    font: FontSpec;
    fontChosen: boolean;
    stroke: number;
    markup: string;
    fill: string | null;
};

type Pointer =
    | { type: "draw"; id: number }
    | { type: "box"; id: number; x: number; y: number }
    | { type: "line"; id: number }
    | { type: "move"; item: PlacedItem; x: number; y: number; moved: boolean; wasSelected: boolean }
    | { type: "resize"; item: BoxItem | ImageItem; x: number; y: number }
    | null;

const INK = ["#16181d", "#2748d6", "#d92d20", "#12795a", "#e8287a", "#ffffff"];
const MARKUP = ["#ffd43b", "#8ce99a", "#74c0fc", "#faa2c1", "#2748d6", "#d92d20"];
const FILLS = ["#ffffff", "#fff3bf", "#d3f9d8", "#d0ebff", "#ffe3e3", "#16181d"];
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const HISTORY = 100;
const KEEP_PAGES = 30;
const DEFAULT_FONT: FontSpec = { ref: null, refPage: null, family: "Arial", weight: 400, italic: false, generic: "sans" };
const BOX_MODES: Mode[] = ["highlight", "underline", "strikeout", "whiteout", "rect", "ellipse", "link"];

const MODE_INFO: Record<Mode, { label: string; icon: typeof Type; hint: string }> = {
    edit: { label: "Edit text", icon: TextCursorInput, hint: "Click any line of text to change it. It keeps its own font." },
    text: { label: "Add text", icon: Type, hint: "Click anywhere on the page to type." },
    draw: { label: "Draw", icon: Pencil, hint: "Drag to draw freehand." },
    highlight: { label: "Highlight", icon: Highlighter, hint: "Drag over text to highlight it." },
    underline: { label: "Underline", icon: Underline, hint: "Drag over text to underline it." },
    strikeout: { label: "Strikethrough", icon: Strikethrough, hint: "Drag over text to strike it through." },
    whiteout: { label: "White-out", icon: Eraser, hint: "Drag over anything to cover it in the colour behind it." },
    rect: { label: "Box", icon: Square, hint: "Drag to draw a box." },
    ellipse: { label: "Ellipse", icon: Circle, hint: "Drag to draw an ellipse." },
    line: { label: "Line", icon: Minus, hint: "Drag to draw a straight line." },
    arrow: { label: "Arrow", icon: ArrowUpRight, hint: "Drag to draw an arrow." },
    note: { label: "Note", icon: MessageSquare, hint: "Click to pin a comment to the page." },
    link: { label: "Link", icon: Link2, hint: "Drag over the area that should open a link." },
    select: { label: "Select", icon: MousePointer2, hint: "Click a change to select it, drag to move it, press Delete to remove it." },
};
const GROUPS: { label: string; modes: Mode[] }[] = [
    { label: "Edit text", modes: ["edit"] },
    { label: "Add text", modes: ["text"] },
    { label: "Draw", modes: ["draw"] },
    { label: "Markup", modes: ["highlight", "underline", "strikeout"] },
    { label: "White-out", modes: ["whiteout"] },
    { label: "Shapes", modes: ["rect", "ellipse", "line", "arrow"] },
    { label: "Note", modes: ["note"] },
    { label: "Link", modes: ["link"] },
];

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

function ToolbarButton({
    label,
    active,
    disabled,
    onClick,
    children,
    showLabel = true,
}: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
    showLabel?: boolean;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            // Keep the text box focused while changing its style.
            onPointerDown={(event) => event.preventDefault()}
            onClick={onClick}
            className={`h-9 shrink-0 inline-flex items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                active ? "bg-ink text-white" : "text-ink-2 hover:text-ink hover:bg-surface-2"
            }`}
        >
            {children}
            {showLabel && <span className="hidden xl:inline">{label}</span>}
        </button>
    );
}

/** A toolbar button for a family of tools (shapes, markup) with a pop-up list. */
function ToolGroup({ label, modes, mode, onPick }: { label: string; modes: Mode[]; mode: Mode; onPick: (mode: Mode) => void }) {
    const [open, setOpen] = useState(false);
    const [last, setLast] = useState(modes[0]);
    const box = useRef<HTMLDivElement>(null);
    const shown = modes.includes(mode) ? mode : last;
    const Icon = MODE_INFO[shown].icon;

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (!box.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    if (modes.length === 1) {
        return (
            <ToolbarButton label={MODE_INFO[shown].label} active={mode === shown} onClick={() => onPick(shown)}>
                <Icon className="w-4 h-4" aria-hidden />
            </ToolbarButton>
        );
    }
    return (
        <div className="relative shrink-0" ref={box}>
            <div className={`flex items-center rounded-lg ${modes.includes(mode) ? "bg-ink text-white" : "text-ink-2"}`}>
                <button
                    type="button"
                    title={MODE_INFO[shown].label}
                    aria-label={MODE_INFO[shown].label}
                    aria-pressed={mode === shown}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onPick(shown)}
                    className={`h-9 inline-flex items-center gap-1.5 rounded-l-lg pl-2.5 pr-1 text-sm font-medium whitespace-nowrap ${
                        modes.includes(mode) ? "" : "hover:text-ink hover:bg-surface-2"
                    }`}
                >
                    <Icon className="w-4 h-4" aria-hidden />
                    <span className="hidden xl:inline">{label}</span>
                </button>
                <button
                    type="button"
                    aria-label={`More ${label.toLowerCase()} tools`}
                    aria-expanded={open}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => setOpen(!open)}
                    className={`h-9 px-1 rounded-r-lg ${modes.includes(mode) ? "" : "hover:text-ink hover:bg-surface-2"}`}
                >
                    <ChevronDown className="w-3.5 h-3.5" aria-hidden />
                </button>
            </div>
            {open && (
                <div role="menu" className="fixed z-50 mt-1 card p-1 shadow-lg min-w-44">
                    {modes.map((item) => {
                        const ItemIcon = MODE_INFO[item].icon;
                        return (
                            <button
                                key={item}
                                type="button"
                                role="menuitemradio"
                                aria-checked={mode === item}
                                onPointerDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    setLast(item);
                                    setOpen(false);
                                    onPick(item);
                                }}
                                className={`flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg ${
                                    mode === item ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface-2"
                                }`}
                            >
                                <ItemIcon className="w-4 h-4" aria-hidden />
                                {MODE_INFO[item].label}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function Swatches({
    colors,
    value,
    onChange,
    label,
    allowNone,
}: {
    colors: string[];
    value: string | null;
    onChange: (color: string | null) => void;
    label: string;
    allowNone?: boolean;
}) {
    const current = value?.toLowerCase() ?? null;
    return (
        <div className="flex items-center gap-1.5" role="group" aria-label={label}>
            {allowNone && (
                <button
                    type="button"
                    title="None"
                    aria-label={`${label}: none`}
                    aria-pressed={current === null}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onChange(null)}
                    className={`relative w-6 h-6 rounded-full border border-line-strong bg-white overflow-hidden ${
                        current === null ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""
                    }`}
                >
                    <span className="absolute left-1/2 top-0 h-full w-px bg-danger rotate-45" aria-hidden />
                </button>
            )}
            {colors.map((color) => (
                <button
                    key={color}
                    type="button"
                    title={color}
                    aria-label={`${label} ${color}`}
                    aria-pressed={current === color}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onChange(color)}
                    className={`w-6 h-6 rounded-full border transition-transform ${
                        current === color ? "ring-2 ring-accent ring-offset-2 ring-offset-surface scale-110" : "border-line-strong hover:scale-110"
                    }`}
                    style={{ background: color }}
                />
            ))}
            <label className="relative w-6 h-6 rounded-full border border-line-strong overflow-hidden cursor-pointer" title="Any colour">
                <span className="absolute inset-0" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }} aria-hidden />
                <input
                    type="color"
                    value={current ?? "#ffffff"}
                    onChange={(event) => onChange(event.target.value)}
                    aria-label={`${label}: any colour`}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                />
            </label>
        </div>
    );
}

/** One page in the side list. Its image loads when it scrolls into view. */
function Thumb({
    number,
    ratio,
    image,
    active,
    count,
    rotation,
    deleted,
    onVisible,
    onOpen,
}: {
    number: number;
    ratio: number;
    image?: string;
    active: boolean;
    count: number;
    rotation: number;
    deleted: boolean;
    onVisible: (number: number) => void;
    onOpen: (number: number) => void;
}) {
    const box = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (image || !box.current) return;
        const watcher = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) onVisible(number);
            },
            { rootMargin: "400px" }
        );
        watcher.observe(box.current);
        return () => watcher.disconnect();
    }, [image, number, onVisible]);

    return (
        <button
            ref={box}
            type="button"
            onClick={() => onOpen(number)}
            aria-label={`Page ${number}${count ? `, ${count} changes` : ""}${deleted ? ", will be deleted" : ""}`}
            aria-current={active ? "page" : undefined}
            className={`relative block w-full rounded-lg overflow-hidden border-2 bg-white transition-colors ${
                active ? "border-accent" : "border-transparent hover:border-line-strong"
            }`}
            style={{ aspectRatio: String(ratio) }}
        >
            {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={image}
                    alt=""
                    className={`block w-full h-full object-contain transition-transform ${deleted ? "opacity-30 grayscale" : ""}`}
                    style={{ transform: rotation ? `rotate(${rotation}deg) scale(${rotation % 180 ? 1 / ratio : 1})` : undefined }}
                />
            ) : (
                <span className="absolute inset-0 skeleton rounded-none" aria-hidden />
            )}
            <span className="absolute bottom-1 left-1 text-[11px] font-medium bg-ink/80 text-white rounded px-1.5">{number}</span>
            {count > 0 && (
                <span className="absolute top-1 right-1 text-[11px] font-semibold chip-featured rounded-full min-w-5 h-5 px-1 inline-flex items-center justify-center">
                    {count}
                </span>
            )}
            {deleted && <Trash className="absolute inset-0 m-auto w-5 h-5 text-danger" aria-hidden />}
        </button>
    );
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

function Editor({ meta, run, onReset }: { meta: Session; run: ToolRun; onReset: () => void }) {
    const session = meta.session;
    const pageCount = meta.pages.length;
    const [page, setPage] = useState(1);
    const [pageInput, setPageInput] = useState("1");
    const [mode, setMode] = useState<Mode>("edit");
    const [style, setStyle] = useState<Style>({
        size: 12,
        color: "#16181d",
        font: DEFAULT_FONT,
        fontChosen: false,
        stroke: 2,
        markup: "#ffd43b",
        fill: null,
    });
    const [items, setItems] = useState<Item[]>([]);
    const [past, setPast] = useState<Item[][]>([]);
    const [future, setFuture] = useState<Item[][]>([]);
    const [selected, setSelected] = useState<number | null>(null);
    const [editing, setEditing] = useState<number | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [stageWidth, setStageWidth] = useState(0);
    const [pages, setPages] = useState<Map<number, PageData>>(() => new Map());
    const [thumbs, setThumbs] = useState<Map<number, string>>(() => new Map());
    const [pageError, setPageError] = useState<string | null>(null);
    const [, setFontsVersion] = useState(0);
    const [findOpen, setFindOpen] = useState(false);
    const [find, setFind] = useState("");
    const [replaceWith, setReplaceWith] = useState("");
    const [matchCase, setMatchCase] = useState(false);
    const [found, setFound] = useState<SearchResult | null>(null);
    const [searching, setSearching] = useState(false);
    const [focusField, setFocusField] = useState<"note" | "link" | null>(null);
    // How many points taller each retyped line has become (new lines, wrapping).
    const [grows, setGrows] = useState<Record<number, number>>({});

    const nextId = useRef(1);
    const itemsRef = useRef<Item[]>([]);
    const gesture = useRef<Item[] | null>(null);
    const fieldGesture = useRef(false);
    const pointer = useRef<Pointer>(null);
    const stage = useRef<HTMLDivElement | null>(null);
    const pageImage = useRef<HTMLImageElement | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const observer = useRef<ResizeObserver | null>(null);
    const scaleRef = useRef(1);
    const textObserver = useRef<ResizeObserver | null>(null);
    const requested = useRef(new Set<string>());
    const thumbQueue = useRef<number[]>([]);
    const thumbsRunning = useRef(0);

    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    const [pageWidth, pageHeight] = meta.pages[page - 1];
    const data = pages.get(page);
    const scale = stageWidth ? stageWidth / pageWidth : 1;
    useEffect(() => {
        scaleRef.current = scale;
    }, [scale]);

    /**
     * Watch a retyped line's height while it is edited: every extra line (Enter,
     * or wrapping at the page's text edge) pushes the content below it down.
     */
    const measureText = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;
        textObserver.current ??= new ResizeObserver((entries) => {
            const changes: Record<number, number> = {};
            for (const entry of entries) {
                const element = entry.target as HTMLElement;
                const id = Number(element.dataset.id);
                const size = Number(element.dataset.size);
                const height = entry.borderBoxSize?.[0]?.blockSize ?? element.offsetHeight;
                changes[id] = Math.max(0, Math.round((height / scaleRef.current - 1.2 * size) * 10) / 10);
            }
            setGrows((old) =>
                Object.entries(changes).some(([id, grow]) => Math.abs((old[Number(id)] ?? 0) - grow) > 0.3) ? { ...old, ...changes } : old
            );
        });
        textObserver.current.observe(node);
    }, []);
    useEffect(() => () => textObserver.current?.disconnect(), []);

    const current = items.find((item) => item.id === selected) ?? null;
    const placed = current && isPlaced(current) ? current : null;

    // ---- loading pages ------------------------------------------------------

    const loadPage = useCallback(
        (number: number) => {
            const key = `full-${number}`;
            if (requested.current.has(key) || number < 1 || number > pageCount) return;
            requested.current.add(key);
            fetchPage(session, number, true)
                .then((loaded) => {
                    setPages((old) => {
                        const next = new Map(old);
                        next.set(number, loaded);
                        // Keep memory flat on long documents: forget far-away pages.
                        for (const kept of [...next.keys()]) {
                            if (next.size <= KEEP_PAGES) break;
                            if (Math.abs(kept - number) > KEEP_PAGES / 2) {
                                next.delete(kept);
                                requested.current.delete(`full-${kept}`);
                            }
                        }
                        return next;
                    });
                    setThumbs((old) => (old.has(number) ? old : new Map(old).set(number, loaded.image)));
                    setPageError(null);
                })
                .catch((error: unknown) => {
                    requested.current.delete(key);
                    setPageError(getErrorMessage(error, "This page could not be loaded."));
                });
        },
        [pageCount, session]
    );

    useEffect(() => {
        loadPage(page);
        loadPage(page + 1); // so turning the page is instant
    }, [loadPage, page]);

    const pumpThumbs = useCallback(function pump() {
        while (thumbsRunning.current < 3 && thumbQueue.current.length) {
            const number = thumbQueue.current.shift()!;
            thumbsRunning.current += 1;
            fetchPage(session, number, false)
                .then((loaded) => setThumbs((old) => new Map(old).set(number, loaded.image)))
                .catch(() => requested.current.delete(`thumb-${number}`))
                .finally(() => {
                    thumbsRunning.current -= 1;
                    pump();
                });
        }
    }, [session]);

    const requestThumb = useCallback(
        (number: number) => {
            const key = `thumb-${number}`;
            if (requested.current.has(key)) return;
            requested.current.add(key);
            thumbQueue.current.push(number);
            pumpThumbs();
        },
        [pumpThumbs]
    );

    // Fonts of the document seen so far, for the font menu and the bold/italic switches.
    const docFonts = useMemo(() => {
        const fonts = new Map<string, FontSpec>();
        for (const loaded of pages.values()) {
            for (const line of loaded.lines ?? []) {
                const key = fontKey(line.font);
                if (!fonts.has(key) || (!fonts.get(key)!.ref && line.font.ref)) fonts.set(key, line.font);
            }
        }
        return fonts;
    }, [pages]);

    // New text starts in the document's main font, until someone picks another.
    const mainFont = useMemo(() => {
        const lines = data?.lines ?? [];
        if (!lines.length) return null;
        // The family and size that cover the most characters: the body text, not a big heading.
        const families = new Map<string, { font: FontSpec; chars: number; sizes: Map<number, number> }>();
        for (const line of lines) {
            const key = fontKey({ ...line.font, weight: 400, italic: false });
            const entry = families.get(key) ?? { font: line.font, chars: 0, sizes: new Map<number, number>() };
            entry.chars += line.text.length;
            entry.sizes.set(line.size, (entry.sizes.get(line.size) ?? 0) + line.text.length);
            families.set(key, entry);
        }
        const main = [...families.values()].sort((a, b) => b.chars - a.chars)[0];
        const size = [...main.sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { font: main.font, size };
    }, [data]);

    const newTextStyle = useMemo(() => {
        if (style.fontChosen || !mainFont) return { font: style.font, size: style.size };
        const regular = docFonts.get(fontKey({ ...mainFont.font, weight: 400, italic: false }));
        return {
            font: regular ?? { ...mainFont.font, weight: 400, italic: false, ref: null, refPage: null },
            size: Math.round(mainFont.size * 10) / 10,
        };
    }, [docFonts, mainFont, style.font, style.fontChosen, style.size]);

    // Load the fonts used by text on this page; re-render when they arrive.
    const pageItems = items.filter((item): item is PlacedItem => isPlaced(item) && item.page === page);
    const replaces = items.filter((item): item is ReplaceItem => item.kind === "replace");
    // Retyped lines that grew push everything below them down.
    const flows = flowsFor(pageItems, grows, editing, pageHeight);
    const fontsNeeded = [
        ...pageItems.flatMap((item) => (item.kind === "text" ? [{ font: item.font, text: item.text }] : [])),
        ...(replaces.length ? (data?.lines ?? []).map((line) => ({ font: line.font, text: line.text })) : []),
        { font: newTextStyle.font, text: "" },
    ];
    // Bangla, Hindi or Arabic in a text adds that script's font, so the key includes them.
    const needKey = ({ font, text }: { font: FontSpec; text: string }) =>
        `${fontKey(font)}|${font.ref}|${font.refPage}|${scriptFonts(text, font).map((script) => script.family).join("+")}`;
    const fontsKey = [...new Set(fontsNeeded.map(needKey))].join(",");
    useEffect(() => {
        let alive = true;
        const unique = new Map(fontsNeeded.map((need) => [needKey(need), need]));
        Promise.all([...unique.values()].map(({ font, text }) => loadFonts(session, font, text))).then(() => {
            if (alive) setFontsVersion((value) => value + 1);
        });
        return () => {
            alive = false;
        };
        // fontsKey captures fontsNeeded.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fontsKey, session]);

    // ---- history -----------------------------------------------------------

    function commit(next: Item[]) {
        setPast((stack) => [...stack.slice(-HISTORY + 1), itemsRef.current]);
        setFuture([]);
        setItems(next);
    }

    /** Start a change made of many small updates (a drag, a stroke, typing). */
    function beginGesture() {
        gesture.current ??= itemsRef.current;
    }

    function endGesture(final = itemsRef.current) {
        const before = gesture.current;
        gesture.current = null;
        if (before && !sameList(before, final)) {
            setPast((stack) => [...stack.slice(-HISTORY + 1), before]);
            setFuture([]);
        }
    }

    /** Typing in a side field (note text, link address) is one undo step. */
    function startFieldEdit() {
        setFocusField(null);
        endFieldEdit();
        beginGesture();
        fieldGesture.current = true;
    }

    function endFieldEdit() {
        if (!fieldGesture.current) return;
        fieldGesture.current = false;
        endGesture();
    }

    function update(id: number, change: Partial<Item>) {
        setItems((list) => list.map((item) => (item.id === id ? ({ ...item, ...change } as Item) : item)));
    }

    function undo() {
        if (!past.length) return;
        stopEditing();
        setFuture((stack) => [itemsRef.current, ...stack]);
        setItems(past[past.length - 1]);
        setPast((stack) => stack.slice(0, -1));
        setSelected(null);
    }

    function redo() {
        if (!future.length) return;
        stopEditing();
        setPast((stack) => [...stack, itemsRef.current]);
        setItems(future[0]);
        setFuture((stack) => stack.slice(1));
        setSelected(null);
    }

    function remove(id: number) {
        stopEditing();
        commit(itemsRef.current.filter((other) => other.id !== id));
        setSelected(null);
    }

    // ---- text editing ------------------------------------------------------

    function lineSnapshot(item: TextItem) {
        const { x, baseline, text, size, color, font } = item;
        return JSON.stringify({ x, baseline, text, size, color, font: fontKey(font) });
    }

    function startEditing(id: number) {
        beginGesture();
        setSelected(id);
        setEditing(id);
    }

    /** Finish typing: drop empty new text, and retyped lines that didn't change. */
    function stopEditing() {
        if (editing === null) return;
        const id = editing;
        setEditing(null);
        let final = itemsRef.current;
        const item = final.find((other) => other.id === id);
        if (item?.kind === "text") {
            const unchanged = item.source && item.original === lineSnapshot(item);
            if ((!item.source && !item.text.trim()) || unchanged) {
                final = final.filter((other) => other.id !== id);
                setItems(final);
                setSelected(null);
            }
        }
        endGesture(final);
    }

    // ---- style -------------------------------------------------------------

    /** The document font with this family and style, or the plain family when the PDF lacks it. */
    function withStyle(font: FontSpec, weight: number, italic: boolean): FontSpec {
        const match = docFonts.get(fontKey({ ...font, weight, italic }));
        return match ?? { ...font, weight, italic, ref: null, refPage: null };
    }

    function applyToCurrent(patch: Partial<Item>) {
        if (!current || !Object.keys(patch).length) return;
        if (editing === current.id) {
            update(current.id, patch); // part of the typing gesture
        } else {
            commit(itemsRef.current.map((item) => (item.id === current.id ? ({ ...item, ...patch } as Item) : item)));
        }
    }

    function applyText(change: { size?: number; color?: string; font?: FontSpec }) {
        setStyle((old) => ({
            ...old,
            ...(change.size ? { size: change.size } : {}),
            ...(change.color ? { color: change.color } : {}),
            ...(change.font ? { font: change.font, fontChosen: true } : {}),
            ...(!old.fontChosen && !change.font ? { font: newTextStyle.font, fontChosen: true } : {}),
        }));
        if (current?.kind === "text") applyToCurrent(change);
    }

    function applyShape(change: { color?: string; stroke?: number; fill?: string | null; markup?: string }) {
        setStyle((old) => ({ ...old, ...change }));
        if (!current) return;
        if (current.kind === "highlight" || current.kind === "underline" || current.kind === "strikeout") {
            if (change.markup) applyToCurrent({ color: change.markup });
        } else if (current.kind === "rect" || current.kind === "ellipse") {
            const patch: Partial<BoxItem> = {};
            if (change.color) patch.color = change.color;
            if (change.stroke) patch.stroke = change.stroke;
            if ("fill" in change) patch.fill = change.fill ?? null;
            applyToCurrent(patch);
        } else if (current.kind === "draw" || current.kind === "line" || current.kind === "arrow") {
            const patch: Partial<DrawItem> = {};
            if (change.color) patch.color = change.color;
            if (change.stroke) patch.stroke = change.stroke;
            applyToCurrent(patch);
        } else if (current.kind === "note" && change.color) {
            applyToCurrent({ color: change.color });
        }
    }

    // ---- pointer -----------------------------------------------------------

    /** The pointer in the page's original coordinates (undoing any reflow shift). */
    function at(event: PointerEvent): [number, number] {
        const rect = stage.current!.getBoundingClientRect();
        const shown = (event.clientY - rect.top) / rect.height;
        return [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp(fromDisplay(flows, shown, pageHeight), 0, 1)];
    }

    function capture(event: PointerEvent) {
        stage.current?.setPointerCapture(event.pointerId);
    }

    function add(item: Item) {
        setItems((list) => [...list, item]);
    }

    const pageDeleted = items.some((item) => item.kind === "delete-page" && item.page === page);

    function handleStageDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button > 0 || pageDeleted) return;
        endFieldEdit(); // pointer events come before the field loses focus
        if (editing !== null) {
            stopEditing();
            return;
        }
        const [x, y] = at(event);
        const id = nextId.current++;
        if (mode === "text") {
            // Otherwise the browser moves focus away from the new text box.
            event.preventDefault();
            beginGesture();
            const { font, size } = newTextStyle;
            add({ id, page, kind: "text", x: clamp(x, 0, 0.98), baseline: clamp(y + (size * 0.35) / pageHeight, 0.01, 1), text: "", size, color: style.color, font });
            startEditing(id);
        } else if (mode === "note") {
            commit([...itemsRef.current, { id, page, kind: "note", x: clamp(x, 0, 0.97), y: clamp(y, 0, 0.97), text: "", color: "#ffd43b" }]);
            setSelected(id);
            setFocusField("note");
        } else if (mode === "draw") {
            beginGesture();
            capture(event);
            add({ id, page, kind: "draw", points: [[x, y]], color: style.color, stroke: style.stroke });
            pointer.current = { type: "draw", id };
        } else if (mode === "line" || mode === "arrow") {
            beginGesture();
            capture(event);
            add({ id, page, kind: mode, x1: x, y1: y, x2: x, y2: y, color: style.color, stroke: style.stroke });
            pointer.current = { type: "line", id };
        } else if (BOX_MODES.includes(mode)) {
            beginGesture();
            capture(event);
            const kind = mode as BoxKind;
            const color =
                kind === "highlight" || kind === "underline" || kind === "strikeout" ? style.markup : kind === "link" ? "#2748d6" : style.color;
            add({ id, page, kind, x, y, w: 0, h: 0, color, fill: kind === "rect" || kind === "ellipse" ? style.fill : null, stroke: style.stroke });
            pointer.current = { type: "box", id, x, y };
        } else {
            setSelected(null);
        }
    }

    function handleStageMove(event: PointerEvent<HTMLDivElement>) {
        const action = pointer.current;
        if (!action) return;
        const [x, y] = at(event);
        if (action.type === "draw") {
            setItems((list) =>
                list.map((item) => {
                    if (item.id !== action.id || item.kind !== "draw") return item;
                    const [lastX, lastY] = item.points[item.points.length - 1];
                    const far = Math.hypot((x - lastX) * pageWidth, (y - lastY) * pageHeight) > 1.5;
                    return far && item.points.length < 5000 ? { ...item, points: [...item.points, [x, y]] } : item;
                })
            );
        } else if (action.type === "line") {
            update(action.id, { x2: x, y2: y });
        } else if (action.type === "box") {
            update(action.id, { x: Math.min(x, action.x), y: Math.min(y, action.y), w: Math.abs(x - action.x), h: Math.abs(y - action.y) });
        } else if (action.type === "move") {
            const dx = x - action.x;
            const dy = y - action.y;
            if (!action.moved && Math.hypot(dx * pageWidth, dy * pageHeight) < 3) return;
            action.moved = true;
            const next = moved(action.item, dx, dy);
            setItems((list) => list.map((item) => (item.id === next.id ? next : item)));
        } else if (action.type === "resize") {
            const item = action.item;
            const w = clamp(item.w + x - action.x, 0.01, 1 - item.x);
            const h =
                item.kind === "image"
                    ? Math.min(w * item.ratio * (pageWidth / pageHeight), 1 - item.y)
                    : clamp(item.h + y - action.y, 0.004, 1 - item.y);
            update(item.id, { w, h });
        }
    }

    function handleStageUp() {
        const action = pointer.current;
        pointer.current = null;
        if (!action) return;
        const drop = (id: number) => {
            const final = itemsRef.current.filter((item) => item.id !== id);
            setItems(final);
            endGesture(final);
        };
        if (action.type === "box") {
            const box = itemsRef.current.find((item) => item.id === action.id) as BoxItem | undefined;
            if (!box || box.w < 0.004 || box.h < 0.003) return drop(action.id);
            if (box.kind === "whiteout") update(box.id, { color: backgroundAround(pageImage.current, box) });
            if (box.kind === "link") {
                setSelected(box.id);
                setFocusField("link");
            }
        }
        if (action.type === "line") {
            const line = itemsRef.current.find((item) => item.id === action.id) as LineItem | undefined;
            if (!line || Math.hypot((line.x2 - line.x1) * pageWidth, (line.y2 - line.y1) * pageHeight) < 4) return drop(action.id);
        }
        if (action.type === "move" && !action.moved) {
            gesture.current = null;
            if (action.item.kind === "text" && (action.wasSelected || mode !== "select")) startEditing(action.item.id);
            return;
        }
        endGesture();
    }

    function handleItemDown(event: PointerEvent, item: PlacedItem) {
        // Drawing tools draw over existing changes.
        if (!["select", "edit", "text", "note"].includes(mode) || event.button > 0) return;
        event.stopPropagation();
        if (editing === item.id) return;
        if (editing !== null) stopEditing();
        const [x, y] = at(event);
        beginGesture();
        capture(event);
        pointer.current = { type: "move", item, x, y, moved: false, wasSelected: selected === item.id };
        setSelected(item.id);
    }

    function handleResizeDown(event: PointerEvent, item: BoxItem | ImageItem) {
        event.stopPropagation();
        const [x, y] = at(event);
        beginGesture();
        capture(event);
        pointer.current = { type: "resize", item, x, y };
    }

    /** Retype a line: a text change in the line's own font, on its baseline. */
    function editLine(event: PointerEvent, line: TextLine, text = line.text) {
        if (event.button > 0) return;
        event.stopPropagation();
        event.preventDefault(); // keep focus in the text box this creates
        if (editing !== null) stopEditing();
        const id = nextId.current++;
        const source = { x: line.x, y: line.y, w: line.w, h: line.h };
        // Longer text wraps at the page's right text edge, like a word processor.
        const textEdge = Math.max(line.x + line.w, ...(data?.lines ?? []).map((other) => other.x + other.w));
        const item: TextItem = {
            id,
            page,
            kind: "text",
            x: line.x,
            baseline: line.baseline,
            text,
            size: line.size,
            color: line.color,
            font: line.font,
            source,
            background: backgroundAround(pageImage.current, source),
            width: Math.min(textEdge - line.x + 0.01, 1 - line.x),
            collapse: line.collapse,
            cut: line.flow,
        };
        item.original = lineSnapshot({ ...item, text: line.text });
        beginGesture();
        add(item);
        startEditing(id);
    }

    // ---- pages -------------------------------------------------------------

    function goTo(number: number) {
        const next = clamp(Math.round(number), 1, pageCount);
        setPageInput(String(next));
        if (next === page) return; // e.g. the page box losing focus: nothing to do
        stopEditing();
        setSelected(null);
        setPage(next);
        setPageInput(String(next));
    }

    function rotatePage(number: number) {
        const existing = itemsRef.current.find((item) => item.kind === "rotate-page" && item.page === number);
        const degrees = existing && existing.kind === "rotate-page" ? (existing.degrees + 90) % 360 : 90;
        const rest = itemsRef.current.filter((item) => item !== existing);
        commit(degrees ? [...rest, { id: nextId.current++, page: number, kind: "rotate-page", degrees }] : rest);
    }

    function toggleDeletePage(number: number) {
        const existing = itemsRef.current.find((item) => item.kind === "delete-page" && item.page === number);
        if (existing) {
            commit(itemsRef.current.filter((item) => item !== existing));
        } else {
            const kept = pageCount - itemsRef.current.filter((item) => item.kind === "delete-page").length;
            if (kept <= 1) {
                setNotice("A PDF needs at least one page.");
                return;
            }
            stopEditing();
            commit([...itemsRef.current, { id: nextId.current++, page: number, kind: "delete-page" }]);
        }
    }

    const rotationOf = (number: number) => {
        const item = items.find((other) => other.kind === "rotate-page" && other.page === number);
        return item && item.kind === "rotate-page" ? item.degrees : 0;
    };
    const deletedPages = new Set(items.filter((item) => item.kind === "delete-page").map((item) => item.page));
    const changesOn = (number: number) => items.filter((item) => isPlaced(item) && item.page === number).length;

    // ---- find & replace ----------------------------------------------------

    async function runSearch() {
        if (!find.trim()) return;
        setSearching(true);
        try {
            setFound(await searchSession(session, find, matchCase));
        } catch (error: unknown) {
            setNotice(getErrorMessage(error, "Search failed."));
        } finally {
            setSearching(false);
        }
    }

    function replaceAll() {
        if (!find.trim()) return;
        commit([
            ...itemsRef.current,
            { id: nextId.current++, page: 1, kind: "replace", find, replace: replaceWith, matchCase, count: found?.total ?? 0 },
        ]);
        setNotice(null);
    }

    /** What a line will say after the find & replace rules, or null when untouched. */
    function replacedText(line: TextLine): string | null {
        let text = line.text;
        for (const rule of replaces) {
            const escaped = rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            text = text.replace(new RegExp(escaped, rule.matchCase ? "g" : "gi"), () => rule.replace);
        }
        return text === line.text ? null : text;
    }

    // ---- images ------------------------------------------------------------

    function pickImage(event: ChangeEvent<HTMLInputElement>) {
        const picked = event.target.files?.[0];
        event.target.value = "";
        if (!picked) return;
        if (!["image/png", "image/jpeg"].includes(picked.type)) return setNotice("Images must be PNG or JPG files.");
        if (picked.size > MAX_IMAGE_BYTES) return setNotice("Images must be 5 MB or smaller.");
        if (itemsRef.current.filter((item) => item.kind === "image").length >= MAX_IMAGES) {
            return setNotice(`You can add up to ${MAX_IMAGES} images at a time.`);
        }
        const url = URL.createObjectURL(picked);
        const picture = new Image();
        picture.onload = () => {
            const ratio = picture.naturalHeight / picture.naturalWidth;
            let w = 0.35;
            let h = w * ratio * (pageWidth / pageHeight);
            if (h > 0.6) {
                w *= 0.6 / h;
                h = 0.6;
            }
            const id = nextId.current++;
            stopEditing();
            commit([...itemsRef.current, { id, page, kind: "image", file: picked, url, ratio, x: (1 - w) / 2, y: (1 - h) / 2, w, h }]);
            setSelected(id);
            setMode("select");
            setNotice(null);
        };
        picture.onerror = () => {
            URL.revokeObjectURL(url);
            setNotice("That image could not be opened.");
        };
        picture.src = url;
    }

    // ---- lifecycle ---------------------------------------------------------

    const stageRef = useCallback((node: HTMLDivElement | null) => {
        stage.current = node;
        observer.current?.disconnect();
        if (!node) return;
        observer.current = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
        observer.current.observe(node);
    }, []);

    // Shortcuts: undo, redo, delete, escape, page keys.
    const keys = useRef<(event: KeyboardEvent) => void>(() => {});
    useEffect(() => {
        keys.current = (event: KeyboardEvent) => {
            if (run.phase !== "idle") return;
            const target = event.target as HTMLElement;
            const typing = target.closest("input, textarea, select, [contenteditable]");
            const mod = event.ctrlKey || event.metaKey;
            if (event.key === "Escape") {
                if (editing !== null) stopEditing();
                else setSelected(null);
                return;
            }
            if (typing) return;
            if (mod && event.key.toLowerCase() === "z") {
                event.preventDefault();
                if (event.shiftKey) redo();
                else undo();
            } else if (mod && event.key.toLowerCase() === "y") {
                event.preventDefault();
                redo();
            } else if (mod && event.key.toLowerCase() === "f") {
                event.preventDefault();
                setFindOpen(true);
            } else if ((event.key === "Delete" || event.key === "Backspace") && selected !== null) {
                event.preventDefault();
                remove(selected);
            } else if (event.key === "PageDown") {
                goTo(page + 1);
            } else if (event.key === "PageUp") {
                goTo(page - 1);
            }
        };
    });
    useEffect(() => {
        const listener = (event: KeyboardEvent) => keys.current(event);
        window.addEventListener("keydown", listener);
        return () => window.removeEventListener("keydown", listener);
    }, []);

    // Don't lose work to an accidental reload.
    const dirty = items.length > 0;
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    useEffect(() => {
        return () => itemsRef.current.forEach((item) => item.kind === "image" && URL.revokeObjectURL(item.url));
    }, []);

    // ---- saving ------------------------------------------------------------

    function save() {
        stopEditing();
        const list = itemsRef.current.filter((item) => item.kind !== "text" || item.source || item.text.trim());
        if (!list.length) {
            run.setError("Make a change first. Click any line of text to edit it, or pick a tool above the page.");
            return;
        }
        const badLink = list.find((item) => item.kind === "link" && !normaliseUrl(item.url ?? ""));
        if (badLink) {
            goTo(badLink.page);
            setSelected(badLink.id);
            run.setError("Add a web or email address to every link.");
            return;
        }
        const pictures = list.filter((item): item is ImageItem => item.kind === "image");
        const body = new FormData();
        body.append("session", session);
        body.append(
            "edits",
            JSON.stringify(
                list.map((item) =>
                    toEdit(
                        item.kind === "link" ? { ...item, url: normaliseUrl(item.url ?? "") ?? "" } : item,
                        item.kind === "image" ? pictures.indexOf(item) : -1,
                        isPlaced(item) ? growOf(item, grows, null) : 0
                    )
                )
            )
        );
        pictures.forEach((item, index) => body.append("images", item.file, `image-${index + 1}${item.file.type === "image/png" ? ".png" : ".jpg"}`));
        run.submit(body);
    }

    // ---- render ------------------------------------------------------------

    const interactive = mode === "select" || mode === "edit" || mode === "text" || mode === "note";
    const retyped = new Set(pageItems.flatMap((item) => (item.kind === "text" && item.source ? [sourceKey(item.source)] : [])));
    const lines = (data?.lines ?? []).filter((line) => !retyped.has(sourceKey(line)));

    /** Fraction of the page height that content at y (fraction) moves down by reflow. */
    const down = (y: number) => shiftAt(flows, y) / pageHeight;
    // A line moves with the band its middle is in, exactly as the server assigns it.
    const lineMiddle = (line: TextLine) => line.y + line.h / 2;
    const totalGrow = Math.max(0, flows.reduce((total, flow) => total + flow.grow, 0));
    // Lines pushed past the bottom: the saved page grows (the server checks all content).
    const lowestText = Math.max(0, ...(data?.lines ?? []).map((line) => line.y + line.h));
    const pageGrows = totalGrow > 0 && lowestText + totalGrow / pageHeight > 1;
    /** CSS top for something stored at y, after reflow. */
    const topOf = (y: number) => `${(y + down(y)) * 100}%`;

    function textStyle(font: FontSpec, size: number, color: string, text = "") {
        const stack = fontStack(session, font, text);
        const px = size * scale;
        return {
            offset: baselineOffset(stack, px, font.weight, font.italic),
            css: { fontFamily: stack, fontSize: `${px}px`, lineHeight: 1.2, fontWeight: font.weight, fontStyle: font.italic ? "italic" : "normal", color },
        };
    }

    function deleteButton(item: PlacedItem) {
        return (
            <button
                type="button"
                aria-label="Remove this change"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => remove(item.id)}
                className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-ink text-white flex items-center justify-center shadow z-10 pointer-events-auto"
            >
                <X className="w-3.5 h-3.5" aria-hidden />
            </button>
        );
    }

    function renderItem(item: PlacedItem) {
        const isSelected = selected === item.id;
        const outline = isSelected ? "outline-2 outline-dashed outline-accent outline-offset-2" : "";
        const removeButton = isSelected && editing !== item.id && deleteButton(item);
        // Moved down by the growth of retyped lines above it (stored unshifted).
        const d = down(anchorOf(item));

        if (item.kind === "draw" || item.kind === "line" || item.kind === "arrow") {
            const box = bounds(item);
            const points =
                item.kind === "draw"
                    ? item.points.map(([x, y]) => `${x * pageWidth},${(y + d) * pageHeight}`).join(" ")
                    : `${item.x1 * pageWidth},${(item.y1 + d) * pageHeight} ${item.x2 * pageWidth},${(item.y2 + d) * pageHeight}`;
            const marker = `arrow-${item.id}`;
            return (
                <div key={item.id} className="absolute inset-0 pointer-events-none">
                    <svg viewBox={`0 0 ${pageWidth} ${pageHeight}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
                        {item.kind === "arrow" && (
                            <defs>
                                <marker id={marker} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                                    <path d="M0,0 L10,5 L0,10 z" fill={item.color} />
                                </marker>
                            </defs>
                        )}
                        <polyline
                            points={points}
                            fill="none"
                            stroke={item.color}
                            strokeWidth={item.stroke}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            markerEnd={item.kind === "arrow" ? `url(#${marker})` : undefined}
                        />
                        <polyline
                            points={points}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={Math.max(item.stroke, 12 / scale)}
                            strokeLinecap="round"
                            className={interactive ? "cursor-move" : ""}
                            style={{ pointerEvents: interactive ? "stroke" : "none" }}
                            onPointerDown={(event) => handleItemDown(event, item)}
                        />
                    </svg>
                    {isSelected && (
                        <div
                            className={`absolute ${outline}`}
                            style={{ left: `${box.x * 100}%`, top: `${(box.y + d) * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
                        >
                            {removeButton}
                        </div>
                    )}
                </div>
            );
        }

        if (item.kind === "text" && item.source && isCollapsed(item, editing)) {
            // A deleted line: its space is gone. A slim marker lets people type it back.
            const source = item.source;
            return (
                <div
                    key={item.id}
                    title="Line deleted. Click to type it again."
                    onPointerDown={(event) => {
                        if (event.button > 0) return;
                        event.stopPropagation();
                        event.preventDefault();
                        if (editing !== null) stopEditing();
                        startEditing(item.id);
                    }}
                    className="absolute h-1.5 -translate-y-full rounded-full border border-dashed border-danger/60 bg-danger-soft/70 cursor-pointer hover:bg-danger-soft"
                    // Where the removed slot began: now the seam between the lines around it.
                    style={{ left: `${source.x * 100}%`, width: `${source.w * 100}%`, top: topOf(flowCut(source) - (COLLAPSE_TOP * item.size) / pageHeight) }}
                />
            );
        }

        if (item.kind === "text") {
            const isEditing = editing === item.id;
            const { offset, css } = textStyle(item.font, item.size, item.color, item.text);
            const wraps = Boolean(item.width);
            const source = item.source;
            // The page opens below the line's whole row; usually that's under the box itself.
            const cut = source ? Math.min(rowCut(item), source.y + source.h) : 0;
            // Each piece of the cover moves with the band holding the middle of what it covers.
            const mask = (top: number, bottom: number) =>
                source && (
                    <div
                        className="absolute pointer-events-none"
                        style={{
                            left: `${source.x * 100}%`,
                            top: `${(top + down((top + bottom) / 2)) * 100}%`,
                            width: `${source.w * 100}%`,
                            height: `${(bottom - top) * 100}%`,
                            background: item.background ?? "#ffffff",
                        }}
                    />
                );
            return (
                <div key={item.id}>
                    {/* Hide the original line (split only if the page opens inside it). */}
                    {source && mask(source.y, cut)}
                    {source && cut < source.y + source.h && mask(cut + 0.000001, source.y + source.h)}
                    <div
                        ref={source ? measureText : undefined}
                        data-id={item.id}
                        data-size={item.size}
                        onPointerDown={(event) => handleItemDown(event, item)}
                        className={`absolute ${wraps ? "whitespace-pre-wrap" : "whitespace-pre"} ${outline} ${
                            isEditing ? "cursor-text" : interactive ? "cursor-move" : ""
                        } ${!isSelected && interactive ? "hover:outline-1 hover:outline-dashed hover:outline-accent/60" : ""}`}
                        style={{
                            left: `${item.x * 100}%`,
                            top: `calc(${(item.baseline + d) * 100}% - ${offset}px)`,
                            width: wraps ? `${(item.width ?? 0) * 100}%` : undefined,
                            ...css,
                        }}
                    >
                        {isEditing ? (
                            <span className={`${wraps ? "grid w-full" : "inline-grid"} align-top`}>
                                <span aria-hidden className={`invisible col-start-1 row-start-1 ${wraps ? "whitespace-pre-wrap" : "whitespace-pre"}`}>
                                    {item.text + " "}
                                </span>
                                <textarea
                                    autoFocus
                                    value={item.text}
                                    rows={1}
                                    wrap={wraps ? "soft" : "off"}
                                    placeholder="Type here"
                                    aria-label="Text"
                                    onChange={(event) => update(item.id, { text: event.target.value })}
                                    onBlur={stopEditing}
                                    onFocus={(event) => {
                                        if (!item.source) return;
                                        const end = event.currentTarget.value.length;
                                        event.currentTarget.setSelectionRange(end, end);
                                    }}
                                    className="col-start-1 row-start-1 resize-none overflow-hidden bg-accent-soft/40 outline-none border-0 p-0 m-0 min-w-[2ch] placeholder:text-ink-3"
                                    style={{ font: "inherit", lineHeight: "inherit", color: "inherit", letterSpacing: "inherit" }}
                                />
                            </span>
                        ) : (
                            item.text || " "
                        )}
                        {removeButton}
                    </div>
                </div>
            );
        }

        if (item.kind === "note") {
            return (
                <div
                    key={item.id}
                    onPointerDown={(event) => handleItemDown(event, item)}
                    title={item.text || "Empty note"}
                    className={`absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-md shadow flex items-center justify-center ${outline} ${
                        interactive ? "cursor-move" : "pointer-events-none"
                    }`}
                    style={{ left: `${item.x * 100}%`, top: `${(item.y + d) * 100}%`, background: item.color }}
                >
                    <MessageSquare className="w-3.5 h-3.5 text-ink" aria-hidden />
                    {removeButton}
                </div>
            );
        }

        const shape = item as BoxItem | ImageItem;
        const position = { left: `${shape.x * 100}%`, top: `${(shape.y + d) * 100}%`, width: `${shape.w * 100}%`, height: `${shape.h * 100}%` };
        let look: React.CSSProperties = {};
        if (item.kind === "whiteout") look = { background: item.color, boxShadow: "inset 0 0 0 1px rgba(22, 24, 29, 0.12)" };
        else if (item.kind === "highlight") look = { background: item.color, mixBlendMode: "multiply" };
        else if (item.kind === "underline") look = { borderBottom: `${Math.max(1.5, 1.5 * scale)}px solid ${item.color}` };
        else if (item.kind === "strikeout") look = { backgroundImage: `linear-gradient(${item.color}, ${item.color})`, backgroundSize: `100% ${Math.max(1.5, 1.5 * scale)}px`, backgroundPosition: "center", backgroundRepeat: "no-repeat" };
        else if (item.kind === "rect" || item.kind === "ellipse") {
            look = {
                border: `${Math.max(item.stroke * scale, 1)}px solid ${item.color}`,
                background: item.fill ?? "transparent",
                borderRadius: item.kind === "ellipse" ? "50%" : undefined,
            };
        } else if (item.kind === "link") look = { background: "rgba(39, 72, 214, 0.08)", outline: "1.5px dashed #2748d6" };

        return (
            <div
                key={item.id}
                onPointerDown={(event) => handleItemDown(event, item)}
                className={`absolute ${outline} ${interactive ? "cursor-move" : "pointer-events-none"}`}
                style={{ ...position, ...look }}
            >
                {item.kind === "image" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt="" draggable={false} className="w-full h-full" />
                )}
                {item.kind === "link" && (
                    <span className="absolute -top-5 left-0 text-[10px] font-medium bg-accent text-white rounded px-1 whitespace-nowrap max-w-full truncate">
                        {item.url || "Add a link"}
                    </span>
                )}
                {removeButton}
                {isSelected && item.kind !== "link" && (
                    <span
                        role="presentation"
                        onPointerDown={(event) => handleResizeDown(event, shape)}
                        className="absolute -bottom-2 -right-2 w-4 h-4 rounded-sm bg-white border-2 border-accent cursor-nwse-resize"
                    />
                )}
            </div>
        );
    }

    /**
     * The page image cut into bands where retyped lines grew: each band moves
     * down by the growth above it, and the new space takes the colour behind
     * the line, the same way the saved PDF opens up.
     */
    function renderBands(image: string) {
        const parts: ReactNode[] = [];
        let top = 0;
        let moved = 0;
        // A deleted line's band (negative flow) is skipped, so what follows closes up.
        [...flows, { cut: 1, grow: 0, background: "" }].forEach((flow, index) => {
            if (flow.cut > top) {
                const band = flow.cut - top;
                parts.push(
                    <div
                        key={`band-${index}`}
                        className="absolute inset-x-0 overflow-hidden pointer-events-none"
                        style={{ top: `${(top + moved / pageHeight) * 100}%`, height: `${band * 100}%` }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={image}
                            alt=""
                            draggable={false}
                            className="absolute left-0 w-full max-w-none"
                            style={{ top: `${(-top / band) * 100}%`, height: `${100 / band}%` }}
                        />
                    </div>
                );
            }
            if (flow.grow > 0) {
                parts.push(
                    <div
                        key={`gap-${index}`}
                        className="absolute inset-x-0 pointer-events-none"
                        style={{ top: `${(flow.cut + moved / pageHeight) * 100}%`, height: `${(flow.grow / pageHeight) * 100}%`, background: flow.background }}
                    />
                );
            }
            moved += flow.grow;
            top = Math.max(top, flow.grow < 0 ? flow.cut - flow.grow / pageHeight : flow.cut);
        });
        return parts;
    }

    /** Lines on this page changed by find & replace, shown as they will be saved. */
    function renderReplacements() {
        if (!replaces.length) return null;
        return lines.map((line) => {
            const text = replacedText(line);
            if (text === null) return null;
            const { offset, css } = textStyle(line.font, line.size, line.color, text);
            const d = down(lineMiddle(line));
            return (
                <div key={`replace-${sourceKey(line)}`}>
                    <div
                        className="absolute pointer-events-none"
                        style={{ left: `${line.x * 100}%`, top: `${(line.y + d) * 100}%`, width: `${line.w * 100}%`, height: `${line.h * 100}%`, background: "#ffffff" }}
                    />
                    <div
                        className="absolute whitespace-pre outline-1 outline-dashed outline-[#e8287a]/60 cursor-text"
                        title="Changed by find & replace. Click to edit."
                        onPointerDown={(event) => editLine(event, line, replacedText(line) ?? line.text)}
                        style={{ left: `${line.x * 100}%`, top: `calc(${(line.baseline + d) * 100}% - ${offset}px)`, ...css }}
                    >
                        {text}
                    </div>
                </div>
            );
        });
    }

    const kind: string = placed ? placed.kind : mode;
    const isTextOptions = kind === "text" || kind === "edit";
    const isStrokeOptions = ["draw", "line", "arrow", "rect", "ellipse"].includes(kind);
    const isMarkupOptions = ["highlight", "underline", "strikeout"].includes(kind);
    const textFont = placed?.kind === "text" ? placed.font : newTextStyle.font;
    const textSize = placed?.kind === "text" ? placed.size : newTextStyle.size;
    const textColor = placed?.kind === "text" ? placed.color : style.color;
    const fontValue = (font: FontSpec) => (docFonts.has(fontKey(font)) ? `doc:${fontKey(font)}` : `fam:${font.family}|${font.generic}`);
    const docFontList = [...docFonts.values()].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight);
    const cursor = mode === "text" || mode === "edit" ? "cursor-text" : mode === "select" ? "cursor-default" : "cursor-crosshair";

    function pickFont(value: string) {
        if (value.startsWith("doc:")) {
            const font = docFonts.get(value.slice(4));
            if (font) applyText({ font });
        } else if (value === "other") {
            const name = window.prompt("Type the name of any Google Font, for example “Nunito” or “Source Serif 4”.")?.trim();
            if (name && /^[A-Za-z0-9 ]{1,60}$/.test(name)) {
                applyText({ font: { ref: null, refPage: null, family: name, weight: textFont.weight, italic: textFont.italic, generic: textFont.generic } });
            }
        } else {
            const [family, generic] = value.slice(4).split("|");
            applyText({ font: withStyle({ ...textFont, family, generic: generic as FontSpec["generic"], ref: null, refPage: null }, textFont.weight, textFont.italic) });
        }
    }

    const optionsBar = (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line mt-1.5 pt-2 px-1.5 pb-0.5 min-h-10">
            {isTextOptions && (
                <>
                    <select value={fontValue(textFont)} onChange={(event) => pickFont(event.target.value)} aria-label="Font" className="input py-1! w-auto! max-w-56 text-sm!">
                        {docFontList.length > 0 && (
                            <optgroup label="In this PDF">
                                {docFontList.map((font) => (
                                    <option key={fontKey(font)} value={`doc:${fontKey(font)}`}>
                                        {font.family}
                                        {font.weight >= 600 ? " Bold" : font.weight <= 300 ? " Light" : ""}
                                        {font.italic ? " Italic" : ""}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                        <optgroup label="Other fonts">
                            {!docFonts.has(fontKey(textFont)) && !FONT_CHOICES.some((choice) => choice.family === textFont.family) && (
                                <option value={`fam:${textFont.family}|${textFont.generic}`}>{textFont.family}</option>
                            )}
                            {FONT_CHOICES.map((choice) => (
                                <option key={choice.family} value={`fam:${choice.family}|${choice.generic}`}>
                                    {choice.family}
                                </option>
                            ))}
                            <option value="other">Any Google Font…</option>
                        </optgroup>
                    </select>
                    <label className="flex items-center gap-1.5 text-sm text-ink-2">
                        Size
                        <input
                            type="number"
                            min={4}
                            max={200}
                            step={0.5}
                            value={Math.round(textSize * 10) / 10}
                            onChange={(event) => {
                                const size = Number(event.target.value);
                                if (size >= 4 && size <= 200) applyText({ size });
                            }}
                            className="input py-1! w-18! text-sm!"
                        />
                    </label>
                    <div className="flex items-center gap-0.5">
                        <ToolbarButton
                            label="Bold"
                            showLabel={false}
                            active={textFont.weight >= 600}
                            onClick={() => applyText({ font: withStyle(textFont, textFont.weight >= 600 ? 400 : 700, textFont.italic) })}
                        >
                            <Bold className="w-4 h-4" aria-hidden />
                        </ToolbarButton>
                        <ToolbarButton
                            label="Italic"
                            showLabel={false}
                            active={textFont.italic}
                            onClick={() => applyText({ font: withStyle(textFont, textFont.weight, !textFont.italic) })}
                        >
                            <Italic className="w-4 h-4" aria-hidden />
                        </ToolbarButton>
                    </div>
                    <Swatches label="Text colour" colors={INK} value={textColor} onChange={(color) => color && applyText({ color })} />
                </>
            )}
            {isStrokeOptions && (
                <>
                    <Swatches
                        label="Colour"
                        colors={INK}
                        value={placed && "color" in placed ? placed.color : style.color}
                        onChange={(color) => color && applyShape({ color })}
                    />
                    <label className="flex items-center gap-2 text-sm text-ink-2">
                        Thickness
                        <input
                            type="range"
                            min={0.5}
                            max={12}
                            step={0.5}
                            value={placed && "stroke" in placed ? placed.stroke : style.stroke}
                            onChange={(event) => applyShape({ stroke: Number(event.target.value) })}
                            className="accent-accent w-24"
                        />
                    </label>
                    {(kind === "rect" || kind === "ellipse") && (
                        <span className="flex items-center gap-2 text-sm text-ink-2">
                            Fill
                            <Swatches
                                label="Fill"
                                colors={FILLS}
                                allowNone
                                value={placed && placed.kind !== "text" && "fill" in placed ? placed.fill : style.fill}
                                onChange={(fill) => applyShape({ fill })}
                            />
                        </span>
                    )}
                </>
            )}
            {isMarkupOptions && (
                <Swatches
                    label="Colour"
                    colors={MARKUP}
                    value={placed && "color" in placed ? placed.color : style.markup}
                    onChange={(markup) => markup && applyShape({ markup })}
                />
            )}
            {placed?.kind === "note" && (
                <>
                    <Swatches label="Note colour" colors={["#ffd43b", "#8ce99a", "#74c0fc", "#faa2c1"]} value={placed.color} onChange={(color) => color && applyShape({ color })} />
                    <textarea
                        autoFocus={focusField === "note"}
                        onFocus={startFieldEdit}
                        value={placed.text}
                        onChange={(event) => update(placed.id, { text: event.target.value })}
                        onBlur={endFieldEdit}
                        placeholder="Write your comment"
                        aria-label="Note text"
                        rows={1}
                        className="input py-1! text-sm! flex-1 min-w-48 resize-y"
                    />
                </>
            )}
            {placed?.kind === "link" && (
                <label className="flex items-center gap-2 text-sm text-ink-2 flex-1 min-w-60">
                    Opens
                    <input
                        autoFocus={focusField === "link"}
                        onFocus={startFieldEdit}
                        onBlur={endFieldEdit}
                        value={placed.url ?? ""}
                        onChange={(event) => update(placed.id, { url: event.target.value })}
                        placeholder="https://example.com or name@example.com"
                        aria-label="Link address"
                        className={`input py-1! text-sm! flex-1 ${placed.url && !normaliseUrl(placed.url) ? "border-danger!" : ""}`}
                    />
                </label>
            )}
            {!isTextOptions && !isStrokeOptions && !isMarkupOptions && placed?.kind !== "note" && placed?.kind !== "link" && (
                <span className="text-sm text-ink-3">{MODE_INFO[mode].hint}</span>
            )}
            {(isTextOptions || isStrokeOptions || isMarkupOptions) && !placed && (
                <span className="text-sm text-ink-3 hidden 2xl:inline">{MODE_INFO[mode].hint}</span>
            )}
        </div>
    );

    return (
        <div className="mt-6">
            {/* Toolbar */}
            <div className="sticky top-19 z-30 card shadow-[0_12px_30px_-20px_rgba(10,12,30,0.45)] p-1.5">
                <div className="flex items-center gap-1 overflow-x-auto">
                    {GROUPS.map((group) => (
                        <ToolGroup
                            key={group.label}
                            label={group.label}
                            modes={group.modes}
                            mode={mode}
                            onPick={(next) => {
                                stopEditing();
                                setMode(next);
                                setSelected(null);
                            }}
                        />
                    ))}
                    <ToolbarButton label="Image" onClick={() => fileInput.current?.click()}>
                        <ImagePlus className="w-4 h-4" aria-hidden />
                    </ToolbarButton>
                    <ToolGroup label="Select" modes={["select"]} mode={mode} onPick={(next) => { stopEditing(); setMode(next); }} />
                    <span className="w-px h-6 bg-line mx-1 shrink-0" aria-hidden />
                    <ToolbarButton label="Find & replace" active={findOpen} onClick={() => setFindOpen(!findOpen)}>
                        <Replace className="w-4 h-4" aria-hidden />
                    </ToolbarButton>
                    <ToolbarButton label="Undo" showLabel={false} disabled={!past.length} onClick={undo}>
                        <Undo2 className="w-4 h-4" aria-hidden />
                    </ToolbarButton>
                    <ToolbarButton label="Redo" showLabel={false} disabled={!future.length} onClick={redo}>
                        <Redo2 className="w-4 h-4" aria-hidden />
                    </ToolbarButton>
                    <ToolbarButton label="Delete" showLabel={false} disabled={!placed} onClick={() => placed && remove(placed.id)}>
                        <Trash className="w-4 h-4" aria-hidden />
                    </ToolbarButton>
                    <input ref={fileInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={pickImage} />
                </div>
                {optionsBar}
            </div>

            {findOpen && (
                <div className="card mt-3 p-4 rise">
                    <div className="flex flex-col md:flex-row md:items-end gap-3">
                        <label className="flex-1 text-sm">
                            <span className="text-ink-2">Find</span>
                            <input
                                autoFocus
                                value={find}
                                onChange={(event) => {
                                    setFind(event.target.value);
                                    setFound(null);
                                }}
                                onKeyDown={(event) => event.key === "Enter" && runSearch()}
                                className="input mt-1"
                                placeholder="Word or phrase"
                            />
                        </label>
                        <label className="flex-1 text-sm">
                            <span className="text-ink-2">Replace with</span>
                            <input value={replaceWith} onChange={(event) => setReplaceWith(event.target.value)} className="input mt-1" placeholder="Leave empty to delete it" />
                        </label>
                        <label className="flex items-center gap-2 text-sm text-ink-2 md:pb-2.5">
                            <input type="checkbox" checked={matchCase} onChange={(event) => { setMatchCase(event.target.checked); setFound(null); }} className="accent-accent" />
                            Match case
                        </label>
                        <div className="flex gap-2">
                            <button type="button" onClick={runSearch} disabled={!find.trim() || searching} className="btn btn-ghost">
                                {searching ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : "Find"}
                            </button>
                            <button type="button" onClick={replaceAll} disabled={!find.trim() || (found !== null && found.total === 0)} className="btn btn-dark">
                                Replace all
                            </button>
                        </div>
                    </div>
                    {found && (
                        <div className="mt-3 text-sm text-ink-2">
                            {found.total === 0 ? (
                                "No matches in this PDF."
                            ) : (
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="mr-1">
                                        {found.total} match{found.total === 1 ? "" : "es"} on {found.matches.length} page{found.matches.length === 1 ? "" : "s"}:
                                    </span>
                                    {found.matches.slice(0, 40).map((match) => (
                                        <button key={match.page} type="button" onClick={() => goTo(match.page)} className="px-2 py-0.5 rounded-full bg-surface-2 hover:bg-accent-soft hover:text-accent">
                                            p{match.page}
                                            {match.count > 1 ? ` ×${match.count}` : ""}
                                        </button>
                                    ))}
                                    {found.matches.length > 40 && <span>and {found.matches.length - 40} more pages</span>}
                                </div>
                            )}
                        </div>
                    )}
                    {replaces.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-2">
                            {replaces.map((rule) => (
                                <li key={rule.id} className="inline-flex items-center gap-2 text-sm rounded-full bg-accent-soft text-accent pl-3 pr-1 py-1">
                                    “{rule.find}” → “{rule.replace}”{rule.count ? `, ${rule.count} matches` : ""}
                                    <button type="button" aria-label="Remove this rule" onClick={() => remove(rule.id)} className="w-5 h-5 rounded-full hover:bg-white flex items-center justify-center">
                                        <X className="w-3 h-3" aria-hidden />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-xs text-ink-3 mt-3">Replacements apply to every page and keep each line&apos;s own font.</p>
                </div>
            )}

            {notice && (
                <p className="mt-3 rounded-xl bg-warning-soft text-warning px-4 py-2.5 text-sm flex items-center justify-between gap-3" role="alert">
                    {notice}
                    <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
                        <X className="w-4 h-4" aria-hidden />
                    </button>
                </p>
            )}

            {/* Page navigation and page actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 mb-2">
                <div className="flex items-center gap-1">
                    <button type="button" disabled={page <= 1} onClick={() => goTo(page - 1)} aria-label="Previous page" className="btn btn-ghost p-1.5!">
                        <ChevronLeft className="w-4 h-4" aria-hidden />
                    </button>
                    <span className="text-sm text-ink-2 tabular-nums px-1 flex items-center gap-1.5">
                        Page
                        <input
                            value={pageInput}
                            onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
                            onBlur={() => goTo(Number(pageInput) || page)}
                            onKeyDown={(event) => event.key === "Enter" && goTo(Number(pageInput) || page)}
                            aria-label="Go to page"
                            inputMode="numeric"
                            className="input py-0.5! px-1.5! w-14! text-center text-sm!"
                        />
                        of {pageCount}
                    </span>
                    <button type="button" disabled={page >= pageCount} onClick={() => goTo(page + 1)} aria-label="Next page" className="btn btn-ghost p-1.5!">
                        <ChevronRight className="w-4 h-4" aria-hidden />
                    </button>
                </div>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => rotatePage(page)} aria-label="Rotate page" className="btn btn-ghost py-1.5! text-sm!">
                        <RotateCw className="w-4 h-4" aria-hidden />
                        <span className="hidden sm:inline">Rotate page</span>
                    </button>
                    <button type="button" onClick={() => toggleDeletePage(page)} aria-label={pageDeleted ? "Keep page" : "Delete page"} className="btn btn-ghost py-1.5! text-sm!">
                        <Trash className="w-4 h-4" aria-hidden />
                        <span className="hidden sm:inline">{pageDeleted ? "Keep page" : "Delete page"}</span>
                    </button>
                    <span className="text-sm text-ink-3 tabular-nums ml-2">
                        {items.length === 0 ? "No changes yet" : `${items.length} change${items.length === 1 ? "" : "s"}`}
                    </span>
                </div>
            </div>

            {pageError && (
                <div className="mb-3 rounded-xl bg-danger-soft text-danger px-4 py-3 text-sm flex items-center justify-between gap-3" role="alert">
                    {pageError}
                    <button type="button" onClick={onReset} className="btn btn-dark py-1.5! text-sm!">
                        Open a PDF again
                    </button>
                </div>
            )}
            {mode === "edit" && data && !(data.lines ?? []).length && (
                <p className="mb-3 rounded-xl bg-surface-2 text-ink-2 px-4 py-2.5 text-sm">
                    This page has no editable text. It may be a scan: use <strong>White-out</strong> to hide something, then <strong>Add text</strong> on top.
                </p>
            )}

            <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-start">
                {/* The page */}
                <div className="rounded-2xl bg-surface-2 border border-line p-3 sm:p-6">
                    <div
                        ref={stageRef}
                        data-testid="edit-stage"
                        onPointerDown={handleStageDown}
                        onPointerMove={handleStageMove}
                        onPointerUp={handleStageUp}
                        onPointerCancel={handleStageUp}
                        className={`relative mx-auto bg-white shadow-[0_10px_30px_-12px_rgba(10,12,30,0.35)] select-none touch-none ${cursor}`}
                        style={{ aspectRatio: `${pageWidth} / ${pageHeight}`, maxWidth: 820, marginBottom: `${totalGrow * scale}px` }}
                    >
                        {data ? (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    ref={pageImage}
                                    src={data.image}
                                    alt={`Page ${page}`}
                                    draggable={false}
                                    className={`block w-full h-full pointer-events-none ${flows.length ? "invisible" : ""}`}
                                />
                                {flows.length > 0 && renderBands(data.image)}
                            </>
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center" role="status">
                                <Loader2 className="w-6 h-6 text-accent animate-spin" aria-label="Loading page" />
                            </div>
                        )}
                        {data && mode === "edit" &&
                            lines.map((line) =>
                                replaces.length && replacedText(line) !== null ? null : (
                                    <div
                                        key={sourceKey(line)}
                                        title="Click to edit"
                                        onPointerDown={(event) => editLine(event, line)}
                                        className="absolute rounded-xs cursor-text outline-1 outline-dashed outline-accent/25 hover:outline-accent hover:bg-accent/10 transition-colors"
                                        style={{ left: `${line.x * 100}%`, top: `${(line.y + down(lineMiddle(line))) * 100}%`, width: `${line.w * 100}%`, height: `${line.h * 100}%` }}
                                    />
                                )
                            )}
                        {pageGrows && (
                            <span className="absolute -bottom-7 left-0 right-0 text-center text-xs text-ink-3 pointer-events-none">
                                The page gets taller to fit your new lines.
                            </span>
                        )}
                        {data && renderReplacements()}
                        {data && pageItems.map(renderItem)}
                        {rotationOf(page) > 0 && (
                            <span className="absolute top-2 left-2 text-xs font-medium bg-ink/85 text-white rounded-full px-2.5 py-1 flex items-center gap-1 pointer-events-none">
                                <RotateCw className="w-3 h-3" aria-hidden />
                                Turns {rotationOf(page)}° when saved
                            </span>
                        )}
                        {pageDeleted && (
                            <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center gap-3 text-center p-4">
                                <Trash className="w-8 h-8 text-danger" aria-hidden />
                                <p className="font-medium">This page will be deleted when you save.</p>
                                <button type="button" onClick={() => toggleDeletePage(page)} className="btn btn-ghost">
                                    Keep this page
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Every page, loaded as it scrolls into view */}
                {pageCount > 1 && (
                    <ol className="hidden lg:flex flex-col gap-2 max-h-[80vh] overflow-y-auto pr-1 w-28" aria-label="Pages">
                        {meta.pages.map(([width, height], index) => {
                            const number = index + 1;
                            return (
                                <li key={number}>
                                    <Thumb
                                        number={number}
                                        ratio={width / height}
                                        image={thumbs.get(number)}
                                        active={number === page}
                                        count={changesOn(number)}
                                        rotation={rotationOf(number)}
                                        deleted={deletedPages.has(number)}
                                        onVisible={requestThumb}
                                        onOpen={goTo}
                                    />
                                </li>
                            );
                        })}
                    </ol>
                )}
            </div>

            <FormError run={run} />
            <button type="button" onClick={save} className="btn btn-primary btn-lg w-full mt-6">
                Save my edited PDF
            </button>
            <p className="text-xs text-ink-3 mt-3 text-center">
                Tips: Ctrl+Z undoes, Ctrl+F finds and replaces, Page Up and Page Down turn pages. Retyped text keeps the PDF&apos;s own font.
            </p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Opening a PDF
// ---------------------------------------------------------------------------

export function EditTool() {
    const run = useToolJob("/tools/edit/");
    const [file, setFile] = useState<File | null>(null);
    const [meta, setMeta] = useState<Session | null>(null);
    const [progress, setProgress] = useState<number | null>(null);
    const [version, setVersion] = useState(0);
    const opening = useRef(0);

    function reset() {
        opening.current += 1;
        setFile(null);
        setMeta(null);
        setProgress(null);
        setVersion((value) => value + 1);
        run.reset();
    }

    async function choose(picked: File) {
        const attempt = ++opening.current;
        run.setError(null);
        setFile(picked);
        setProgress(0);
        try {
            const opened = await openSession(picked, setProgress);
            if (attempt !== opening.current) return;
            setMeta(opened);
        } catch (error: unknown) {
            if (attempt !== opening.current) return;
            setFile(null);
            run.setError(getErrorMessage(error, "This PDF could not be opened."));
        } finally {
            if (attempt === opening.current) setProgress(null);
        }
    }

    return (
        <ToolLayout slug="edit-pdf" run={run} wide="xl" persistent onReset={reset}>
            {file ? (
                <>
                    <FileCard file={file} detail={meta ? `${meta.pages.length} page${meta.pages.length === 1 ? "" : "s"}` : undefined} onRemove={reset} />
                    {progress !== null && (
                        <div className="card mt-6 p-10 text-center" role="status">
                            <Loader2 className="w-7 h-7 text-accent animate-spin mx-auto mb-3" aria-hidden />
                            <p className="text-sm text-ink-2">{progress < 100 ? `Uploading… ${progress}%` : "Opening your PDF in the editor…"}</p>
                        </div>
                    )}
                    {meta && <Editor key={`${meta.session}-${version}`} meta={meta} run={run} onReset={reset} />}
                </>
            ) : (
                <>
                    <FilePicker extensions={[".pdf"]} label="Choose a PDF" onFiles={([picked]) => choose(picked)} onError={run.setError} />
                    <FormError run={run} />
                </>
            )}
        </ToolLayout>
    );
}
