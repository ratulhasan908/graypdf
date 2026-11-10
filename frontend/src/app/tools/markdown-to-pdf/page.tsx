import { MarkdownToPdfTool } from "@/components/tools/MarkdownToPdfTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("markdown-to-pdf");

export default function Page() {
    return <MarkdownToPdfTool />;
}
