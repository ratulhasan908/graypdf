import { PageNumbersTool } from "@/components/tools/PageNumbersTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("page-numbers");

export default function Page() {
    return <PageNumbersTool />;
}
