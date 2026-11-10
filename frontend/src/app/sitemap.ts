import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { tools } from "@/lib/tools";

export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: SITE_URL, priority: 1 },
        ...tools.map((tool) => ({ url: `${SITE_URL}/tools/${tool.slug}`, priority: 0.8 })),
    ];
}
