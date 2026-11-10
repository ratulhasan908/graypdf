import { PdfToExcelTool } from "@/components/tools/PdfToExcelTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("pdf-to-excel");

export default function Page() {
    return <PdfToExcelTool />;
}
