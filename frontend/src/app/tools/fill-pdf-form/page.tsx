import { FillFormTool } from "@/components/tools/FillFormTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("fill-pdf-form");

export default function Page() {
    return <FillFormTool />;
}
