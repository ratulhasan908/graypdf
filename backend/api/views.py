import base64
import json
import math
import os
import uuid
from datetime import timedelta
from pathlib import Path

import pymupdf
from PIL import Image

# from .tasks import merge_pdf_task, split_pdf_task, compress_pdf_task, rotate_pdf_task, pdf_to_jpg_task, jpg_to_pdf_task, protect_pdf_task, unlock_pdf_task
from .tasks import (
    WATERMARK_TEXT_ERROR,
    compare_pdf_task,
    extract_pages_task,
    ocr_pdf_task,
    office_to_pdf_task,
    fill_form_task,
    is_watermark_text_supported,
    pdf_to_excel_task,
    pdf_to_powerpoint_task,
    pdf_to_word_task,
    redact_pdf_task,
    remove_pages_task,
    repair_pdf_task,
    sign_pdf_task,
    merge_pdf_task,
    split_pdf_task,
    compress_pdf_task,
    rotate_pdf_task,
    pdf_to_jpg_task,
    jpg_to_pdf_task,
    protect_pdf_task,
    unlock_pdf_task,
    watermark_pdf_task,
    page_numbers_task,
    organize_pdf_task,
    crop_pdf_task,
    html_to_pdf_task,
    pdf_to_html_task,
    markdown_to_pdf_task,
    pdf_to_markdown_task,
)
from .office_tools import MAX_OCR_LANGUAGES, OCR_LANGUAGES, office_file_problem
from .pdf_tools import list_form_fields
from .rate_limit import (
    check_and_increment_guest,
    check_and_increment_user,
    check_guest_preview_rate,
    get_usage,
)

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.db.models import Count
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from kombu.exceptions import OperationalError

from .models import Job
from .serializers import RegisterSerializer, JobSerializer

User = get_user_model()

DOWNLOAD_TYPES = {
    "pdf": "application/pdf",
    "zip": "application/zip",
    "html": "text/html; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

DOWNLOAD_SUFFIXES = {
    "merge": "merged",
    "split": "split",
    "compress": "compressed",
    "rotate": "rotated",
    "pdf-to-jpg": "images",
    "jpg-to-pdf": "converted",
    "protect": "protected",
    "unlock": "unlocked",
    "watermark": "watermarked",
    "page-numbers": "numbered",
    "organize": "organized",
    "crop": "cropped",
    "html-to-pdf": "converted",
    "pdf-to-html": "converted",
    "markdown-to-pdf": "converted",
    "pdf-to-markdown": "converted",
    "pdf-to-word": "converted",
    "pdf-to-excel": "converted",
    "pdf-to-powerpoint": "converted",
    "sign": "signed",
    "redact": "redacted",
    "compare": "comparison",
    "repair": "repaired",
    "fill-form": "filled",
    "remove-pages": "edited",
    "extract-pages": "extracted",
    "word-to-pdf": "converted",
    "excel-to-pdf": "converted",
    "powerpoint-to-pdf": "converted",
    "ocr": "searchable",
}


# ---------- Helpers ----------

def _set_jwt_cookies(response, refresh_token):
    access_token = str(refresh_token.access_token)
    refresh_str = str(refresh_token)

    secure = getattr(settings, "COOKIE_SECURE", False)
    samesite = getattr(settings, "COOKIE_SAMESITE", "Lax")

    response.set_cookie(
        key="access_token", value=access_token,
        httponly=True, secure=secure, samesite=samesite,
        max_age=60 * 30, path="/",
    )
    response.set_cookie(
        key="refresh_token", value=refresh_str,
        httponly=True, secure=secure, samesite=samesite,
        max_age=60 * 60 * 24 * 7, path="/",
    )
    return response



def _enqueue_job(task, job, request):
    files = request.FILES.getlist("files")
    if files:
        job.options = {
            **(job.options or {}),
            "source_name": files[0].name[:200],
            "source_count": len(files),
        }
        job.save(update_fields=["options"])

    try:
        task.delay(str(job.id))
    except OperationalError as exc:
        job.status = "failed"
        job.error_message = f"Background worker unavailable: {exc}"
        job.save(update_fields=["status", "error_message"])


def _validate_upload_sizes(files):
    max_file_size = settings.MAX_UPLOAD_FILE_SIZE
    max_total_size = settings.MAX_TOTAL_UPLOAD_SIZE

    for uploaded_file in files:
        if uploaded_file.size > max_file_size:
            limit_mb = max_file_size // (1024 * 1024)
            return Response(
                {"detail": f"Each file must be {limit_mb} MB or smaller."},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

    if sum(uploaded_file.size for uploaded_file in files) > max_total_size:
        limit_mb = max_total_size // (1024 * 1024)
        return Response(
            {"detail": f"Combined file size must be {limit_mb} MB or smaller."},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    return None


def _validate_text_input(value, label):
    if not isinstance(value, str) or not value.strip():
        return Response(
            {"detail": f"{label} content is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(value) > settings.MAX_TEXT_INPUT_CHARS:
        return Response(
            {"detail": f"{label} content is too long."},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )
    return None


# ---------- Auth endpoints ----------

@api_view(["GET"])
def health_check(request):
    return Response({
        "status": "ok",
        "service": "GreyPDF API",
        "version": "0.1.0",
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        return Response(
            {
                "id": user.id,
                "email": user.email,
                "username": user.username,
                "message": "User created successfully.",
            },
            status=status.HTTP_201_CREATED,
        )
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    email = request.data.get("email")
    password = request.data.get("password")

    if not email or not password:
        return Response(
            {"detail": "Email and password are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user_obj = User.objects.filter(email__iexact=str(email).strip()).first()
    if user_obj is None:
        return Response(
            {"detail": "Invalid credentials."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = authenticate(request, username=user_obj.username, password=password)
    if user is None:
        return Response(
            {"detail": "Invalid credentials."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    refresh = RefreshToken.for_user(user)
    response = Response({
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "is_premium": user.is_premium,
        "message": "Login successful.",
    })
    return _set_jwt_cookies(response, refresh)


@api_view(["POST"])
@permission_classes([AllowAny])
def logout(request):
    refresh_str = request.COOKIES.get("refresh_token")
    if refresh_str:
        try:
            RefreshToken(refresh_str).blacklist()
        except TokenError:
            pass  # already expired or revoked

    response = Response({"message": "Logged out."})
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return response


@api_view(["GET"])
def me(request):
    if not request.user.is_authenticated:
        return Response(
            {"detail": "Not authenticated."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
    usage = get_usage(request)
    response = Response({
        "id": request.user.id,
        "email": request.user.email,
        "username": request.user.username,
        "is_premium": request.user.is_premium,
        "usage": usage,
    })

    # Signed in through the refresh cookie: the access token lapsed, so rotate
    # the pair. Active users stay signed in past the refresh lifetime this way.
    if isinstance(request.auth, RefreshToken):
        request.auth.blacklist()
        _set_jwt_cookies(response, RefreshToken.for_user(request.user))
    return response


# ---------- Tool: Merge PDF ----------

@api_view(["POST"])
@permission_classes([AllowAny])
def merge_pdf(request):
    """
    Accept multiple PDF files, save them, enqueue a Celery task,
    and return the Job immediately (status = pending).
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import merge_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if not files:
        return Response(
            {"detail": "No files uploaded."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(files) < 2:
        return Response(
            {"detail": "Please upload at least 2 PDF files to merge."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    for uploaded_file in files:
        if not uploaded_file.name.lower().endswith(".pdf"):
            return Response(
                {"detail": f"{uploaded_file.name} is not a PDF file."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # Rate limit check
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(
            request.user, increment_by=len(files)
        )
    else:
        allowed, used, limit = check_and_increment_guest(
            request, increment_by=len(files)
        )

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    # Save uploaded files
    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    saved_names = []
    for f in files:
        filename = f"{uuid.uuid4().hex}.pdf"
        filepath = upload_dir / filename
        with open(filepath, "wb+") as dest:
            for chunk in f.chunks():
                dest.write(chunk)
        saved_names.append(filename)

    # Create Job
    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="merge",
        status="pending",
        input_files=saved_names,
    )

    # Enqueue Celery task. Do not leave a job pending when the broker is down.
    _enqueue_job(merge_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)

# ---------- Job status & download ----------

@api_view(["GET"])
def job_status(request, job_id):
    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return Response(
            {"detail": "Job not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    # If the job belongs to a user, only that user can view it.
    # Guest jobs (user=None) can be viewed by anyone with the UUID.
    if job.user and (not request.user.is_authenticated or job.user_id != request.user.id):
        return Response(
            {"detail": "Not authorized."},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Auto-fail jobs that have been pending/processing WAY too long.
    # The worker is doing the real timeout enforcement; this is just
    # a UI safety net.
    if job.status in ("pending", "processing"):
        from django.utils import timezone
        age_seconds = (timezone.now() - job.created_at).total_seconds()
        if age_seconds > 600:  # 10 minutes
            job.status = "failed"
            job.error_message = "Job took too long to process. Please try again."
            job.save(update_fields=["status", "error_message"])

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data)


@api_view(["GET"])
def job_download(request, job_id):
    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return Response(
            {"detail": "Job not found."},
            status=status.HTTP_404_NOT_FOUND,
        )

    if job.user and (not request.user.is_authenticated or job.user_id != request.user.id):
        return Response(
            {"detail": "Not authorized."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if job.status != "completed" or not job.output_file:
        return Response(
            {"detail": "File not ready."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    file_path = Path(settings.MEDIA_ROOT) / job.output_file
    if not file_path.exists():
        return Response(
            {"detail": "File expired or missing."},
            status=status.HTTP_404_NOT_FOUND,
        )

    extension = file_path.suffix.lstrip(".").lower()
    mime = DOWNLOAD_TYPES.get(extension, "application/octet-stream")

    source_name = (job.options or {}).get("source_name") or "document"
    suffix = DOWNLOAD_SUFFIXES.get(job.tool, job.tool)
    return FileResponse(
        open(file_path, "rb"),
        as_attachment=True,
        filename=f"{Path(source_name).stem}-{suffix}.{extension}",
        content_type=mime,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def split_pdf(request):
    """
    Accept 1 PDF + options (mode, ranges), enqueue split task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import split_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit check
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    mode = request.data.get("mode", "each")
    ranges = request.data.get("ranges", "")

    # Save file
    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="split",
        status="pending",
        input_files=[filename],
        options={"mode": mode, "ranges": ranges},
    )

    _enqueue_job(split_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)

@api_view(["GET"])
@permission_classes([AllowAny])
def usage(request):
    """
    Public endpoint. Returns the daily usage for the current
    caller (guest by IP, or user if logged in).
    """
    return Response(get_usage(request))


@api_view(["POST"])
@permission_classes([AllowAny])
def compress_pdf(request):
    """
    Accept 1 PDF + optional quality, enqueue compress task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import compress_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(
            request.user, increment_by=len(files)
        )
    else:
        allowed, used, limit = check_and_increment_guest(
            request, increment_by=len(files)
        )

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    quality = request.data.get("quality", "ebook")
    if quality not in ("screen", "ebook", "printer", "prepress"):
        quality = "ebook"

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="compress",
        status="pending",
        input_files=[filename],
        options={"quality": quality},
    )

    _enqueue_job(compress_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def rotate_pdf(request):
    """
    Accept 1 PDF + angle + pages, enqueue rotate task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import rotate_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    angle = request.data.get("angle", "90")
    try:
        angle = int(angle)
    except (TypeError, ValueError):
        angle = 90
    if angle not in (90, 180, 270):
        angle = 90

    pages_spec = request.data.get("pages", "all")

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="rotate",
        status="pending",
        input_files=[filename],
        options={"angle": angle, "pages": pages_spec},
    )

    _enqueue_job(rotate_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_to_jpg(request):
    """
    Accept 1 PDF + dpi, enqueue pdf_to_jpg task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import pdf_to_jpg_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    dpi = request.data.get("dpi", "150")
    try:
        dpi = int(dpi)
    except (TypeError, ValueError):
        dpi = 150
    if dpi not in (72, 150, 300):
        dpi = 150

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="pdf-to-jpg",
        status="pending",
        input_files=[filename],
        options={"dpi": dpi},
    )

    _enqueue_job(pdf_to_jpg_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def jpg_to_pdf(request):
    """
    Accept multiple images + page_size, enqueue jpg_to_pdf task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import jpg_to_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if not files:
        return Response(
            {"detail": "No files uploaded."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    allowed_exts = (".jpg", ".jpeg", ".png")
    for f in files:
        if not f.name.lower().endswith(allowed_exts):
            return Response(
                {"detail": f"{f.name} is not a JPG or PNG file."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(
            request.user, increment_by=len(files)
        )
    else:
        allowed, used, limit = check_and_increment_guest(
            request, increment_by=len(files)
        )

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    page_size = request.data.get("page_size", "auto")
    if page_size not in ("A4", "Letter", "auto"):
        page_size = "auto"

    # Save all uploaded images
    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    saved_names = []
    for f in files:
        ext = Path(f.name).suffix.lower()
        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = upload_dir / filename
        with open(filepath, "wb+") as dest:
            for chunk in f.chunks():
                dest.write(chunk)
        saved_names.append(filename)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="jpg-to-pdf",
        status="pending",
        input_files=saved_names,
        options={"page_size": page_size},
    )

    _enqueue_job(jpg_to_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def protect_pdf(request):
    """
    Accept 1 PDF + password + permissions, enqueue protect task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import protect_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    password = request.data.get("password", "")
    if not password.strip():
        return Response(
            {"detail": "Password is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(password) < 4:
        return Response(
            {"detail": "Password must be at least 4 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    allow_printing = str(request.data.get("allow_printing", "true")).lower() == "true"
    allow_copying = str(request.data.get("allow_copying", "true")).lower() == "true"

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    # Password is passed via a separate channel that isn't persisted.
    # We'll use a temporary Redis key tied to the job ID.
    import redis as _redis
    import os as _os

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="protect",
        status="pending",
        input_files=[filename],
        options={
            # password NOT stored here
            "allow_printing": allow_printing,
            "allow_copying": allow_copying,
        },
    )

    # Store the password in Redis for 5 minutes, keyed by job ID
    r = _redis.from_url(_os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    r.setex(f"pdf_password:{job.id}", 300, password)

    _enqueue_job(protect_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def unlock_pdf(request):
    """
    Accept 1 PDF + password, enqueue unlock task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import unlock_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    password = request.data.get("password", "")

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    import redis as _redis
    import os as _os

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="unlock",
        status="pending",
        input_files=[filename],
        options={},   # no password here
    )

    # Store the password in Redis for 5 minutes, keyed by job ID
    r = _redis.from_url(_os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    r.setex(f"pdf_password:{job.id}", 300, password or "")

    _enqueue_job(unlock_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def watermark_pdf(request):
    """
    Accept 1 PDF + watermark options, enqueue watermark task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import watermark_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    text = str(request.data.get("text", "")).strip()
    if not text:
        return Response(
            {"detail": "Watermark text is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not is_watermark_text_supported(text):
        return Response(
            {"detail": WATERMARK_TEXT_ERROR},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    def to_int(v, default):
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    def to_float(v, default):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    font_size = to_int(request.data.get("font_size", 60), 60)
    opacity = to_float(request.data.get("opacity", 0.3), 0.3)
    color = request.data.get("color", "#FF0000")
    position = request.data.get("position", "diagonal")
    if position not in ("center", "diagonal"):
        position = "diagonal"

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="watermark",
        status="pending",
        input_files=[filename],
        options={
            "text": text,
            "font_size": font_size,
            "opacity": opacity,
            "color": color,
            "position": position,
        },
    )

    _enqueue_job(watermark_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def page_numbers(request):
    """
    Accept 1 PDF + page number options, enqueue task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import page_numbers_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    def to_int(v, default):
        try:
            return int(v)
        except (TypeError, ValueError):
            return default

    position = request.data.get("position", "bottom-center")
    fmt = request.data.get("format", "number")
    start = to_int(request.data.get("start", 1), 1)
    font_size = to_int(request.data.get("font_size", 12), 12)
    margin = to_int(request.data.get("margin", 40), 40)

    if position not in (
        "bottom-center", "bottom-right", "bottom-left",
        "top-center", "top-right", "top-left",
    ):
        position = "bottom-center"
    if fmt not in ("number", "page-n", "n-of-total"):
        fmt = "number"

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="page-numbers",
        status="pending",
        input_files=[filename],
        options={
            "position": position,
            "format": fmt,
            "start": start,
            "font_size": font_size,
            "margin": margin,
        },
    )

    _enqueue_job(page_numbers_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def organize_pdf(request):
    """
    Accept 1 PDF + page order, enqueue organize task.
    """
    import json
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import organize_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    raw_order = request.data.get("order", "")
    order = None

    # Accept either a JSON list or a comma-separated string
    if isinstance(raw_order, list):
        order = raw_order
    else:
        raw_order = str(raw_order).strip()
        if raw_order.startswith("["):
            try:
                order = json.loads(raw_order)
            except json.JSONDecodeError:
                order = None
        else:
            # Comma-separated like "3,1,2"
            order = [
                p.strip() for p in raw_order.split(",") if p.strip()
            ]

    if not order:
        return Response(
            {"detail": "Page order is required (e.g., 3,1,2)."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="organize",
        status="pending",
        input_files=[filename],
        options={"order": order},
    )

    _enqueue_job(organize_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_page_count(request):
    """
    Returns the number of pages in an uploaded PDF.
    Used by Organize UI to build the page grid.

    This is a metadata read, not a processing job, so it does not count
    towards the daily file limit: Organize would otherwise charge twice.
    """
    from pypdf import PdfReader

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        reader = PdfReader(f)
        if reader.is_encrypted and reader.decrypt("") == 0:
            return Response(
                {"detail": "This PDF is password-protected. Use Unlock PDF first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"pages": len(reader.pages)})
    except Exception:
        return Response(
            {"detail": "This file could not be read. It may be damaged or not a real PDF."},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(["POST"])
@permission_classes([AllowAny])
def crop_pdf(request):
    """
    Accept 1 PDF + crop amounts, enqueue crop task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import crop_pdf_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    file_count = len(files)
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user, increment_by=file_count)
    else:
        allowed, used, limit = check_and_increment_guest(
            request, increment_by=file_count
        )

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    def to_float(v, default=0.0):
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    top = to_float(request.data.get("top", 0))
    bottom = to_float(request.data.get("bottom", 0))
    left = to_float(request.data.get("left", 0))
    right = to_float(request.data.get("right", 0))
    apply_to = request.data.get("apply_to", "all")

    if apply_to not in ("all", "first", "last"):
        apply_to = "all"

    if top < 0 or bottom < 0 or left < 0 or right < 0:
        return Response(
            {"detail": "Crop amounts must be positive."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if top + bottom <= 0 and left + right <= 0:
        return Response(
            {"detail": "Please specify at least one crop amount."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="crop",
        status="pending",
        input_files=[filename],
        options={
            "top": top,
            "bottom": bottom,
            "left": left,
            "right": right,
            "apply_to": apply_to,
        },
    )

    _enqueue_job(crop_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def my_jobs(request):
    """
    The signed-in user's job history and stats for the dashboard.
    Guests have no history, so they get an empty list.
    """
    if not request.user.is_authenticated:
        return Response({"jobs": [], "total": 0, "this_week": 0, "top_tools": []})

    user_jobs = Job.objects.filter(user=request.user)
    serializer = JobSerializer(user_jobs[:100], many=True, context={"request": request})
    week_ago = timezone.now() - timedelta(days=7)

    return Response({
        "jobs": serializer.data,
        "total": user_jobs.count(),
        "this_week": user_jobs.filter(created_at__gte=week_ago).count(),
        "top_tools": list(
            user_jobs.values("tool").annotate(count=Count("id")).order_by("-count")[:6]
        ),
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def html_to_pdf(request):
    """
    Accept HTML content, enqueue conversion task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import html_to_pdf_task

    html_content = request.data.get("html", "")
    text_error = _validate_text_input(html_content, "HTML")
    if text_error:
        return text_error

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="html-to-pdf",
        status="pending",
        input_files=[],
        options={"html": html_content},
    )

    _enqueue_job(html_to_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)



@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_to_html(request):
    """
    Accept 1 PDF + layout, enqueue conversion task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import pdf_to_html_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    layout = request.data.get("layout", "simple")
    if layout not in ("simple", "preserve"):
        layout = "simple"

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="pdf-to-html",
        status="pending",
        input_files=[filename],
        options={"layout": layout},
    )

    _enqueue_job(pdf_to_html_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)



@api_view(["POST"])
@permission_classes([AllowAny])
def markdown_to_pdf(request):
    """
    Accept Markdown content, enqueue conversion task.
    """
    from .tasks import markdown_to_pdf_task

    md_content = request.data.get("markdown", "")
    text_error = _validate_text_input(md_content, "Markdown")
    if text_error:
        return text_error

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="markdown-to-pdf",
        status="pending",
        input_files=[],
        options={"markdown": md_content},
    )

    _enqueue_job(markdown_to_pdf_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_to_markdown(request):
    """
    Accept 1 PDF + layout, enqueue conversion task.
    """
    import uuid
    from pathlib import Path
    from django.conf import settings
    from .tasks import pdf_to_markdown_task

    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return Response(
            {"detail": "Please upload exactly 1 PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    f = files[0]
    if not f.name.lower().endswith(".pdf"):
        return Response(
            {"detail": f"{f.name} is not a PDF file."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up free for unlimited use.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    layout = request.data.get("layout", "preserve")
    if layout not in ("simple", "preserve"):
        layout = "preserve"

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="pdf-to-markdown",
        status="pending",
        input_files=[filename],
        options={"layout": layout},
    )

    _enqueue_job(pdf_to_markdown_task, job, request)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)



@api_view(["POST"])
@permission_classes([AllowAny])
def refresh_token(request):
    """
    Issue a new access + refresh token pair using the refresh_token cookie.
    Implements rotation: the old refresh token is invalidated and a new
    one is issued.
    """
    refresh_str = request.COOKIES.get("refresh_token")
    if not refresh_str:
        return Response(
            {"detail": "No refresh token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        old_refresh = RefreshToken(refresh_str)
        new_access = str(old_refresh.access_token)
        # Rotation: blacklist the old refresh (needs blacklist app), and issue new one
        try:
            old_refresh.blacklist()
        except AttributeError:
            # blacklist app not installed — safe to ignore for now
            pass

        # Get the user and issue a fresh refresh token
        from django.contrib.auth import get_user_model
        User = get_user_model()
        user = User.objects.get(id=old_refresh["user_id"])
        new_refresh = RefreshToken.for_user(user)
    except Exception:
        response = Response(
            {"detail": "Your session has expired. Please log in again."},
            status=status.HTTP_401_UNAUTHORIZED,
        )
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/")
        return response

    secure = getattr(settings, "COOKIE_SECURE", False)
    samesite = getattr(settings, "COOKIE_SAMESITE", "Lax")

    response = Response({"detail": "Refreshed."})
    response.set_cookie(
        key="access_token",
        value=new_access,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=60 * 30,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=str(new_refresh),
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=60 * 60 * 24 * 7,
        path="/",
    )
    return response


# ---------- Tools built on the shared job flow ----------

def _bad_request(message):
    return Response({"detail": message}, status=status.HTTP_400_BAD_REQUEST)


def _pdf_upload_error(files, expected=1):
    """Check a PDF upload. Returns an error Response, or None when it's fine."""
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != expected:
        noun = "1 PDF file" if expected == 1 else f"{expected} PDF files"
        return _bad_request(f"Please upload exactly {noun}.")
    for uploaded in files:
        if not uploaded.name.lower().endswith(".pdf"):
            return _bad_request(f"{uploaded.name} is not a PDF file.")
    return None


def _charge_usage(request, count):
    """Count files against the daily limit. Returns a 429 Response when over."""
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user, increment_by=count)
    else:
        allowed, used, limit = check_and_increment_guest(request, increment_by=count)
    if allowed:
        return None
    advice = "Try again tomorrow." if request.user.is_authenticated else "Sign up free for unlimited use."
    return Response(
        {"detail": f"Daily limit reached ({limit} files/day). {advice}", "used": used, "limit": limit},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )


def _store_upload(uploaded, extension):
    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    with open(upload_dir / filename, "wb") as destination:
        for chunk in uploaded.chunks():
            destination.write(chunk)
    return filename


def _start_job(request, tool, task, options=None, expected_files=1, extra_uploads=()):
    """Validate, charge and enqueue a PDF job. `extra_uploads` is (file, extension)."""
    files = request.FILES.getlist("files")
    error = _pdf_upload_error(files, expected_files) or _charge_usage(request, len(files))
    if error:
        return error

    names = [_store_upload(uploaded, ".pdf") for uploaded in files]
    names += [_store_upload(uploaded, extension) for uploaded, extension in extra_uploads]
    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool=tool,
        status="pending",
        input_files=names,
        options=options or {},
    )
    _enqueue_job(task, job, request)
    return Response(
        JobSerializer(job, context={"request": request}).data,
        status=status.HTTP_201_CREATED,
    )


def _json_field(request, name, default):
    """Read a JSON value sent as a multipart field. Returns None when malformed."""
    raw = request.data.get(name)
    if raw in (None, ""):
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _valid_boxes(items):
    if not isinstance(items, list) or len(items) > 500:
        return False
    for item in items:
        if not isinstance(item, dict):
            return False
        try:
            int(item["page"])
            for key in ("x", "y", "w", "h"):
                if not math.isfinite(float(item[key])):
                    return False
        except (KeyError, TypeError, ValueError):
            return False
    return True


@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_to_word(request):
    return _start_job(request, "pdf-to-word", pdf_to_word_task)


@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_to_excel(request):
    return _start_job(request, "pdf-to-excel", pdf_to_excel_task)


@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_to_powerpoint(request):
    return _start_job(request, "pdf-to-powerpoint", pdf_to_powerpoint_task)


@api_view(["POST"])
@permission_classes([AllowAny])
def repair_pdf(request):
    return _start_job(request, "repair", repair_pdf_task)


@api_view(["POST"])
@permission_classes([AllowAny])
def compare_pdf(request):
    return _start_job(request, "compare", compare_pdf_task, expected_files=2)


@api_view(["POST"])
@permission_classes([AllowAny])
def remove_pages(request):
    pages = str(request.data.get("pages", "")).strip()
    if not pages:
        return _bad_request("Choose the pages to remove.")
    return _start_job(request, "remove-pages", remove_pages_task, {"pages": pages})


@api_view(["POST"])
@permission_classes([AllowAny])
def extract_pages(request):
    pages = str(request.data.get("pages", "")).strip()
    if not pages:
        return _bad_request("Choose the pages to extract.")
    return _start_job(request, "extract-pages", extract_pages_task, {"pages": pages})


@api_view(["POST"])
@permission_classes([AllowAny])
def sign_pdf(request):
    placements = _json_field(request, "placements", [])
    if not placements or not _valid_boxes(placements):
        return _bad_request("Place your signature on a page first.")

    signature = request.FILES.get("signature")
    if signature is None:
        return _bad_request("Add your signature first.")
    if signature.size > settings.MAX_SIGNATURE_BYTES:
        return _bad_request("Your signature image must be 5 MB or smaller.")
    try:
        with Image.open(signature) as image:
            image.verify()
            image_format = image.format
    except Exception:
        return _bad_request("The signature must be a PNG or JPG image.")
    if image_format not in ("PNG", "JPEG"):
        return _bad_request("The signature must be a PNG or JPG image.")
    signature.seek(0)

    extension = ".png" if image_format == "PNG" else ".jpg"
    return _start_job(
        request,
        "sign",
        sign_pdf_task,
        {"placements": placements},
        extra_uploads=[(signature, extension)],
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def redact_pdf(request):
    terms = _json_field(request, "terms", [])
    patterns = _json_field(request, "patterns", [])
    boxes = _json_field(request, "boxes", [])
    if (
        not isinstance(terms, list)
        or not all(isinstance(term, str) for term in terms)
        or not isinstance(patterns, list)
        or not set(patterns) <= {"email", "phone"}
        or not _valid_boxes(boxes)
    ):
        return _bad_request("Those redaction settings aren't valid.")
    if not any(term.strip() for term in terms) and not patterns and not boxes:
        return _bad_request("Choose something to redact first.")
    return _start_job(
        request,
        "redact",
        redact_pdf_task,
        {"terms": terms, "patterns": patterns, "boxes": boxes},
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def fill_form(request):
    values = _json_field(request, "values", None)
    if not isinstance(values, dict) or not values:
        return _bad_request("Fill in at least one field.")
    flatten = str(request.data.get("flatten", "false")).lower() == "true"
    return _start_job(
        request, "fill-form", fill_form_task, {"values": values, "flatten": flatten}
    )


def _start_office_job(request, kind, tool, options=None):
    """Like _start_job, for Word, Excel and PowerPoint uploads."""
    files = request.FILES.getlist("files")
    size_error = _validate_upload_sizes(files)
    if size_error:
        return size_error
    if len(files) != 1:
        return _bad_request("Please upload exactly 1 file.")

    uploaded = files[0]
    head = uploaded.read(8)
    uploaded.seek(0)
    problem = office_file_problem(kind, uploaded.name, head)
    if problem:
        return _bad_request(problem)

    error = _charge_usage(request, 1)
    if error:
        return error

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool=tool,
        status="pending",
        input_files=[_store_upload(uploaded, Path(uploaded.name).suffix.lower())],
        options=options or {},
    )
    _enqueue_job(office_to_pdf_task, job, request)
    return Response(
        JobSerializer(job, context={"request": request}).data,
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def word_to_pdf(request):
    return _start_office_job(request, "word", "word-to-pdf")


@api_view(["POST"])
@permission_classes([AllowAny])
def excel_to_pdf(request):
    one_page = str(request.data.get("one_page_per_sheet", "false")).lower() == "true"
    return _start_office_job(request, "excel", "excel-to-pdf", {"one_page_per_sheet": one_page})


@api_view(["POST"])
@permission_classes([AllowAny])
def powerpoint_to_pdf(request):
    return _start_office_job(request, "powerpoint", "powerpoint-to-pdf")


@api_view(["POST"])
@permission_classes([AllowAny])
def ocr_pdf(request):
    languages = _json_field(request, "languages", [])
    if (
        not isinstance(languages, list)
        or not languages
        or len(languages) > MAX_OCR_LANGUAGES
        or not set(languages) <= OCR_LANGUAGES
    ):
        return _bad_request(f"Choose between 1 and {MAX_OCR_LANGUAGES} languages.")
    return _start_job(request, "ocr", ocr_pdf_task, {"languages": languages})


def _open_for_reading(request):
    """Open an uploaded PDF in memory for a quick read. Returns (doc, error)."""
    files = request.FILES.getlist("files")
    error = _pdf_upload_error(files)
    if error:
        return None, error
    if not request.user.is_authenticated and not check_guest_preview_rate(request):
        return None, Response(
            {"detail": "Too many previews. Please wait a while, or sign up free."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    try:
        doc = pymupdf.open(stream=files[0].read(), filetype="pdf")
    except Exception:
        return None, _bad_request("This file could not be read. It may be damaged or not a real PDF.")
    if doc.needs_pass:
        doc.close()
        return None, _bad_request("This PDF is password-protected. Use Unlock PDF first.")
    return doc, None


@api_view(["POST"])
@permission_classes([AllowAny])
def page_previews(request):
    """
    Page images for tools where people pick pages or point at them. Nothing is
    stored, and this does not count towards the daily file limit.
    """
    doc, error = _open_for_reading(request)
    if error:
        return error
    try:
        dpi = int(request.data.get("dpi", 50))
    except (TypeError, ValueError):
        dpi = 50
    dpi = max(30, min(dpi, 110))

    try:
        pages = []
        for page in doc.pages(0, min(doc.page_count, settings.MAX_PREVIEW_PAGES)):
            image = page.get_pixmap(dpi=dpi, alpha=False).tobytes("jpeg", jpg_quality=75)
            pages.append({
                "width": page.rect.width,
                "height": page.rect.height,
                "image": "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii"),
            })
        return Response({"total": doc.page_count, "pages": pages})
    except Exception:
        return _bad_request("This file could not be read. It may be damaged or not a real PDF.")
    finally:
        doc.close()


@api_view(["POST"])
@permission_classes([AllowAny])
def form_fields(request):
    """List a PDF's fillable fields. Nothing is stored."""
    doc, error = _open_for_reading(request)
    if error:
        return error
    try:
        return Response({"fields": list_form_fields(doc)})
    except Exception:
        return _bad_request("This file could not be read. It may be damaged or not a real PDF.")
    finally:
        doc.close()
