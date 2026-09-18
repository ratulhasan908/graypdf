from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, Job


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    list_display = ("email", "username", "is_premium", "is_staff", "date_joined")
    search_fields = ("email", "username")


@admin.register(Job)
class JobAdmin(admin.ModelAdmin):
    list_display = ("id", "tool", "status", "user", "created_at", "completed_at")
    list_filter = ("tool", "status")
    search_fields = ("id", "user__email")
    readonly_fields = ("id", "created_at")