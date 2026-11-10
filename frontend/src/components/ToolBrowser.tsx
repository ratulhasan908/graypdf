"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { ToolIcon } from "@/components/ToolLayout";
import { categories, categoryBlurbs, newSlugs, Tool, ToolCategory, tools } from "@/lib/tools";

function ToolCard({ tool }: { tool: Tool }) {
    return (
        <li>
            <Link href={`/tools/${tool.slug}`} className="tool-card group card h-full p-4 sm:p-5 flex sm:block items-center gap-3">
                <span className="flex items-start justify-between">
                    <ToolIcon tool={tool} />
                    <ArrowUpRight
                        className="hidden sm:block w-4 h-4 text-ink-3 opacity-0 -translate-x-1 translate-y-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0 transition-all"
                        aria-hidden
                    />
                </span>
                <span className="block sm:mt-4 min-w-0">
                    <span className="flex items-center gap-2 font-semibold">
                        {tool.name}
                        {newSlugs.includes(tool.slug) && (
                            <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-md bg-accent text-white">
                                New
                            </span>
                        )}
                    </span>
                    <span className="block text-sm text-ink-2 mt-1 leading-snug">{tool.description}</span>
                </span>
            </Link>
        </li>
    );
}

export default function ToolBrowser() {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<ToolCategory | "all">("all");

    const needle = query.trim().toLowerCase();
    const results = useMemo(
        () =>
            tools.filter(
                (tool) =>
                    (category === "all" || tool.category === category) &&
                    (!needle || `${tool.name} ${tool.description} ${tool.blurb}`.toLowerCase().includes(needle))
            ),
        [needle, category]
    );

    // With no search, "All tools" is grouped by category so 30 tools are easy to scan.
    const grouped = category === "all" && !needle;
    const groups = categories.filter((item) => item.id !== "all") as { id: ToolCategory; name: string }[];

    return (
        <section id="tools" aria-labelledby="tools-heading" className="scroll-mt-20">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 mb-8">
                <div>
                    <p className="eyebrow">The toolbox</p>
                    <h2 id="tools-heading" className="text-4xl md:text-5xl font-semibold tracking-tight mt-3">
                        {tools.length} tools, all free
                    </h2>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="relative sm:w-72">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" aria-hidden />
                        <input
                            type="search"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search tools, e.g. “compress”"
                            aria-label="Search tools"
                            className="input pl-10! rounded-full! bg-surface! shadow-sm"
                        />
                    </div>
                    <div
                        className="flex gap-1 p-1 rounded-full bg-surface border border-line overflow-x-auto shadow-sm"
                        role="group"
                        aria-label="Filter by category"
                    >
                        {categories.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                aria-pressed={category === item.id}
                                onClick={() => setCategory(item.id)}
                                className={`px-3.5 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                                    category === item.id ? "bg-ink text-white" : "text-ink-2 hover:text-ink hover:bg-surface-2"
                                }`}
                            >
                                {item.name}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {results.length === 0 ? (
                <div className="card p-10 text-center">
                    <p className="text-ink-2">No tools match “{query}”.</p>
                    <button type="button" onClick={() => setQuery("")} className="btn btn-ghost mt-4">
                        <X className="w-4 h-4" aria-hidden />
                        Clear search
                    </button>
                </div>
            ) : grouped ? (
                <div className="space-y-12">
                    {groups.map((group) => (
                        <div key={group.id}>
                            <div className="flex items-baseline gap-3 mb-4 flex-wrap">
                                <h3 className="text-lg font-semibold">{group.name}</h3>
                                <p className="text-sm text-ink-3">{categoryBlurbs[group.id]}</p>
                            </div>
                            <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                {tools
                                    .filter((tool) => tool.category === group.id)
                                    .map((tool) => (
                                        <ToolCard key={tool.slug} tool={tool} />
                                    ))}
                            </ul>
                        </div>
                    ))}
                </div>
            ) : (
                <ul className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {results.map((tool) => (
                        <ToolCard key={tool.slug} tool={tool} />
                    ))}
                </ul>
            )}
        </section>
    );
}
