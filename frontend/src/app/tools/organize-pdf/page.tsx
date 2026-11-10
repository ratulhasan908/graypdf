import { OrganizeTool } from "@/components/tools/OrganizeTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("organize-pdf");

export default function Page() {
    return <OrganizeTool />;
}
