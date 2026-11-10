import { ExcelToPdfTool } from "@/components/tools/ExcelToPdfTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("excel-to-pdf");

export default function Page() {
    return <ExcelToPdfTool />;
}
