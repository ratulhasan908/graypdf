from django.contrib.auth import get_user_model
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
        )

    def get_download_url(self, obj):
        if obj.status == "completed" and obj.output_file:
            request = self.context.get("request")
            if request:
                return request.build_absolute_uri(f"/api/jobs/{obj.id}/download/")
        return None