export type Tool = {
    slug: string;
    name: string;
    description: string;
    icon: string;
    available: boolean;
};

export const tools: Tool[] = [
    {
        slug: "merge-pdf",
        name: "Merge PDF",
        description: "Combine PDFs in the order you want.",
        icon: "🔗",
        available: true,
    },
    {
        slug: "split-pdf",
        name: "Split PDF",
        description: "Separate one page or a whole set into independent PDFs.",
        icon: "✂️",
        available: true,
    },
    {
        slug: "compress-pdf",
        name: "Compress PDF",
        description: "Reduce file size while keeping quality.",
        icon: "📉",
        available: true,
    },
    {
        slug: "pdf-to-jpg",
        name: "PDF to JPG",
        description: "Convert each PDF page into a JPG image.",
        icon: "🖼️",
        available: false,
    },
    {
        slug: "jpg-to-pdf",
        name: "JPG to PDF",
        description: "Convert JPG images to PDF in seconds.",
        icon: "📷",
        available: false,
    },
    {
        slug: "rotate-pdf",
        name: "Rotate PDF",
        description: "Rotate your PDFs the way you need them.",
        icon: "🔄",
        available: false,
    },
    {
        slug: "watermark",
        name: "Watermark",
        description: "Stamp an image or text over your PDF.",
        icon: "💧",
        available: false,
    },
    {
        slug: "page-numbers",
        name: "Page Numbers",
        description: "Add page numbers into PDFs with ease.",
        icon: "🔢",
        available: false,
    },
    {
        slug: "protect-pdf",
        name: "Protect PDF",
        description: "Protect PDF files with a password.",
        icon: "🔒",
        available: false,
    },
    {
        slug: "unlock-pdf",
        name: "Unlock PDF",
        description: "Remove PDF password security.",
        icon: "🔓",
        available: false,
    },
    {
        slug: "organize-pdf",
        name: "Organize PDF",
        description: "Sort, delete, or add PDF pages.",
        icon: "📑",
        available: false,
    },
    {
        slug: "crop-pdf",
        name: "Crop PDF",
        description: "Crop margins or select specific areas.",
        icon: "✂️",
        available: false,
    },
];

export function getToolBySlug(slug: string): Tool | undefined {
    return tools.find((t) => t.slug === slug);
}