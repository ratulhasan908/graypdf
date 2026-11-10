import { CropTool } from "@/components/tools/CropTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("crop-pdf");

export default function Page() {
    return <CropTool />;
}
