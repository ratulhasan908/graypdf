"""
Rebuild document structure from a PDF so it can be written as HTML or Markdown.

A PDF only stores positioned glyphs, so headings, lists, tables and links have
to be inferred. `extract_document` does that once; the render_* functions turn
the result into each output format.
"""

import base64
import html
import math
import re
from collections import Counter

import pymupdf

BULLET_RE = re.compile(r"^\s*[•●▪◦‣∙·*–-]\s+(.*)$", re.S)
BARE_BULLET_RE = re.compile(r"^\s*[•●▪◦‣∙·]\s*$")
NUMBERED_RE = re.compile(r"^\s*(\d{1,3})[.)]\s+(.*)$", re.S)
SAFE_LINK_RE = re.compile(r"^(https?://|mailto:)", re.I)
IMAGE_MIME = {"jpeg": "image/jpeg", "jpg": "image/jpeg", "png": "image/png", "gif": "image/gif"}
MAX_DRAWINGS_PER_PAGE = 20000


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def _safe_href(uri):
    """Links come from an untrusted file, so never emit javascript: and friends."""
    return uri if uri and SAFE_LINK_RE.match(uri.strip()) else None


def _page_links(page):
    return [
        (pymupdf.Rect(link["from"]), _safe_href(link.get("uri")))
        for link in page.get_links()
        if _safe_href(link.get("uri"))
    ]


def _link_for(bbox, links):
    rect = pymupdf.Rect(bbox)
    center = pymupdf.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
    for link_rect, href in links:
        if center in link_rect:
            return href
    return None


def _span_style(span):
    flags = span.get("flags", 0)
    font = span.get("font", "").lower()
    return {
        "bold": bool(flags & 16) or "bold" in font,
        "italic": bool(flags & 2) or "italic" in font or "oblique" in font,
        "mono": bool(flags & 8) or "courier" in font or "mono" in font,
    }


def _append_run(runs, text, style, href):
    if runs and runs[-1]["href"] == href and all(
        runs[-1][key] == style[key] for key in style
    ):
        runs[-1]["text"] += text
    else:
        runs.append({"text": text, "href": href, **style})


def _join_lines(lines):
    """Join wrapped lines into runs, repairing words hyphenated at line ends."""
    runs = []
    for line in lines:
        if runs:
            previous = runs[-1]["text"]
            first_text = line[0]["text"] if line else ""
            if previous.endswith("-") and first_text[:1].islower():
                runs[-1]["text"] = previous[:-1]
            elif not previous.endswith(" "):
                runs[-1]["text"] += " "
        for run in line:
            style = {key: run[key] for key in ("bold", "italic", "mono")}
            _append_run(runs, run["text"], style, run["href"])
    return runs


def _plain(runs):
    return re.sub(r"\s+", " ", "".join(run["text"] for run in runs)).strip()


def _strip_prefix(runs, length):
    """Remove `length` characters from the start of a list of runs."""
    trimmed = [dict(run) for run in runs]
    while trimmed and length > 0:
        text = trimmed[0]["text"]
        if len(text) <= length:
            length -= len(text)
            trimmed.pop(0)
        else:
            trimmed[0]["text"] = text[length:]
            length = 0
    if trimmed:
        trimmed[0]["text"] = trimmed[0]["text"].lstrip()
    return trimmed


def _line_runs(line, links):
    runs = []
    for span in line.get("spans", []):
        text = span.get("text", "")
        if text:
            _append_run(runs, text, _span_style(span), _link_for(span["bbox"], links))
    return runs


def _image_block(block, page_number):
    data = block.get("image")
    if not data:
        return None
    mime = IMAGE_MIME.get(block.get("ext", "").lower())
    if not mime:
        try:
            data = pymupdf.Pixmap(data).tobytes("png")
            mime = "image/png"
        except Exception:
            return None
    x0, y0, x1, y1 = block["bbox"]
    return {
        "kind": "image",
        "mime": mime,
        "data": base64.b64encode(data).decode("ascii"),
        "width": x1 - x0,
        "height": y1 - y0,
        "alt": f"Image from page {page_number}",
    }


def _text_blocks(block, links, sizes, page_number):
    """Split one PDF text block into paragraph / list-item entries."""
    groups = []
    for line in block.get("lines", []):
        runs = _line_runs(line, links)
        text = _plain(runs)
        if not text:
            continue

        line_sizes = []
        for span in line.get("spans", []):
            size = float(span.get("size", 0))
            if size > 0 and span.get("text", "").strip():
                line_sizes.append(size)
                sizes[round(size, 1)] += len(span["text"].strip())

        if BARE_BULLET_RE.match(text):
            groups.append({"marker": "ul", "lines": [], "sizes": []})
            continue

        # A wrapped paragraph line can start with "- " or "12. ", so a list
        # item may only open a block or follow another list item.
        may_start_list = not groups or groups[-1]["marker"] is not None
        marker, body = None, None
        if may_start_list:
            bullet = BULLET_RE.match(text)
            numbered = NUMBERED_RE.match(text)
            if bullet:
                marker, body = "ul", bullet.group(1)
            elif numbered:
                marker, body = "ol", numbered.group(2)

        if marker:
            raw = "".join(run["text"] for run in runs)
            prefix = max(raw.find(body[:12]), 0)
            groups.append(
                {"marker": marker, "lines": [_strip_prefix(runs, prefix)], "sizes": line_sizes}
            )
        elif groups:
            groups[-1]["lines"].append(runs)
            groups[-1]["sizes"].extend(line_sizes)
        else:
            groups.append({"marker": None, "lines": [runs], "sizes": line_sizes})

    entries = []
    for group in groups:
        if not group["lines"]:
            continue
        runs = _join_lines(group["lines"])
        text = _plain(runs)
        if not text:
            continue
        counted = sum(len(run["text"].strip()) for run in runs)
        bold = sum(len(run["text"].strip()) for run in runs if run["bold"])
        entries.append(
            {
                "kind": "text",
                "marker": group["marker"],
                "runs": runs,
                "text": text,
                "size": max(group["sizes"], default=0),
                "bold_ratio": bold / counted if counted else 0,
                "lines": len(group["lines"]),
                "page": page_number,
            }
        )
    return entries


def _find_tables(page):
    try:
        found = page.find_tables().tables
    except Exception:
        return []
    tables = []
    for table in found:
        rows = [
            [re.sub(r"\s+", " ", cell or "").strip() for cell in row]
            for row in table.extract()
        ]
        rows = [row for row in rows if any(row)]
        # A single row or column is usually a decorative box, not a table.
        if len(rows) >= 2 and max(len(row) for row in rows) >= 2:
            tables.append({"kind": "table", "rows": rows, "bbox": pymupdf.Rect(table.bbox)})
    return tables


def _inside(block_bbox, rect):
    block = pymupdf.Rect(block_bbox)
    center = pymupdf.Point((block.x0 + block.x1) / 2, (block.y0 + block.y1) / 2)
    return center in rect


def _heading_level(entry, body_size, title_seen):
    text = entry["text"]
    if entry["marker"] or entry["lines"] > 2 or len(text) > 140:
        return None
    if text.endswith((".", ",", ";", ":")) and entry["size"] < body_size * 1.5:
        return None
    if entry["size"] >= body_size * 1.5:
        return 2 if title_seen else 1
    if entry["size"] >= body_size * 1.2:
        return 2
    letters = [c for c in text if c.isalpha()]
    is_bold = entry["bold_ratio"] >= 0.8
    if is_bold and letters and entry["size"] >= body_size * 1.05:
        return 3
    if is_bold and letters and len(text) <= 90 and all(c.isupper() for c in letters):
        return 3
    return None


def extract_document(doc):
    """Return (pages, title). Each page is an ordered list of block dicts."""
    raw_pages = []
    sizes = Counter()  # font size -> characters set at that size
    for number, page in enumerate(doc, start=1):
        page.remove_rotation()
        links = _page_links(page)
        tables = _find_tables(page)
        items = []
        for block in page.get_text("dict")["blocks"]:
            y0 = block["bbox"][1]
            if block.get("type") == 1:
                image = _image_block(block, number)
                if image:
                    items.append((y0, image))
            elif block.get("type") == 0:
                if any(_inside(block["bbox"], table["bbox"]) for table in tables):
                    continue
                for entry in _text_blocks(block, links, sizes, number):
                    items.append((y0, entry))

        # Keep the PDF's own order (it respects columns) and slot tables in by height.
        for table in tables:
            position = next(
                (i for i, (y0, _) in enumerate(items) if y0 > table["bbox"].y0),
                len(items),
            )
            items.insert(position, (table["bbox"].y0, table))
        raw_pages.append([item for _, item in items])

    body_size = sizes.most_common(1)[0][0] if sizes else 10

    title = None
    pages = []
    for items in raw_pages:
        blocks = []
        for item in items:
            if item["kind"] != "text":
                blocks.append(item)
                continue
            level = _heading_level(item, body_size, title is not None)
            if level:
                if level == 1:
                    title = item["text"]
                blocks.append({"kind": "heading", "level": level, "runs": item["runs"]})
            elif item["marker"]:
                if blocks and blocks[-1]["kind"] == "list" and blocks[-1]["tag"] == item["marker"]:
                    blocks[-1]["items"].append(item["runs"])
                else:
                    blocks.append({"kind": "list", "tag": item["marker"], "items": [item["runs"]]})
            else:
                blocks.append({"kind": "paragraph", "runs": item["runs"]})
        pages.append(blocks)

    metadata_title = (doc.metadata or {}).get("title", "").strip()
    return pages, title or metadata_title or "Converted PDF"


# --------------------------------------------------------------------------
# HTML
# --------------------------------------------------------------------------

def _runs_to_html(runs):
    parts = []
    for run in runs:
        text = html.escape(run["text"])
        if run["mono"]:
            text = f"<code>{text}</code>"
        if run["italic"]:
            text = f"<em>{text}</em>"
        if run["bold"]:
            text = f"<strong>{text}</strong>"
        if run["href"]:
            href = html.escape(run["href"], quote=True)
            text = f'<a href="{href}" rel="noopener noreferrer">{text}</a>'
        parts.append(text)
    return "".join(parts).strip()


def _table_to_html(rows):
    width = max(len(row) for row in rows)
    head = "".join(f"<th>{html.escape(cell)}</th>" for cell in rows[0])
    body = []
    for row in rows[1:]:
        cells = row + [""] * (width - len(row))
        body.append("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in cells) + "</tr>")
    return (
        f"<table>\n<thead><tr>{head}</tr></thead>\n<tbody>\n"
        + "\n".join(body)
        + "\n</tbody>\n</table>"
    )


def _block_to_html(block):
    kind = block["kind"]
    if kind == "heading":
        return f"<h{block['level']}>{_runs_to_html(block['runs'])}</h{block['level']}>"
    if kind == "paragraph":
        return f"<p>{_runs_to_html(block['runs'])}</p>"
    if kind == "list":
        items = "\n".join(f"<li>{_runs_to_html(item)}</li>" for item in block["items"])
        return f"<{block['tag']}>\n{items}\n</{block['tag']}>"
    if kind == "table":
        return _table_to_html(block["rows"])
    return (
        f'<figure><img src="data:{block["mime"]};base64,{block["data"]}" '
        f'style="width:{block["width"]:.0f}pt" alt="{html.escape(block["alt"], quote=True)}"></figure>'
    )


def _svg_color(color, fallback="none"):
    if color is None:
        return fallback
    return "#" + "".join(f"{round(max(0, min(1, c)) * 255):02x}" for c in color[:3])


def _drawing_path(items):
    commands = []
    for item in items:
        op = item[0]
        if op == "l":
            commands.append(f"M{item[1].x:.2f} {item[1].y:.2f}L{item[2].x:.2f} {item[2].y:.2f}")
        elif op == "re":
            r = item[1]
            commands.append(f"M{r.x0:.2f} {r.y0:.2f}H{r.x1:.2f}V{r.y1:.2f}H{r.x0:.2f}Z")
        elif op == "c":
            a, b, c, d = item[1:5]
            commands.append(
                f"M{a.x:.2f} {a.y:.2f}C{b.x:.2f} {b.y:.2f} {c.x:.2f} {c.y:.2f} {d.x:.2f} {d.y:.2f}"
            )
        elif op == "qu":
            q = item[1]
            commands.append(
                f"M{q.ul.x:.2f} {q.ul.y:.2f}L{q.ur.x:.2f} {q.ur.y:.2f}"
                f"L{q.lr.x:.2f} {q.lr.y:.2f}L{q.ll.x:.2f} {q.ll.y:.2f}Z"
            )
    return "".join(commands)


def _drawings_to_svg(page):
    """Vector art (table rules, shaded cells, shapes) sits under the text."""
    paths = []
    for drawing in page.get_drawings()[:MAX_DRAWINGS_PER_PAGE]:
        path = _drawing_path(drawing.get("items", []))
        if not path:
            continue
        kind = drawing.get("type", "s")
        attrs = [f'd="{path}"']
        attrs.append(f'fill="{_svg_color(drawing.get("fill")) if "f" in kind else "none"}"')
        if "f" in kind and drawing.get("fill_opacity") not in (None, 1):
            attrs.append(f'fill-opacity="{drawing["fill_opacity"]:.2f}"')
        if drawing.get("even_odd"):
            attrs.append('fill-rule="evenodd"')
        if "s" in kind:
            attrs.append(f'stroke="{_svg_color(drawing.get("color"), "#000000")}"')
            attrs.append(f'stroke-width="{drawing.get("width") or 1:.2f}"')
            if drawing.get("stroke_opacity") not in (None, 1):
                attrs.append(f'stroke-opacity="{drawing["stroke_opacity"]:.2f}"')
        paths.append(f"<path {' '.join(attrs)}/>")
    if not paths:
        return ""
    width, height = page.rect.width, page.rect.height
    return (
        f'<svg class="pdf-art" viewBox="0 0 {width:.2f} {height:.2f}" aria-hidden="true">'
        + "".join(paths)
        + "</svg>"
    )


def _preserved_page(page, number):
    page.remove_rotation()
    links = _page_links(page)
    elements = [_drawings_to_svg(page)]
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") == 1:
            image = _image_block(block, number)
            if image:
                x0, y0, x1, y1 = block["bbox"]
                elements.append(
                    f'<img class="pdf-image" style="left:{x0:.2f}pt;top:{y0:.2f}pt;'
                    f'width:{x1 - x0:.2f}pt;height:{y1 - y0:.2f}pt" '
                    f'src="data:{image["mime"]};base64,{image["data"]}" '
                    f'alt="{html.escape(image["alt"], quote=True)}">'
                )
            continue
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            direction = line.get("dir", (1, 0))
            angle = math.degrees(math.atan2(direction[1], direction[0]))
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text.strip():
                    continue
                style = _span_style(span)
                x0, y0 = span["bbox"][:2]
                color = span.get("color", 0) & 0xFFFFFF
                css = [
                    f"left:{x0:.2f}pt",
                    f"top:{y0:.2f}pt",
                    f"font-size:{max(float(span.get('size', 1)), 1):.2f}pt",
                    f"color:#{color:06x}",
                ]
                if style["bold"]:
                    css.append("font-weight:700")
                if style["italic"]:
                    css.append("font-style:italic")
                if style["mono"]:
                    css.append("font-family:monospace")
                if abs(angle) > 0.5:
                    css.append(f"transform:rotate({angle:.1f}deg)")
                content = html.escape(text)
                href = _link_for(span["bbox"], links)
                if href:
                    safe = html.escape(href, quote=True)
                    content = f'<a href="{safe}" rel="noopener noreferrer">{content}</a>'
                elements.append(f'<span class="pdf-text" style="{";".join(css)}">{content}</span>')
    style = f"--page-width:{page.rect.width:.2f}pt;--page-height:{page.rect.height:.2f}pt"
    return (
        f'<section class="page page-preserved" style="{style}" aria-label="Page {number}">\n'
        + "\n".join(element for element in elements if element)
        + "\n</section>"
    )


DOCUMENT_CSS = """
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 40px 20px; background: #f3f4f6; color: #1f2937; }
    main { max-width: 850px; margin: 0 auto; }
    main.readable { padding: 48px; background: #fff; box-shadow: 0 2px 16px #17203318; }
    .page-readable { line-height: 1.65; overflow-wrap: anywhere; }
    .page-readable + .page-readable { margin-top: 40px; padding-top: 40px; border-top: 1px solid #e5e7eb; }
    h1 { margin: 0 0 .8em; font-size: 2em; line-height: 1.2; color: #111827; }
    h2 { margin: 1.6em 0 .6em; font-size: 1.35em; line-height: 1.3; color: #111827; }
    h3 { margin: 1.4em 0 .5em; font-size: 1.1em; line-height: 1.3; color: #111827; }
    p { margin: 0 0 1em; }
    ul, ol { margin: 0 0 1em; padding-left: 1.5em; }
    li { margin-bottom: .4em; }
    a { color: #1d4ed8; }
    code { font-family: Consolas, Menlo, monospace; font-size: .92em; }
    figure { margin: 1.5em 0; }
    figure img { display: block; max-width: 100%; height: auto; }
    table { width: 100%; margin: 0 0 1.25em; border-collapse: collapse; font-size: .95em; }
    th, td { padding: 8px 10px; border: 1px solid #d1d5db; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; color: #111827; }
    .page-preserved { position: relative; width: var(--page-width); height: var(--page-height);
      margin: 0 auto 24px; background: #fff; box-shadow: 0 2px 16px #17203318; overflow: hidden; }
    .pdf-art { position: absolute; inset: 0; width: 100%; height: 100%; }
    .pdf-text, .pdf-image { position: absolute; }
    .pdf-text { white-space: pre; line-height: 1.15; transform-origin: left top; }
    .pdf-text a { color: inherit; }
    .pdf-image { object-fit: fill; }
    @media (max-width: 700px) { body { padding: 12px; } main.readable { padding: 24px; } }
    @media print {
      body { padding: 0; background: #fff; }
      main.readable { max-width: none; padding: 0; box-shadow: none; }
      .page-preserved { margin: 0; box-shadow: none; break-after: page; }
      .page-readable + .page-readable { margin-top: 0; padding-top: 0; border-top: 0; break-before: page; }
    }
"""


def render_html(doc, layout):
    """Return a complete standalone HTML document."""
    if layout == "preserve":
        sections = [_preserved_page(page, number) for number, page in enumerate(doc, start=1)]
        title = (doc.metadata or {}).get("title", "").strip() or "Converted PDF"
        main_class = "preserved"
    else:
        pages, title = extract_document(doc)
        sections = [
            f'<section class="page page-readable" aria-label="Page {number}">\n'
            + "\n".join(_block_to_html(block) for block in blocks)
            + "\n</section>"
            for number, blocks in enumerate(pages, start=1)
            if blocks
        ]
        main_class = "readable"

    return (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n'
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"  <title>{html.escape(title)}</title>\n"
        f"  <style>{DOCUMENT_CSS}  </style>\n"
        f'</head>\n<body>\n<main class="{main_class}">\n'
        + "\n".join(sections)
        + "\n</main>\n</body>\n</html>\n"
    )


# --------------------------------------------------------------------------
# Markdown
# --------------------------------------------------------------------------

def _md_escape(text):
    return re.sub(r"([\\`*_\[\]<>|])", r"\\\1", text)


def _wrap(text, marker):
    """Markers must hug the words, so keep outer spaces outside them."""
    stripped = text.strip()
    if not stripped:
        return text
    leading = text[: len(text) - len(text.lstrip())]
    trailing = text[len(text.rstrip()):]
    return f"{leading}{marker}{stripped}{marker}{trailing}"


def _runs_to_md(runs, emphasis=True):
    parts = []
    for run in runs:
        text = run["text"]
        if run["mono"] and text.strip():
            text = _wrap(text.replace("`", "'"), "`")
        else:
            text = _md_escape(text)
            if emphasis and run["bold"]:
                text = _wrap(text, "**")
            if emphasis and run["italic"]:
                text = _wrap(text, "*")
        if run["href"]:
            target = run["href"].replace(")", "%29").replace(" ", "%20")
            text = f"[{text.strip()}]({target})"
        parts.append(text)
    return re.sub(r"[ \t]+", " ", "".join(parts)).strip()


def _table_to_md(rows):
    width = max(len(row) for row in rows)

    def line(row):
        cells = [_md_escape(cell) for cell in row] + [""] * (width - len(row))
        return "| " + " | ".join(cells) + " |"

    return "\n".join([line(rows[0]), "|" + " --- |" * width] + [line(row) for row in rows[1:]])


def render_markdown(doc):
    pages, _ = extract_document(doc)
    parts = []
    for blocks in pages:
        for block in blocks:
            kind = block["kind"]
            if kind == "heading":
                parts.append("#" * block["level"] + " " + _runs_to_md(block["runs"], emphasis=False))
            elif kind == "paragraph":
                parts.append(_runs_to_md(block["runs"]))
            elif kind == "list":
                parts.append(
                    "\n".join(
                        (f"{index}. " if block["tag"] == "ol" else "- ") + _runs_to_md(item)
                        for index, item in enumerate(block["items"], start=1)
                    )
                )
            elif kind == "table":
                parts.append(_table_to_md(block["rows"]))
    return "\n\n".join(part for part in parts if part.strip())
