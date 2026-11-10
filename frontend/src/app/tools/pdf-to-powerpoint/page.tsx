import { PdfToPowerPointTool } from "@/components/tools/PdfToPowerPointTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("pdf-to-powerpoint");

export default function Page() {
    return <PdfToPowerPointTool />;
}
