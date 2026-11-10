import { PdfToJpgTool } from "@/components/tools/PdfToJpgTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("pdf-to-jpg");

export default function Page() {
    return <PdfToJpgTool />;
}
