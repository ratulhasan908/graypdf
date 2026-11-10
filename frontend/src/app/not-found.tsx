import Link from "next/link";

export default function NotFound() {
    return (
        <main className="max-w-xl mx-auto px-4 py-24 text-center">
            <p className="font-mono text-sm text-ink-3 mb-2">404</p>
            <h1 className="text-3xl font-semibold tracking-tight mb-2">We can&apos;t find that page</h1>
            <p className="text-ink-2 mb-6">It may have moved. All of our tools are on the home page.</p>
            <Link href="/" className="btn btn-primary">
                See all tools
            </Link>
        </main>
    );
}
