import { MergeTool } from "@/components/tools/MergeTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("merge-pdf");

export default function Page() {
    return <MergeTool />;
}
