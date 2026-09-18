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