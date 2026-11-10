import { WatermarkTool } from "@/components/tools/WatermarkTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("watermark");

export default function Page() {
    return <WatermarkTool />;
}
