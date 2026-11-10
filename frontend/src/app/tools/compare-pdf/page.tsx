import { CompareTool } from "@/components/tools/CompareTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("compare-pdf");

export default function Page() {
    return <CompareTool />;
}
