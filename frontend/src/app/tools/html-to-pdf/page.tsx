import { HtmlToPdfTool } from "@/components/tools/HtmlToPdfTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("html-to-pdf");

export default function Page() {
    return <HtmlToPdfTool />;
}
