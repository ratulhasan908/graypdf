"""
Document operations behind the newer tools.

Each public function takes input paths, an output path and the job options,
writes the output file, and may return a dict of results for the user. Celery
lifecycle lives in tasks.py; errors raised as ValueError are shown to users.
"""

import difflib
import html
import io
import math
import re
import shutil
import subprocess
import zlib

import pymupdf
from django.conf import settings

from . import edit_fonts

ENCRYPTED_ERROR = "This PDF is password-protected. Use Unlock PDF first, then try again."
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]*\w")
PHONE_RE = re.compile(r"(?<![\w.])\+?\d[\d\s().-]{7,}\d(?!\w)")
NUMBER_RE = re.compile(r"^-?(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*|0)(?:\.\d+)?$")
PERCENT_RE = re.compile(r"^-?\d+(?:\.\d+)?%$")
PT_TO_EMU = 12700
MAX_SLIDE_POINTS = 4032  # PowerPoint's 56 inch limit
COMPARE_LABEL_HEIGHT = 26


def render_page(page, dpi):
    """
    Draw a page as an RGB pixmap at `dpi`, or lower when that would take more
    than MAX_RENDER_PIXELS (a long web-page export at 150 dpi can need 400 MB).
    """
    zoom = dpi / 72
    width, height = page.rect.width * zoom, page.rect.height * zoom
    limit = getattr(settings, "MAX_RENDER_PIXELS", 25_000_000)
    if width * height > limit:
        zoom *= (limit / (width * height)) ** 0.5
    return page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)


def open_pdf(path, max_pages=-1):
    """
    Open a PDF for reading, enforcing the password and page rules.
    `max_pages=None` lifts the page limit (the editor only touches what changed).
    """
    doc = pymupdf.open(str(path))
    if doc.needs_pass:
        doc.close()
        raise ValueError(ENCRYPTED_ERROR)
    if doc.page_count == 0:
        doc.close()
        raise ValueError("This PDF has no pages.")
    limit = getattr(settings, "MAX_PDF_PAGES", 500) if max_pages == -1 else max_pages
    if limit is not None and doc.page_count > limit:
        count = doc.page_count
        doc.close()
        raise ValueError(f"This PDF has {count} pages. The maximum is {limit}.")
    return doc


def _save(doc, output):
    doc.save(str(output), garbage=4, deflate=True, clean=True)


def _page_rect(page, box, dims=None):
    """
    Turn a box of 0..1 fractions of the visible page into page coordinates.
    `dims` is the page size the fractions refer to, when the page has since grown.
    """
    width, height = dims or (page.rect.width, page.rect.height)
    bottom = max(1.0, page.rect.height / height)
    x0 = min(max(float(box["x"]), 0), 1) * width
    y0 = min(max(float(box["y"]), 0), bottom) * height
    x1 = min(max(float(box["x"]) + float(box["w"]), 0), 1) * width
    y1 = min(max(float(box["y"]) + float(box["h"]), 0), bottom) * height
    if x1 - x0 < 1 or y1 - y0 < 1:
        raise ValueError("One of the selected areas is too small.")
    return pymupdf.Rect(x0, y0, x1, y1)


def _page_index(doc, item):
    index = int(item["page"]) - 1
    if index < 0 or index >= doc.page_count:
        raise ValueError(f"Page {item['page']} does not exist in this PDF.")
    return index


# --------------------------------------------------------------------------
# Convert from PDF
# --------------------------------------------------------------------------

def to_word(inputs, output, options):
    from pdf2docx import Converter

    open_pdf(inputs[0]).close()
    converter = Converter(str(inputs[0]))
    try:
        converter.convert(str(output))
    finally:
        converter.close()


def _write_cell(cell, text):
    """
    Store numbers as numbers so spreadsheets can sum them. Everything else is
    forced to plain text: a PDF is untrusted, and a cell like =HYPERLINK(...)
    would otherwise become a live formula.
    """
    text = text.strip()
    if NUMBER_RE.match(text):
        number = float(text.replace(",", ""))
        cell.value = int(number) if number.is_integer() and "." not in text else number
    elif PERCENT_RE.match(text):
        cell.value = float(text[:-1]) / 100
        cell.number_format = "0.##%"
    else:
        cell.value = text
        cell.data_type = "s"


def _tables_on(page):
    found = page.find_tables().tables
    if not found:
        # No ruled lines: fall back to column alignment, and only trust
        # results that look like a grid rather than wrapped paragraphs.
        found = [
            table
            for table in page.find_tables(strategy="text").tables
            if table.col_count >= 2 and table.row_count >= 3
        ]
    tables = []
    for table in found:
        rows = [[(cell or "").replace("\n", " ") for cell in row] for row in table.extract()]
        rows = [row for row in rows if any(cell.strip() for cell in row)]
        if len(rows) >= 2:
            tables.append(rows)
    return tables


def to_excel(inputs, output, options):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    workbook.remove(workbook.active)
    doc = open_pdf(inputs[0])
    try:
        for number, page in enumerate(doc, start=1):
            for table_number, rows in enumerate(_tables_on(page), start=1):
                sheet = workbook.create_sheet(f"Page {number} Table {table_number}")
                for row_number, row in enumerate(rows, start=1):
                    for column, text in enumerate(row, start=1):
                        cell = sheet.cell(row=row_number, column=column)
                        _write_cell(cell, text)
                        if row_number == 1:
                            cell.font = Font(bold=True)
                for column in range(1, max(len(row) for row in rows) + 1):
                    longest = max(
                        (len(row[column - 1]) for row in rows if column <= len(row)), default=8
                    )
                    sheet.column_dimensions[get_column_letter(column)].width = min(longest + 3, 60)
                sheet.freeze_panes = "A2"
    finally:
        doc.close()

    if not workbook.worksheets:
        raise ValueError(
            "No tables were found in this PDF. PDF to Excel works on PDFs with "
            "real text tables, not scanned pages."
        )
    workbook.save(str(output))
    return {"tables": len(workbook.worksheets)}


def _font_name(span_font):
    name = span_font.split("+")[-1].lower()
    if "courier" in name or "mono" in name:
        return "Courier New"
    if "times" in name or "serif" in name and "sans" not in name:
        return "Times New Roman"
    return "Arial"


def to_powerpoint(inputs, output, options):
    """
    One slide per page. Everything except the text becomes the slide picture,
    and the text goes on top as real text boxes, so wording stays editable
    while tables, shapes and images keep their exact look.
    """
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.text import MSO_ANCHOR
    from pptx.util import Emu, Pt

    doc = open_pdf(inputs[0])
    try:
        largest = max(max(page.rect.width, page.rect.height) for page in doc)
        scale = min(1.0, MAX_SLIDE_POINTS / largest)
        first = doc[0]
        first.remove_rotation()

        presentation = Presentation()
        presentation.slide_width = Emu(int(first.rect.width * scale * PT_TO_EMU))
        presentation.slide_height = Emu(int(first.rect.height * scale * PT_TO_EMU))
        blank = presentation.slide_layouts[6]

        for page in doc:
            page.remove_rotation()
            slide = presentation.slides.add_slide(blank)
            # Pages of a different size are fitted to the slide.
            fit = min(
                presentation.slide_width / (page.rect.width * PT_TO_EMU),
                presentation.slide_height / (page.rect.height * PT_TO_EMU),
            )
            lines = [
                line
                for block in page.get_text("dict")["blocks"]
                if block.get("type") == 0
                for line in block.get("lines", [])
                if "".join(span.get("text", "") for span in line.get("spans", [])).strip()
                and abs(line.get("dir", (1, 0))[1]) < 0.01
            ]

            for line in lines:
                page.add_redact_annot(pymupdf.Rect(line["bbox"]), fill=False)
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            )
            picture = render_page(page, 150).tobytes("jpeg", jpg_quality=88)
            slide.shapes.add_picture(
                io.BytesIO(picture),
                0,
                0,
                width=Emu(int(page.rect.width * PT_TO_EMU * fit)),
                height=Emu(int(page.rect.height * PT_TO_EMU * fit)),
            )

            for line in lines:
                x0, y0, x1, y1 = line["bbox"]
                box = slide.shapes.add_textbox(
                    Emu(int(x0 * PT_TO_EMU * fit)),
                    Emu(int(y0 * PT_TO_EMU * fit)),
                    Emu(int((x1 - x0) * PT_TO_EMU * fit * 1.05)),
                    Emu(int((y1 - y0) * PT_TO_EMU * fit)),
                )
                frame = box.text_frame
                frame.word_wrap = False
                frame.vertical_anchor = MSO_ANCHOR.TOP
                frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
                paragraph = frame.paragraphs[0]
                for span in line["spans"]:
                    text = span.get("text", "")
                    if not text:
                        continue
                    run = paragraph.add_run()
                    run.text = text
                    run.font.size = Pt(max(round(float(span.get("size", 11)) * fit, 1), 1))
                    run.font.name = _font_name(span.get("font", ""))
                    run.font.bold = bool(span.get("flags", 0) & 16) or "bold" in span.get("font", "").lower()
                    run.font.italic = bool(span.get("flags", 0) & 2)
                    run.font.color.rgb = RGBColor.from_string(f"{span.get('color', 0) & 0xFFFFFF:06X}")

        presentation.save(str(output))
    finally:
        doc.close()


# --------------------------------------------------------------------------
# Sign, redact, forms
# --------------------------------------------------------------------------

def sign(inputs, output, options):
    pdf_path, signature_path = inputs
    placements = options.get("placements") or []
    if not placements:
        raise ValueError("Place your signature on a page first.")

    signature = signature_path.read_bytes()
    doc = open_pdf(pdf_path)
    try:
        for placement in placements:
            page = doc[_page_index(doc, placement)]
            page.remove_rotation()
            page.insert_image(_page_rect(page, placement), stream=signature, keep_proportion=True)
        _save(doc, output)
    finally:
        doc.close()


def _pattern_matches(text, patterns):
    matches = set()
    if "email" in patterns:
        matches.update(EMAIL_RE.findall(text))
    if "phone" in patterns:
        matches.update(match.strip() for match in PHONE_RE.findall(text))
    return matches


def redact(inputs, output, options):
    """
    Permanently remove content. A black box alone would leave the text
    underneath, so this deletes the text and image pixels from the file, then
    strips the other places a redacted word could survive.
    """
    terms = [term.strip() for term in options.get("terms") or [] if term.strip()]
    patterns = options.get("patterns") or []
    boxes = options.get("boxes") or []
    if not terms and not patterns and not boxes:
        raise ValueError("Choose something to redact first.")

    doc = open_pdf(inputs[0])
    try:
        # Form values and annotations become page content, so redaction reaches them.
        doc.bake(annots=True, widgets=True)
        count = 0
        for page in doc:
            page.remove_rotation()
            rects = []
            for needle in set(terms) | _pattern_matches(page.get_text(), patterns):
                rects.extend(page.search_for(needle))
            rects.extend(
                _page_rect(page, box)
                for box in boxes
                if _page_index(doc, box) == page.number
            )
            for rect in rects:
                page.add_redact_annot(rect, fill=(0, 0, 0))
            count += len(rects)
            if rects:
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                )

        if count == 0:
            raise ValueError("Nothing matched, so the PDF was not changed.")

        # Titles, bookmarks and attachments can repeat the same words.
        doc.set_metadata({})
        doc.del_xml_metadata()
        doc.set_toc([])
        for name in doc.embfile_names():
            doc.embfile_del(name)
        _save(doc, output)
        return {"redactions": count}
    finally:
        doc.close()


# --------------------------------------------------------------------------
# Edit
# --------------------------------------------------------------------------

EDIT_TYPES = (
    "text", "replace", "whiteout", "highlight", "underline", "strikeout", "rect", "ellipse",
    "line", "arrow", "draw", "image", "note", "link", "rotate-page", "delete-page",
)
BOX_TYPES = ("whiteout", "highlight", "underline", "strikeout", "rect", "ellipse", "image", "link")
LINE_TYPES = ("line", "arrow")
PAGE_TYPES = ("rotate-page", "delete-page")
GENERIC_FAMILIES = {"sans": "sans-serif", "serif": "serif", "mono": "monospace"}
LINE_HEIGHT = 1.2
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
LINK_RE = re.compile(r"^(https?://|mailto:)[^\s\"'<>\\]{1,2000}$", re.IGNORECASE)
MAX_TEXT_LINES_PER_PAGE = 2000


def _fraction(value):
    return min(max(float(value), 0.0), 1.0)


def _rgb(value, default=(0, 0, 0)):
    if isinstance(value, str) and HEX_COLOR_RE.match(value):
        return tuple(int(value[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return default


def _stroke(item):
    return min(max(float(item.get("stroke", 2)), 0.5), 40.0)


def _weight(value):
    try:
        return min(max(int(float(value)) // 100 * 100, 100), 900)
    except (TypeError, ValueError):
        return 400


def text_lines(page):
    """
    The page's horizontal lines of text, as fractions of the page, with the
    font each is set in, so the editor can retype a line in its own font.
    """
    width, height = page.rect.width, page.rect.height
    refs = edit_fonts.page_font_refs(page)
    lines = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            if abs(line["dir"][0] - 1) > 1e-3:
                continue  # rotated or vertical text
            spans = [span for span in line["spans"] if span["text"].strip()]
            if not spans:
                continue
            main = max(spans, key=lambda span: len(span["text"].strip()))
            family, weight, italic = edit_fonts.parse_font_name(main["font"])
            flags = main["flags"]
            x0, y0, x1, y1 = line["bbox"]
            lines.append({
                "x": round(x0 / width, 5),
                "y": round(y0 / height, 5),
                "w": round((x1 - x0) / width, 5),
                "h": round((y1 - y0) / height, 5),
                "baseline": round(main["origin"][1] / height, 5),
                "text": clean_text("".join(span["text"] for span in line["spans"]).strip()),
                "size": round(main["size"], 2),
                "color": f"#{main['color'] & 0xFFFFFF:06x}",
                "font": {
                    "ref": refs.get(edit_fonts.name_key(main["font"])),
                    "family": family,
                    "weight": max(weight, 700) if flags & 16 else weight,
                    "italic": italic or bool(flags & 2),
                    "generic": edit_fonts.generic_kind(main["font"], flags),
                },
            })
            if len(lines) >= MAX_TEXT_LINES_PER_PAGE:
                _add_collapse(page, lines)
                _add_flow_cuts(page, lines)
                return lines
    _add_collapse(page, lines)
    _add_flow_cuts(page, lines)
    return lines


def clean_text(text):
    """
    Undo a common extraction fault in Bengali and other Indic PDFs: a vowel
    sign or mark drawn with two glyphs comes out twice. The same sign never
    legitimately repeats, so repeats are dropped.
    """
    import unicodedata

    kept = []
    for char in text:
        if kept and char == kept[-1] and unicodedata.category(char) in ("Mn", "Mc"):
            continue
        kept.append(char)
    return "".join(kept)


# Where a retyped line splits the page when it grows: just above its baseline,
# below the line before it. Keep in step with FLOW_CUT in edit/model.ts.
FLOW_CUT = 0.78


def _flows(items, height):
    """
    [(y, points)] where the page opens up (a retyped line grew: positive) or
    closes up (a line was deleted: negative, removing the band below y).
    """
    flows = []
    for item in items:
        grow = float(item.get("grow") or 0) if item.get("type") == "text" else 0
        source = item.get("source")
        if not source or abs(grow) <= 0.5:
            continue
        cut = (float(source["y"]) + FLOW_CUT * float(source["h"])) * height
        if grow > 0:
            flows.append((_row_cut(item, height), min(grow, 5000.0)))
        elif not str(item.get("text") or "").strip():
            size = min(max(float(item.get("size", 12)), 4.0), 200.0)
            flows.append((cut - COLLAPSE_TOP * size, max(grow, -3 * size)))
    return sorted(flows)


def _row_cut(item, height):
    """Where a growing line opens the page: under its row (from text_lines), else its baseline."""
    source = item["source"]
    try:
        cut = float(item["cut"])
    except (KeyError, TypeError, ValueError):
        cut = -1
    lowest = float(source["y"])
    if not math.isfinite(cut) or not lowest <= cut <= lowest + 4 * float(source["h"]):
        cut = lowest + FLOW_CUT * float(source["h"])
    return cut * height


def _anchor(item, height):
    """
    The point of a change that decides whether it moves with the content when
    a line above grows. Keep in step with anchorOf in edit/model.ts.
    """
    kind = item["type"]
    source = item.get("source")
    if kind == "text" and source:
        return _row_cut(item, height) - 0.01
    if kind == "text":
        return float(item["baseline"]) * height
    if kind in LINE_TYPES:
        return min(float(item["y1"]), float(item["y2"])) * height
    if kind == "draw":
        return min(float(y) for _x, y in item["points"]) * height
    return float(item["y"]) * height


def _shifted(item, flows, height):
    """The change moved down by the growth of every retyped line above it."""
    shift = sum(grow for cut, grow in flows if cut < _anchor(item, height)) / height if flows else 0
    if not shift:
        return item
    kind = item["type"]
    if kind == "text":
        return {**item, "baseline": float(item["baseline"]) + shift}
    if kind in LINE_TYPES:
        return {**item, "y1": float(item["y1"]) + shift, "y2": float(item["y2"]) + shift}
    if kind == "draw":
        return {**item, "points": [[x, float(y) + shift] for x, y in item["points"]]}
    return {**item, "y": float(item["y"]) + shift}


def _content_bottom(page):
    bottoms = [pymupdf.Rect(rect).y1 for _kind, rect in page.get_bboxlog() if not pymupdf.Rect(rect).is_empty]
    return max(bottoms, default=0)


def _ink(line, height):
    """The vertical span (points) a line's letters actually cover, ascenders to descenders."""
    baseline, size = line["baseline"] * height, line["size"]
    return baseline - 0.72 * size, baseline + 0.22 * size


def _add_flow_cuts(page, lines):
    """
    For each line, where the page opens up when it gets longer: in the gap
    below its whole row, clear of every line on the page (labels on the same
    row, other columns), so nothing is ever cut through.
    """
    height = page.rect.height
    inks = [_ink(line, height) for line in lines]
    for line, (top, bottom) in zip(lines, inks):
        # Everything on the same row ends here...
        row_bottom = max(other_bottom for other_top, other_bottom in inks if other_top < bottom and other_bottom > top)
        y = row_bottom
        moved = True
        while moved:  # ...then step past any line that still covers this height
            moved = False
            for other_top, other_bottom in inks:
                if other_top < y < other_bottom:
                    y, moved = other_bottom, True
        next_top = min((other_top for other_top, _bottom in inks if other_top >= y), default=height)
        line["flow"] = round(min(y + min((next_top - y) / 2, 3.0), height) / height, 5)


def _band_text_only(snapshot, bands, height):
    """
    One copy of the page per band, keeping only the text of the lines whose
    middle falls inside that band. Clipping hides the rest from view but not
    from copy and search, so without this every band would repeat the page's
    text.
    """
    lines = [
        line["bbox"]
        for block in snapshot[0].get_text("dict")["blocks"]
        for line in block.get("lines", [])
    ]
    copies = pymupdf.open()
    for top, bottom in bands:
        copies.insert_pdf(snapshot)
        page = copies[-1]
        removed = False
        for x0, y0, x1, y1 in lines:
            middle = (y0 + y1) / 2
            if not top <= middle < bottom:
                # A thin strip through the line's middle touches only that line.
                page.add_redact_annot(pymupdf.Rect(x0, middle - 0.1, x1, middle + 0.1), fill=False)
                removed = True
        if removed:
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                text=pymupdf.PDF_REDACT_TEXT_REMOVE,
            )
    return copies


def _reflow(doc, page, flows, dims):
    """
    Make room under retyped lines that grew: everything below each one moves
    down, and the gap is filled by stretching a thin text-free strip, so boxes,
    table borders and backgrounds grow instead of breaking. The page only gets
    taller when the content would no longer fit.
    """
    width, height = dims
    snapshot = pymupdf.open()
    snapshot.insert_pdf(doc, from_page=page.number, to_page=page.number, annots=False)
    strip = pymupdf.open()
    strip.insert_pdf(snapshot)
    blank = strip[0]
    blank.add_redact_annot(blank.rect, fill=False)
    blank.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )
    try:
        total = sum(grow for _cut, grow in flows if grow > 0)
        bottom = _content_bottom(snapshot[0])
        overflow = max(0.0, bottom + total + min(height - bottom, 36.0) - height) if bottom > flows[0][0] else 0.0

        for xref in page.get_contents():
            doc.update_stream(xref, b" ")
        if overflow:
            cropped = page.cropbox != page.mediabox
            crop = page.cropbox
            box = page.mediabox
            page.set_mediabox(pymupdf.Rect(box.x0, box.y0, box.x1, box.y1 + overflow))
            if cropped:
                page.set_cropbox(pymupdf.Rect(crop.x0, crop.y0, crop.x1, crop.y1 + overflow))

        # Plan the bands first: (source top, source bottom, offset), and the gaps to fill.
        bands, gaps = [], []
        top, offset = 0.0, 0.0
        for cut, grow in [*flows, (height, 0.0)]:
            if cut > top:
                bands.append((top, cut, offset))
            if grow > 0:
                gaps.append((cut, offset, grow))
            offset += grow
            # A deleted line's band is skipped, so what follows closes up.
            top = max(top, cut - grow if grow < 0 else cut)

        copies = _band_text_only(snapshot, [(band_top, band_bottom) for band_top, band_bottom, _ in bands], height)
        try:
            for index, (band_top, band_bottom, shift) in enumerate(bands):
                page.show_pdf_page(
                    pymupdf.Rect(0, band_top + shift, width, band_bottom + shift), copies, index,
                    clip=pymupdf.Rect(0, band_top, width, band_bottom),
                )
            for cut, shift, grow in gaps:
                page.show_pdf_page(
                    pymupdf.Rect(0, cut + shift, width, cut + shift + grow), strip, 0,
                    clip=pymupdf.Rect(0, cut - 0.6, width, cut), keep_proportion=False,
                )
        finally:
            copies.close()
    finally:
        strip.close()
        snapshot.close()


# How far above its baseline a line's removable slot starts, as a share of its
# size: below the previous line's descenders. Keep in step with COLLAPSE_TOP in edit/model.ts.
COLLAPSE_TOP = 0.75


def _add_collapse(page, lines):
    """
    For each line, the space (points) that deleting it frees: down to the next
    line, so the text below closes up. 0 when the band also holds something
    that must not be cut: another cell on the same row, a box edge, a rule or
    an image.
    """
    width, height = page.rect.width, page.rect.height
    edges = []
    for drawing in page.get_drawings():
        rect = drawing["rect"]
        edges.extend((rect.y0, rect.y1))
    images = [pymupdf.Rect(info["bbox"]) for info in page.get_image_info()]
    places = [(line["baseline"] * height, line["size"]) for line in lines]
    for line, (baseline, size) in zip(lines, places):
        line["collapse"] = 0
        below = [other for other in places if other[0] > baseline + 0.5 * size]
        if not below:
            continue
        pitch = min(other[0] for other in below) - baseline
        # Remove one line's slot, not the extra space before a heading or table:
        # the gap from the line above is the line spacing when there is one.
        above = [other[0] for other in places if other[0] < baseline - 0.5 * size]
        if above:
            pitch = min(pitch, baseline - max(above))
        pitch = min(pitch, 3 * size)
        top, bottom = baseline - COLLAPSE_TOP * size, baseline - COLLAPSE_TOP * size + pitch
        inside = lambda y: top + 0.5 < y < bottom - 0.5  # noqa: E731
        crowded = any(
            other is not line and other_base - 0.6 * other_size < bottom - 0.5 and other_base + 0.1 * other_size > top + 0.5
            for other, (other_base, other_size) in zip(lines, places)
        )
        if crowded or any(inside(y) for y in edges) or any(image.y1 > top and image.y0 < bottom for image in images):
            continue
        line["collapse"] = round(pitch, 2)


class FontKit:
    """
    The fonts one edit needs, each built once. Embedded fonts are read from
    the untouched original, because retyping a line changes the page's text.
    """

    def __init__(self, source_path):
        self.source = pymupdf.open(str(source_path))
        self.embedded_fonts = {}
        self.families = {}
        self.inserted = set()

    def close(self):
        self.source.close()

    def embedded(self, ref):
        if not isinstance(ref, int) or not 0 < ref < self.source.xref_length():
            return None
        if ref not in self.embedded_fonts:
            data = edit_fonts.editable_font(self.source, ref)
            self.embedded_fonts[ref] = (data, edit_fonts.coverage(data)) if data else None
        return self.embedded_fonts[ref]

    def invisible_font(self, page, faces, text):
        """(name, bytes) of the face covering the most of `text`, added to the page once."""
        best = max(faces, key=lambda face: sum(ord(char) in face[1] for char in text), default=None)
        if best is None:
            return None, None
        data = best[2]
        name = f"gpx{zlib.crc32(data) & 0xFFFFFF:x}"
        key = (page.xref, name)
        if key not in self.inserted:
            page.insert_font(fontname=name, fontbuffer=data)
            self.inserted.add(key)
        return name, data

    def family(self, family, weight, italic, generic):
        key = (family, weight, italic, generic)
        if key not in self.families:
            data, _used = edit_fonts.family_font(family, weight, italic, generic)
            self.families[key] = (data, edit_fonts.coverage(data)) if data else None
        return self.families[key]


def _first_baseline(html_text, css, archive):
    """Where this text's first baseline lands below the top-left of its box."""
    scratch = pymupdf.open()
    try:
        page = scratch.new_page(width=3000, height=3000)
        page.insert_htmlbox(pymupdf.Rect(0, 0, 3000, 3000), html_text, css=css, archive=archive)
        for span in page.get_texttrace():
            for char in span["chars"]:
                if chr(char[0]).strip():
                    return char[2]
    finally:
        scratch.close()
    return (0, 0)


def _text_style(item, kit):
    """(html, css, archive) for one text change, in its font with full fallbacks."""
    text = str(item.get("text") or "")
    size = min(max(float(item.get("size", 12)), 4.0), 200.0)
    color = item.get("color") if HEX_COLOR_RE.match(str(item.get("color", ""))) else "#000000"
    weight = _weight(item.get("weight", 400))
    italic = bool(item.get("italic"))
    generic = item.get("generic") if item.get("generic") in GENERIC_FAMILIES else "sans"
    family = str(item.get("family") or "")
    face_style = f"font-weight: {weight}; font-style: {'italic' if italic else 'normal'};"

    archive = pymupdf.Archive()
    faces, rules = [], []
    chain = [
        ("pdf-font", kit.embedded(item.get("ref"))),
        ("full-font", kit.family(family, weight, italic, generic)),
    ]
    for index, script_family in enumerate(edit_fonts.script_families(text, generic)):
        chain.append((f"script-font-{index}", kit.family(script_family, weight, italic, generic)))
    for name, entry in chain:
        if entry:
            data, chars = entry
            archive.add((data, f"{name}.otf"))
            rules.append(f"@font-face {{font-family: {name}; src: url({name}.otf); {face_style}}}")
            faces.append((name, chars, data))
    css = "".join(rules) + (
        f"* {{margin: 0; padding: 0; line-height: {LINE_HEIGHT}; font-family: {GENERIC_FAMILIES[generic]}; "
        f"font-size: {size:.2f}px; color: {color}; {face_style}}}"
    )
    html_text = edit_fonts.runs_html(text, [(name, chars) for name, chars, _data in faces])
    return html_text, css, archive, size, faces


def _y(value, page, dims):
    """A fraction of the original page height in points, allowing for a page that grew."""
    return min(max(float(value), 0.0), max(1.0, page.rect.height / dims[1])) * dims[1]


def _edit_text(page, item, kit, dims):
    if not str(item.get("text") or "").strip():
        return  # an existing line that was cleared is simply deleted
    html_text, css, archive, size, faces = _text_style(item, kit)
    width, height = dims
    dx, dy = _first_baseline(html_text, css, archive)
    left = _fraction(item["x"]) * width - dx
    top = _y(item["baseline"], page, dims) - dy
    # A retyped line wraps where the editor wrapped it; new text runs to the page edge.
    wrap = float(item.get("width") or 0)
    right = left + dx + wrap * width + 1 if wrap > 0 else max(width, left + size * 4)
    box = pymupdf.Rect(left, top, right, max(page.rect.height, top + size * 3) + 5000)
    text = str(item["text"])
    if any(edit_fonts.is_complex(ord(char)) for char in text):
        if _draw_shaped_text(page, box, text, html_text, css, archive, faces, kit):
            return
    page.insert_htmlbox(box, html_text, css=css, archive=archive, scale_low=0)


class _OutlinePen:
    """Draws a font glyph's outline onto a PyMuPDF Shape, in page coordinates."""

    def __new__(cls, shape, origin, scale, glyphs):
        from fontTools.pens.basePen import BasePen

        class Pen(BasePen):
            def _point(self, point):
                return pymupdf.Point(origin[0] + point[0] * scale, origin[1] - point[1] * scale)

            def _moveTo(self, point):
                self.last = self._point(point)

            def _lineTo(self, point):
                end = self._point(point)
                shape.draw_line(self.last, end)
                self.last = end

            def _curveToOne(self, first, second, third):
                end = self._point(third)
                shape.draw_bezier(self.last, self._point(first), self._point(second), end)
                self.last = end

            def _closePath(self):
                pass

        return Pen(glyphs)


def _draw_shaped_text(page, box, text, html_text, css, archive, faces, kit):
    """
    Text in scripts like Bangla, whose letters change shape with their
    neighbours. PDF writers record such text glyph by glyph, so copying it back
    out gives broken characters. Instead the shaped glyphs are drawn as
    outlines (they look identical and hold no text), and the real text sits
    underneath as an invisible layer, line by line, the way OCR'd scans work.
    Copy, search and screen readers then get correct Unicode in every viewer.
    Returns False (drawing nothing) when it can't be done safely.
    """
    from fontTools.ttLib import TTFont

    scratch = pymupdf.open()
    try:
        layout = scratch.new_page(width=page.rect.width, height=page.rect.height + 6000)
        layout.insert_htmlbox(box, html_text, css=css, archive=archive, scale_low=0)
        trace = layout.get_texttrace()
    finally:
        scratch.close()

    fonts = {}
    for _name, _chars, data in faces:
        try:
            fonts[edit_fonts.name_key(pymupdf.Font(fontbuffer=data).name)] = TTFont(io.BytesIO(data))
        except Exception:
            continue
    # A visible glyph from a font we don't hold (MuPDF's own fallback): keep normal text.
    for span in trace:
        if edit_fonts.name_key(span["font"]) not in fonts and any(chr(char[0]).strip() for char in span["chars"]):
            return False

    # Words as drawn: spaces and line changes separate them, in reading order.
    drawn = []
    for span in trace:
        for unicode, _gid, origin, bbox in span["chars"]:
            if not chr(unicode).strip():
                drawn.append(None)
                continue
            last = drawn[-1] if drawn else None
            if last is not None and abs(last["baseline"] - origin[1]) < 0.4 * span["size"]:
                last["x1"] = max(last["x1"], bbox[2])
            else:
                drawn.append({"baseline": origin[1], "x0": bbox[0], "x1": bbox[2], "size": span["size"]})
    drawn = [word for word in drawn if word is not None]
    words = text.split()
    if len(drawn) != len(words):
        return False

    shape = page.new_shape()
    for span in trace:
        font = fonts.get(edit_fonts.name_key(span["font"]))
        if font is None:
            continue
        order, glyphs = font.getGlyphOrder(), font.getGlyphSet()
        scale = span["size"] / font["head"].unitsPerEm
        color = tuple(span["color"])[:3] if span.get("color") else (0, 0, 0)
        for _unicode, gid, origin, _bbox in span["chars"]:
            if 0 < gid < len(order):
                glyphs[order[gid]].draw(_OutlinePen(shape, origin, scale, glyphs))
                shape.finish(fill=color, color=None, closePath=True, even_odd=False)
    shape.commit()

    rows = {}
    for word, place in zip(words, drawn):
        rows.setdefault(round(place["baseline"], 1), []).append((place, word))
    for baseline, row in rows.items():
        line = " ".join(word for _place, word in row)
        name, data = kit.invisible_font(page, faces, line)
        if not data:
            continue
        size = row[0][0]["size"]
        left, right = row[0][0]["x0"], row[-1][0]["x1"]
        natural = pymupdf.Font(fontbuffer=data).text_length(line, fontsize=size) or 1
        point = pymupdf.Point(left, baseline)
        stretch = min(max((right - left) / natural, 0.3), 3)
        page.insert_text(point, line, fontname=name, fontsize=size, render_mode=3, morph=(point, pymupdf.Matrix(stretch, 1)))
    return True


def _remove_original_text(page, items):
    """Delete the text of the lines being retyped, leaving what is behind it."""
    sources = [item["source"] for item in items if item.get("type") == "text" and item.get("source")]
    if not sources:
        return
    for source in sources:
        rect = _page_rect(page, source)
        # Neighbouring lines overlap a little; trimming keeps them intact.
        inset = rect.height * 0.25
        page.add_redact_annot(pymupdf.Rect(rect.x0, rect.y0 + inset, rect.x1, rect.y1 - inset), fill=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )


def _source_key(box):
    return tuple(round(float(box[key]), 3) for key in ("x", "y", "w", "h"))


def _replacements(page, number, replaces, retyped):
    """Find & replace: every line containing a match is retyped in its own font."""
    if not replaces:
        return [], 0
    plain = page.get_text().lower()
    replaces = [item for item in replaces if item["find"].lower() in plain]
    if not replaces:
        return [], 0
    items, count = [], 0
    for line in text_lines(page):
        if _source_key(line) in retyped:
            continue  # the person retyped this line themselves
        text = line["text"]
        for item in replaces:
            pattern = re.compile(re.escape(item["find"]), 0 if item.get("case") else re.IGNORECASE)
            text, found = pattern.subn(lambda _match, new=str(item.get("replace", "")): new, text)
            count += found
        if text != line["text"]:
            items.append({
                "type": "text", "page": number, "x": line["x"], "baseline": line["baseline"],
                "text": text, "size": line["size"], "color": line["color"], **line["font"],
                "source": {key: line[key] for key in ("x", "y", "w", "h")},
            })
    return items, count


def _edit_draw(page, item, dims):
    width = dims[0]
    points = [pymupdf.Point(_fraction(x) * width, _y(y, page, dims)) for x, y in item["points"]]
    if len(points) == 1:
        points.append(points[0] + (0.01, 0))  # a tap leaves a dot
    shape = page.new_shape()
    shape.draw_polyline(points)
    shape.finish(color=_rgb(item.get("color")), width=_stroke(item), closePath=False, lineCap=1, lineJoin=1)
    shape.commit()


def _edit_line(page, item, dims):
    width = dims[0]
    start = pymupdf.Point(_fraction(item["x1"]) * width, _y(item["y1"], page, dims))
    end = pymupdf.Point(_fraction(item["x2"]) * width, _y(item["y2"], page, dims))
    color, stroke = _rgb(item.get("color")), _stroke(item)
    shape = page.new_shape()
    shape.draw_line(start, end)
    shape.finish(color=color, width=stroke, lineCap=1)
    if item["type"] == "arrow" and abs(end - start) > 0:
        import math

        angle = math.atan2(end.y - start.y, end.x - start.x)
        length = max(8.0, stroke * 4)
        wings = [
            pymupdf.Point(end.x - length * math.cos(angle + turn), end.y - length * math.sin(angle + turn))
            for turn in (0.45, -0.45)
        ]
        shape.draw_polyline([wings[0], end, wings[1]])
        shape.finish(color=color, fill=color, width=stroke, closePath=True, lineJoin=1)
    shape.commit()


def _edit_note(page, item, dims):
    point = pymupdf.Point(_fraction(item["x"]) * dims[0], _y(item["y"], page, dims))
    annot = page.add_text_annot(point, str(item.get("text") or ""), icon="Comment")
    annot.set_colors(stroke=_rgb(item.get("color"), (1, 0.83, 0.23)))
    annot.set_info(title="GreyPDF")
    annot.update()


def _edit_box(page, item, images, dims):
    rect = _page_rect(page, item, dims)
    kind = item["type"]
    color = _rgb(item.get("color"))
    fill = _rgb(item["fill"]) if HEX_COLOR_RE.match(str(item.get("fill", ""))) else None
    if kind == "whiteout":
        page.draw_rect(rect, color=None, fill=_rgb(item.get("color"), (1, 1, 1)), width=0)
    elif kind in ("highlight", "underline", "strikeout"):
        # Real markup annotations: viewers list them, and highlights multiply.
        add = {"highlight": page.add_highlight_annot, "underline": page.add_underline_annot,
               "strikeout": page.add_strikeout_annot}[kind]
        annot = add(rect)
        annot.set_colors(stroke=_rgb(item.get("color"), (1, 0.85, 0.2)))
        annot.update()
    elif kind == "rect":
        page.draw_rect(rect, color=color, fill=fill, width=_stroke(item))
    elif kind == "ellipse":
        page.draw_oval(rect, color=color, fill=fill, width=_stroke(item))
    elif kind == "link":
        url = str(item.get("url") or "")
        if not LINK_RE.match(url):
            raise ValueError("One of your links isn't a valid web or email address.")
        page.insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": url})
    elif kind == "image":
        index = int(item["image"])
        if not 0 <= index < len(images):
            raise ValueError("One of the images you added is missing. Add it again.")
        page.insert_image(rect, stream=images[index], keep_proportion=False)


def edit(inputs, output, options):
    """
    Apply the PDF editor's changes. Each page first loses the original text of
    the lines being retyped (by hand or by find & replace), then gets every
    change in the order it was made, so later changes sit on top. Page
    rotations and deletions come last. There is no page limit.
    """
    edits = options.get("edits") or []
    if not edits:
        raise ValueError("Make at least one change first.")
    pdf_path, *image_paths = inputs
    images = [path.read_bytes() for path in image_paths]

    doc = open_pdf(pdf_path, max_pages=None)
    kit = FontKit(pdf_path)
    try:
        replaces = [item for item in edits if item["type"] == "replace" and item.get("find")]
        by_page, rotations, deletions = {}, {}, set()
        for item in edits:
            if item["type"] == "replace":
                continue
            index = _page_index(doc, item)
            if item["type"] == "rotate-page":
                rotations[index] = (rotations.get(index, 0) + int(item.get("degrees", 90))) % 360
            elif item["type"] == "delete-page":
                deletions.add(index)
            else:
                by_page.setdefault(index, []).append(item)

        replaced, wrote_text = 0, False
        for index in range(doc.page_count):
            items = by_page.get(index, [])
            if not items and not replaces:
                continue
            page = doc[index]
            page.remove_rotation()
            retyped = {_source_key(item["source"]) for item in items if item["type"] == "text" and item.get("source")}
            found, count = _replacements(page, index + 1, replaces, retyped)
            replaced += count
            items = found + items
            if not items:
                continue
            dims = (page.rect.width, page.rect.height)
            _remove_original_text(page, items)
            flows = _flows(items, dims[1])
            if flows:
                _reflow(doc, page, flows, dims)
            for item in items:
                item = _shifted(item, flows, dims[1])
                kind = item["type"]
                if kind == "text":
                    _edit_text(page, item, kit, dims)
                    wrote_text = True
                elif kind == "draw":
                    _edit_draw(page, item, dims)
                elif kind in LINE_TYPES:
                    _edit_line(page, item, dims)
                elif kind == "note":
                    _edit_note(page, item, dims)
                else:
                    _edit_box(page, item, images, dims)

        if replaces and not replaced and len(replaces) == len(edits):
            raise ValueError("No text matched, so the PDF was not changed.")
        for index, degrees in rotations.items():
            page = doc[index]
            page.set_rotation((page.rotation + degrees) % 360)
        if deletions:
            if len(deletions) >= doc.page_count:
                raise ValueError("You can't delete every page. Keep at least one.")
            doc.select([number for number in range(doc.page_count) if number not in deletions])
        if wrote_text:
            # Keep only the glyphs used from the fonts the new text brought in.
            try:
                doc.subset_fonts()
            except Exception:
                pass
        _save(doc, output)
        result = {"edits": len(edits)}
        if replaces:
            result["replaced"] = replaced
        return result
    finally:
        kit.close()
        doc.close()


FIELD_TYPES = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "choice",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "choice",
}


def list_form_fields(doc):
    """Describe fillable fields, merging radio buttons that share a name."""
    fields = {}
    for page in doc:
        for widget in page.widgets() or []:
            kind = FIELD_TYPES.get(widget.field_type)
            name = widget.field_name
            if not kind or not name:
                continue
            field = fields.setdefault(
                name,
                {
                    "name": name,
                    "label": widget.field_label or name,
                    "type": kind,
                    "value": "",
                    "options": [],
                    "page": page.number + 1,
                },
            )
            if kind == "radio":
                states = widget.button_states() or {}
                for state in states.get("normal") or []:
                    if state != "Off" and state not in field["options"]:
                        field["options"].append(state)
                if widget.field_value not in (None, "Off", False):
                    field["value"] = str(widget.field_value)
            elif kind == "checkbox":
                field["value"] = widget.field_value not in (None, "Off", False, "")
            elif kind == "choice":
                field["options"] = [
                    option[1] if isinstance(option, (list, tuple)) else option
                    for option in widget.choice_values or []
                ]
                field["value"] = widget.field_value or ""
            else:
                field["value"] = widget.field_value or ""
    return list(fields.values())


def fill_form(inputs, output, options):
    values = options.get("values") or {}
    doc = open_pdf(inputs[0])
    try:
        filled = 0
        for page in doc:
            for widget in page.widgets() or []:
                if widget.field_name not in values:
                    continue
                value = values[widget.field_name]
                if widget.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
                    widget.field_value = bool(value)
                elif widget.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON:
                    states = (widget.button_states() or {}).get("normal") or []
                    widget.field_value = value if value in states else "Off"
                elif widget.field_type in FIELD_TYPES:
                    widget.field_value = str(value)
                else:
                    continue
                widget.update()
                filled += 1
        if filled == 0:
            raise ValueError("This PDF has no fillable fields.")
        if options.get("flatten"):
            doc.bake(annots=False, widgets=True)
        _save(doc, output)
    finally:
        doc.close()


# --------------------------------------------------------------------------
# Repair, pages
# --------------------------------------------------------------------------

def _ghostscript_rewrite(source, output):
    command = shutil.which("gswin64c") or shutil.which("gswin32c") or shutil.which("gs")
    if not command:
        return False
    result = subprocess.run(
        [command, "-sDEVICE=pdfwrite", "-dSAFER", "-dNOPAUSE", "-dQUIET", "-dBATCH",
         f"-sOutputFile={output}", str(source)],
        capture_output=True,
        timeout=120,
    )
    return result.returncode == 0 and output.exists() and output.stat().st_size > 0


def repair(inputs, output, options):
    """PyMuPDF rebuilds broken structure on open; Ghostscript is the second try."""
    unreadable = ValueError(
        "This file is too damaged to repair, or it isn't a PDF."
    )
    try:
        doc = pymupdf.open(str(inputs[0]), filetype="pdf")
    except Exception:
        doc = None

    if doc is not None:
        try:
            if doc.needs_pass:
                raise ValueError(ENCRYPTED_ERROR)
            if doc.page_count > 0:
                was_damaged = doc.is_repaired
                pages = doc.page_count
                _save(doc, output)
                return {"pages": pages, "was_damaged": was_damaged}
        finally:
            doc.close()

    if _ghostscript_rewrite(inputs[0], output):
        check = pymupdf.open(str(output))
        pages = check.page_count
        check.close()
        if pages:
            return {"pages": pages, "was_damaged": True}
    raise unreadable


def remove_pages(inputs, output, options):
    doc = open_pdf(inputs[0])
    try:
        indices = sorted(set(options["indices"]))
        if len(indices) >= doc.page_count:
            raise ValueError("You can't remove every page. Keep at least one.")
        doc.delete_pages(indices)
        _save(doc, output)
        return {"pages": doc.page_count}
    finally:
        doc.close()


def extract_pages(inputs, output, options):
    doc = open_pdf(inputs[0])
    try:
        indices = list(dict.fromkeys(options["indices"]))
        doc.select(indices)
        _save(doc, output)
        return {"pages": len(indices)}
    finally:
        doc.close()


# --------------------------------------------------------------------------
# Compare
# --------------------------------------------------------------------------

def _document_lines(doc):
    """Return lines as lists of (word, page number, rect), in reading order."""
    lines = []
    for page in doc:
        page.remove_rotation()
        grouped = {}
        for x0, y0, x1, y1, word, block, line, _ in page.get_text("words"):
            grouped.setdefault((block, line), []).append((word, page.number, pymupdf.Rect(x0, y0, x1, y1)))
        # Sort by position: an edit can move a line within the PDF's internal
        # order, which would otherwise show the whole line as changed.
        lines.extend(
            sorted(
                grouped.values(),
                key=lambda line: (round(line[0][2].y0 / 3), line[0][2].x0),
            )
        )
    return lines


def _diff_words(old_lines, new_lines):
    """
    Find changed words. Lines are matched first, then words inside changed
    lines, which keeps this fast on long documents.
    """
    removed, added = [], []
    old_text = [" ".join(word for word, _, _ in line) for line in old_lines]
    new_text = [" ".join(word for word, _, _ in line) for line in new_lines]
    matcher = difflib.SequenceMatcher(None, old_text, new_text, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        old_words = [word for line in old_lines[i1:i2] for word in line]
        new_words = [word for line in new_lines[j1:j2] for word in line]
        inner = difflib.SequenceMatcher(
            None, [w[0] for w in old_words], [w[0] for w in new_words], autojunk=False
        )
        for inner_tag, a1, a2, b1, b2 in inner.get_opcodes():
            if inner_tag != "equal":
                removed.extend(old_words[a1:a2])
                added.extend(new_words[b1:b2])
    return removed, added


def _highlight(doc, words, color):
    for _, page_number, rect in words:
        shape = doc[page_number].new_shape()
        shape.draw_rect(rect)
        shape.finish(color=None, fill=color, fill_opacity=0.35)
        shape.commit()


def compare(inputs, output, options):
    """Write a side-by-side PDF with removed words in red and added in green."""
    old = open_pdf(inputs[0])
    new = open_pdf(inputs[1])
    report = pymupdf.open()
    try:
        removed, added = _diff_words(_document_lines(old), _document_lines(new))
        _highlight(old, removed, (0.9, 0.2, 0.2))
        _highlight(new, added, (0.1, 0.7, 0.35))

        for index in range(max(old.page_count, new.page_count)):
            left = old[index] if index < old.page_count else None
            right = new[index] if index < new.page_count else None
            sample = left or right
            width, height = sample.rect.width, sample.rect.height
            sheet = report.new_page(width=width * 2 + 12, height=height + COMPARE_LABEL_HEIGHT)
            sheet.draw_rect(sheet.rect, color=None, fill=(0.93, 0.93, 0.92))
            sheet.insert_text((8, 17), f"Original, page {index + 1}", fontsize=10)
            sheet.insert_text((width + 20, 17), f"Changed, page {index + 1}", fontsize=10)
            top = COMPARE_LABEL_HEIGHT
            left_area = pymupdf.Rect(0, top, width, top + height)
            right_area = pymupdf.Rect(width + 12, top, width * 2 + 12, top + height)
            sheet.draw_rect(left_area, color=None, fill=(1, 1, 1))
            sheet.draw_rect(right_area, color=None, fill=(1, 1, 1))
            if left:
                sheet.show_pdf_page(left_area, old, index)
            if right:
                sheet.show_pdf_page(right_area, new, index)

        report.save(str(output), garbage=4, deflate=True)
        changed_pages = {page for _, page, _ in removed} | {page for _, page, _ in added}
        return {
            "words_removed": len(removed),
            "words_added": len(added),
            "pages_changed": len(changed_pages),
        }
    finally:
        report.close()
        old.close()
        new.close()
