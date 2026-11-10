import { RedactTool } from "@/components/tools/RedactTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("redact-pdf");

export default function Page() {
    return <RedactTool />;
}
