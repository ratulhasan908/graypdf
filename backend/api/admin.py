from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Job


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "email",
        "username",
        "is_premium",
        "daily_upload_count",
        "date_joined",
        "last_login",
    )
    list_filter = ("is_premium", "is_staff", "is_active", "date_joined")
    search_fields = ("email", "username")
    ordering = ("-date_joined",)

    fieldsets = BaseUserAdmin.fieldsets + (
        (
            "GrayPDF",
            {
                "fields": (
                    "is_premium",
                    "daily_upload_count",
                    "last_upload_reset",
                )
            },
        ),
    )

    readonly_fields = ("last_upload_reset",)


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ("id", "tool", "status", "user", "created_at", "completed_at")
    list_filter = ("tool", "status", "created_at")
    search_fields = ("id", "user__email")
    readonly_fields = ("id", "created_at", "completed_at")
    raw_id_fields = ("user",)
    date_hierarchy = "created_at"