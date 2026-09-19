import Link from "next/link";
import { tools } from "@/lib/tools";

const FEATURES = [
  {
    icon: "🔒",
    title: "Private by design",
    description: "Files auto-delete after 2 hours. Never stored long-term.",
  },
  {
    icon: "⚡",
    title: "Fast processing",
    description: "Background workers keep the UI snappy, even for large PDFs.",
  },
  {
    icon: "🎯",
    title: "No signup required",
    description: "Use any tool instantly. Sign up only if you want more.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen">
      {/* === Hero === */}
      <section className="hero-bg">
        <div className="max-w-6xl mx-auto px-4 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 bg-white/70 border border-[#e5dcb8] rounded-full px-4 py-1.5 text-xs font-medium text-[#0D1C42] mb-6 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            12 tools · Free forever · No ads
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-[#010736] mb-6 animate-fade-in leading-[1.1]">
            Every PDF tool you need,
            <br />
            <span className="gradient-text">all in one place</span>
          </h1>

          <p className="text-lg md:text-xl text-[#0D1C42]/70 max-w-2xl mx-auto mb-10 animate-fade-in">
            Merge, split, compress, convert, and organize your PDFs. Fast,
            private, and free — no signup required.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 animate-fade-in">
            <a
              href="#tools"
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 text-base"
            >
              Browse tools
              <span>↓</span>
            </a>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 px-6 py-3 text-base font-medium text-[#0D1C42] bg-white border border-[#e5dcb8] rounded-xl hover:border-[#22396F] hover:bg-white transition-all"
            >
              Create free account
            </Link>
          </div>
        </div>
      </section>

      {/* === Tool grid === */}
      <section id="tools" className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-[#010736] mb-3">
            All the tools you need
          </h2>
          <p className="text-[#0D1C42]/60 max-w-xl mx-auto">
            Pick a tool and get started. No installation, no watermark, no
            hidden fees.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {tools.map((tool) => {
            const CardWrapper = tool.available ? Link : "div";
            const wrapperProps = tool.available
              ? { href: `/tools/${tool.slug}` }
              : {};

            return (
              <CardWrapper
                key={tool.slug}
                {...(wrapperProps as any)}
                className={`card card-hover p-5 text-left ${tool.available
                    ? "cursor-pointer"
                    : "opacity-60 cursor-not-allowed"
                  }`}
              >
                <div
                  className={`w-12 h-12 rounded-xl bg-gradient-to-br ${tool.color} flex items-center justify-center text-2xl mb-4 shadow-sm`}
                >
                  {tool.icon}
                </div>
                <h3 className="font-semibold text-[#010736] mb-1">
                  {tool.name}
                </h3>
                <p className="text-sm text-[#0D1C42]/60 leading-snug">
                  {tool.description}
                </p>
                {tool.available && (
                  <div className="mt-4 text-xs font-medium text-[#22396F] flex items-center gap-1 group-hover:gap-2 transition-all">
                    Open tool <span>→</span>
                  </div>
                )}
              </CardWrapper>
            );
          })}
        </div>
      </section>

      {/* === Features strip === */}
      <section className="bg-white/60 border-y border-[#e5dcb8]">
        <div className="max-w-6xl mx-auto px-4 py-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="text-center">
              <div className="text-4xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-[#010736] mb-1">{f.title}</h3>
              <p className="text-sm text-[#0D1C42]/60 max-w-xs mx-auto">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* === Footer === */}
      <footer className="bg-[#010736] text-[#FCF1D0]">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-[#FCF1D0] flex items-center justify-center">
                <span className="text-[#010736] font-bold text-lg">G</span>
              </div>
              <span className="text-xl font-bold tracking-tight">
                Gray<span className="text-[#FCF1D0]/70">PDF</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-6 text-sm text-[#FCF1D0]/70">
              <Link href="/" className="hover:text-[#FCF1D0] transition">
                Tools
              </Link>
              <Link href="/dashboard" className="hover:text-[#FCF1D0] transition">
                Dashboard
              </Link>
              <Link href="/register" className="hover:text-[#FCF1D0] transition">
                Sign up
              </Link>
            </div>
          </div>

          <div className="border-t border-[#FCF1D0]/10 mt-8 pt-6 flex flex-col sm:flex-row sm:justify-between gap-3 text-xs text-[#FCF1D0]/60">
            <p>© {new Date().getFullYear()} GrayPDF. All rights reserved.</p>
            <p>Files are automatically deleted after 2 hours.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}