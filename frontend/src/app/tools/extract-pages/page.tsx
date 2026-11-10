import { ExtractPagesTool } from "@/components/tools/ExtractPagesTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("extract-pages");

export default function Page() {
    return <ExtractPagesTool />;
}
