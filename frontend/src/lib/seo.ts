import type { Metadata } from "next";
import { getToolBySlug } from "@/lib/tools";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export function toolMetadata(slug: string): Metadata {
    const tool = getToolBySlug(slug);
    if (!tool) return {};
    const title = `${tool.name} online, free`;
    return {
        title,
        description: tool.blurb,
        alternates: { canonical: `/tools/${slug}` },
        openGraph: { title: `${title} | GreyPDF`, description: tool.blurb },
    };
}
