import { UnlockTool } from "@/components/tools/UnlockTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("unlock-pdf");

export default function Page() {
    return <UnlockTool />;
}
