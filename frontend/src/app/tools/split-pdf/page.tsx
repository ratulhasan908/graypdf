import { SplitTool } from "@/components/tools/SplitTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("split-pdf");

export default function Page() {
    return <SplitTool />;
}
