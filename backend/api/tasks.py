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