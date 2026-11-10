import { PdfToHtmlTool } from "@/components/tools/PdfToHtmlTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("pdf-to-html");

export default function Page() {
    return <PdfToHtmlTool />;
}
