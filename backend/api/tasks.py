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