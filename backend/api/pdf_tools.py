"""
Document operations behind the newer tools.

Each public function takes input paths, an output path and the job options,
writes the output file, and may return a dict of results for the user. Celery
lifecycle lives in tasks.py; errors raised as ValueError are shown to users.
"""

import difflib
import io
import re
import shutil
import subprocess

import pymupdf
from django.conf import settings

ENCRYPTED_ERROR = "This PDF is password-protected. Use Unlock PDF first, then try again."
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]*\w")
PHONE_RE = re.compile(r"(?<![\w.])\+?\d[\d\s().-]{7,}\d(?!\w)")
NUMBER_RE = re.compile(r"^-?(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*|0)(?:\.\d+)?$")
PERCENT_RE = re.compile(r"^-?\d+(?:\.\d+)?%$")
PT_TO_EMU = 12700
MAX_SLIDE_POINTS = 4032  # PowerPoint's 56 inch limit
COMPARE_LABEL_HEIGHT = 26


def open_pdf(path):
    """Open a PDF for reading, enforcing the password and page rules."""
    doc = pymupdf.open(str(path))
    if doc.needs_pass:
        doc.close()
        raise ValueError(ENCRYPTED_ERROR)
    if doc.page_count == 0:
        doc.close()
        raise ValueError("This PDF has no pages.")
    limit = getattr(settings, "MAX_PDF_PAGES", 500)
    if doc.page_count > limit:
        count = doc.page_count
        doc.close()
        raise ValueError(f"This PDF has {count} pages. The maximum is {limit}.")
    return doc


def _save(doc, output):
    doc.save(str(output), garbage=4, deflate=True, clean=True)


def _page_rect(page, box):
    """Turn a box of 0..1 fractions of the visible page into page coordinates."""
    width, height = page.rect.width, page.rect.height
    x0 = min(max(float(box["x"]), 0), 1) * width
    y0 = min(max(float(box["y"]), 0), 1) * height
    x1 = min(max(float(box["x"]) + float(box["w"]), 0), 1) * width
    y1 = min(max(float(box["y"]) + float(box["h"]), 0), 1) * height
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
            picture = page.get_pixmap(dpi=150, alpha=False).tobytes("jpeg", jpg_quality=88)
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
