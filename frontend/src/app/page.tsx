"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Sparkles, Shield, Zap, Clock, ChevronDown } from "lucide-react";
import { tools, categories } from "@/lib/tools";

const FEATURES = [
  {
    icon: Shield,
    title: "Private by design",
    description: "Files auto-delete after 2 hours. Never stored long-term.",
    color: "from-emerald-500 to-emerald-600",
  },
  {
    icon: Zap,
    title: "Lightning fast",
    description: "Background workers keep the interface snappy.",
    color: "from-amber-500 to-amber-600",
  },
  {
    icon: Clock,
    title: "No signup needed",
    description: "Use any tool instantly. Sign up only for more.",
    color: "from-blue-500 to-blue-600",
  },
];

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const filteredTools =
    activeCategory === "all"
      ? tools
      : tools.filter((t) => t.category === activeCategory);

  return (
    <main className="min-h-screen overflow-x-hidden">
      {/* ==================== HERO ==================== */}
      <section className="mesh-bg grain relative">
        {/* Animated orbs */}
        <div className="absolute top-20 left-[10%] w-[400px] h-[400px] rounded-full bg-[#4f7cff]/20 blur-[100px] animate-orb-1 pointer-events-none" />
        <div className="absolute top-40 right-[15%] w-[350px] h-[350px] rounded-full bg-[#8b5cf6]/20 blur-[100px] animate-orb-2 pointer-events-none" />
        <div className="absolute bottom-10 left-[40%] w-[300px] h-[300px] rounded-full bg-[#22d3ee]/15 blur-[100px] animate-orb-1 pointer-events-none" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-20 pb-24">
          <div className="text-center">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 pill mb-8 animate-fade-in">
              <span className="pulse-dot" />
              <span className="text-[#0D1C42] font-medium">
                16 tools · Free forever · No ads
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-[#010736] mb-6 animate-fade-in leading-[1.05]">
              Every PDF tool
              <br />
              <span className="gradient-text">you'll ever need</span>
            </h1>

            {/* Subtitle */}
            <p className="text-lg md:text-xl text-[#0D1C42]/70 max-w-2xl mx-auto mb-10 animate-fade-in leading-relaxed">
              Merge, split, compress, convert, and secure your PDFs. Fast,
              private, and free — no signup required.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap items-center justify-center gap-4 animate-fade-in">
              <a
                href="#tools"
                className="btn-primary inline-flex items-center gap-2 group"
              >
                <span>Explore all tools</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
              <Link href="/register" className="btn-ghost inline-flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span>Create free account</span>
              </Link>
            </div>

            {/* Floating PDF mockup */}
            <div className="mt-20 relative max-w-3xl mx-auto">
              <div className="relative animate-float-slow">
                <div className="relative rounded-2xl bg-white/70 backdrop-blur-xl border border-white/80 shadow-[0_20px_80px_rgba(1,7,54,0.15)] p-6 md:p-8">
                  {/* Mini navbar inside mockup */}
                  <div className="flex items-center gap-1.5 mb-6">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-amber-400" />
                    <div className="w-3 h-3 rounded-full bg-emerald-400" />
                    <div className="ml-3 text-xs text-[#0D1C42]/50 font-mono">
                      graypdf.com
                    </div>
                  </div>

                  {/* Mockup content — 3 tool cards */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {tools.slice(0, 6).map((tool, i) => {
                      const Icon = tool.icon;
                      return (
                        <div
                          key={tool.slug}
                          className="rounded-xl bg-white border border-[#e5dcb8]/60 p-4 text-left"
                          style={{ animationDelay: `${i * 100}ms` }}
                        >
                          <div
                            className={`w-9 h-9 rounded-lg bg-gradient-to-br ${tool.color} flex items-center justify-center mb-2 shadow-sm`}
                          >
                            <Icon className="w-4 h-4 text-white" strokeWidth={2.5} />
                          </div>
                          <div className="text-xs font-semibold text-[#010736]">
                            {tool.name}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Glow behind mockup */}
                <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-[#4f7cff]/20 via-[#8b5cf6]/20 to-[#22d3ee]/20 blur-3xl -z-10" />
              </div>
            </div>

            {/* Scroll indicator */}
            <div className="mt-16 flex justify-center animate-bounce-subtle">
              <ChevronDown className="w-6 h-6 text-[#0D1C42]/40" />
            </div>
          </div>
        </div>
      </section>

      {/* ==================== TOOLS ==================== */}
      <section id="tools" className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-[#010736] mb-4">
            All the tools
            <br />
            <span className="gradient-text">you need</span>
          </h2>
          <p className="text-[#0D1C42]/60 max-w-xl mx-auto text-lg">
            Pick a tool and get started. No installation, no watermark, no
            hidden fees.
          </p>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${activeCategory === cat.id
                  ? "bg-[#010736] text-[#FCF1D0] shadow-md"
                  : "bg-white/70 text-[#0D1C42] border border-[#e5dcb8] hover:bg-white"
                }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {/* Tool grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTools.map((tool, i) => {
            const Icon = tool.icon;
            const CardWrapper = tool.available ? Link : "div";
            const wrapperProps = tool.available
              ? { href: `/tools/${tool.slug}` }
              : {};

            return (
              <CardWrapper
                key={tool.slug}
                {...(wrapperProps as any)}
                className={`card card-hover p-5 text-left animate-fade-in group ${tool.available
                    ? ""
                    : "opacity-50 cursor-not-allowed"
                  }`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="relative mb-4">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tool.color} flex items-center justify-center shadow-md transition-all duration-300 group-hover:scale-110`}
                  >
                    <Icon
                      className="w-5 h-5 text-white"
                      strokeWidth={2.5}
                    />
                  </div>
                  <div
                    className={`absolute inset-0 w-12 h-12 rounded-xl bg-gradient-to-br ${tool.color} blur-lg opacity-0 group-hover:opacity-60 transition-opacity duration-300 -z-10`}
                  />
                </div>
                <h3 className="font-semibold text-[#010736] mb-1">
                  {tool.name}
                </h3>
                <p className="text-sm text-[#0D1C42]/60 leading-snug mb-3">
                  {tool.description}
                </p>
                {tool.available && (
                  <div className="flex items-center gap-1 text-xs font-medium text-[#22396F] opacity-0 group-hover:opacity-100 transition-all duration-300">
                    <span>Open tool</span>
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                )}
              </CardWrapper>
            );
          })}
        </div>
      </section>

      {/* ==================== FEATURES ==================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-[#010736] mb-4">
            Built for people
            <br />
            <span className="gradient-text">who value their time</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="card p-8 text-center animate-fade-in"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div
                  className={`w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br ${feature.color} flex items-center justify-center shadow-md mb-5`}
                >
                  <Icon className="w-6 h-6 text-white" strokeWidth={2.5} />
                </div>
                <h3 className="text-lg font-bold text-[#010736] mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-[#0D1C42]/60 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ==================== CTA ==================== */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-20">
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-[#010736] via-[#0d1c42] to-[#22396f] p-12 md:p-20 text-center">
          {/* Decorative glow */}
          <div className="absolute top-0 left-1/4 w-[300px] h-[300px] rounded-full bg-[#4f7cff]/30 blur-[100px]" />
          <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] rounded-full bg-[#8b5cf6]/30 blur-[100px]" />

          <div className="relative">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-[#FCF1D0] mb-6">
              Ready to get started?
            </h2>
            <p className="text-lg text-[#FCF1D0]/70 max-w-xl mx-auto mb-10">
              Create a free account for 20 files per day, batch processing,
              and a personal dashboard.
            </p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 bg-[#FCF1D0] text-[#010736] hover:bg-white font-semibold px-8 py-4 rounded-xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1"
            >
              <Sparkles className="w-4 h-4" />
              <span>Create free account</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ==================== FOOTER ==================== */}
      <footer className="bg-[#010736] text-[#FCF1D0] mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            {/* Brand */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#FCF1D0] flex items-center justify-center">
                  <span className="text-[#010736] font-bold text-lg">G</span>
                </div>
                <span className="text-xl font-bold tracking-tight">
                  Gray<span className="text-[#FCF1D0]/70">PDF</span>
                </span>
              </div>
              <p className="text-sm text-[#FCF1D0]/60 max-w-sm leading-relaxed">
                Free online PDF tools. Fast, private, and no ads.
                Files automatically deleted after 2 hours.
              </p>
            </div>

            {/* Links */}
            <div>
              <h4 className="text-sm font-bold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-[#FCF1D0]/60">
                <li>
                  <Link href="#tools" className="hover:text-[#FCF1D0] transition">
                    Tools
                  </Link>
                </li>
                <li>
                  <Link href="/dashboard" className="hover:text-[#FCF1D0] transition">
                    Dashboard
                  </Link>
                </li>
                <li>
                  <Link href="/register" className="hover:text-[#FCF1D0] transition">
                    Sign up
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-sm font-bold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-[#FCF1D0]/60">
                <li>
                  <Link href="/privacy" className="hover:text-[#FCF1D0] transition">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link href="/terms" className="hover:text-[#FCF1D0] transition">
                    Terms
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-[#FCF1D0]/10 pt-8 flex flex-col sm:flex-row sm:justify-between gap-3 text-xs text-[#FCF1D0]/50">
            <p>© {new Date().getFullYear()} GrayPDF. All rights reserved.</p>
            <p>Made with care · Files deleted after 2 hours</p>
          </div>
        </div>
      </footer>
    </main>
  );
}