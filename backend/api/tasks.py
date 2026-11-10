import io
import logging
import os
import re
import shutil
import subprocess
import uuid
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from . import office_tools, pdf_tools
from .models import Job
from .pdf_structure import render_html, render_markdown

logger = logging.getLogger(__name__)

WATERMARK_TEXT_ERROR = (
    "Watermarks currently support Latin characters only (English and most "
    "European languages)."
)


def is_watermark_text_supported(text):
    """The stamp font is Helvetica, which draws anything else as solid boxes."""
    try:
        text.encode("cp1252")
    except UnicodeEncodeError:
        return False
    return True



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


def _friendly_error(exc):
    """
    Turn an exception into a message that is safe and useful to show users.
    Library errors can contain server paths, so only pass through our own
    ValueErrors and map the rest.
    """
    from billiard.exceptions import SoftTimeLimitExceeded
    from pymupdf import FileDataError
    from pypdf.errors import EmptyFileError, FileNotDecryptedError, PdfReadError, PdfStreamError

    message = str(exc)
    lowered = message.lower()

    if isinstance(exc, FileNotDecryptedError) or "encrypted" in lowered or "decrypted" in lowered:
        return "This PDF is password-protected. Use Unlock PDF first, then try again."
    if isinstance(exc, (EmptyFileError, PdfStreamError, PdfReadError, FileDataError)) or (
        "failed to open file" in lowered or "cannot open" in lowered
    ):
        return "This file could not be read. It may be damaged or not a real PDF."
    if isinstance(exc, (SoftTimeLimitExceeded, subprocess.TimeoutExpired)):
        return "This file took too long to process. Try a smaller file."
    if isinstance(exc, ValueError) and message and "invalid literal" not in lowered:
        return message

    logger.error("Unexpected job failure", exc_info=exc)
    return "Something went wrong while processing this file. Please try again."


def _parse_page_ranges(spec, total_pages):
    """
    Parse "1-3,5" into [("1-3", [0, 1, 2]), ("5", [4])], using 0-based indices.
    Raises a ValueError with a message written for the user.
    """
    groups = []
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        match = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", part)
        if not match:
            raise ValueError(f'"{part}" is not a valid page range. Use a format like 1-3,5.')
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start < 1 or end > total_pages or start > end:
            raise ValueError(f'"{part}" is outside this PDF, which has {total_pages} pages.')
        label = str(start) if start == end else f"{start}-{end}"
        groups.append((label, list(range(start - 1, end))))
    if not groups:
        raise ValueError("Enter at least one page or range, like 1-3,5.")
    return groups


def _visible_box(page):
    """
    Bake any /Rotate into the content, then return the box viewers display.
    After this, drawing coordinates match what the user sees on screen.
    """
    page.transfer_rotation_to_content()
    box = page.cropbox
    return float(box.left), float(box.bottom), float(box.width), float(box.height)


def _stamp_page(page, draw):
    """Overlay `draw(canvas, width, height)` on the visible area of a page."""
    from pypdf import PdfReader, Transformation
    from reportlab.pdfgen import canvas as rl_canvas

    left, bottom, width, height = _visible_box(page)
    packet = io.BytesIO()
    canvas = rl_canvas.Canvas(packet, pagesize=(width, height))
    draw(canvas, width, height)
    canvas.save()
    packet.seek(0)
    overlay = PdfReader(packet).pages[0]
    page.merge_transformed_page(overlay, Transformation().translate(left, bottom))


def _release_text_payload(job, key):
    """Pasted HTML/Markdown is user content, so it must not outlive the job."""
    job.options = {k: v for k, v in (job.options or {}).items() if k != key}


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
        job.error_message = _friendly_error(e)
        job.save(update_fields=["status", "error_message"])
        raise



@shared_task(autoretry_for=(), max_retries=0)
def cleanup_old_files():
    """
    Runs every 15 min. Deletes files older than FILE_RETENTION_HOURS.
    Guest Job records go after 24 hours; signed-in users keep theirs for
    JOB_HISTORY_DAYS so the dashboard has a history (records only, no files).
    """
    from datetime import timedelta

    retention_hours = getattr(settings, "FILE_RETENTION_HOURS", 2)
    cutoff = timezone.now() - timedelta(hours=retention_hours)
    guest_job_cutoff = timezone.now() - timedelta(hours=24)
    user_job_cutoff = timezone.now() - timedelta(
        days=getattr(settings, "JOB_HISTORY_DAYS", 30)
    )

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
    old_jobs = Job.objects.filter(
        Q(user__isnull=True, created_at__lt=guest_job_cutoff)
        | Q(created_at__lt=user_job_cutoff)
    )
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
            groups = _parse_page_ranges(options.get("ranges", ""), total_pages)
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
        job.error_message = _friendly_error(e)
        job.save(update_fields=["status", "error_message"])
        raise



@shared_task(bind=True, autoretry_for=(), max_retries=0)
def compress_pdf_task(self, job_id):
    """
    Compress a PDF with Ghostscript.
    Options: quality = 'screen' | 'ebook' | 'printer' | 'prepress' (default: 'ebook')
    """
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
            "-dSAFER",
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
        # Already-optimized PDFs can grow when rewritten. Never hand back a
        # "compressed" file that is larger than what the user uploaded.
        if output_path.stat().st_size >= original_size:
            shutil.copyfile(input_path, output_path)
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
        job.error_message = _friendly_error(e)
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
            indices_to_rotate = {
                index
                for _, indices in _parse_page_ranges(pages_spec, total_pages)
                for index in indices
            }

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
        job.error_message = _friendly_error(e)
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
        job.error_message = _friendly_error(e)
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
        job.error_message = _friendly_error(e)
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
    import secrets

    from pypdf import PdfReader, PdfWriter
    from pypdf.constants import UserAccessPermissions

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
        password = (r.get(redis_key) or b"").decode("utf-8")
        r.delete(redis_key)   # clean up immediately after reading

        allow_printing = (job.options or {}).get("allow_printing", True)
        allow_copying = (job.options or {}).get("allow_copying", True)

        if not password:
            raise ValueError("Password is required.")
        if len(password) < 4:
            raise ValueError("Password must be at least 4 characters.")

        reader = PdfReader(str(input_path))
        if reader.is_encrypted:
            raise ValueError("This PDF already has a password. Unlock it first.")
        _check_page_count(reader)
        writer = PdfWriter(clone_from=reader)

        permissions = UserAccessPermissions.all()
        if not allow_printing:
            permissions &= ~(
                UserAccessPermissions.PRINT | UserAccessPermissions.PRINT_TO_REPRESENTATION
            )
        if not allow_copying:
            permissions &= ~UserAccessPermissions.EXTRACT

        # A separate random owner password is what makes the restrictions real:
        # opening with the owner password bypasses them.
        writer.encrypt(
            user_password=password,
            owner_password=secrets.token_urlsafe(32),
            permissions_flag=permissions,
            algorithm="AES-256",
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
        job.error_message = _friendly_error(e)
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
        password = (r.get(redis_key) or b"").decode("utf-8")
        r.delete(redis_key)

        reader = PdfReader(str(input_path))

        if reader.is_encrypted:
            # Permission-only PDFs open with an empty password, so try it
            # rather than demanding one.
            if reader.decrypt(password) == 0:
                raise ValueError(
                    "Incorrect password." if password
                    else "This PDF needs a password to open. Enter it and try again."
                )

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
        job.error_message = _friendly_error(e)
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
        text = str(options.get("text", "")).strip()
        if not text:
            raise ValueError("Watermark text is required.")
        if not is_watermark_text_supported(text):
            raise ValueError(WATERMARK_TEXT_ERROR)

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

        def draw(canvas, width, height):
            canvas.saveState()
            canvas.setFillAlpha(opacity)
            canvas.setFillColor(color)
            canvas.setFont("Helvetica-Bold", font_size)
            text_width = canvas.stringWidth(text, "Helvetica-Bold", font_size)
            if position == "diagonal":
                canvas.translate(width / 2, height / 2)
                canvas.rotate(45)
                canvas.drawString(-text_width / 2, -font_size / 3, text)
            else:
                canvas.drawString((width - text_width) / 2, (height - font_size) / 2, text)
            canvas.restoreState()

        for page in reader.pages:
            _stamp_page(page, draw)
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
        job.error_message = _friendly_error(e)
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
            current_num = start + idx

            if fmt == "number":
                label = str(current_num)
            elif fmt == "page-n":
                label = f"Page {current_num}"
            else:  # n-of-total
                label = f"{current_num} / {total_pages + start - 1}"

            def draw(canvas, width, height, label=label):
                canvas.setFont("Helvetica", font_size)
                canvas.setFillColor(HexColor("#000000"))
                text_width = canvas.stringWidth(label, "Helvetica", font_size)
                if "left" in position:
                    x = margin
                elif "right" in position:
                    x = width - margin - text_width
                else:
                    x = (width - text_width) / 2
                y = height - margin if position.startswith("top") else margin
                canvas.drawString(x, y, label)

            _stamp_page(page, draw)
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
        job.error_message = _friendly_error(e)
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
        job.error_message = _friendly_error(e)
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
    from pypdf.generic import RectangleObject

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
                # Measure from the area the user sees, as they see it.
                box_left, box_bottom, width, height = _visible_box(page)
                new_left = box_left + left
                new_right = box_left + width - right
                new_bottom = box_bottom + bottom
                new_top = box_bottom + height - top

                if new_right <= new_left or new_top <= new_bottom:
                    raise ValueError(
                        f"Crop too large for page {idx + 1} "
                        f"(page is {width:.0f}×{height:.0f} pt)."
                    )

                cropped = RectangleObject((new_left, new_bottom, new_right, new_top))
                page.mediabox = cropped
                page.cropbox = cropped
                page.trimbox = cropped
                page.bleedbox = cropped
                page.artbox = cropped

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
        job.error_message = _friendly_error(e)
        job.save(update_fields=["status", "error_message"])
        raise




@shared_task(bind=True, autoretry_for=(), max_retries=0)
def html_to_pdf_task(self, job_id):
    """
    Convert HTML content to PDF.
    Options:
      - html: HTML string
    """
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
        _release_text_payload(job, "html")
        job.save(update_fields=["status", "output_file", "completed_at", "options"])

        return {"status": "completed"}

    except Exception as e:
        job.status = "failed"
        job.error_message = _friendly_error(e)
        _release_text_payload(job, "html")
        job.save(update_fields=["status", "error_message", "options"])
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
            html_output = render_html(doc, layout)
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
        job.error_message = _friendly_error(e)
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
        _release_text_payload(job, "markdown")
        job.save(update_fields=["status", "output_file", "completed_at", "options"])

        return {"status": "completed"}

    except Exception as e:
        job.status = "failed"
        job.error_message = _friendly_error(e)
        _release_text_payload(job, "markdown")
        job.save(update_fields=["status", "error_message", "options"])
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
        try:
            total_pages = _check_page_count(doc)
            if layout == "preserve":
                md_output = render_markdown(doc)
            else:
                # Simple layout: plain text per page with page separators
                md_parts = []
                for i, page in enumerate(doc):
                    text = page.get_text("text").strip()
                    if text:
                        md_parts.append(f"## Page {i + 1}\n\n{text}")
                md_output = "\n\n".join(md_parts)
        finally:
            doc.close()

        md_output = md_output.strip()
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
        job.error_message = _friendly_error(e)
        job.save(update_fields=["status", "error_message"])
        raise


def _run_tool(job_id, work, extension, private_options=()):
    """
    Shared job lifecycle: `work(inputs, output, options)` does the document
    work. `private_options` hold what the user typed (form values, redaction
    terms), which must not stay in the database once the job ends.
    """
    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"error": "Job not found"}

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    output_dir = Path(settings.MEDIA_ROOT) / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)
    inputs = [upload_dir / name for name in job.input_files]
    output_name = f"{uuid.uuid4().hex}{extension}"
    output_path = output_dir / output_name

    try:
        job.status = "processing"
        job.save(update_fields=["status"])

        for path in inputs:
            if not path.exists():
                raise FileNotFoundError(f"Input file missing: {path.name}")

        result = work(inputs, output_path, job.options or {}) or {}
        _check_output_size(output_path)

        job.options = {
            **{k: v for k, v in (job.options or {}).items() if k not in private_options},
            **result,
        }
        job.status = "completed"
        job.output_file = f"outputs/{output_name}"
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "output_file", "completed_at", "options"])
        return {"status": "completed"}
    except Exception as e:
        job.status = "failed"
        job.error_message = _friendly_error(e)
        job.options = {k: v for k, v in (job.options or {}).items() if k not in private_options}
        job.save(update_fields=["status", "error_message", "options"])
        output_path.unlink(missing_ok=True)
        raise
    finally:
        # Sensitive documents shouldn't wait for the 2-hour sweep, even on failure.
        for path in inputs:
            path.unlink(missing_ok=True)


def _page_tool(work):
    """Resolve the user's page ranges, then run a page-selection operation."""
    def run(inputs, output, options):
        doc = pdf_tools.open_pdf(inputs[0])
        total = doc.page_count
        doc.close()
        groups = _parse_page_ranges(options.get("pages", ""), total)
        indices = [index for _, group in groups for index in group]
        return work(inputs, output, {**options, "indices": indices})
    return run


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def pdf_to_word_task(self, job_id):
    return _run_tool(job_id, pdf_tools.to_word, ".docx")


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def pdf_to_excel_task(self, job_id):
    return _run_tool(job_id, pdf_tools.to_excel, ".xlsx")


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def pdf_to_powerpoint_task(self, job_id):
    return _run_tool(job_id, pdf_tools.to_powerpoint, ".pptx")


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def sign_pdf_task(self, job_id):
    return _run_tool(job_id, pdf_tools.sign, ".pdf", private_options=("placements",))


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def redact_pdf_task(self, job_id):
    return _run_tool(
        job_id, pdf_tools.redact, ".pdf", private_options=("terms", "patterns", "boxes")
    )


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def compare_pdf_task(self, job_id):
    return _run_tool(job_id, pdf_tools.compare, ".pdf")


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def repair_pdf_task(self, job_id):
    return _run_tool(job_id, pdf_tools.repair, ".pdf")


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def fill_form_task(self, job_id):
    return _run_tool(job_id, pdf_tools.fill_form, ".pdf", private_options=("values",))


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def remove_pages_task(self, job_id):
    return _run_tool(job_id, _page_tool(pdf_tools.remove_pages), ".pdf")


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def extract_pages_task(self, job_id):
    return _run_tool(job_id, _page_tool(pdf_tools.extract_pages), ".pdf")


@shared_task(bind=True, autoretry_for=(), max_retries=0)
def office_to_pdf_task(self, job_id):
    return _run_tool(job_id, office_tools.office_to_pdf, ".pdf")


# OCR reads every page, so it gets more time than the global task limit.
@shared_task(bind=True, autoretry_for=(), max_retries=0, soft_time_limit=570, time_limit=600)
def ocr_pdf_task(self, job_id):
    return _run_tool(job_id, office_tools.ocr, ".pdf")
