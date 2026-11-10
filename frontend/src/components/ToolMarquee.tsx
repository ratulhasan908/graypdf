import Link from "next/link";
import { Tool, tools } from "@/lib/tools";

function Row({ items, reverse }: { items: Tool[]; reverse?: boolean }) {
    // The list is drawn twice so the loop is seamless; the copy is hidden from
    // screen readers and keyboard users, who get the full tool grid below.
    return (
        <div className="marquee-wrap overflow-hidden">
            <ul className={`marquee ${reverse ? "marquee-reverse" : ""}`}>
                {[0, 1].map((copy) =>
                    items.map((tool) => (
                        <li key={`${copy}-${tool.slug}`} aria-hidden={copy === 1 || undefined}>
                            <Link
                                href={`/tools/${tool.slug}`}
                                tabIndex={copy === 1 ? -1 : undefined}
                                className="glass-dark flex items-center gap-2.5 rounded-xl pl-2 pr-4 py-2 text-sm text-white/85 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
                            >
                                <span className={`chip-${tool.category} w-7 h-7 rounded-lg inline-flex items-center justify-center`}>
                                    <tool.icon className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden />
                                </span>
                                {tool.name}
                            </Link>
                        </li>
                    ))
                )}
            </ul>
        </div>
    );
}

export default function ToolMarquee() {
    const half = Math.ceil(tools.length / 2);
    return (
        <div className="space-y-3">
            <Row items={tools.slice(0, half)} />
            <Row items={tools.slice(half)} reverse />
        </div>
    );
}
