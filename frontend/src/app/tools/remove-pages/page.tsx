import { RemovePagesTool } from "@/components/tools/RemovePagesTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("remove-pages");

export default function Page() {
    return <RemovePagesTool />;
}
