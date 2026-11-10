import { SignTool } from "@/components/tools/SignTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("sign-pdf");

export default function Page() {
    return <SignTool />;
}
