import { RepairTool } from "@/components/tools/RepairTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("repair-pdf");

export default function Page() {
    return <RepairTool />;
}
