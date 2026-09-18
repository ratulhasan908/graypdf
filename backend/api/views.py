import os
import uuid
from datetime import datetime
from pathlib import Path

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
    return Response({
        "id": request.user.id,
        "email": request.user.email,
        "username": request.user.username,
        "is_premium": request.user.is_premium,
    })


# ---------- Tool: Merge PDF ----------

@api_view(["POST"])
@permission_classes([AllowAny])
def merge_pdf(request):
    """
    Accept multiple PDF files, merge them in order, return a job with download URL.
    """
    from pypdf import PdfWriter, PdfReader

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

    # Create Job record
    job = Job.objects.create(
        user=request.user if request.user.is_authenticated else None,
        tool="merge",
        status="processing",
    )

    # Save uploaded files
    upload_dir = Path(settings.MEDIA_ROOT) / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)

    saved_paths = []
    try:
        for f in files:
            if not f.name.lower().endswith(".pdf"):
                raise ValueError(f"{f.name} is not a PDF file.")

            ext = ".pdf"
            filename = f"{uuid.uuid4().hex}{ext}"
            filepath = upload_dir / filename
            with open(filepath, "wb+") as dest:
                for chunk in f.chunks():
                    dest.write(chunk)
            saved_paths.append(filepath)

        # Merge
        writer = PdfWriter()
        for path in saved_paths:
            reader = PdfReader(str(path))
            for page in reader.pages:
                writer.add_page(page)

        output_dir = Path(settings.MEDIA_ROOT) / "outputs"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_name = f"{uuid.uuid4().hex}.pdf"
        output_path = output_dir / output_name

        with open(output_path, "wb") as out:
            writer.write(out)

        # Update job
        job.status = "completed"
        job.input_files = [p.name for p in saved_paths]
        job.output_file = f"outputs/{output_name}"
        job.completed_at = datetime.now()
        job.save()

        serializer = JobSerializer(job, context={"request": request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    except Exception as e:
        job.status = "failed"
        job.error_message = str(e)
        job.save()
        return Response(
            {"detail": f"Merge failed: {str(e)}"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    finally:
        # Clean up uploaded files immediately (they're not needed anymore)
        for p in saved_paths:
            try:
                os.remove(p)
            except OSError:
                pass


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

    return FileResponse(
        open(file_path, "rb"),
        as_attachment=True,
        filename=f"graypdf-{job.tool}-{job.id}.pdf",
    )