import { PdfToMarkdownTool } from "@/components/tools/PdfToMarkdownTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("pdf-to-markdown");

export default function Page() {
    return <PdfToMarkdownTool />;
}
