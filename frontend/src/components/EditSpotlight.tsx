import Link from "next/link";
import {
    ArrowRight,
    Eraser,
    FilePen,
    Highlighter,
    ImagePlus,
    Infinity as InfinityIcon,
    MousePointer2,
    Pencil,
    Replace,
    TextCursorInput,
    Type,
} from "lucide-react";

const FEATURES = [
    { icon: TextCursorInput, text: "Retype text in the PDF’s own font" },
    { icon: Replace, text: "Find & replace on every page" },
    { icon: Type, text: "Add text, notes and links" },
    { icon: Highlighter, text: "Highlight, draw, shapes, arrows" },
    { icon: ImagePlus, text: "Insert images, white out mistakes" },
    { icon: InfinityIcon, text: "Any number of pages. No watermark" },
];

/** A drawing of the editor at work: a line being retyped, a highlight and a pen mark. */
function EditorArt() {
    const tools = [TextCursorInput, Type, Pencil, Highlighter, Eraser, ImagePlus];
    return (
        <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
            <div className="float-slow rounded-2xl bg-white text-ink shadow-[0_40px_80px_-30px_rgba(0,0,0,0.75)] overflow-hidden rotate-[-1.5deg]">
                <div className="flex items-center gap-1 px-3 py-2 border-b border-line bg-surface-2">
                    {tools.map((Icon, index) => (
                        <span
                            key={index}
                            className={`w-7 h-7 rounded-md inline-flex items-center justify-center ${index === 0 ? "bg-ink text-white" : "text-ink-3"}`}
                        >
                            <Icon className="w-3.5 h-3.5" />
                        </span>
                    ))}
                    <span className="ml-auto text-[10px] font-semibold text-ink-3">invoice.pdf</span>
                </div>
                <div className="p-6 sm:p-8 space-y-3 text-[13px]">
                    <div className="h-3 w-24 rounded bg-ink/80" />
                    <div className="h-2 w-40 rounded bg-ink/15" />
                    <div className="pt-3 space-y-2">
                        <div className="h-2 w-full rounded bg-ink/15" />
                        <div className="relative">
                            <span className="absolute -inset-x-1 -inset-y-0.5 rounded bg-[#ffd43b]/60" />
                            <div className="relative h-2 w-11/12 rounded bg-ink/20" />
                        </div>
                        <div className="h-2 w-4/5 rounded bg-ink/15" />
                    </div>
                    <div className="relative mt-4 inline-flex items-center rounded-sm outline-2 outline-dashed outline-[#e8287a] outline-offset-4 bg-[#fde7f1]/70 px-1 font-semibold">
                        Total due: <span className="line-through text-ink-3 mx-1.5 font-normal">$100</span>
                        <span className="text-[#d92d20]">$250</span>
                        <span className="caret ml-0.5 w-px h-4 bg-ink" />
                    </div>
                    <div className="pt-2 space-y-2">
                        <div className="h-2 w-full rounded bg-ink/15" />
                        <div className="h-2 w-2/3 rounded bg-ink/15" />
                    </div>
                    <svg viewBox="0 0 160 40" className="w-36 h-9 mt-2">
                        <path
                            d="M4 30 C 20 4, 30 4, 36 24 S 54 38, 62 16 S 84 2, 92 22 S 118 34, 132 12 L 154 20"
                            fill="none"
                            stroke="#2748d6"
                            strokeWidth="3"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>
            </div>

            <span className="float absolute -top-4 -right-2 sm:-right-4 rotate-[8deg] free-badge rounded-2xl px-4 py-2 text-white text-center shadow-xl">
                <span className="block text-2xl font-bold leading-none">FREE</span>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-white/85 mt-0.5">usually paid</span>
            </span>
            <span className="float float-delay absolute -bottom-5 left-4 sm:-left-5 glass rounded-xl px-3 py-2 text-xs font-medium text-ink flex items-center gap-2">
                <MousePointer2 className="w-3.5 h-3.5 text-[#e8287a]" />
                Click any line to edit it
            </span>
        </div>
    );
}

export default function EditSpotlight() {
    return (
        <section aria-labelledby="edit-spotlight" className="pt-20 md:pt-24">
            <div className="featured-frame rounded-4xl">
                <div className="edit-spotlight relative overflow-hidden rounded-[calc(2rem-2px)] grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-10 items-center px-6 py-10 sm:p-10 md:p-14">
                    <div className="hero-grid opacity-50" aria-hidden />
                    <div className="relative">
                        <span className="glass-dark inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/85">
                            <span className="relative flex w-2 h-2" aria-hidden>
                                <span className="ping-soft absolute inset-0 rounded-full bg-[#ff5fa2]" />
                                <span className="relative w-2 h-2 rounded-full bg-[#ff5fa2]" />
                            </span>
                            New: free PDF editor
                        </span>
                        <h2 id="edit-spotlight" className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight mt-5 leading-[1.02]">
                            Edit any PDF.
                            <br />
                            <span className="text-hot">Pay nothing.</span>
                        </h2>
                        <p className="text-white/70 text-lg mt-5 max-w-lg leading-relaxed">
                            Most PDF apps charge a subscription to edit a PDF. Here it&apos;s free for everyone: change the
                            words already on the page in their original font, on documents of any length, and download
                            it with no watermark.
                        </p>
                        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mt-7">
                            {FEATURES.map(({ icon: Icon, text }) => (
                                <li key={text} className="flex items-center gap-2.5 text-sm text-white/85">
                                    <span className="w-7 h-7 shrink-0 rounded-lg glass-dark inline-flex items-center justify-center">
                                        <Icon className="w-3.5 h-3.5 text-[#ff9a5c]" aria-hidden />
                                    </span>
                                    {text}
                                </li>
                            ))}
                        </ul>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-9">
                            <Link
                                href="/tools/edit-pdf"
                                className="group btn btn-lg chip-featured whitespace-nowrap shrink-0 rounded-xl! font-semibold text-white! hover:brightness-110 transition-[filter]"
                            >
                                <FilePen className="w-5 h-5" aria-hidden />
                                Edit a PDF now
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden />
                            </Link>
                            <span className="text-sm text-white/55">No signup needed. Works on phone and desktop.</span>
                        </div>
                    </div>
                    <div className="relative px-2 sm:px-6 pb-4">
                        <EditorArt />
                    </div>
                </div>
            </div>
        </section>
    );
}
