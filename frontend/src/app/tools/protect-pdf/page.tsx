import { ProtectTool } from "@/components/tools/ProtectTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("protect-pdf");

export default function Page() {
    return <ProtectTool />;
}
