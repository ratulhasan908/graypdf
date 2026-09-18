import os
import uuid
from datetime import datetime
from pathlib import Path

from .tasks import merge_pdf_task, split_pdf_task, compress_pdf_task, rotate_pdf_task, pdf_to_jpg_task, jpg_to_pdf_task
from .rate_limit import check_and_increment_guest, check_and_increment_user, get_usage

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.http import FileResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

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

    # Enqueue Celery task
    merge_pdf_task.delay(str(job.id))

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

    split_pdf_task.delay(str(job.id))

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

    compress_pdf_task.delay(str(job.id))

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

    rotate_pdf_task.delay(str(job.id))

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

    pdf_to_jpg_task.delay(str(job.id))

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

    jpg_to_pdf_task.delay(str(job.id))

    serializer = JobSerializer(job, context={"request": request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)