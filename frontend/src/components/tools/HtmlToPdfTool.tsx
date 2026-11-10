"use client";

import { TextToPdfTool } from "@/components/tools/TextToPdfTool";

const SAMPLE = `<h1>Hello from GreyPDF</h1>
<p>This is a <strong>sample</strong> HTML document. Replace it with your own.</p>
<ul>
  <li>Point one</li>
  <li>Point two</li>
</ul>
<table border="1" cellpadding="6">
  <tr><th>Item</th><th>Price</th></tr>
  <tr><td>Widget</td><td>$10</td></tr>
  <tr><td>Gadget</td><td>$25</td></tr>
</table>`;

export function HtmlToPdfTool() {
    return (
        <TextToPdfTool slug="html-to-pdf" field="html" label="HTML" extensions={[".html", ".htm"]} sample={SAMPLE} />
    );
}
