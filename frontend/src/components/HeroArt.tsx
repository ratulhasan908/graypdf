import { Check, FileStack, Minimize2, PenLine, ScanText } from "lucide-react";

/** Decorative hero illustration: a PDF with the results of a few tools floating around it. */
export default function HeroArt() {
    return (
        <div className="relative w-full max-w-115 aspect-[4/4.3] mx-auto select-none" aria-hidden>
            {/* back sheets */}
            <div className="absolute inset-x-[14%] top-[6%] bottom-[10%] rounded-2xl bg-white/60 border border-line rotate-[7deg]" />
            <div className="absolute inset-x-[14%] top-[6%] bottom-[10%] rounded-2xl bg-white/80 border border-line rotate-3" />

            {/* front page */}
            <div className="absolute inset-x-[14%] top-[6%] bottom-[10%] rounded-2xl bg-white border border-line shadow-[0_30px_60px_-30px_rgba(22,24,29,0.45)] -rotate-2 p-[7%] flex flex-col">
                <div className="flex items-center justify-between">
                    <span className="h-3 w-24 rounded-full bg-ink" />
                    <span className="text-[10px] font-semibold tracking-wider text-white bg-accent rounded px-1.5 py-0.5">PDF</span>
                </div>
                <div className="mt-5 space-y-2">
                    <span className="block h-2 rounded-full bg-surface-2 w-full" />
                    <span className="block h-2 rounded-full bg-surface-2 w-[92%]" />
                    <span className="block h-2 rounded-full bg-surface-2 w-[80%]" />
                </div>
                <div className="mt-5 h-24 rounded-xl bg-accent-soft px-3 pt-3 flex items-end gap-2">
                    {[38, 58, 46, 74, 62, 90, 80].map((height, index) => (
                        <span
                            key={index}
                            className={`flex-1 rounded-t-md ${index === 5 ? "bg-accent" : "bg-accent/45"}`}
                            style={{ height: `${height}%` }}
                        />
                    ))}
                </div>
                <div className="mt-5 space-y-2">
                    <span className="block h-2 rounded-full bg-surface-2 w-full" />
                    <span className="block h-2 rounded-full bg-surface-2 w-[70%]" />
                </div>
                <div className="mt-auto flex items-end justify-between">
                    <svg viewBox="0 0 120 40" className="w-28 text-accent">
                        <path
                            d="M4 30c10-18 18-24 22-14s-6 18 2 12 12-22 18-16-2 18 6 12 10-14 16-10 4 10 12 6 14-8 30-10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                        />
                    </svg>
                    <span className="h-2 w-14 rounded-full bg-surface-2 mb-2" />
                </div>
            </div>

            {/* floating results */}
            <div className="glass absolute left-0 top-[14%] rounded-2xl px-3.5 py-3 flex items-center gap-3 float">
                <span className="chip-optimize w-9 h-9 rounded-xl flex items-center justify-center">
                    <Minimize2 className="w-4 h-4" />
                </span>
                <span>
                    <span className="block text-xs text-ink-3">Compressed</span>
                    <span className="block text-sm font-semibold">4.8 MB → 1.2 MB</span>
                </span>
            </div>

            <div className="glass absolute right-0 top-[34%] rounded-2xl px-3.5 py-3 flex items-center gap-3 float-slow float-delay">
                <span className="chip-organize w-9 h-9 rounded-xl flex items-center justify-center">
                    <FileStack className="w-4 h-4" />
                </span>
                <span>
                    <span className="block text-xs text-ink-3">Merged</span>
                    <span className="block text-sm font-semibold">3 files → 1 PDF</span>
                </span>
            </div>

            <div className="glass absolute left-[2%] bottom-[16%] rounded-2xl px-3.5 py-3 flex items-center gap-3 float-slow">
                <span className="chip-convert w-9 h-9 rounded-xl flex items-center justify-center">
                    <ScanText className="w-4 h-4" />
                </span>
                <span>
                    <span className="block text-xs text-ink-3">OCR · বাংলা</span>
                    <span className="block text-sm font-semibold">Text is searchable</span>
                </span>
            </div>

            <div className="glass absolute right-[4%] bottom-[2%] rounded-full pl-2 pr-4 py-2 flex items-center gap-2 float float-delay">
                <span className="chip-secure w-7 h-7 rounded-full flex items-center justify-center">
                    <PenLine className="w-3.5 h-3.5" />
                </span>
                <span className="text-sm font-semibold">Signed</span>
                <Check className="w-4 h-4 text-success" strokeWidth={2.5} />
            </div>
        </div>
    );
}
