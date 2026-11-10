import { CompressTool } from "@/components/tools/CompressTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("compress-pdf");

export default function Page() {
    return <CompressTool />;
}
