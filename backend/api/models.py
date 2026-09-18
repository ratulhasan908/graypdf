import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    Custom user model. Extends Django's AbstractUser so we can
    add fields later (e.g., is_premium, daily_upload_count).
    """
    email = models.EmailField(unique=True)
    is_premium = models.BooleanField(default=False)
    daily_upload_count = models.PositiveIntegerField(default=0)
    last_upload_reset = models.DateField(null=True, blank=True)

    def __str__(self):
        return self.email


class Job(models.Model):
    """
    Tracks every PDF operation (merge, split, compress, ...).
    """
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("processing", "Processing"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    TOOL_CHOICES = [
        ("merge", "Merge PDF"),
        ("split", "Split PDF"),
        ("compress", "Compress PDF"),
        ("rotate", "Rotate PDF"),
        ("pdf-to-jpg", "PDF to JPG"),
        ("jpg-to-pdf", "JPG to PDF"),
        ("protect", "Protect PDF"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="jobs",
    )
    tool = models.CharField(max_length=32, choices=TOOL_CHOICES)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending")
    input_files = models.JSONField(default=list)
    options = models.JSONField(default=dict, blank=True)
    output_file = models.CharField(max_length=512, blank=True, null=True)
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.tool} — {self.status} ({self.id})"