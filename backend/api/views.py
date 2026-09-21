import os
import uuid
from datetime import datetime
from pathlib import Path
from rest_framework_simplejwt.tokens import RefreshToken

# from .tasks import merge_pdf_task, split_pdf_task, compress_pdf_task, rotate_pdf_task, pdf_to_jpg_task, jpg_to_pdf_task, protect_pdf_task, unlock_pdf_task
from .tasks import (
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
from .rate_limit import check_and_increment_guest, check_and_increment_user, get_usage

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken
from kombu.exceptions import OperationalError

from .models import Job
from .serializers import RegisterSerializer, JobSerializer

User = get_user_model()

# ---------- Helpers ----------

def _set_jwt_cookies(response, refresh_token):
    access_token = str(refresh_token.access_token)
    refresh_str = str(refresh_token)

    response.set_cookie(
        key="access_token", value=access_token,
        httponly=True, secure=False, samesite="Lax",
        max_age=60 * 30, path="/",
    )
    response.set_cookie(
        key="refresh_token", value=refresh_str,
        httponly=True, secure=False, samesite="Lax",
        max_age=60 * 60 * 24 * 7, path="/",
    )
    return response


def _get_client_identifier(request):
    """Return a string identifying the user (auth or IP)."""
    if request.user.is_authenticated:
        return f"user:{request.user.id}"
    ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
    if not ip:
        ip = request.META.get("REMOTE_ADDR", "unknown")
    return f"ip:{ip}"


def _enqueue_job(task, job):
    try:
        task.delay(str(job.id))
    except OperationalError as exc:
        job.status = "failed"
        job.error_message = f"Background worker unavailable: {exc}"
        job.save(update_fields=["status", "error_message"])


# ---------- Auth endpoints ----------

@api_view(["GET"])
def health_check(request):
    return Response({
        "status": "ok",
        "service": "GrayPDF API",
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

    try:
        user_obj = User.objects.get(email=email)
    except User.DoesNotExist:
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
    return Response({
        "id": request.user.id,
        "email": request.user.email,
        "username": request.user.username,
        "is_premium": request.user.is_premium,
        "usage": usage,
    })


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

    # Rate limit check
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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
        if not f.name.lower().endswith(".pdf"):
            return Response(
                {"detail": f"{f.name} is not a PDF file."},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
    _enqueue_job(merge_pdf_task, job)

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

    # Do not leave the client polling forever when a worker disappeared.
    if job.status in ("pending", "processing"):
        age = timezone.now() - job.created_at
        if age.total_seconds() > 2 * 60:
            job.status = "failed"
            job.error_message = "The background worker did not finish this job. Please try again."
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

    # Choose extension + MIME based on tool
    if job.tool in ("split", "pdf-to-jpg"):
        extension = "zip"
        mime = "application/zip"
    elif job.tool == "pdf-to-html":
        extension = "html"
        mime = "text/html"
    elif job.tool == "pdf-to-markdown":
        extension = "md"
        mime = "text/markdown"
    else:
        extension = "pdf"
        mime = "application/pdf"

    return FileResponse(
        open(file_path, "rb"),
        as_attachment=True,
        filename=f"graypdf-{job.tool}-{job.id}.{extension}",
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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(split_pdf_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(compress_pdf_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(rotate_pdf_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(pdf_to_jpg_task, job)

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
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(jpg_to_pdf_task, job)

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

    password = request.data.get("password", "").strip()
    if not password:
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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="protect",
        status="pending",
        input_files=[filename],
        options={
            "password": password,
            "allow_printing": allow_printing,
            "allow_copying": allow_copying,
        },
    )

    _enqueue_job(protect_pdf_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
                "used": used,
                "limit": limit,
            },
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    password = request.data.get("password", "").strip()

    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    filepath = upload_dir / filename
    with open(filepath, "wb+") as dest:
        for chunk in f.chunks():
            dest.write(chunk)

    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="unlock",
        status="pending",
        input_files=[filename],
        options={"password": password},
    )

    _enqueue_job(unlock_pdf_task, job)

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

    # Rate limit
    if request.user.is_authenticated:
        allowed, used, limit = check_and_increment_user(request.user)
    else:
        allowed, used, limit = check_and_increment_guest(request)

    if not allowed:
        return Response(
            {
                "detail": f"Daily limit reached ({limit} files/day). "
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(watermark_pdf_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(page_numbers_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(organize_pdf_task, job)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
def pdf_page_count(request):
    """
    Returns the number of pages in an uploaded PDF.
    Used by Organize UI to build the page grid.
    """
    from pypdf import PdfReader

    files = request.FILES.getlist("files")
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
        return Response({"pages": len(reader.pages)})
    except Exception as e:
        return Response(
            {"detail": f"Could not read PDF: {str(e)}"},
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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(crop_pdf_task, job)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def my_jobs(request):
    """
    List the current user's recent jobs (or guest jobs by session — not
    tracked, so guests get empty list). Returns up to 10 most recent.
    """
    if not request.user.is_authenticated:
        return Response({"jobs": []})

    jobs = Job.objects.filter(user=request.user)[:10]
    serializer = JobSerializer(jobs, many=True, context={"request": request})

    total = Job.objects.filter(user=request.user).count()

    return Response({
        "jobs": serializer.data,
        "total": total,
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

    html_content = request.data.get("html", "").strip()

    if not html_content:
        return Response(
            {"detail": "HTML content is required."},
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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(html_to_pdf_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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
        tool="pdf-to-html",
        status="pending",
        input_files=[filename],
        options={"layout": layout},
    )

    _enqueue_job(pdf_to_html_task, job)

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
    if not isinstance(md_content, str) or not md_content.strip():
        return Response(
            {"detail": "Markdown content is required."},
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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(markdown_to_pdf_task, job)

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
                          f"{'Sign up for more.' if not request.user.is_authenticated else 'Try again tomorrow.'}",
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

    _enqueue_job(pdf_to_markdown_task, job)

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)



@api_view(["POST"])
@permission_classes([AllowAny])
def refresh_token(request):
    """
    Issue a new access token using the refresh_token cookie.
    """
    refresh_str = request.COOKIES.get("refresh_token")
    if not refresh_str:
        return Response(
            {"detail": "No refresh token."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    try:
        refresh = RefreshToken(refresh_str)
        new_access = str(refresh.access_token)
    except Exception as e:
        return Response(
            {"detail": f"Invalid refresh token: {str(e)}"},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    response = Response({"detail": "Refreshed."})
    response.set_cookie(
        key="access_token",
        value=new_access,
        httponly=True,
        secure=False,          # True in production (HTTPS)
        samesite="Lax",
        max_age=60 * 30,       # 30 minutes
        path="/",
    )
    return response