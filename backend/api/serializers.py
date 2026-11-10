from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers

from .models import Job

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password_confirm = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "username", "password", "password_confirm")

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password": "Passwords do not match."})

        user = User(email=attrs["email"], username=attrs["username"])
        try:
            validate_password(attrs["password"], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc

        return attrs

    def create(self, validated_data):
        validated_data.pop("password_confirm")
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class JobSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()
    source_name = serializers.SerializerMethodField()
    source_count = serializers.SerializerMethodField()
    expires_at = serializers.SerializerMethodField()
    result = serializers.SerializerMethodField()

    class Meta:
        model = Job
        fields = (
            "id",
            "tool",
            "status",
            "output_file",
            "download_url",
            "error_message",
            "created_at",
            "completed_at",
            "source_name",
            "source_count",
            "expires_at",
            "result",
        )

    def _expiry(self, obj):
        if obj.status != "completed" or not obj.completed_at:
            return None
        return obj.completed_at + timedelta(hours=settings.FILE_RETENTION_HOURS)

    def get_download_url(self, obj):
        expiry = self._expiry(obj)
        if expiry and expiry > timezone.now() and obj.output_file:
            # Relative on purpose: the site proxies /api/ through its own
            # domain, so the browser sends the login cookie with the download.
            return f"/api/jobs/{obj.id}/download/"
        return None

    def get_source_name(self, obj):
        return (obj.options or {}).get("source_name")

    def get_source_count(self, obj):
        return (obj.options or {}).get("source_count", 0)

    def get_expires_at(self, obj):
        return self._expiry(obj)

    def get_result(self, obj):
        options = obj.options or {}
        keys = (
            "original_size",
            "compressed_size",
            "savings_percent",
            "tables",
            "redactions",
            "pages",
            "was_damaged",
            "words_added",
            "words_removed",
            "pages_changed",
            "text_pages",
        )
        return {key: options[key] for key in keys if key in options} or None
