import { EditTool } from "@/components/tools/EditTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("edit-pdf");

export default function Page() {
    return <EditTool />;
}
