import os
import uuid
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import Job


def _check_page_count(reader_or_doc, context="PDF"):
    """
    Raise if the document exceeds the allowed page count.
    Works with both pypdf PdfReader and fitz Document.
    """
    max_pages = getattr(settings, "MAX_PDF_PAGES", 500)
    pages = getattr(reader_or_doc, "pages", None)
    if pages is not None and not callable(pages):
        count = len(pages)
    else:
        count = len(reader_or_doc)

    if count > max_pages:
        raise ValueError(
            f"{context} has {count} pages — max allowed is {max_pages}."
        )
    return count


def _check_output_size(path, context="Output"):
    """Raise if the output file exceeds the configured cap."""
    max_mb = getattr(settings, "MAX_OUTPUT_SIZE_MB", 200)
    size_mb = os.path.getsize(path) / (1024 * 1024)
    if size_mb > max_mb:
        try:
            os.remove(path)
        except OSError:
            pass
        raise ValueError(f"{context} is {size_mb:.1f} MB — max is {max_mb} MB.")


def _pdf_to_html_document(doc, layout):
    import base64
    import html
    import re
    from statistics import median

    page_markup = []
    has_document_title = False
    for page_number, page in enumerate(doc, start=1):
        page_width = float(page.rect.width)
        page_height = float(page.rect.height)

        if layout == "preserve":
            elements = []
            page_data = page.get_text("dict")
            for block in page_data["blocks"]:
                if block.get("type") == 1 and block.get("image"):
                    image_ext = block.get("ext", "").lower()
                    image_mime = {
                        "jpeg": "image/jpeg",
                        "jpg": "image/jpeg",
                        "png": "image/png",
                        "gif": "image/gif",
                    }.get(image_ext)
                    if image_mime:
                        x0, y0, x1, y1 = block["bbox"]
                        image_data = base64.b64encode(block["image"]).decode("ascii")
                        elements.append(
                            '<img class="pdf-image" '
                            f'style="left:{x0:.2f}pt;top:{y0:.2f}pt;'
                            f'width:{x1 - x0:.2f}pt;height:{y1 - y0:.2f}pt" '
                            f'src="data:{image_mime};base64,{image_data}" '
                            f'alt="Image from page {page_number}">'
                        )
                elif block.get("type") == 0:
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span.get("text", "")
                            if not text:
                                continue
                            x0, y0, x1, y1 = span["bbox"]
                            flags = span.get("flags", 0)
                            color = span.get("color", 0)
                            color_hex = f"#{color & 0xFFFFFF:06x}"
                            styles = [
                                f"left:{x0:.2f}pt",
                                f"top:{y0:.2f}pt",
                                f"font-size:{max(float(span.get('size', 1)), 1):.2f}pt",
                                f"color:{color_hex}",
                            ]
                            if flags & 16:
                                styles.append("font-weight:700")
                            if flags & 2:
                                styles.append("font-style:italic")
                            elements.append(
                                f'<span class="pdf-text" style="{";".join(styles)}">'
                                f"{html.escape(text)}</span>"
                            )

            content = "\n".join(elements)
            page_class = "page page-preserved"
        else:
            blocks = []
            font_sizes = []
            for block in page.get_text("dict", sort=True)["blocks"]:
                if block.get("type") == 1 and block.get("image"):
                    image_ext = block.get("ext", "").lower()
                    image_mime = {
                        "jpeg": "image/jpeg",
                        "jpg": "image/jpeg",
                        "png": "image/png",
                        "gif": "image/gif",
                    }.get(image_ext)
                    if image_mime:
                        image_data = base64.b64encode(block["image"]).decode("ascii")
                        blocks.append(
                            ("image", "", '<figure><img '
                             f'src="data:{image_mime};base64,{image_data}" '
                             f'alt="Image from page {page_number}"></figure>', 0, 0, 1)
                        )
                    continue
                if block.get("type") != 0:
                    continue

                lines = []
                styled_lines = []
                block_sizes = []
                bold_characters = 0
                total_characters = 0
                for line in block.get("lines", []):
                    plain_parts = []
                    styled_parts = []
                    for span in line.get("spans", []):
                        text = span.get("text", "")
                        if not text:
                            continue
                        plain_parts.append(text)
                        escaped_text = html.escape(text)
                        flags = span.get("flags", 0)
                        if flags & 2:
                            escaped_text = f"<em>{escaped_text}</em>"
                        if flags & 16:
                            escaped_text = f"<strong>{escaped_text}</strong>"
                        styled_parts.append(escaped_text)
                        character_count = len(text.strip())
                        total_characters += character_count
                        if flags & 16:
                            bold_characters += character_count
                        size = float(span.get("size", 0))
                        if size > 0:
                            block_sizes.append(size)
                            font_sizes.extend([size] * max(character_count, 1))

                    plain_line = "".join(plain_parts).strip()
                    if plain_line:
                        lines.append(plain_line)
                        styled_lines.append("".join(styled_parts).strip())

                if not lines:
                    continue
                plain_text = " ".join(lines)
                plain_text = re.sub(r"- (?=[a-z])", "", plain_text)
                plain_text = re.sub(r"\s+", " ", plain_text).strip()
                markup = " ".join(styled_lines)
                markup = re.sub(r"- (?=[a-z])", "", markup)
                blocks.append(
                    (
                        "text",
                        plain_text,
                        markup,
                        median(block_sizes) if block_sizes else 0,
                        bold_characters / total_characters if total_characters else 0,
                        len(lines),
                    )
                )

            body_size = median(font_sizes) if font_sizes else 10
            content_parts = []
            list_items = []

            def flush_list():
                if list_items:
                    content_parts.append("<ul>\n" + "\n".join(list_items) + "\n</ul>")
                    list_items.clear()

            for kind, plain_text, markup, font_size, bold_ratio, line_count in blocks:
                if kind == "image":
                    flush_list()
                    content_parts.append(markup)
                    continue

                bullet = re.match(r"^\s*[•●▪◦‣*-]\s*(.+)$", plain_text)
                if bullet:
                    list_items.append(f"<li>{html.escape(bullet.group(1))}</li>")
                    continue
                flush_list()

                letters = [character for character in plain_text if character.isalpha()]
                is_uppercase_label = (
                    len(plain_text) <= 90
                    and bool(letters)
                    and all(character.isupper() for character in letters)
                    and bold_ratio >= 0.5
                )
                if line_count == 1 and font_size >= body_size * 1.5:
                    tag = "h2" if has_document_title else "h1"
                    has_document_title = True
                elif line_count == 1 and (
                    font_size >= body_size * 1.2 or is_uppercase_label
                ):
                    tag = "h2"
                else:
                    tag = "p"
                content_parts.append(f"<{tag}>{markup}</{tag}>")

            flush_list()
            content = "\n".join(content_parts)
            page_class = "page page-readable"

        page_style = (
            f' style="--page-width:{page_width:.2f}pt;'
            f'--page-height:{page_height:.2f}pt"'
            if layout == "preserve"
            else ""
        )
        page_markup.append(
            f'<section class="{page_class}"{page_style} '
            f'aria-label="Page {page_number}">\n'
            f"{content}\n"
            "</section>"
        )

    return (
        "<!doctype html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="utf-8">\n'
        '  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "  <title>PDF converted to HTML</title>\n"
        "  <style>\n"
        "    :root { color-scheme: light; font-family: Arial, sans-serif; }\n"
        "    * { box-sizing: border-box; }\n"
        "    body { margin: 0; padding: 40px 20px; background: #f3f4f6; color: #1f2937; }\n"
        "    main { max-width: 850px; margin: 0 auto; padding: 48px; background: #fff; "
        "box-shadow: 0 2px 16px #17203318; }\n"
        "    .page-readable { line-height: 1.65; overflow-wrap: anywhere; }\n"
        "    .page-readable + .page-readable { margin-top: 40px; padding-top: 40px; "
        "border-top: 1px solid #e5e7eb; }\n"
        "    h1 { margin: 0 0 1.25em; font-size: 2em; line-height: 1.2; color: #111827; }\n"
        "    h2 { margin: 1.7em 0 .65em; font-size: 1.15em; line-height: 1.3; "
        "color: #111827; }\n"
        "    p { margin: 0 0 1em; }\n"
        "    ul { margin: 0 0 1em; padding-left: 1.5em; }\n"
        "    li { margin-bottom: .4em; }\n"
        "    figure { margin: 1.5em 0; }\n"
        "    figure img { display: block; max-width: 100%; height: auto; }\n"
        "    .page-preserved { position: relative; width: var(--page-width); "
        "min-height: var(--page-height); max-width: 100%; margin: 0 auto 24px; "
        "padding: 0; background: #fff; overflow: hidden; }\n"
        "    .pdf-text, .pdf-image { position: absolute; }\n"
        "    .pdf-text { white-space: pre; line-height: 1; transform-origin: left top; }\n"
        "    .pdf-image { object-fit: fill; }\n"
        "    @media (max-width: 700px) { body { padding: 12px; } main { padding: 24px; } }\n"
        "    @media print { body { padding: 0; background: #fff; } "
        "      main { max-width: none; padding: 0; box-shadow: none; } "
        "      .page-readable + .page-readable { margin-top: 0; padding-top: 0; "
        "border-top: 0; break-before: page; } }\n"
        "  </style>\n"
        "</head>\n"
        "<body>\n"
        "<main>\n"
        + "\n".join(page_markup)
        + "\n</main>\n"
        "</body>\n"
        "</html>\n"
    )

@shared_task(bind=True, autoretry_for=(), max_retries=0)
def merge_pdf_task(self, job_id):
    """
    Merge PDFs for the given Job. Runs in a Celery worker.
    """
    from pypdf import PdfWriter, PdfReader

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        input_paths = [upload_dir / name for name in job.input_files]

        for p in input_paths:
            if not p.exists():
                raise FileNotFoundError(f"Input file missing: {p.name}")

        # Merge with page count guard
        writer = PdfWriter()
        total_pages = 0
        for path in input_paths:
            reader = PdfReader(str(path))
            total_pages += _check_page_count(reader)
            if total_pages > getattr(settings, "MAX_PDF_PAGES", 500):
                raise ValueError(
                    f"Merged PDF has {total_pages} pages — max allowed is "
                    f"{settings.MAX_PDF_PAGES}."
                )
            for page in reader.pages:
                writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name

        with open(output_path, "wb") as out:
            writer.write(out)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        for p in input_paths:
            try:
                os.remove(p)
            except OSError:
                pass

        return {"status": "completed", "output": job.output_file}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise



@shared_task(autoretry_for=(), max_retries=0)
def cleanup_old_files():
    """
    Runs every 15 min. Deletes files older than FILE_RETENTION_HOURS
    and old Job records older than 24 hours.
    """
    from datetime import timedelta

    retention_hours = getattr(settings, "FILE_RETENTION_HOURS", 2)
    cutoff = timezone.now() - timedelta(hours=retention_hours)
    job_cutoff = timezone.now() - timedelta(hours=24)

    media_root = Path(settings.MEDIA_ROOT)
    deleted_files = 0
    deleted_jobs = 0

    # Delete old files
    for subfolder in ["uploads", "outputs"]:
        folder = media_root / subfolder
        if not folder.exists():
            continue
        for filepath in folder.iterdir():
            if not filepath.is_file():
                continue
            try:
                if filepath.stat().st_mtime < cutoff.timestamp():
                    os.remove(filepath)
                    deleted_files += 1
            except OSError:
                pass

    # Delete old Job records
    old_jobs = Job.objects.filter(created_at__lt=job_cutoff)
    deleted_jobs = old_jobs.count()
    old_jobs.delete()

    return {
        "deleted_files": deleted_files,
        "deleted_jobs": deleted_jobs,
    }




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def split_pdf_task(self, job_id):
    """
    Split a PDF. Expects job.input_files = [filename] and job.options.
    Options:
      - mode: "each" (one file per page) | "range"
      - ranges: "1-3,5,7-9" (only if mode is "range")
    Output: a single ZIP file containing the split PDFs.
    """
    import zipfile
    from pypdf import PdfReader, PdfWriter

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found for this job.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        reader = PdfReader(str(input_path))
        total_pages = _check_page_count(reader)

        # Build a list of page groups to write
        options = job.options or {}
        mode = options.get("mode", "each")
        groups = []  # list of (label, [page_indices])

        if mode == "each":
            for i in range(total_pages):
                groups.append((f"page-{i + 1}", [i]))
        elif mode == "range":
            ranges_str = options.get("ranges", "").strip()
            if not ranges_str:
                raise ValueError("No ranges provided.")
            for part in ranges_str.split(","):
                part = part.strip()
                if "-" in part:
                    start, end = part.split("-")
                    start, end = int(start) - 1, int(end) - 1
                    if start < 0 or end >= total_pages or start > end:
                        raise ValueError(f"Invalid range: {part}")
                    groups.append((f"{start + 1}-{end + 1}", list(range(start, end + 1))))
                else:
                    idx = int(part) - 1
                    if idx < 0 or idx >= total_pages:
                        raise ValueError(f"Invalid page: {part}")
                    groups.append((f"{idx + 1}", [idx]))
        else:
            raise ValueError(f"Unknown split mode: {mode}")

        # Write each group to a separate PDF, then zip them
        zip_name = f"{uuid.uuid4().hex}.zip"
        zip_path = output_dir / zip_name

        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            written_files = []
            for label, page_indices in groups:
                writer = PdfWriter()
                for idx in page_indices:
                    writer.add_page(reader.pages[idx])
                out_name = f"{label}.pdf"
                out_path = Path(tmpdir) / out_name
                with open(out_path, "wb") as f:
                    writer.write(f)
                written_files.append((out_name, out_path))

            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for name, path in written_files:
                    zf.write(path, arcname=name)

        job.status = "completed"
        job.output_file = f"outputs/{zip_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        # Clean up input
        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed", "output": job.output_file}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise



@shared_task(bind=True, autoretry_for=(), max_retries=0)
def compress_pdf_task(self, job_id):
    """
    Compress a PDF with Ghostscript.
    Options: quality = 'screen' | 'ebook' | 'printer' | 'prepress' (default: 'ebook')
    """
    import subprocess
    import shutil
    from pypdf import PdfReader

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        _check_page_count(PdfReader(str(input_path)))
        quality = (job.options or {}).get("quality", "ebook")

        # Ghostscript quality presets
        gs_preset = {
            "screen": "/screen",
            "ebook": "/ebook",
            "printer": "/printer",
            "prepress": "/prepress",
        }.get(quality, "/ebook")

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name

        # Find Ghostscript executable
        gs_cmd = shutil.which("gswin64c") or shutil.which("gswin32c") or shutil.which("gs")
        if not gs_cmd:
            raise RuntimeError(
                "Ghostscript not found. Install from ghostscript.com and add to PATH."
            )

        cmd = [
            gs_cmd,
            "-sDEVICE=pdfwrite",
            "-dCompatibilityLevel=1.4",
            f"-dPDFSETTINGS={gs_preset}",
            "-dNOPAUSE",
            "-dQUIET",
            "-dBATCH",
            f"-sOutputFile={output_path}",
            str(input_path),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise RuntimeError(f"Ghostscript failed: {result.stderr[:500]}")

        if not output_path.exists():
            raise RuntimeError("Ghostscript produced no output.")

        original_size = input_path.stat().st_size
        compressed_size = output_path.stat().st_size
        savings = 0
        if original_size > 0:
            savings = round((1 - compressed_size / original_size) * 100, 1)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.options = {
            **(job.options or {}),
            "original_size": original_size,
            "compressed_size": compressed_size,
            "savings_percent": savings,
        }
        job.save(update_fields=["status", "output_file", "completed_at", "options"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed", "savings_percent": savings}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise



@shared_task(bind=True, autoretry_for=(), max_retries=0)
def rotate_pdf_task(self, job_id):
    """
    Rotate PDF pages.
    Options:
      - angle: 90 | 180 | 270 (clockwise degrees)
      - pages: "all" | "1,3,5" | "1-3,7"
    """
    from pypdf import PdfReader, PdfWriter

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        angle = int(options.get("angle", 90))
        if angle not in (90, 180, 270):
            raise ValueError("Angle must be 90, 180, or 270.")

        pages_spec = options.get("pages", "all")

        reader = PdfReader(str(input_path))
        total_pages = _check_page_count(reader)

        # Determine which page indices to rotate (0-based)
        if pages_spec == "all" or not pages_spec:
            indices_to_rotate = set(range(total_pages))
        else:
            indices_to_rotate = set()
            for part in pages_spec.split(","):
                part = part.strip()
                if "-" in part:
                    start, end = part.split("-")
                    start, end = int(start) - 1, int(end) - 1
                    if start < 0 or end >= total_pages or start > end:
                        raise ValueError(f"Invalid range: {part}")
                    indices_to_rotate.update(range(start, end + 1))
                else:
                    idx = int(part) - 1
                    if idx < 0 or idx >= total_pages:
                        raise ValueError(f"Invalid page: {part}")
                    indices_to_rotate.add(idx)

        writer = PdfWriter()
        for i, page in enumerate(reader.pages):
            if i in indices_to_rotate:
                page.rotate(angle)
            writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as out:
            writer.write(out)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed", "angle": angle}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise



@shared_task(bind=True, autoretry_for=(), max_retries=0)
def pdf_to_jpg_task(self, job_id):
    """
    Convert each page of a PDF to a JPG image.
    Options:
      - dpi: 72 | 150 | 300 (default: 150)
    Output: ZIP containing one JPG per page.
    """
    import zipfile
    import tempfile
    import pymupdf as fitz

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        dpi = int(options.get("dpi", 150))
        if dpi not in (72, 150, 300):
            dpi = 150

        doc = fitz.open(str(input_path))
        try:
            total_pages = _check_page_count(doc)
            if total_pages == 0:
                raise ValueError("PDF has no pages.")

            zip_name = f"{uuid.uuid4().hex}.zip"
            zip_path = output_dir / zip_name

            with tempfile.TemporaryDirectory() as tmpdir:
                written = []
                for i, page in enumerate(doc):
                    zoom = dpi / 72.0
                    matrix = fitz.Matrix(zoom, zoom)
                    pix = page.get_pixmap(matrix=matrix, alpha=False)
                    jpg_name = f"page-{i + 1}.jpg"
                    jpg_path = Path(tmpdir) / jpg_name
                    pix.save(str(jpg_path))
                    written.append((jpg_name, jpg_path))

                with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                    for name, path in written:
                        zf.write(path, arcname=name)
        finally:
            doc.close()

        job.status = "completed"
        job.output_file = f"outputs/{zip_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {
            "status": "completed",
            "pages": total_pages,
            "dpi": dpi,
        }

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def jpg_to_pdf_task(self, job_id):
    """
    Combine multiple images (JPG/PNG) into a single PDF.
    Options:
      - page_size: "A4" | "Letter" | "auto" (default: "auto")
    """
    import img2pdf

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input files found.")

        input_paths = [upload_dir / name for name in job.input_files]
        for p in input_paths:
            if not p.exists():
                raise FileNotFoundError(f"Input file missing: {p.name}")

        if len(input_paths) > getattr(settings, "MAX_PDF_PAGES", 500):
            raise ValueError(
                f"PDF has {len(input_paths)} pages — max allowed is "
                f"{settings.MAX_PDF_PAGES}."
            )

        options = job.options or {}
        page_size = options.get("page_size", "auto")

        # img2pdf page size presets (in points, 72 dpi)
        # A4 = 595 x 842, Letter = 612 x 792
        # "auto" → use image dimensions per page
        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name

        # convert_kwargs = {
        #     "outputstream": None,  # set below
        # }

        with open(output_path, "wb") as f:
            if page_size == "A4":
                layout_fn = img2pdf.get_layout_fun(
                    (img2pdf.mm_to_pt(210), img2pdf.mm_to_pt(297))
                )
                img2pdf.convert(
                    [str(p) for p in input_paths],
                    outputstream=f,
                    layout_fun=layout_fn,
                )
            elif page_size == "Letter":
                layout_fn = img2pdf.get_layout_fun(
                    (img2pdf.in_to_pt(8.5), img2pdf.in_to_pt(11))
                )
                img2pdf.convert(
                    [str(p) for p in input_paths],
                    outputstream=f,
                    layout_fun=layout_fn,
                )
            else:
                # auto — no layout_fun at all
                img2pdf.convert(
                    [str(p) for p in input_paths],
                    outputstream=f,
                )

        if not output_path.exists():
            raise RuntimeError("img2pdf produced no output.")

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        # Clean up inputs
        for p in input_paths:
            try:
                os.remove(p)
            except OSError:
                pass

        return {"status": "completed", "images": len(input_paths)}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def protect_pdf_task(self, job_id):
    """
    Add password protection + optional permissions.
    Options:
      - password: string
      - allow_printing: bool (default True)
      - allow_copying: bool (default True)
    """
    from pypdf import PdfReader, PdfWriter

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        # Retrieve password from Redis (not from DB)
        import redis as _redis
        import os as _os

        r = _redis.from_url(_os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        redis_key = f"pdf_password:{job.id}"
        password = (r.get(redis_key) or b"").decode("utf-8").strip()
        r.delete(redis_key)   # clean up immediately after reading

        allow_printing = (job.options or {}).get("allow_printing", True)
        allow_copying = (job.options or {}).get("allow_copying", True)

        if not password:
            raise ValueError("Password is required.")
        if len(password) < 4:
            raise ValueError("Password must be at least 4 characters.")

        reader = PdfReader(str(input_path))
        _check_page_count(reader)
        writer = PdfWriter()

        for page in reader.pages:
            writer.add_page(page)

        writer.encrypt(
            user_password=password,
            owner_password=password,
            permissions_flag=(
                (0b0100 if allow_printing else 0)
                | (0b0001 if allow_copying else 0)
            ),
        )

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            writer.write(f)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed"}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def unlock_pdf_task(self, job_id):
    """
    Remove password from a PDF.
    Options:
      - password: string (the current password)
    """
    from pypdf import PdfReader, PdfWriter
    from pypdf.errors import FileNotDecryptedError

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        # Retrieve password from Redis (not from DB)
        import redis as _redis
        import os as _os

        r = _redis.from_url(_os.getenv("REDIS_URL", "redis://localhost:6379/0"))
        redis_key = f"pdf_password:{job.id}"
        password = (r.get(redis_key) or b"").decode("utf-8").strip()
        r.delete(redis_key)

        reader = PdfReader(str(input_path))

        if reader.is_encrypted:
            if not password:
                raise ValueError("This PDF is password-protected. Enter the password.")
            result = reader.decrypt(password)
            if result == 0:
                raise ValueError("Incorrect password.")

        _check_page_count(reader)
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            writer.write(f)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed"}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def watermark_pdf_task(self, job_id):
    """
    Add a text watermark to every page.
    Options:
      - text: string
      - font_size: int (default: 60)
      - opacity: float 0..1 (default: 0.3)
      - color: hex "#RRGGBB" (default: "#FF0000")
      - position: "center" | "diagonal" (default: "diagonal")
    """
    import io
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import letter
    from pypdf import PdfReader, PdfWriter

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        text = str(options.get("text", "")).strip()
        if not text:
            raise ValueError("Watermark text is required.")

        font_size = int(options.get("font_size", 60))
        opacity = float(options.get("opacity", 0.3))
        color_hex = options.get("color", "#FF0000")
        position = options.get("position", "diagonal")

        # Clamp values
        font_size = max(10, min(font_size, 200))
        opacity = max(0.05, min(opacity, 1.0))
        if not color_hex.startswith("#"):
            color_hex = "#FF0000"

        try:
            color = HexColor(color_hex)
        except Exception:
            color = HexColor("#FF0000")

        reader = PdfReader(str(input_path))
        _check_page_count(reader)
        writer = PdfWriter()

        for page in reader.pages:
            # Get page dimensions (in points)
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            # Create a transparent overlay PDF the same size as this page
            packet = io.BytesIO()
            can = rl_canvas.Canvas(packet, pagesize=(page_width, page_height))

            can.saveState()
            try:
                can.setFillAlpha(opacity)
            except Exception:
                pass

            can.setFillColor(color)
            can.setFont("Helvetica-Bold", font_size)

            if position == "diagonal":
                # Rotate 45° and draw from bottom-left to top-right
                can.translate(page_width / 2, page_height / 2)
                can.rotate(45)
                text_width = can.stringWidth(text, "Helvetica-Bold", font_size)
                can.drawString(-text_width / 2, -font_size / 3, text)
            else:
                # Center horizontally and vertically
                text_width = can.stringWidth(text, "Helvetica-Bold", font_size)
                can.drawString(
                    (page_width - text_width) / 2,
                    (page_height - font_size) / 2,
                    text,
                )

            can.restoreState()
            can.save()
            packet.seek(0)

            overlay = PdfReader(packet)
            overlay_page = overlay.pages[0]

            # Merge overlay onto the current page
            page.merge_page(overlay_page)
            writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            writer.write(f)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed"}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def page_numbers_task(self, job_id):
    """
    Add page numbers to every page.
    Options:
      - position: "bottom-center" | "bottom-right" | "bottom-left"
                  | "top-center" | "top-right" | "top-left"
                  (default: "bottom-center")
      - format: "number" | "page-n" | "n-of-total" (default: "number")
      - start: int (default: 1)
      - font_size: int (default: 12)
      - margin: int in points (default: 40)
    """
    import io
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.lib.colors import HexColor
    from pypdf import PdfReader, PdfWriter

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        position = options.get("position", "bottom-center")
        fmt = options.get("format", "number")
        start = int(options.get("start", 1))
        font_size = int(options.get("font_size", 12))
        margin = int(options.get("margin", 40))

        if position not in (
            "bottom-center", "bottom-right", "bottom-left",
            "top-center", "top-right", "top-left",
        ):
            position = "bottom-center"
        if fmt not in ("number", "page-n", "n-of-total"):
            fmt = "number"

        font_size = max(8, min(font_size, 30))
        margin = max(20, min(margin, 100))

        reader = PdfReader(str(input_path))
        total_pages = _check_page_count(reader)
        writer = PdfWriter()

        for idx, page in enumerate(reader.pages):
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            current_num = start + idx

            # Build the text
            if fmt == "number":
                label = str(current_num)
            elif fmt == "page-n":
                label = f"Page {current_num}"
            else:  # n-of-total
                label = f"{current_num} / {total_pages + start - 1}"

            # Overlay PDF
            packet = io.BytesIO()
            can = rl_canvas.Canvas(packet, pagesize=(page_width, page_height))
            can.setFont("Helvetica", font_size)
            can.setFillColor(HexColor("#000000"))

            text_width = can.stringWidth(label, "Helvetica", font_size)

            # X position
            if "left" in position:
                x = margin
            elif "right" in position:
                x = page_width - margin - text_width
            else:  # center
                x = (page_width - text_width) / 2

            # Y position
            if position.startswith("top"):
                y = page_height - margin
            else:  # bottom
                y = margin

            can.drawString(x, y, label)
            can.save()
            packet.seek(0)

            overlay = PdfReader(packet)
            page.merge_page(overlay.pages[0])
            writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            writer.write(f)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed", "pages": total_pages}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def organize_pdf_task(self, job_id):
    """
    Reorder pages based on a new order.
    Options:
      - order: list of ints (1-based page numbers) e.g. [3, 1, 2]
        Pages not in the list are dropped (that's how deletion works).
      - duplicates allowed (a page can appear multiple times)
    """
    from pypdf import PdfReader, PdfWriter

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        order = options.get("order") or []

        if not isinstance(order, list) or not order:
            raise ValueError("Page order is required.")

        reader = PdfReader(str(input_path))
        total_pages = _check_page_count(reader)

        # Validate all page numbers
        normalized = []
        for raw in order:
            try:
                n = int(raw)
            except (TypeError, ValueError):
                raise ValueError(f"Invalid page number: {raw}")
            if n < 1 or n > total_pages:
                raise ValueError(
                    f"Page {n} does not exist (PDF has {total_pages} pages)."
                )
            normalized.append(n - 1)  # convert to 0-based

        writer = PdfWriter()
        for idx in normalized:
            writer.add_page(reader.pages[idx])

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            writer.write(f)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {
            "status": "completed",
            "output_pages": len(normalized),
            "original_pages": total_pages,
        }

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def crop_pdf_task(self, job_id):
    """
    Crop PDF pages by trimming margins.
    Options:
      - top, bottom, left, right: points (72pt = 1 inch)
      - apply_to: "all" | "first" | "last"
    The crop box shrinks from all four sides.
    """
    from pypdf import PdfReader, PdfWriter

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        top = float(options.get("top", 0))
        bottom = float(options.get("bottom", 0))
        left = float(options.get("left", 0))
        right = float(options.get("right", 0))
        apply_to = options.get("apply_to", "all")

        if top < 0 or bottom < 0 or left < 0 or right < 0:
            raise ValueError("Crop amounts must be positive.")
        if top + bottom <= 0 and left + right <= 0:
            raise ValueError("Please specify at least one crop amount.")

        reader = PdfReader(str(input_path))
        total_pages = _check_page_count(reader)

        # Determine which pages to crop
        if apply_to == "first":
            targets = {0}
        elif apply_to == "last":
            targets = {total_pages - 1}
        else:
            targets = set(range(total_pages))

        writer = PdfWriter()
        for idx, page in enumerate(reader.pages):
            if idx in targets:
                # mediabox = (left, bottom, right, top) in PDF coordinates
                mb = page.mediabox
                new_left = float(mb.left) + left
                new_right = float(mb.right) - right
                new_bottom = float(mb.bottom) + bottom
                new_top = float(mb.top) - top

                if new_right <= new_left or new_top <= new_bottom:
                    raise ValueError(
                        f"Crop too large for page {idx + 1} "
                        f"(page is {float(mb.width):.0f}×{float(mb.height):.0f} pt)."
                    )

                # Set cropbox AND mediabox so most viewers respect it
                page.cropbox.lower_left = (new_left, new_bottom)
                page.cropbox.upper_right = (new_right, new_top)
                page.mediabox.lower_left = (new_left, new_bottom)
                page.mediabox.upper_right = (new_right, new_top)

            writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            writer.write(f)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed", "pages": total_pages}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def html_to_pdf_task(self, job_id):
    """
    Convert HTML content to PDF.
    Options:
      - html: HTML string
    """
    import io
    import ironpress
    from pypdf import PdfReader

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        options = job.options or {}
        html_content = options.get("html", "").strip()

        if not html_content:
            raise ValueError("HTML content is required.")

        # IronPress sanitizes HTML and does not fetch remote HTTP resources.
        pdf_bytes = ironpress.html_to_pdf(html_content)
        _check_page_count(PdfReader(io.BytesIO(pdf_bytes)))

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            f.write(pdf_bytes)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        return {"status": "completed"}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def pdf_to_html_task(self, job_id):
    """
    Extract text from a PDF and produce an HTML file.
    Options:
      - layout: "simple" | "preserve" (default: "simple")
    """
    import pymupdf as fitz

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        layout = options.get("layout", "simple")
        if layout not in ("simple", "preserve"):
            layout = "simple"

        doc = fitz.open(str(input_path))
        try:
            total_pages = _check_page_count(doc)
            html_output = _pdf_to_html_document(doc, layout)
        finally:
            doc.close()

        output_name = f"{uuid.uuid4().hex}.html"
        output_path = output_dir / output_name
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(html_output)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed", "pages": total_pages}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        # Re-raise so Celery marks this task as FAILED (visible in monitoring)
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def markdown_to_pdf_task(self, job_id):
    """
    Convert Markdown to PDF.
    Options:
      - markdown: Markdown string
    """
    import io
    import ironpress
    from pypdf import PdfReader

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        options = job.options or {}
        md_content = options.get("markdown", "")
        if not isinstance(md_content, str) or not md_content.strip():
            raise ValueError("Markdown content is required.")

        pdf_bytes = ironpress.markdown_to_pdf(md_content)
        _check_page_count(PdfReader(io.BytesIO(pdf_bytes)))

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            f.write(pdf_bytes)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        return {"status": "completed"}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def pdf_to_markdown_task(self, job_id):
    """
    Extract content from a PDF and produce a Markdown file.
    Options:
      - layout: "simple" | "preserve" (default: "preserve")
    """
    import pymupdf as fitz

    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)

        if not job.input_files:
            raise ValueError("No input file found.")

        input_path = upload_dir / job.input_files[0]
        if not input_path.exists():
            raise FileNotFoundError(f"Input file missing: {input_path.name}")

        options = job.options or {}
        layout = options.get("layout", "preserve")
        if layout not in ("simple", "preserve"):
            layout = "preserve"

        doc = fitz.open(str(input_path))
        total_pages = _check_page_count(doc)

        md_parts = []

        try:
            if layout == "preserve":
                # PyMuPDF built-in markdown export — keeps headings, tables, links
                for page in doc:
                    md_parts.append(page.get_text("markdown"))
            else:
                # Simple layout — plain text per page with page separators
                for i, page in enumerate(doc):
                    text = page.get_text("text").strip()
                    if not text:
                        continue
                    md_parts.append(f"## Page {i + 1}\n")
                    md_parts.append(text)
                    md_parts.append("")
        finally:
            doc.close()

        md_output = "\n\n".join(md_parts).strip()
        if not md_output:
            raise ValueError(
                "No extractable text found. The PDF may be a scanned image "
                "(needs OCR)."
            )

        output_name = f"{uuid.uuid4().hex}.md"
        output_path = output_dir / output_name
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(md_output)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        _check_output_size(Path(settings.MEDIA_ROOT) / job.output_file)
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        try:
            os.remove(input_path)
        except OSError:
            pass

        return {"status": "completed", "pages": total_pages}

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save(update_fields=["status", "error_message"])
        raise