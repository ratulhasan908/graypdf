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

from rest_framework_simplejwt.exceptions import TokenError

from . import pdf_tools
from .office_tools import LIBREOFFICE_PROFILE, OLE_MAGIC, office_file_problem, office_to_pdf
from .authentication import CookieJWTAuthentication
from .pdf_structure import render_html, render_markdown
from .rate_limit import (
    RateLimitUnavailable,
    check_and_increment_guest,
    check_and_increment_user,
)
from .serializers import RegisterSerializer
from .tasks import (
    _check_output_size,
    _check_page_count,
    _friendly_error,
    _parse_page_ranges,
    _stamp_page,
    _visible_box,
    is_watermark_text_supported,
    cleanup_old_files,
    html_to_pdf_task,
    pdf_to_jpg_task,
    pdf_to_html_task,
)
from .views import _validate_upload_sizes


class GreyPDFConfigTests(SimpleTestCase):
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
        self.assertEqual(response.data["service"], "GreyPDF API")


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
            job.options = {"html": "<h1>GreyPDF test</h1>"}

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
            job.options = {"source_name": "report.pdf"}

            with override_settings(MEDIA_ROOT=media_root), patch(
                "api.views.Job.objects.get", return_value=job
            ):
                response = APIClient().get(
                    reverse("job-download", kwargs={"job_id": job_id})
                )
                body = b"".join(response.streaming_content)

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
            self.assertTrue(
                response["Content-Disposition"].endswith('report-converted.html"')
            )
            self.assertEqual(body, b"<!doctype html><html></html>")


def _sample_document():
    """A small real PDF with a title, list, link and ruled table."""
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 80), "Annual Report", fontsize=26, fontname="hebo")
    page.insert_text((72, 120), "Plain body text for the report.", fontsize=11)
    page.insert_text((72, 140), "More body text goes on this line.", fontsize=11)
    page.insert_text((72, 170), "- First point", fontsize=11)
    page.insert_text((72, 240), "Visit our site", fontsize=11)
    page.insert_link({
        "kind": pymupdf.LINK_URI,
        "from": pymupdf.Rect(70, 228, 170, 245),
        "uri": "https://example.com/",
    })
    shape = page.new_shape()
    for row in range(3):
        for column in range(2):
            shape.draw_rect(pymupdf.Rect(
                72 + column * 100, 300 + row * 24, 172 + column * 100, 324 + row * 24
            ))
    shape.finish(color=(0, 0, 0))
    shape.commit()
    for row, (left, right) in enumerate([("Name", "Value"), ("Alpha", "1"), ("Beta", "2")]):
        page.insert_text((80, 317 + row * 24), left, fontsize=11)
        page.insert_text((180, 317 + row * 24), right, fontsize=11)
    return doc


class PdfStructureTests(SimpleTestCase):
    def test_markdown_keeps_headings_tables_and_links(self):
        markdown = render_markdown(_sample_document())

        self.assertIn("# Annual Report", markdown)
        self.assertIn("[Visit our site](https://example.com/)", markdown)
        self.assertIn("| Name | Value |", markdown)
        self.assertIn("| Beta | 2 |", markdown)

    def test_clean_html_builds_real_tables_and_links(self):
        document = render_html(_sample_document(), "simple")

        self.assertIn("<h1>", document)
        self.assertIn("<title>Annual Report</title>", document)
        self.assertIn("<th>Name</th>", document)
        self.assertIn('href="https://example.com/"', document)

    def test_preserved_html_keeps_vector_art(self):
        self.assertIn("<svg", render_html(_sample_document(), "preserve"))

    def test_unsafe_links_are_dropped(self):
        import pymupdf

        for layout in ("simple", "preserve"):
            doc = pymupdf.open()
            page = doc.new_page()
            page.insert_text((72, 100), "Click here", fontsize=14)
            page.insert_link({
                "kind": pymupdf.LINK_URI,
                "from": pymupdf.Rect(70, 85, 200, 105),
                "uri": "javascript:alert(1)",
            })
            self.assertNotIn("javascript:", render_html(doc, layout))


class PdfPageEditingTests(SimpleTestCase):
    def _rotated_page(self):
        import io

        import pymupdf
        from pypdf import PdfReader

        doc = pymupdf.open()
        page = doc.new_page(width=600, height=800)
        page.set_rotation(90)
        return PdfReader(io.BytesIO(doc.tobytes())).pages[0]

    def test_visible_box_matches_what_a_rotated_page_shows(self):
        page = self._rotated_page()

        _, _, width, height = _visible_box(page)

        self.assertEqual((round(width), round(height)), (800, 600))
        self.assertEqual(page.rotation, 0)

    def test_stamps_are_positioned_inside_offset_page_boxes(self):
        import io

        import pymupdf
        from pypdf import PdfWriter
        from pypdf.generic import RectangleObject

        writer = PdfWriter()
        page = writer.add_blank_page(600, 800)
        page.mediabox = RectangleObject((100, 100, 500, 700))
        page.cropbox = RectangleObject((100, 100, 500, 700))

        _stamp_page(page, lambda canvas, width, height: canvas.drawString(20, 20, "STAMP"))

        output = io.BytesIO()
        writer.write(output)
        shown = pymupdf.open(stream=output.getvalue(), filetype="pdf")[0]
        self.assertTrue(shown.search_for("STAMP"))

    def test_page_ranges_explain_mistakes_to_the_user(self):
        self.assertEqual(
            _parse_page_ranges("1-2, 4", 5), [("1-2", [0, 1]), ("4", [3])]
        )
        with self.assertRaisesMessage(ValueError, "not a valid page range"):
            _parse_page_ranges("abc", 5)
        with self.assertRaisesMessage(ValueError, "outside this PDF"):
            _parse_page_ranges("4-9", 5)

    def test_non_latin_watermarks_are_rejected_instead_of_drawn_as_boxes(self):
        self.assertTrue(is_watermark_text_supported("Confidentiel é"))
        self.assertFalse(is_watermark_text_supported("গোপনীয়"))


class FriendlyErrorTests(SimpleTestCase):
    def test_library_errors_never_reach_users(self):
        from pymupdf import FileDataError
        from pypdf.errors import FileNotDecryptedError, PdfStreamError

        cases = [
            (FileDataError("Failed to open file 'C:/srv/media/x.pdf'"), "could not be read"),
            (PdfStreamError("Stream has ended unexpectedly"), "could not be read"),
            (FileNotDecryptedError("File has not been decrypted"), "password-protected"),
            (ValueError("invalid literal for int()"), "Something went wrong"),
            (AssertionError(), "Something went wrong"),
        ]
        for exception, expected in cases:
            with self.subTest(exception=exception), self.assertLogs("api.tasks", "ERROR") if (
                expected == "Something went wrong"
            ) else nullcontext():
                message = _friendly_error(exception)
                self.assertIn(expected, message)
                self.assertNotIn("C:/", message)

    def test_our_own_messages_pass_through(self):
        self.assertEqual(_friendly_error(ValueError("Incorrect password.")), "Incorrect password.")


class UsageLimitTests(SimpleTestCase):
    def test_product_limits(self):
        self.assertEqual(settings.GUEST_DAILY_LIMIT, 10)
        self.assertIsNone(settings.USER_DAILY_LIMIT)

    def test_signed_in_users_are_never_blocked_when_unlimited(self):
        user = Mock(pk=12)
        locked_user = Mock(
            pk=12,
            last_upload_reset=timezone.now().date(),
            daily_upload_count=5000,
        )
        user_manager = Mock()
        user_manager.get.return_value = locked_user

        with (
            patch("api.models.User.objects.select_for_update", return_value=user_manager),
            patch("api.rate_limit.transaction.atomic", return_value=nullcontext()),
        ):
            result = check_and_increment_user(user, increment_by=3)

        self.assertEqual(result, (True, 5003, None))


class CookieSessionTests(SimpleTestCase):
    def _request(self, **cookies):
        return Mock(COOKIES=cookies, META={})

    def test_lapsed_access_token_falls_back_to_the_refresh_cookie(self):
        auth = CookieJWTAuthentication()
        user = Mock()
        token = Mock()

        with (
            patch("api.authentication.RefreshToken", return_value=token),
            patch.object(auth, "get_user", return_value=user),
        ):
            result = auth.authenticate(self._request(refresh_token="refresh"))

        self.assertEqual(result, (user, token))

    def test_invalid_session_continues_as_anonymous(self):
        auth = CookieJWTAuthentication()

        with patch("api.authentication.RefreshToken", side_effect=TokenError("revoked")):
            result = auth.authenticate(
                self._request(access_token="junk", refresh_token="revoked")
            )

        self.assertIsNone(result)


class PdfToolsTests(SimpleTestCase):
    """These run the real libraries on real PDFs, with no mocks."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.folder = Path(directory.name)

    def _open(self, path):
        """Open a PDF that is closed again before the temp folder is removed."""
        import pymupdf

        doc = pymupdf.open(path)
        self.addCleanup(doc.close)
        return doc

    def _pdf(self, name, pages):
        import pymupdf

        doc = pymupdf.open()
        for text in pages:
            page = doc.new_page()
            page.insert_text((72, 100), text, fontsize=12)
        path = self.folder / name
        doc.save(path)
        return path

    def test_redaction_removes_text_from_the_file_and_everywhere_it_hides(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_text((72, 100), "Name: SECRETWORD", fontsize=12)
        page.insert_text((72, 130), "Public sentence stays.", fontsize=12)
        field = pymupdf.Widget()
        field.field_name = "note"
        field.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        field.field_value = "SECRETWORD in a field"
        field.rect = pymupdf.Rect(72, 200, 400, 225)
        page.add_widget(field)
        doc.set_metadata({"title": "SECRETWORD"})
        doc.set_toc([[1, "SECRETWORD", 1]])
        doc.embfile_add("notes.txt", b"SECRETWORD", filename="notes.txt")
        source = self.folder / "source.pdf"
        doc.save(source)
        output = self.folder / "out.pdf"

        result = pdf_tools.redact([source], output, {"terms": ["secretword"]})

        redacted = self._open(output)
        text = redacted[0].get_text()
        self.assertGreaterEqual(result["redactions"], 2)
        self.assertNotIn("SECRETWORD", text)
        self.assertIn("Public sentence stays.", text)
        self.assertNotIn(b"SECRETWORD", output.read_bytes())
        self.assertFalse(redacted.metadata["title"])
        self.assertEqual(redacted.get_toc(), [])
        self.assertEqual(redacted.embfile_names(), [])

    def test_redaction_refuses_to_report_success_when_nothing_matched(self):
        source = self._pdf("a.pdf", ["Hello"])
        with self.assertRaisesMessage(ValueError, "Nothing matched"):
            pdf_tools.redact([source], self.folder / "out.pdf", {"terms": ["absent"]})

    def test_spreadsheet_cells_cannot_become_formulas(self):
        from openpyxl import Workbook

        sheet = Workbook().active
        cases = {
            "A1": ('=HYPERLINK("http://evil")', "s"),
            "A2": ("00123", "s"),
            "A3": ("1,200", "n"),
            "A4": ("25%", "n"),
        }
        for address, (text, _) in cases.items():
            pdf_tools._write_cell(sheet[address], text)

        for address, (_, data_type) in cases.items():
            self.assertEqual(sheet[address].data_type, data_type, address)
        self.assertEqual(sheet["A2"].value, "00123")
        self.assertEqual(sheet["A3"].value, 1200)
        self.assertEqual(sheet["A4"].value, 0.25)

    def test_compare_marks_only_the_word_that_changed(self):
        old = self._pdf("old.pdf", ["The fee is 100 dollars", "Same page"])
        new = self._pdf("new.pdf", ["The fee is 900 dollars", "Same page"])

        result = pdf_tools.compare([old, new], self.folder / "out.pdf", {})

        self.assertEqual(
            result, {"words_removed": 1, "words_added": 1, "pages_changed": 1}
        )

    def test_page_selection(self):
        import pymupdf

        source = self._pdf("a.pdf", ["one", "two", "three"])
        output = self.folder / "out.pdf"

        pdf_tools.extract_pages([source], output, {"indices": [2, 0, 2]})
        kept = pymupdf.open(output)
        self.assertEqual([page.get_text().strip() for page in kept], ["three", "one"])
        kept.close()

        pdf_tools.remove_pages([source], output, {"indices": [0, 1]})
        kept = pymupdf.open(output)
        self.assertEqual([page.get_text().strip() for page in kept], ["three"])
        kept.close()

        with self.assertRaisesMessage(ValueError, "Keep at least one"):
            pdf_tools.remove_pages([source], output, {"indices": [0, 1, 2]})

    def test_repair_recovers_a_file_with_a_broken_ending(self):
        data = self._pdf("a.pdf", ["recover me"]).read_bytes()
        damaged = self.folder / "damaged.pdf"
        damaged.write_bytes(data.replace(b"startxref", b"startxxxx"))
        output = self.folder / "out.pdf"

        result = pdf_tools.repair([damaged], output, {})

        self.assertEqual(result["pages"], 1)
        self.assertIn("recover me", self._open(output)[0].get_text())

    def test_repair_rejects_files_that_are_not_pdfs(self):
        junk = self.folder / "junk.pdf"
        junk.write_bytes(b"not a pdf")
        with self.assertRaisesMessage(ValueError, "too damaged"):
            pdf_tools.repair([junk], self.folder / "out.pdf", {})

    def test_locked_pdfs_get_a_clear_message(self):
        from pypdf import PdfWriter

        writer = PdfWriter()
        writer.add_blank_page(100, 100)
        writer.encrypt("secret", algorithm="AES-256")
        locked = self.folder / "locked.pdf"
        writer.write(locked)
        with self.assertRaisesMessage(ValueError, "password-protected"):
            pdf_tools.open_pdf(locked)

    def test_form_fields_are_listed_and_filled(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        field = pymupdf.Widget()
        field.field_name = "full_name"
        field.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
        field.field_value = ""
        field.rect = pymupdf.Rect(72, 100, 300, 125)
        page.add_widget(field)
        source = self.folder / "form.pdf"
        doc.save(source)
        output = self.folder / "out.pdf"

        listed = pdf_tools.list_form_fields(self._open(source))
        pdf_tools.fill_form([source], output, {"values": {"full_name": "Ratul"}, "flatten": True})

        self.assertEqual(listed[0]["type"], "text")
        filled = self._open(output)[0]
        self.assertIn("Ratul", filled.get_text())
        self.assertFalse(list(filled.widgets() or []))


class OfficeToolsTests(SimpleTestCase):
    def test_uploads_must_be_what_their_name_claims(self):
        cases = [
            ("word", "a.docx", b"PKrest", None),
            ("word", "a.rtf", b"{\\rtf1", None),
            ("excel", "a.csv", b"name,score", None),
            ("word", "a.docx", b"not zip!", "real .docx"),
            ("excel", "a.xls", b"PKrest", "real .xls"),
            ("word", "a.pdf", b"%PDF-1.7", "Please choose"),
            ("powerpoint", "a.docx", b"PKrest", "Please choose"),
        ]
        for kind, name, head, expected in cases:
            with self.subTest(name=name, kind=kind):
                problem = office_file_problem(kind, name, head)
                if expected is None:
                    self.assertIsNone(problem)
                else:
                    self.assertIn(expected, problem)

    def test_password_protected_office_files_are_named_as_such(self):
        problem = office_file_problem("word", "a.docx", OLE_MAGIC)
        self.assertIn("password-protected", problem)

    def test_missing_converter_gives_a_clear_message(self):
        with patch("api.office_tools.shutil.which", return_value=None):
            with self.assertRaisesMessage(ValueError, "isn't available"):
                office_to_pdf([Path("a.docx")], Path("a.pdf"), {})

    def test_libreoffice_profile_blocks_macros_and_links(self):
        self.assertIn('"DisableMacrosExecution" oor:op="fuse"><value>true', LIBREOFFICE_PROFILE)
        self.assertIn("Office.Writer/Content/Update", LIBREOFFICE_PROFILE)
        self.assertIn("Office.Calc/Content/Update", LIBREOFFICE_PROFILE)
