import { JpgToPdfTool } from "@/components/tools/JpgToPdfTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("jpg-to-pdf");

export default function Page() {
    return <JpgToPdfTool />;
}
