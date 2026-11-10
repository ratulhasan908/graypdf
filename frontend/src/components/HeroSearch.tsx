"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { ToolIcon } from "@/components/ToolLayout";
import { getToolBySlug, popularSlugs, Tool, tools } from "@/lib/tools";

const popular = popularSlugs.map(getToolBySlug).filter((tool): tool is Tool => Boolean(tool));

/** "What do you want to do?" box in the hero: type, then jump straight to a tool. */
export default function HeroSearch() {
    const router = useRouter();
    const listId = useId();
    const input = useRef<HTMLInputElement>(null);
    const box = useRef<HTMLDivElement>(null);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);

    const results = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return popular;
        const words = needle.split(/\s+/);
        return tools
            .filter((tool) => {
                const text = `${tool.name} ${tool.description} ${tool.blurb}`.toLowerCase();
                return words.every((word) => text.includes(word));
            })
            .sort((a, b) => Number(!a.name.toLowerCase().includes(needle)) - Number(!b.name.toLowerCase().includes(needle)))
            .slice(0, 6);
    }, [query]);

    // Press "/" anywhere on the page to jump into the search.
    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            const target = event.target as HTMLElement;
            if (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && !target.isContentEditable) {
                event.preventDefault();
                input.current?.focus();
            }
        }
        function onClick(event: MouseEvent) {
            if (!box.current?.contains(event.target as Node)) setOpen(false);
        }
        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onClick);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("mousedown", onClick);
        };
    }, []);

    function go(tool: Tool | undefined) {
        if (tool) router.push(`/tools/${tool.slug}`);
    }

    function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, results.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
        } else if (event.key === "Enter") {
            event.preventDefault();
            go(results[active]);
        } else if (event.key === "Escape") {
            setOpen(false);
        }
    }

    const showList = open && results.length > 0;

    return (
        <div ref={box} className="relative w-full max-w-2xl mx-auto text-left">
            <div className="relative rounded-2xl p-[1.5px] bg-linear-to-r from-[#5b8cff] via-[#b48cff] to-[#ff8fc8] shadow-[0_20px_60px_-20px_rgba(91,140,255,0.7)] focus-within:ring-4 focus-within:ring-[#5b8cff]/35 transition-shadow">
                <div className="flex items-center gap-3 rounded-[15px] bg-white pl-4 pr-2 h-16">
                    <Search className="w-5 h-5 text-ink-3 shrink-0" aria-hidden />
                    <input
                        ref={input}
                        type="text"
                        role="combobox"
                        aria-label="What do you want to do with your PDF?"
                        aria-expanded={showList}
                        aria-controls={listId}
                        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
                        aria-autocomplete="list"
                        autoComplete="off"
                        value={query}
                        placeholder="Search tools, e.g. “compress”"
                        onFocus={() => setOpen(true)}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setActive(0);
                            setOpen(true);
                        }}
                        onKeyDown={onKeyDown}
                        className="flex-1 min-w-0 h-full bg-transparent text-ink text-base sm:text-lg placeholder:text-ink-3 outline-none focus-visible:outline-none"
                    />
                    <kbd className="hidden sm:inline-flex items-center justify-center w-7 h-7 rounded-md border border-line text-xs text-ink-3 font-mono">
                        /
                    </kbd>
                    <button
                        type="button"
                        onClick={() => go(results[active])}
                        disabled={!results.length}
                        className="btn btn-primary h-12 px-5! rounded-xl! disabled:opacity-40"
                    >
                        <span className="hidden sm:inline">Go</span>
                        <ArrowRight className="w-4 h-4" aria-hidden />
                        <span className="sr-only sm:hidden">Open tool</span>
                    </button>
                </div>
            </div>

            {showList && (
                <ul
                    id={listId}
                    role="listbox"
                    aria-label={query.trim() ? "Matching tools" : "Popular tools"}
                    className="absolute z-30 left-0 right-0 mt-2 rounded-2xl bg-white text-ink p-2 shadow-[0_24px_60px_-20px_rgba(10,12,30,0.6)] border border-line rise"
                >
                    <li className="px-3 pt-1.5 pb-2 text-xs font-medium text-ink-3" role="presentation">
                        {query.trim() ? "Matching tools" : "Popular tools"}
                    </li>
                    {results.map((tool, index) => (
                        <li
                            key={tool.slug}
                            id={`${listId}-${index}`}
                            role="option"
                            aria-selected={index === active}
                            onMouseEnter={() => setActive(index)}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                go(tool);
                            }}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer ${
                                index === active ? "bg-surface-2" : ""
                            }`}
                        >
                            <ToolIcon tool={tool} size="sm" />
                            <span className="min-w-0">
                                <span className="block font-medium">{tool.name}</span>
                                <span className="block text-sm text-ink-2 truncate">{tool.description}</span>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            {open && query.trim() && results.length === 0 && (
                <p className="absolute left-0 right-0 mt-2 rounded-2xl bg-white text-ink-2 p-4 text-sm shadow-lg border border-line">
                    No tool matches “{query}”. Try another word.
                </p>
            )}
        </div>
    );
}
