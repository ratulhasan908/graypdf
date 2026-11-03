import os
import tempfile
import time
import uuid
import zipfile
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import Mock, patch

import redis
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.test import APIClient

from .rate_limit import (
    RateLimitUnavailable,
    check_and_increment_guest,
    check_and_increment_user,
)
from .serializers import RegisterSerializer
from .tasks import (
    _check_output_size,
    _check_page_count,
    cleanup_old_files,
    html_to_pdf_task,
    pdf_to_jpg_task,
    pdf_to_html_task,
)
from .views import _validate_upload_sizes


class GrayPDFConfigTests(SimpleTestCase):
    def test_required_settings_are_loaded(self):
        self.assertTrue(settings.SECRET_KEY)
        self.assertEqual(settings.ALLOWED_HOSTS[0], "localhost")
        self.assertTrue(settings.DATABASES["default"]["NAME"])
        self.assertTrue(settings.DATABASES["default"]["USER"])
        self.assertTrue(settings.CELERY_BROKER_URL)
        self.assertTrue(os.getenv("SECRET_KEY"))
        self.assertIn(
            "rest_framework_simplejwt.token_blacklist",
            settings.INSTALLED_APPS,
        )
        self.assertTrue(settings.SIMPLE_JWT["BLACKLIST_AFTER_ROTATION"])

    def test_health_endpoint(self):
        client = APIClient()
        response = client.get(reverse("health-check"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "ok")
        self.assertEqual(response.data["service"], "GrayPDF API")


class PDFTaskTests(SimpleTestCase):
    def test_refresh_endpoint_blacklists_the_consumed_refresh_token(self):
        client = APIClient()
        client.cookies["refresh_token"] = "old-refresh-token"

        old_refresh = Mock()
        old_refresh.access_token = "new-access-token"
        old_refresh.__getitem__ = Mock(return_value=123)
        new_refresh = Mock()
        new_refresh.__str__ = Mock(return_value="new-refresh-token")
        user = Mock()

        with (
            patch("api.views.RefreshToken") as refresh_token,
            patch("api.views.User.objects.get", return_value=user),
        ):
            refresh_token.return_value = old_refresh
            refresh_token.for_user.return_value = new_refresh
            response = client.post(reverse("refresh-token"))

        self.assertEqual(response.status_code, 200)
        old_refresh.blacklist.assert_called_once_with()
        self.assertEqual(response.cookies["refresh_token"].value, "new-refresh-token")

    def test_registration_applies_configured_password_validators(self):
        serializer = RegisterSerializer()
        with self.assertRaises(DRFValidationError) as context:
            serializer.validate(
                {
                    "email": "person@example.com",
                    "username": "person",
                    "password": "password123",
                    "password_confirm": "password123",
                }
            )
        self.assertIn("password", context.exception.detail)

    def test_pdf_page_and_output_size_limits_are_enforced(self):
        import pymupdf

        document = pymupdf.open()
        document.new_page()
        with override_settings(MAX_PDF_PAGES=0):
            with self.assertRaisesRegex(ValueError, "max allowed is 0"):
                _check_page_count(document)
        document.close()

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "oversized.pdf"
            output_path.write_bytes(b"output")
            with override_settings(MAX_OUTPUT_SIZE_MB=0):
                with self.assertRaisesRegex(ValueError, "max is 0 MB"):
                    _check_output_size(output_path)
            self.assertFalse(output_path.exists())

    @override_settings(
        MAX_UPLOAD_FILE_SIZE=5,
        MAX_TOTAL_UPLOAD_SIZE=8,
    )
    def test_upload_size_limits_cover_each_file_and_combined_upload(self):
        oversized_file = SimpleUploadedFile("large.pdf", b"123456")
        response = _validate_upload_sizes([oversized_file])
        self.assertEqual(response.status_code, 413)

        combined_response = _validate_upload_sizes(
            [
                SimpleUploadedFile("one.pdf", b"12345"),
                SimpleUploadedFile("two.pdf", b"67890"),
            ]
        )
        self.assertEqual(combined_response.status_code, 413)

        self.assertIsNone(
            _validate_upload_sizes(
                [
                    SimpleUploadedFile("one.pdf", b"1234"),
                    SimpleUploadedFile("two.pdf", b"5678"),
                ]
            )
        )

    @override_settings(GUEST_DAILY_LIMIT=5)
    def test_guest_batch_quota_denies_without_incrementing_over_limit(self):
        request = Mock()
        request.META = {"REMOTE_ADDR": "192.0.2.1"}
        redis_client = Mock()
        redis_client.eval.return_value = [0, 4]

        with patch("api.rate_limit._get_redis", return_value=redis_client):
            result = check_and_increment_guest(request, increment_by=2)

        self.assertEqual(result, (False, 4, 5))
        redis_client.eval.assert_called_once()

    def test_guest_quota_fails_closed_when_redis_is_unavailable(self):
        request = Mock()
        request.META = {"REMOTE_ADDR": "192.0.2.1"}

        with patch(
            "api.rate_limit._get_redis",
            side_effect=redis.RedisError("unavailable"),
        ):
            with self.assertRaises(RateLimitUnavailable) as context:
                check_and_increment_guest(request)

        self.assertEqual(context.exception.status_code, 503)

    def test_authenticated_batch_quota_denies_without_partial_increment(self):
        user = Mock(pk=12)
        locked_user = Mock(
            pk=12,
            last_upload_reset=timezone.now().date(),
            daily_upload_count=19,
        )
        user_manager = Mock()
        user_manager.get.return_value = locked_user

        with (
            override_settings(USER_DAILY_LIMIT=20),
            patch(
                "api.models.User.objects.select_for_update",
                return_value=user_manager,
            ),
            patch("api.rate_limit.transaction.atomic", return_value=nullcontext()),
        ):
            result = check_and_increment_user(user, increment_by=2)

        self.assertEqual(result, (False, 19, 20))
        locked_user.save.assert_called_once_with(
            update_fields=["daily_upload_count", "last_upload_reset"]
        )

    def test_cleanup_removes_expired_files_without_removing_recent_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir)
            old_upload = media_root / "uploads" / "expired.pdf"
            recent_output = media_root / "outputs" / "recent.pdf"
            old_upload.parent.mkdir()
            recent_output.parent.mkdir()
            old_upload.write_bytes(b"expired")
            recent_output.write_bytes(b"recent")
            os.utime(old_upload, (time.time() - 3 * 60 * 60,) * 2)

            old_jobs = Mock()
            old_jobs.count.return_value = 2
            with override_settings(
                MEDIA_ROOT=media_root,
                FILE_RETENTION_HOURS=2,
            ), patch("api.tasks.Job.objects.filter", return_value=old_jobs):
                result = cleanup_old_files.run()

            self.assertEqual(result, {"deleted_files": 1, "deleted_jobs": 2})
            self.assertFalse(old_upload.exists())
            self.assertTrue(recent_output.exists())
            old_jobs.delete.assert_called_once_with()

    @override_settings(MAX_PDF_PAGES=500, MAX_OUTPUT_SIZE_MB=200)
    def test_pdf_to_jpg_archives_pages_before_temp_files_are_removed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir)
            upload_dir = media_root / "uploads"
            upload_dir.mkdir()
            input_path = upload_dir / "input.pdf"

            import pymupdf

            document = pymupdf.open()
            document.new_page()
            document.save(input_path)
            document.close()

            job = Mock()
            job.id = uuid.uuid4()
            job.input_files = ["input.pdf"]
            job.options = {"dpi": 72}

            with override_settings(MEDIA_ROOT=media_root), patch(
                "api.tasks.Job.objects.get", return_value=job
            ):
                result = pdf_to_jpg_task.run(str(job.id))

            self.assertEqual(result["status"], "completed")
            self.assertEqual(result["pages"], 1)
            self.assertEqual(job.status, "completed")
            self.assertIsNotNone(job.completed_at)

            output_path = media_root / job.output_file
            self.assertTrue(output_path.exists())
            with zipfile.ZipFile(output_path) as archive:
                self.assertEqual(archive.namelist(), ["page-1.jpg"])
                self.assertTrue(archive.read("page-1.jpg"))

    @override_settings(MAX_PDF_PAGES=500, MAX_OUTPUT_SIZE_MB=200)
    def test_html_to_pdf_renders_and_completes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            job = Mock()
            job.id = uuid.uuid4()
            job.input_files = []
            job.options = {"html": "<h1>GrayPDF test</h1>"}

            with override_settings(MEDIA_ROOT=Path(temp_dir)), patch(
                "api.tasks.Job.objects.get", return_value=job
            ):
                result = html_to_pdf_task.run(str(job.id))

            self.assertEqual(result["status"], "completed")
            self.assertEqual(job.status, "completed")
            self.assertIsNotNone(job.completed_at)
            self.assertTrue((Path(temp_dir) / job.output_file).is_file())

    @override_settings(MAX_PDF_PAGES=500, MAX_OUTPUT_SIZE_MB=200)
    def test_pdf_to_html_writes_complete_html_for_both_layouts(self):
        import pymupdf

        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir)
            upload_dir = media_root / "uploads"
            upload_dir.mkdir()

            for layout in ("simple", "preserve"):
                input_path = upload_dir / f"{layout}.pdf"
                document = pymupdf.open()
                page = document.new_page()
                page.insert_text((72, 72), "unsafe <tag> & text")
                document.save(input_path)
                document.close()

                job = Mock()
                job.id = uuid.uuid4()
                job.input_files = [input_path.name]
                job.options = {"layout": layout}

                with override_settings(MEDIA_ROOT=media_root), patch(
                    "api.tasks.Job.objects.get", return_value=job
                ):
                    result = pdf_to_html_task.run(str(job.id))

                self.assertEqual(result["status"], "completed")
                self.assertEqual(job.status, "completed")
                self.assertTrue(job.output_file.endswith(".html"))
                output_path = media_root / job.output_file
                html_output = output_path.read_text(encoding="utf-8")
                self.assertTrue(html_output.startswith("<!doctype html>"))
                for element in ("<html", "<head>", "<style>", "<body>", "</html>"):
                    self.assertIn(element, html_output)
                self.assertIn("&lt;tag&gt; &amp; text", html_output)
                self.assertNotIn("%PDF", html_output)

    @override_settings(MAX_PDF_PAGES=500, MAX_OUTPUT_SIZE_MB=200)
    def test_pdf_to_html_clean_layout_uses_semantic_document_flow(self):
        import pymupdf

        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir)
            upload_dir = media_root / "uploads"
            upload_dir.mkdir()
            input_path = upload_dir / "resume.pdf"

            document = pymupdf.open()
            page = document.new_page()
            page.insert_text((72, 72), "RATUL HASAN", fontname="hebo", fontsize=20)
            page.insert_text(
                (72, 104), "PROFESSIONAL SUMMARY", fontname="hebo", fontsize=12
            )
            page.insert_text(
                (72, 128), "Results-driven front-end developer.", fontsize=10
            )
            page.insert_text((72, 150), "- Built accessible web applications.", fontsize=10)
            document.save(input_path)
            document.close()

            job = Mock()
            job.id = uuid.uuid4()
            job.input_files = [input_path.name]
            job.options = {"layout": "simple"}

            with override_settings(MEDIA_ROOT=media_root), patch(
                "api.tasks.Job.objects.get", return_value=job
            ):
                pdf_to_html_task.run(str(job.id))

            html_output = (media_root / job.output_file).read_text(encoding="utf-8")
            self.assertIn("<h1>", html_output)
            self.assertIn("<h2>", html_output)
            self.assertIn("<p>", html_output)
            self.assertIn("<ul>", html_output)
            self.assertIn("<li>Built accessible web applications.</li>", html_output)
            self.assertIn("h1 {", html_output)
            self.assertIn("@media (max-width: 700px)", html_output)
            self.assertNotIn('class="pdf-text"', html_output)
            self.assertNotIn('style="--page-width:', html_output)

    def test_pdf_to_html_download_uses_html_filename_and_content_type(self):
        job_id = uuid.uuid4()
        with tempfile.TemporaryDirectory() as temp_dir:
            media_root = Path(temp_dir)
            output_path = media_root / "outputs" / "converted.html"
            output_path.parent.mkdir()
            output_path.write_text("<!doctype html><html></html>", encoding="utf-8")

            job = Mock()
            job.id = job_id
            job.user = None
            job.status = "completed"
            job.output_file = "outputs/converted.html"
            job.tool = "pdf-to-html"

            with override_settings(MEDIA_ROOT=media_root), patch(
                "api.views.Job.objects.get", return_value=job
            ):
                response = APIClient().get(
                    reverse("job-download", kwargs={"job_id": job_id})
                )
                body = b"".join(response.streaming_content)

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
            self.assertTrue(response["Content-Disposition"].endswith(".html\""))
            self.assertEqual(body, b"<!doctype html><html></html>")
