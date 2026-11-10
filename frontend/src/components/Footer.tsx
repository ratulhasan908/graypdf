import Link from "next/link";
import Logo from "@/components/Logo";
import { categories, tools } from "@/lib/tools";

export default function Footer() {
    const groups = categories.filter((category) => category.id !== "all");

    return (
        <footer className="border-t border-line mt-16">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-2 md:grid-cols-5 gap-8">
                <div className="col-span-2 md:col-span-1">
                    <Logo />
                    <p className="text-sm text-ink-2 mt-3 leading-relaxed">
                        Free PDF tools. Files are deleted automatically after 2 hours.
                    </p>
                </div>
                {groups.map((group) => (
                    <div key={group.id}>
                        <h2 className="text-sm font-medium mb-3">{group.name}</h2>
                        <ul className="space-y-2">
                            {tools
                                .filter((tool) => tool.category === group.id)
                                .map((tool) => (
                                    <li key={tool.slug}>
                                        <Link href={`/tools/${tool.slug}`} className="text-sm text-ink-2 hover:text-ink transition-colors">
                                            {tool.name}
                                        </Link>
                                    </li>
                                ))}
                        </ul>
                    </div>
                ))}
            </div>
            <div className="border-t border-line">
                <p className="max-w-6xl mx-auto px-4 sm:px-6 py-5 text-xs text-ink-3">
                    © {new Date().getFullYear()} GreyPDF
                </p>
            </div>
        </footer>
    );
}
