import { OcrTool } from "@/components/tools/OcrTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("ocr-pdf");

export default function Page() {
    return <OcrTool />;
}
