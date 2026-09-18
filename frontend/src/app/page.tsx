import Link from "next/link";
import { tools } from "@/lib/tools";

export default function Home() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-16 pb-12 text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Every PDF tool you need,
          <br />
          <span className="text-blue-600">all in one place</span>
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Merge, split, compress, and convert your PDF files. Free, fast, and
          secure — no signup required.
        </p>
      </section>

      {/* Tool grid */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
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
                className={`bg-white rounded-lg shadow-sm border border-gray-200 p-5 transition ${tool.available
                    ? "hover:shadow-md hover:border-blue-400 cursor-pointer"
                    : "opacity-60 cursor-not-allowed"
                  }`}
              >
                <div className="text-3xl mb-3">{tool.icon}</div>
                <h3 className="font-bold text-gray-900 mb-1">{tool.name}</h3>
                <p className="text-sm text-gray-500">{tool.description}</p>
                {!tool.available && (
                  <span className="inline-block mt-3 text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">
                    Coming soon
                  </span>
                )}
              </CardWrapper>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8 text-center text-sm text-gray-500">
          <p>© {new Date().getFullYear()} GrayPDF. All rights reserved.</p>
          <p className="mt-2">
            Files are automatically deleted after 2 hours. Your privacy matters.
          </p>
        </div>
      </footer>
    </main>
  );
}