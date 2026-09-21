export type Tool = {
    slug: string;
    name: string;
    description: string;
    icon: string;
    color: string; // tailwind color classes for icon tile
    available: boolean;
};

export const tools: Tool[] = [
    {
        slug: "merge-pdf",
        name: "Merge PDF",
        description: "Combine PDFs in the order you want.",
        icon: "🔗",
        color: "from-blue-500 to-blue-600",
        available: true,
    },
    {
        slug: "split-pdf",
        name: "Split PDF",
        description: "Separate one page or a whole set into independent PDFs.",
        icon: "✂️",
        color: "from-violet-500 to-violet-600",
        available: true,
    },
    {
        slug: "compress-pdf",
        name: "Compress PDF",
        description: "Reduce file size while keeping quality.",
        icon: "📉",
        color: "from-emerald-500 to-emerald-600",
        available: true,
    },
    {
        slug: "pdf-to-jpg",
        name: "PDF to JPG",
        description: "Convert each PDF page into a JPG image.",
        icon: "🖼️",
        color: "from-rose-500 to-rose-600",
        available: true,
    },
    {
        slug: "jpg-to-pdf",
        name: "JPG to PDF",
        description: "Convert JPG images to PDF in seconds.",
        icon: "📷",
        color: "from-amber-500 to-amber-600",
        available: true,
    },
    {
        slug: "rotate-pdf",
        name: "Rotate PDF",
        description: "Rotate your PDFs the way you need them.",
        icon: "🔄",
        color: "from-cyan-500 to-cyan-600",
        available: true,
    },
    {
        slug: "watermark",
        name: "Watermark",
        description: "Stamp an image or text over your PDF.",
        icon: "💧",
        color: "from-sky-500 to-sky-600",
        available: true,
    },
    {
        slug: "page-numbers",
        name: "Page Numbers",
        description: "Add page numbers into PDFs with ease.",
        icon: "🔢",
        color: "from-indigo-500 to-indigo-600",
        available: true,
    },
    {
        slug: "protect-pdf",
        name: "Protect PDF",
        description: "Protect PDF files with a password.",
        icon: "🔒",
        color: "from-red-500 to-red-600",
        available: true,
    },
    {
        slug: "unlock-pdf",
        name: "Unlock PDF",
        description: "Remove PDF password security.",
        icon: "🔓",
        color: "from-green-500 to-green-600",
        available: true,
    },
    {
        slug: "organize-pdf",
        name: "Organize PDF",
        description: "Sort, delete, or add PDF pages.",
        icon: "📑",
        color: "from-fuchsia-500 to-fuchsia-600",
        available: true,
    },
    {
        slug: "crop-pdf",
        name: "Crop PDF",
        description: "Crop margins or select specific areas.",
        icon: "✂️",
        color: "from-orange-500 to-orange-600",
        available: true,
    },
    {
        slug: "html-to-pdf",
        name: "HTML to PDF",
        description: "Convert HTML content to a PDF document.",
        icon: "🌐",
        color: "from-slate-500 to-slate-600",
        available: true,
    },
];

export function getToolBySlug(slug: string): Tool | undefined {
    return tools.find((t) => t.slug === slug);
}