import { PowerPointToPdfTool } from "@/components/tools/PowerPointToPdfTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("powerpoint-to-pdf");

export default function Page() {
    return <PowerPointToPdfTool />;
}
