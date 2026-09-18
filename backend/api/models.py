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