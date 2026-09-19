import os

from django.conf import settings
from django.test import SimpleTestCase
from django.urls import reverse
from rest_framework.test import APIClient


class GrayPDFConfigTests(SimpleTestCase):
    def test_required_settings_are_loaded(self):
        self.assertTrue(settings.SECRET_KEY)
        self.assertEqual(settings.ALLOWED_HOSTS[0], "localhost")
        self.assertTrue(settings.DATABASES["default"]["NAME"])
        self.assertTrue(settings.DATABASES["default"]["USER"])
        self.assertTrue(settings.CELERY_BROKER_URL)
        self.assertTrue(os.getenv("SECRET_KEY"))

    def test_health_endpoint(self):
        client = APIClient()
        response = client.get(reverse("health-check"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")
        self.assertEqual(response.data["service"], "GrayPDF API")
