import os
import uuid
from datetime import datetime
from pathlib import Path

from celery import shared_task
from django.conf import settings

from .models import Job


@shared_task(bind=True)
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

        # job.input_files holds the uploaded filenames
        input_paths = [upload_dir / name for name in job.input_files]

        # Verify all files exist
        for p in input_paths:
            if not p.exists():
                raise FileNotFoundError(f"Input file missing: {p.name}")

        # Merge
        writer = PdfWriter()
        for path in input_paths:
            reader = PdfReader(str(path))
            for page in reader.pages:
                writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name

        with open(output_path, "wb") as out:
            writer.write(out)

        # Mark complete
        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        job.completed_at = datetime.now()
        job.save(update_fields=["status", "output_file", "completed_at"])

        # Clean up uploaded inputs (they're no longer needed)
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
        return {"error": str(e)}



@shared_task
def cleanup_old_files():
    """
    Runs every 15 min. Deletes files older than FILE_RETENTION_HOURS
    and old Job records older than 24 hours.
    """
    from datetime import timedelta
    from django.utils import timezone

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
                mtime = datetime.fromtimestamp(filepath.stat().st_mtime)
                if mtime < cutoff.replace(tzinfo=None):
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




@shared_task(bind=True)
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
        total_pages = len(reader.pages)

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
        job.completed_at = datetime.now()
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
        return {"error": str(e)}



@shared_task(bind=True)
def compress_pdf_task(self, job_id):
    """
    Compress a PDF with Ghostscript.
    Options: quality = 'screen' | 'ebook' | 'printer' | 'prepress' (default: 'ebook')
    """
    import subprocess
    import shutil

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
        job.completed_at = datetime.now()
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
        return {"error": str(e)}



@shared_task(bind=True)
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
        total_pages = len(reader.pages)

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
                current = page.get("/Rotate", 0)
                page.rotate(angle)
            writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as out:
            writer.write(out)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        job.completed_at = datetime.now()
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
        return {"error": str(e)}



@shared_task(bind=True)
def pdf_to_jpg_task(self, job_id):
    """
    Convert each page of a PDF to a JPG image.
    Options:
      - dpi: 72 | 150 | 300 (default: 150)
    Output: ZIP containing one JPG per page.
    """
    import zipfile
    import tempfile
    import fitz  # PyMuPDF

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

        # Render each page to JPG
        doc = fitz.open(str(input_path))
        total_pages = len(doc)
        if total_pages == 0:
            raise ValueError("PDF has no pages.")

        zip_name = f"{uuid.uuid4().hex}.zip"
        zip_path = output_dir / zip_name

        with tempfile.TemporaryDirectory() as tmpdir:
            written = []
            for i, page in enumerate(doc):
                # scale = dpi / 72 (PDF default is 72 dpi)
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

        doc.close()

        job.status = "completed"
        job.output_file = f"outputs/{zip_name}"
        job.completed_at = datetime.now()
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
        return {"error": str(e)}




@shared_task(bind=True)
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

        options = job.options or {}
        page_size = options.get("page_size", "auto")

        # img2pdf page size presets (in points, 72 dpi)
        # A4 = 595 x 842, Letter = 612 x 792
        # "auto" → use image dimensions per page
        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name

        convert_kwargs = {
            "outputstream": None,  # set below
        }

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
        job.completed_at = datetime.now()
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
        return {"error": str(e)}




@shared_task(bind=True)
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

        options = job.options or {}
        password = options.get("password", "").strip()
        allow_printing = options.get("allow_printing", True)
        allow_copying = options.get("allow_copying", True)

        if not password:
            raise ValueError("Password is required.")
        if len(password) < 4:
            raise ValueError("Password must be at least 4 characters.")

        reader = PdfReader(str(input_path))
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
        job.completed_at = datetime.now()
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
        return {"error": str(e)}




@shared_task(bind=True)
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

        options = job.options or {}
        password = options.get("password", "").strip()

        reader = PdfReader(str(input_path))

        if reader.is_encrypted:
            if not password:
                raise ValueError("This PDF is password-protected. Enter the password.")
            result = reader.decrypt(password)
            if result == 0:
                raise ValueError("Incorrect password.")

        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)

        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name
        with open(output_path, "wb") as f:
            writer.write(f)

        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        job.completed_at = datetime.now()
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
        return {"error": str(e)}




@shared_task(bind=True)
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
                can.drawString(-text_width / 2, -font_size / 3)
            else:
                # Center horizontally and vertically
                text_width = can.stringWidth(text, "Helvetica-Bold", font_size)
                can.drawString(
                    (page_width - text_width) / 2,
                    (page_height - font_size) / 2,
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
        job.completed_at = datetime.now()
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
        return {"error": str(e)}




@shared_task(bind=True)
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
        total_pages = len(reader.pages)
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
        job.completed_at = datetime.now()
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
        return {"error": str(e)}