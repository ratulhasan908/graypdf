import { PdfToWordTool } from "@/components/tools/PdfToWordTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("pdf-to-word");

export default function Page() {
    return <PdfToWordTool />;
}
