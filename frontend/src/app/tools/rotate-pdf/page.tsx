import { RotateTool } from "@/components/tools/RotateTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("rotate-pdf");

export default function Page() {
    return <RotateTool />;
}
