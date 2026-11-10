import { WordToPdfTool } from "@/components/tools/WordToPdfTool";
import { toolMetadata } from "@/lib/seo";

export const metadata = toolMetadata("word-to-pdf");

export default function Page() {
    return <WordToPdfTool />;
}
