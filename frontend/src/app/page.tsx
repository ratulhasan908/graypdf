import Link from "next/link";
import {
    ArrowRight,
    Check,
    Download,
    Gift,
    FileUp,
    Languages,
    Laptop,
    LayoutGrid,
    ShieldCheck,
    Smartphone,
    Sparkles,
    Tablet,
    Zap,
} from "lucide-react";
import HeroArt from "@/components/HeroArt";
import HeroSearch from "@/components/HeroSearch";
import ToolBrowser from "@/components/ToolBrowser";
import ToolMarquee from "@/components/ToolMarquee";
import { tools } from "@/lib/tools";

const PROMISES = ["No signup for 10 files a day", "Files deleted after 2 hours", "No watermarks added"];

const STATS = [
    { value: String(tools.length), label: "PDF tools" },
    { value: "12", label: "OCR languages" },
    { value: "2 h", label: "Then files are deleted" },
    { value: "$0", label: "Free for everyone" },
];

const STEPS = [
    { icon: LayoutGrid, title: "Pick a tool", text: "Merge, compress, convert, sign and more. Every tool is one click away." },
    { icon: FileUp, title: "Add your file", text: "Drop it in or choose it from your device, then adjust a few options if you like." },
    { icon: Download, title: "Download the result", text: "Your file is ready in seconds, and we delete our copy automatically." },
];

const LANGUAGES = ["English", "বাংলা", "हिन्दी", "اردو", "العربية", "简体中文", "Français", "Español", "Deutsch", "Português", "Italiano", "Русский"];

const QUESTIONS = [
    {
        q: "Is GreyPDF really free?",
        a: "Yes. All tools are free for everyone. Without an account you can process 10 files a day. With a free account there is no daily limit.",
    },
    {
        q: "Is there a subscription or paid plan?",
        a: "No. There is no subscription, no premium plan and no trial that runs out. Signing up is free and simply removes the daily limit.",
    },
    {
        q: "Are my files safe?",
        a: "Files are sent over an encrypted connection, used only for the task you chose, and deleted automatically after 2 hours. PDF passwords you enter are never stored with your file.",
    },
    {
        q: "How big can my files be?",
        a: "Each file can be up to 50 MB, and one upload can be up to 200 MB in total. PDFs can have up to 500 pages.",
    },
    {
        q: "Can it read scanned documents in Bangla?",
        a: "Yes. OCR PDF recognises text in 12 languages, including Bangla, Hindi, Urdu and Arabic, and turns scans into PDFs you can search and copy from.",
    },
    {
        q: "Do I need to install anything?",
        a: "No. GreyPDF runs in your browser on Windows, Mac, Linux, Android and iPhone.",
    },
];

export default function HomePage() {
    return (
        <main>
            {/* ---------- Hero (slides up under the floating header) ---------- */}
            <section className="hero-dark relative isolate overflow-hidden -mt-[68px] pt-[68px] rounded-b-[2rem] md:rounded-b-[3rem]">
                <div className="absolute inset-0 -z-10" aria-hidden>
                    <div className="aurora w-[38rem] h-[38rem] -top-60 -left-40 bg-[#2748d6]" />
                    <div className="aurora w-[34rem] h-[34rem] -top-40 right-[-10rem] bg-[#7a4cf0] [animation-delay:-8s]" />
                    <div className="aurora w-[30rem] h-[30rem] top-[45%] left-[30%] bg-[#e0479e] opacity-30! [animation-delay:-14s]" />
                    <div className="hero-grid" />
                </div>

                <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 md:pt-24 text-center">
                    <Link
                        href="/tools/word-to-pdf"
                        className="glass-dark inline-flex items-center gap-2 rounded-full pl-1 pr-3 py-1 text-sm text-white/80 hover:text-white transition-colors rise"
                    >
                        <span className="inline-flex items-center gap-1 rounded-full bg-white text-ink text-xs font-semibold px-2 py-0.5">
                            <Sparkles className="w-3 h-3 text-accent" aria-hidden />
                            New
                        </span>
                        <span className="sm:hidden">Office to PDF and OCR</span>
                        <span className="hidden sm:inline">Word, Excel, PowerPoint to PDF and OCR are here</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                    </Link>

                    <h1 className="mt-7 font-semibold tracking-[-0.04em] leading-[0.98] text-[2.9rem] sm:text-7xl lg:text-[5.6rem] rise">
                        Every PDF tool you need.
                        <br />
                        <span className="text-shine">Free. Fast. Private.</span>
                    </h1>
                    <p className="mt-6 text-lg md:text-xl text-white/65 max-w-2xl mx-auto leading-relaxed rise">
                        Merge, split, compress, convert, sign and protect your PDFs in seconds, right in your browser.
                        No account needed.
                    </p>

                    <div className="mt-10 relative z-20">
                        <HeroSearch />
                    </div>

                    <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-6 text-sm text-white/60">
                        {PROMISES.map((item) => (
                            <li key={item} className="flex items-center gap-1.5">
                                <Check className="w-4 h-4 text-[#3ddc9f]" strokeWidth={2.5} aria-hidden />
                                {item}
                            </li>
                        ))}
                    </ul>

                    {/* The main hook: signing up costs nothing and removes the limit. */}
                    <Link
                        href="/register"
                        className="group mt-8 inline-flex flex-col sm:flex-row items-center gap-3 sm:gap-4 rounded-2xl p-px bg-linear-to-r from-[#3ddc9f]/70 via-[#5b8cff]/70 to-[#b48cff]/70"
                    >
                        <span className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 rounded-[15px] bg-[#0b0e1f]/90 px-5 py-3.5">
                            <span className="flex items-center gap-2.5 text-left">
                                <span className="w-9 h-9 shrink-0 rounded-xl chip-optimize flex items-center justify-center">
                                    <Gift className="w-4 h-4" aria-hidden />
                                </span>
                                <span>
                                    <span className="block font-semibold text-white">
                                        Sign up free for unlimited use
                                    </span>
                                    <span className="block text-sm text-white/60">
                                        No subscription. No paid plan. No credit card. Ever.
                                    </span>
                                </span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-xl bg-white text-ink text-sm font-semibold px-4 py-2 group-hover:bg-white/90 transition-colors">
                                Create free account
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden />
                            </span>
                        </span>
                    </Link>
                </div>

                <div className="mt-16">
                    <ToolMarquee />
                </div>

                <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-14 pb-16 md:pb-20">
                    <dl className="glass-dark rounded-2xl grid grid-cols-2 md:grid-cols-4 divide-white/10 md:divide-x">
                        {STATS.map(({ value, label }, index) => (
                            <div
                                key={label}
                                className={`py-6 px-3 text-center ${index % 2 ? "border-l md:border-l-0" : ""} ${index >= 2 ? "border-t md:border-t-0" : ""} border-white/10`}
                            >
                                <dt className="sr-only">{label}</dt>
                                <dd className="text-3xl md:text-4xl font-semibold tracking-tight">{value}</dd>
                                <dd className="text-sm text-white/55 mt-1">{label}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </section>

            <div className="max-w-6xl mx-auto px-4 sm:px-6">
                {/* ---------- Tools ---------- */}
                <div className="pt-20 md:pt-24">
                    <ToolBrowser />
                </div>

                {/* ---------- How it works ---------- */}
                <section className="mt-28 md:mt-36 text-center" aria-labelledby="how">
                    <p className="eyebrow">How it works</p>
                    <h2 id="how" className="text-4xl md:text-5xl font-semibold tracking-tight mt-3">
                        Three steps. <span className="text-gradient">No learning curve.</span>
                    </h2>
                    <ol className="relative grid md:grid-cols-3 gap-5 mt-14 text-left">
                        <span
                            className="hidden md:block absolute top-10 left-[16%] right-[16%] border-t-2 border-dashed border-line-strong"
                            aria-hidden
                        />
                        {STEPS.map(({ icon: Icon, title, text }, index) => (
                            <li key={title} className="relative card p-7 text-center">
                                <span className="relative mx-auto w-14 h-14 rounded-2xl chip-convert flex items-center justify-center">
                                    <Icon className="w-6 h-6" aria-hidden />
                                    <span className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-ink text-white text-xs font-semibold flex items-center justify-center ring-4 ring-surface">
                                        {index + 1}
                                    </span>
                                </span>
                                <h3 className="font-semibold text-lg mt-6">{title}</h3>
                                <p className="text-sm text-ink-2 mt-2 leading-relaxed">{text}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                {/* ---------- Why ---------- */}
                <section className="mt-28 md:mt-36" aria-labelledby="why">
                    <div className="text-center">
                        <p className="eyebrow">Why GreyPDF</p>
                        <h2 id="why" className="text-4xl md:text-5xl font-semibold tracking-tight mt-3 max-w-3xl mx-auto">
                            Simple, private and <span className="text-gradient">genuinely free.</span>
                        </h2>
                    </div>

                    <div className="grid md:grid-cols-3 gap-4 mt-14">
                        <div className="dark-card text-white rounded-3xl p-7 md:p-10 md:col-span-2 md:row-span-2 grid lg:grid-cols-[1fr_1.1fr] gap-6 items-center overflow-hidden">
                            <div>
                                <span className="glass-dark inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-white/80">
                                    <Zap className="w-3.5 h-3.5 text-[#ffbf5c]" aria-hidden />
                                    No catch
                                </span>
                                <p className="text-6xl md:text-7xl font-semibold tracking-tight mt-6">$0</p>
                                <h3 className="text-2xl font-semibold mt-3">Free for everyone, forever</h3>
                                <p className="text-white/65 mt-3 leading-relaxed">
                                    There is no subscription and no paid plan. Use 10 files a day without an account, or
                                    sign up free and use every tool without limits.
                                </p>
                                <ul className="mt-5 space-y-2 text-sm text-white/80">
                                    {["Unlimited files with a free account", "No credit card, no trial that ends", "No watermark on your files"].map((item) => (
                                        <li key={item} className="flex items-center gap-2">
                                            <Check className="w-4 h-4 text-[#3ddc9f]" strokeWidth={2.5} aria-hidden />
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                                <Link href="/register" className="btn bg-white text-ink! hover:bg-white/90 mt-7">
                                    Get unlimited files
                                    <ArrowRight className="w-4 h-4" aria-hidden />
                                </Link>
                            </div>
                            <div className="hidden sm:block">
                                <HeroArt />
                            </div>
                        </div>

                        <div className="card rounded-3xl! p-7 flex flex-col">
                            <span className="w-12 h-12 rounded-2xl chip-optimize flex items-center justify-center">
                                <ShieldCheck className="w-5 h-5" aria-hidden />
                            </span>
                            <h3 className="text-lg font-semibold mt-6">Your files stay yours</h3>
                            <p className="text-sm text-ink-2 mt-2 leading-relaxed">
                                Used only for the job you asked for, sent over an encrypted connection, and deleted
                                automatically after 2 hours.
                            </p>
                        </div>

                        <div className="card rounded-3xl! p-7 flex flex-col">
                            <span className="w-12 h-12 rounded-2xl chip-organize flex items-center justify-center">
                                <Laptop className="w-5 h-5" aria-hidden />
                            </span>
                            <h3 className="text-lg font-semibold mt-6">Works on every device</h3>
                            <p className="text-sm text-ink-2 mt-2 leading-relaxed">
                                Nothing to install. Use it on your phone, tablet or computer.
                            </p>
                            <span className="flex gap-3 mt-auto pt-5 text-ink-3" aria-hidden>
                                <Smartphone className="w-5 h-5" />
                                <Tablet className="w-5 h-5" />
                                <Laptop className="w-5 h-5" />
                            </span>
                        </div>

                        <Link href="/tools/ocr-pdf" className="tool-card card rounded-3xl! p-7 md:col-span-2 group">
                            <span className="flex items-center justify-between gap-4">
                                <span className="w-12 h-12 rounded-2xl chip-convert flex items-center justify-center">
                                    <Languages className="w-5 h-5" aria-hidden />
                                </span>
                                <span className="text-sm text-accent font-medium flex items-center gap-1">
                                    Try OCR PDF
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden />
                                </span>
                            </span>
                            <h3 className="text-lg font-semibold mt-6">Reads scans in your language</h3>
                            <p className="text-sm text-ink-2 mt-2 leading-relaxed max-w-lg">
                                Turn scanned pages into searchable text in 12 languages, including Bangla, Hindi, Urdu
                                and Arabic.
                            </p>
                            <span className="flex flex-wrap gap-1.5 mt-5">
                                {LANGUAGES.map((name) => (
                                    <span key={name} className="text-sm px-3 py-1 rounded-full bg-surface-2 text-ink-2 border border-line">
                                        {name}
                                    </span>
                                ))}
                            </span>
                        </Link>

                        <Link
                            href="/tools/word-to-pdf"
                            className="tool-card rounded-3xl p-7 text-white group flex flex-col bg-linear-to-br from-[#5b8cff] via-[#6a4cf0] to-[#b04ff0]"
                        >
                            <span className="text-xs font-semibold uppercase tracking-wider text-white/70">New</span>
                            <h3 className="text-xl font-semibold mt-3">Office files in, PDF out</h3>
                            <p className="text-sm text-white/80 mt-2 leading-relaxed">
                                Convert Word, Excel and PowerPoint files to clean PDFs that look the same everywhere.
                            </p>
                            <span className="mt-auto pt-6 text-sm font-medium flex items-center gap-1">
                                Convert a file
                                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" aria-hidden />
                            </span>
                        </Link>
                    </div>
                </section>

                {/* ---------- FAQ ---------- */}
                <section className="mt-28 md:mt-36 grid md:grid-cols-[1fr_1.6fr] gap-10" aria-labelledby="faq">
                    <div>
                        <p className="eyebrow">FAQ</p>
                        <h2 id="faq" className="text-4xl md:text-5xl font-semibold tracking-tight mt-3">
                            Common questions
                        </h2>
                        <p className="text-ink-2 mt-4 leading-relaxed">Everything you need to know before you start.</p>
                    </div>
                    <div className="space-y-3">
                        {QUESTIONS.map(({ q, a }) => (
                            <details key={q} className="group card rounded-2xl! px-5 open:shadow-[0_12px_30px_-18px_rgba(10,12,30,0.4)] transition-shadow">
                                <summary className="cursor-pointer font-medium list-none flex justify-between items-center gap-4 py-4 [&::-webkit-details-marker]:hidden">
                                    {q}
                                    <span
                                        className="w-8 h-8 shrink-0 rounded-full bg-surface-2 flex items-center justify-center text-ink-2 text-lg group-open:rotate-45 group-open:bg-ink group-open:text-white transition-all"
                                        aria-hidden
                                    >
                                        +
                                    </span>
                                </summary>
                                <p className="text-sm text-ink-2 pb-5 -mt-1 leading-relaxed">{a}</p>
                            </details>
                        ))}
                    </div>
                </section>

                {/* ---------- CTA ---------- */}
                <section className="mt-28 md:mt-36 cta-band rounded-4xl text-white px-6 py-14 md:px-16 md:py-20 relative overflow-hidden text-center">
                    <div className="hero-grid opacity-60" aria-hidden />
                    <div className="relative">
                        <h2 className="text-4xl md:text-6xl font-semibold tracking-tight max-w-3xl mx-auto leading-[1.05]">
                            Unlimited files. <span className="whitespace-nowrap">Zero cost.</span>
                        </h2>
                        <p className="text-white/75 mt-5 text-lg max-w-xl mx-auto">
                            Sign up free to remove the daily limit and keep a history of your work. There is no
                            subscription and nothing to pay, now or later.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-9">
                            <Link href="/register" className="btn btn-lg bg-white text-ink! hover:bg-white/90">
                                Create a free account
                                <ArrowRight className="w-4 h-4" aria-hidden />
                            </Link>
                            <Link href="#tools" className="btn btn-lg glass-dark text-white hover:bg-white/15">
                                Browse tools
                            </Link>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}
