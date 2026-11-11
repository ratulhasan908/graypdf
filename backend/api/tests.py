import io
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

from . import edit_fonts, pdf_tools
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


def _test_font(family="Testsans", glyphs="Invoice tal:0123456789USDp()"):
    """A real TrueType font, built here so tests don't depend on installed fonts."""
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    names = [".notdef", "space"] + [f"u{ord(char):04X}" for char in dict.fromkeys(glyphs.replace(" ", ""))]
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({32: "space", **{ord(char): f"u{ord(char):04X}" for char in glyphs if char != " "}})
    shapes = {}
    for index, name in enumerate(names):
        pen = TTGlyphPen(None)
        if name != "space":
            # Each glyph is a box of a different width, so glyphs are tellable apart.
            right = 300 + index * 7
            pen.moveTo((50, 0)); pen.lineTo((50, 700)); pen.lineTo((right, 700)); pen.lineTo((right, 0)); pen.closePath()
        shapes[name] = pen.glyph()
    builder.setupGlyf(shapes)
    builder.setupHorizontalMetrics({name: (400 + index * 7, 50) for index, name in enumerate(names)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": family, "styleName": "Regular"})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    output = io.BytesIO()
    builder.save(output)
    return output.getvalue()


@override_settings(EDIT_FONT_DOWNLOADS=False)
class PdfEditTests(SimpleTestCase):
    """The PDF editor, run on real PDFs the way the browser drives it."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.folder = Path(directory.name)
        media = override_settings(MEDIA_ROOT=str(self.folder / "media"))
        media.enable()
        self.addCleanup(media.disable)

    def _open(self, path):
        import pymupdf

        doc = pymupdf.open(path)
        self.addCleanup(doc.close)
        return doc

    def _invoice(self, embed=True):
        """An invoice set in an embedded, subsetted TrueType font, like Word makes."""
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        page.draw_rect(pymupdf.Rect(60, 80, 400, 140), color=None, fill=(0.85, 0.92, 1))
        if embed:
            page.insert_font(fontname="F1", fontbuffer=_test_font())
            page.insert_text((72, 100), "Invoice total: 100 USD", fontname="F1", fontsize=12)
        else:
            page.insert_text((72, 100), "Invoice total: 100 USD", fontsize=12)
        page.insert_text((72, 115), "Line just below stays", fontsize=12)
        page.insert_text((72, 300), "Times bold heading", fontsize=20, fontname="tibo", color=(0.8, 0, 0))
        doc.subset_fonts()
        path = self.folder / "invoice.pdf"
        doc.save(path)
        doc.close()
        return path

    def _lines(self, path, number=0):
        """What the editor gets for a page."""
        page = self._open(path)[number]
        page.remove_rotation()
        return pdf_tools.text_lines(page)

    def _line(self, path, start):
        return next(line for line in self._lines(path) if line["text"].startswith(start))

    def _retype(self, line, text):
        """The change the browser sends after someone retypes a line."""
        return {
            "type": "text", "page": 1, "x": line["x"], "baseline": line["baseline"], "text": text,
            "size": line["size"], "color": line["color"], **line["font"],
            "source": {key: line[key] for key in ("x", "y", "w", "h")},
        }

    def _spans(self, path, number=0):
        page = self._open(path)[number]
        return [span for block in page.get_text("dict")["blocks"] for row in block.get("lines", []) for span in row["spans"]]

    def test_lines_report_their_embedded_font(self):
        source = self._invoice()
        invoice = self._line(source, "Invoice")
        heading = self._line(source, "Times")

        self.assertIsInstance(invoice["font"]["ref"], int)
        self.assertEqual(invoice["font"]["family"], "Testsans")
        self.assertEqual((heading["font"]["weight"], heading["font"]["generic"], heading["size"]), (700, "serif", 20))
        self.assertEqual(heading["color"], "#cc0000")

    def test_embedded_subset_fonts_are_rebuilt_with_a_character_map(self):
        from fontTools.ttLib import TTFont

        source = self._invoice()
        doc = self._open(source)
        font = edit_fonts.editable_font(doc, self._line(source, "Invoice")["font"]["ref"])

        mapped = set(TTFont(io.BytesIO(font)).getBestCmap())
        self.assertTrue({ord(char) for char in "Invoice total:10USD"} <= mapped)
        self.assertNotIn(ord("5"), mapped)  # unused glyphs in a subset are empty, so never mapped

    def test_cff_fonts_are_rebuilt_too(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        page.insert_font(fontname="F0", fontbuffer=pymupdf.Font("tiro").buffer)  # MuPDF's own CFF font
        page.insert_text((72, 100), "Invoice total", fontname="F0", fontsize=12)
        doc.subset_fonts()
        doc = pymupdf.open("pdf", doc.tobytes())
        self.addCleanup(doc.close)
        xref, ext = doc[0].get_fonts()[0][:2]

        font = edit_fonts.editable_font(doc, xref)

        self.assertIn(ext, ("cff", "cid"))
        self.assertTrue({ord(char) for char in "Invoice total"} <= edit_fonts.coverage(font))

    def test_retyped_line_keeps_its_font_place_and_neighbours(self):
        source = self._invoice()
        line = self._line(source, "Invoice")
        output = self.folder / "out.pdf"

        result = pdf_tools.edit([source], output, {"edits": [self._retype(line, "Invoice total: 10 USD (paid)")]})

        text = self._open(output)[0].get_text()
        self.assertEqual(result, {"edits": 1})
        self.assertIn("Invoice total: 10 USD (paid)", text)
        self.assertNotIn("100 USD", text)
        self.assertIn("Line just below stays", text)
        self.assertTrue(any(drawing.get("fill") for drawing in self._open(output)[0].get_drawings()))
        spans = [span for span in self._spans(output) if span["text"].strip() and span["origin"][1] < 105]
        # Characters the subset has come from the PDF's own font, on the old baseline.
        self.assertTrue(all(span["font"].startswith("Testsans") for span in spans if "nvoice" in span["text"]))
        for span in spans:
            self.assertAlmostEqual(span["origin"][1], 100, delta=0.6)
        self.assertAlmostEqual(min(span["origin"][0] for span in spans), 72, delta=0.6)

    def test_characters_missing_from_the_subset_use_a_fallback_font(self):
        source = self._invoice()
        output = self.folder / "out.pdf"
        line = self._line(source, "Invoice")

        pdf_tools.edit([source], output, {"edits": [self._retype(line, "Invoice €5 মোট")]})

        fonts = {span["font"] for span in self._spans(output) if span["origin"][1] < 105}
        self.assertTrue(any(font.startswith("Testsans") for font in fonts), fonts)
        self.assertTrue(any("Bengali" in font for font in fonts), fonts)

    def test_unembedded_fonts_and_new_text_work(self):
        source = self._invoice(embed=False)
        output = self.folder / "out.pdf"
        new = {"type": "text", "page": 1, "x": 0.1, "baseline": 0.5, "text": "New line\nSecond line",
               "size": 14, "color": "#123456", "weight": 700, "italic": True, "family": "Helvetica",
               "generic": "sans", "ref": None}

        pdf_tools.edit([source], output, {"edits": [new, self._retype(self._line(source, "Invoice"), "Changed")]})

        text = self._open(output)[0].get_text()
        self.assertIn("New line", text)
        self.assertIn("Second line", text)
        self.assertIn("Changed", text)
        first = next(span for span in self._spans(output) if span["text"].startswith("New"))
        self.assertAlmostEqual(first["origin"][1], 0.5 * 842, delta=0.6)

    def test_clearing_a_line_deletes_it(self):
        source = self._invoice()
        pdf_tools.edit([source], self.folder / "out.pdf", {"edits": [self._retype(self._line(source, "Times"), "")]})

        text = self._open(self.folder / "out.pdf")[0].get_text()
        self.assertNotIn("Times bold heading", text)
        self.assertIn("Invoice total: 100 USD", text)

    def test_lines_on_a_rotated_page_can_be_retyped(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        page.set_rotation(90)  # a landscape scan whose text still reads upright
        page.insert_text(pymupdf.Point(72, 100) * page.derotation_matrix, "Invoice total: 100 USD", fontsize=12, rotate=90)
        source = self.folder / "landscape.pdf"
        doc.save(source)
        output = self.folder / "out.pdf"

        pdf_tools.edit([source], output, {"edits": [self._retype(self._line(source, "Invoice"), "Rotated but edited")]})

        page = self._open(output)[0]
        page.remove_rotation()
        span = next(span for block in page.get_text("dict")["blocks"] for row in block.get("lines", []) for span in row["spans"])
        self.assertEqual(span["text"], "Rotated but edited")
        self.assertAlmostEqual(span["origin"][1], 100, delta=0.6)

    def test_a_retyped_line_that_grows_pushes_everything_below_it_down(self):
        source = self._invoice()
        line = self._line(source, "Invoice")
        grown = {**self._retype(line, "Invoice total:\nsecond line\nthird line"), "width": 0.6, "grow": 28.8}
        highlight = {"type": "highlight", "page": 1, "x": 0.1, "y": 300 / 842 - 0.02, "w": 0.3, "h": 0.03}
        output = self.folder / "out.pdf"

        pdf_tools.edit([source], output, {"edits": [grown, highlight]})

        page = self._open(output)[0]
        origins = {span["text"].strip(): span["origin"][1] for span in self._spans(output) if span["text"].strip()}
        self.assertAlmostEqual(origins["Line just below stays"], 115 + 28.8, delta=0.6)
        self.assertAlmostEqual(origins["Times bold heading"], 300 + 28.8, delta=0.6)
        self.assertIn("third line", page.get_text())
        # The blue box behind the text grew to fit instead of breaking in two.
        picture = page.get_pixmap(dpi=72)
        blue, white = (216, 234, 255), (255, 255, 255)  # the box's fill (0.85, 0.92, 1)
        for y, colour in ((77, white), (83, blue), (138, blue), (150, blue), (166, blue), (172, white)):
            with self.subTest(y=y):
                self.assertEqual(picture.pixel(390, y), colour)
        # Changes below the line move with the content.
        self.assertAlmostEqual(next(page.annots()).rect.y0, 300 - 0.02 * 842 + 28.8, delta=2)
        self.assertEqual(page.rect.height, 842)  # there was room, so the page kept its size

    def test_a_growing_value_never_splits_the_label_on_its_row_or_duplicates_text(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        rows = [("Taxpayer's Name", "RATUL HASAN"), ("Identification Number (TIN)", "840710566414"), ("Father's Name", "Late Md. Abu Daud")]
        for index, (label, value) in enumerate(rows):
            y = 100 + 18 * index
            page.insert_text((72, y), label, fontsize=12)
            page.insert_text((320, y), value, fontsize=12)
        source = self.folder / "form.pdf"
        doc.save(source)
        value = next(line for line in self._lines(source) if line["text"] == "840710566414")
        grown = {**self._retype(value, "840710566414\n9934093945\n3488888934"), "cut": value["flow"], "width": 0.4, "grow": 28.8}
        output = self.folder / "out.pdf"

        pdf_tools.edit([source], output, {"edits": [grown]})

        page = self._open(output)[0]
        origins = {span["text"]: span["origin"][1] for span in self._spans(output)}
        # The label beside the edited value stays whole, on its own row.
        self.assertAlmostEqual(origins["Identification Number (TIN)"], 118, delta=0.5)
        self.assertAlmostEqual(origins["Father's Name"], 136 + 28.8, delta=0.5)
        self.assertAlmostEqual(origins["Late Md. Abu Daud"], 136 + 28.8, delta=0.5)
        # Every line's text exists once, not once per moved band.
        text = page.get_text()
        for label, _value in rows:
            self.assertEqual(text.count(label), 1, label)

    def test_the_page_gets_taller_when_pushed_content_would_fall_off(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page(width=300, height=200)
        page.insert_text((20, 40), "Top line", fontsize=12)
        page.insert_text((20, 190), "Bottom line", fontsize=12)
        source = self.folder / "short.pdf"
        doc.save(source)
        output = self.folder / "out.pdf"
        grown = {**self._retype(self._line(source, "Top"), "Top line\n" * 5), "grow": 72.0, "width": 0.8}

        pdf_tools.edit([source], output, {"edits": [grown]})

        page = self._open(output)[0]
        self.assertGreater(page.rect.height, 200 + 60)
        bottom = next(span for span in self._spans(output) if span["text"] == "Bottom line")
        self.assertAlmostEqual(bottom["origin"][1], 190 + 72, delta=0.6)

    def test_bengali_text_is_cleaned_and_uses_a_shaping_font(self):
        self.assertEqual(pdf_tools.clean_text("মোঃঃ স্ত্রীী প্রতিষ্ঠাান"), "মোঃ স্ত্রী প্রতিষ্ঠান")
        self.assertEqual(edit_fonts.script_families("নাম Name", "sans"), ["Noto Sans Bengali"])
        self.assertEqual(edit_fonts.script_families("Name", "sans"), [])
        self.assertTrue(edit_fonts.is_complex(ord("ম")))
        self.assertFalse(edit_fonts.is_complex(ord("M")))
        self.assertEqual(edit_fonts.family_font.__name__, "family_font")
        self.assertEqual(edit_fonts.SUBSTITUTES["solaimanlipi"], "Noto Sans Bengali")

    def test_deleting_a_line_closes_up_the_space_but_never_cuts_a_table(self):
        import pymupdf

        doc = pymupdf.open()
        page = doc.new_page()
        for number, y in enumerate((100, 121, 142, 163)):
            page.insert_text((72, y), f"Line {number + 1}", fontsize=12)
        # A one-row table under the lines: its cells must never collapse.
        page.draw_rect(pymupdf.Rect(60, 190, 400, 230), color=(0, 0, 0))
        page.insert_text((72, 214), "Cell A", fontsize=12)
        page.insert_text((200, 214), "Cell B", fontsize=12)
        source = self.folder / "lines.pdf"
        doc.save(source)
        lines = {line["text"]: line for line in self._lines(source)}
        self.assertAlmostEqual(lines["Line 2"]["collapse"], 21, delta=0.1)
        self.assertEqual(lines["Cell A"]["collapse"], 0)  # cutting it would break the table
        # The last line before the table frees one line's slot, keeping the space above the table.
        self.assertAlmostEqual(lines["Line 4"]["collapse"], 21, delta=0.1)

        output = self.folder / "out.pdf"
        deleted = {**self._retype(lines["Line 2"], ""), "grow": -lines["Line 2"]["collapse"]}
        pdf_tools.edit([source], output, {"edits": [deleted]})

        origins = {span["text"]: span["origin"][1] for span in self._spans(output)}
        self.assertNotIn("Line 2", origins)
        self.assertAlmostEqual(origins["Line 1"], 100, delta=0.5)
        self.assertAlmostEqual(origins["Line 3"], 121, delta=0.5)
        self.assertAlmostEqual(origins["Cell A"], 214 - 21, delta=0.5)

    def test_retyped_bangla_copies_out_as_real_text(self):
        source = self._invoice()
        output = self.folder / "out.pdf"
        new = {"type": "text", "page": 1, "x": 0.1, "baseline": 0.5, "text": "নামঃ মোঃ রাতুল হাসান\nকিশোর স্ত্রী প্রতিষ্ঠান",
               "size": 14, "color": "#123456", "family": "Arial", "generic": "sans", "ref": None}

        with override_settings(EDIT_FONT_DOWNLOADS=True):
            pdf_tools.edit([source], output, {"edits": [new]})

        page = self._open(output)[0]
        text = page.get_text()
        if "রাতুল" not in text:
            self.skipTest("No Bangla font available offline; shaped text falls back to plain drawing.")
        self.assertIn("নামঃ মোঃ রাতুল হাসান", text)
        self.assertIn("কিশোর স্ত্রী প্রতিষ্ঠান", text)
        self.assertEqual(len(page.search_for("রাতুল")), 1)

    def test_an_outdated_worker_refuses_instead_of_saving_old_behaviour(self):
        from .tasks import EDIT_ENGINE, OUTDATED_WORKER, _edit_with_current_engine

        source = self._invoice()
        edit = {"type": "whiteout", "page": 1, "x": 0, "y": 0, "w": 0.1, "h": 0.1}
        with self.assertRaisesMessage(ValueError, OUTDATED_WORKER):
            _edit_with_current_engine([source], self.folder / "a.pdf", {"edits": [edit], "engine": "older"})
        result = _edit_with_current_engine([source], self.folder / "b.pdf", {"edits": [edit], "engine": EDIT_ENGINE})
        self.assertEqual(result, {"edits": 1})

    def test_find_and_replace_works_across_every_page(self):
        import pymupdf

        doc = pymupdf.open()
        for number in range(3):
            doc.new_page().insert_text((72, 100), f"Page {number + 1}: ACME Ltd owes 100 USD", fontsize=12)
        source = self.folder / "many.pdf"
        doc.save(source)
        output = self.folder / "out.pdf"

        result = pdf_tools.edit([source], output, {"edits": [{"type": "replace", "find": "acme", "replace": "Globex"}]})

        self.assertEqual(result, {"edits": 1, "replaced": 3})
        for page in self._open(output):
            self.assertIn("Globex Ltd owes 100 USD", page.get_text())
            self.assertNotIn("ACME", page.get_text())
        with self.assertRaisesMessage(ValueError, "No text matched"):
            pdf_tools.edit([source], output, {"edits": [{"type": "replace", "find": "absent", "replace": "x"}]})

    def test_shapes_markup_notes_links_and_images(self):
        import pymupdf

        source = self._invoice()
        picture = self.folder / "logo.png"
        pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 10), False).save(picture)
        box = {"page": 1, "x": 0.1, "y": 0.1, "w": 0.4, "h": 0.03}
        edits = [
            {**box, "type": "whiteout", "y": 0.6},
            {**box, "type": "highlight", "color": "#ffd43b"},
            {**box, "type": "underline", "color": "#2748d6"},
            {**box, "type": "strikeout", "color": "#d92d20"},
            {**box, "type": "rect", "y": 0.5, "color": "#ff0000", "fill": "#00ff00", "stroke": 3},
            {**box, "type": "ellipse", "y": 0.7, "color": "#0000ff"},
            {"type": "arrow", "page": 1, "x1": 0.1, "y1": 0.9, "x2": 0.5, "y2": 0.9, "color": "#ff00ff", "stroke": 2},
            {"type": "draw", "page": 1, "points": [[0.1, 0.8], [0.2, 0.85]], "color": "#00ffff", "stroke": 2},
            {"type": "note", "page": 1, "x": 0.9, "y": 0.1, "text": "Check this total", "color": "#ffd43b"},
            {**box, "type": "link", "y": 0.3, "url": "https://example.com/pay"},
            {**box, "type": "image", "x": 0.6, "image": 0},
        ]
        output = self.folder / "out.pdf"

        pdf_tools.edit([source, picture], output, {"edits": edits})

        page = self._open(output)[0]
        self.assertEqual(sorted(annot.type[1] for annot in page.annots()), ["Highlight", "StrikeOut", "Text", "Underline"])
        self.assertEqual([link["uri"] for link in page.get_links()], ["https://example.com/pay"])
        self.assertEqual(len(page.get_images()), 1)
        colors = {drawing.get("color") for drawing in page.get_drawings()}
        self.assertTrue({(1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 1.0), (0.0, 1.0, 1.0)} <= colors)
        self.assertIn((0.0, 1.0, 0.0), {drawing.get("fill") for drawing in page.get_drawings()})

    def test_pages_can_be_rotated_and_deleted_and_there_is_no_page_limit(self):
        import pymupdf

        doc = pymupdf.open()
        for number in range(600):  # more than the other tools allow
            doc.new_page().insert_text((72, 100), f"Page {number + 1}", fontsize=12)
        source = self.folder / "long.pdf"
        doc.save(source)
        output = self.folder / "out.pdf"
        edits = [
            {"type": "rotate-page", "page": 2, "degrees": 90},
            {"type": "delete-page", "page": 1},
            {"type": "whiteout", "page": 600, "x": 0, "y": 0, "w": 0.1, "h": 0.1},
        ]

        pdf_tools.edit([source], output, {"edits": edits})

        edited = self._open(output)
        self.assertEqual(edited.page_count, 599)
        self.assertEqual((edited[0].get_text().strip(), edited[0].rotation), ("Page 2", 90))
        with self.assertRaisesMessage(ValueError, "Keep at least one"):
            pdf_tools.edit([self._invoice()], output, {"edits": [{"type": "delete-page", "page": 1}]})

    def test_edits_must_point_at_real_pages_and_images(self):
        source = self._invoice()
        output = self.folder / "out.pdf"
        with self.assertRaisesMessage(ValueError, "Page 4 does not exist"):
            pdf_tools.edit([source], output, {"edits": [{"type": "whiteout", "page": 4, "x": 0, "y": 0, "w": 0.1, "h": 0.1}]})
        with self.assertRaisesMessage(ValueError, "images you added is missing"):
            pdf_tools.edit([source], output, {"edits": [{"type": "image", "page": 1, "x": 0, "y": 0, "w": 0.1, "h": 0.1, "image": 0}]})

    def test_font_names_are_understood(self):
        cases = {
            "ABCDEF+TimesNewRomanPS-BoldItalicMT": ("Times New Roman", 700, True),
            "ArialMT": ("Arial", 400, False),
            "Calibri,Bold": ("Calibri", 700, False),
            "OpenSans-SemiBold": ("Open Sans", 600, False),
            "Roboto-LightItalic": ("Roboto", 300, True),
            "QABWXL+Calibri Regular": ("Calibri", 400, False),
        }
        for name, expected in cases.items():
            with self.subTest(name=name):
                self.assertEqual(edit_fonts.parse_font_name(name), expected)
        self.assertEqual(edit_fonts.name_key("URW Bookman Light"), edit_fonts.name_key("ABCDEF+URWBookman-Light"))

    def test_text_runs_follow_each_fonts_characters(self):
        html = edit_fonts.runs_html("ab  c\nমো", [("pdf-font", {ord("a")}), ("full-font", {ord("b"), ord(" ")})])
        self.assertEqual(
            html,
            '<span style="font-family: pdf-font">a</span>'
            '<span style="font-family: full-font">b&nbsp;&nbsp;</span>c<br>মো',
        )

    def test_fonts_come_from_the_cache_without_the_network(self):
        cache = Path(settings.MEDIA_ROOT) / "font-cache"
        cache.mkdir(parents=True)
        (cache / "Carlito-700-0.ttf").write_bytes(b"carlito bold")

        self.assertEqual(edit_fonts.family_font("Calibri", 700, False, "sans"), (b"carlito bold", "Carlito"))
        self.assertEqual(edit_fonts.family_font("Unknown Font", 400, False, "serif"), (None, None))
        self.assertTrue((cache / "Tinos-400-0.missing").exists())

    def test_the_endpoint_rejects_malformed_changes(self):
        from .views import _edit_problem

        text = {"type": "text", "page": 1, "x": 0.1, "baseline": 0.1, "text": "hi", "size": 12, "family": "Open Sans", "ref": 12}
        draw = {"type": "draw", "page": 1, "points": [[0.1, 0.1]], "color": "#000000"}
        self.assertIsNone(_edit_problem([text, draw, {"type": "replace", "find": "a", "replace": "b"}], 0))
        cases = [
            ([], "at least one change"),
            ("nope", "at least one change"),
            ([{**text, "type": "script"}], "aren't valid"),
            ([{**text, "color": "red; background: url(x)"}], "aren't valid"),
            ([{**text, "family": "x}</style><script>"}], "aren't valid"),
            ([{**text, "ref": "12"}], "aren't valid"),
            ([{**text, "text": "x" * 5001}], "aren't valid"),
            ([{**text, "size": "nan"}], "aren't valid"),
            ([{**text, "source": {"x": 0, "y": 0, "w": "inf", "h": 1}}], "aren't valid"),
            ([{**draw, "points": [[0.1]]}], "aren't valid"),
            ([{"type": "replace", "find": " "}], "text you want to find"),
            ([{"type": "link", "page": 1, "x": 0, "y": 0, "w": 0.1, "h": 0.1, "url": "javascript:alert(1)"}], "Links must"),
            ([{"type": "rotate-page", "page": 1, "degrees": 45}], "aren't valid"),
            ([{"type": "image", "page": 1, "x": 0, "y": 0, "w": 0.1, "h": 0.1, "image": 1}], "missing"),
            ([draw] * 5001, "more than 5000"),
            ([{**draw, "points": [[0.1, 0.1]] * 5000}] * 21, "too detailed"),
        ]
        for edits, message in cases:
            with self.subTest(message=message):
                self.assertIn(message, _edit_problem(edits, 1))


@override_settings(EDIT_FONT_DOWNLOADS=False)
class EditSessionTests(SimpleTestCase):
    """Open once, then load pages and fonts as they are viewed."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        media = override_settings(MEDIA_ROOT=directory.name)
        media.enable()
        self.addCleanup(media.disable)
        for name in ("check_guest_preview_rate", "check_guest_hourly"):
            patcher = patch(f"api.views.{name}", return_value=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = APIClient()

    def _upload(self, pages=700):
        import pymupdf

        doc = pymupdf.open()
        for number in range(pages):
            page = doc.new_page()
            page.insert_font(fontname="F1", fontbuffer=_test_font())
            page.insert_text((72, 100), f"Invoice {number}", fontname="F1", fontsize=12)
        doc.subset_fonts()
        data = doc.tobytes()
        return self.client.post(
            reverse("edit-open"), {"files": SimpleUploadedFile("big.pdf", data, "application/pdf")}, format="multipart"
        )

    def test_any_length_of_pdf_opens_and_pages_load_on_demand(self):
        opened = self._upload()
        self.assertEqual(opened.status_code, 200, opened.content)
        session = opened.json()["session"]
        self.assertEqual(len(opened.json()["pages"]), 700)

        page = self.client.get(reverse("edit-page", args=[session, 650]), {"text": "1", "dpi": "40"})
        self.assertEqual(page.status_code, 200)
        line = page.json()["lines"][0]
        self.assertEqual(line["text"], "Invoice 649")
        self.assertTrue(page.json()["image"].startswith("data:image/jpeg;base64,"))

        font = self.client.get(reverse("edit-font", args=[session, line["font"]["ref"]]), {"page": 650})
        self.assertEqual(font.status_code, 200)
        self.assertTrue({ord(char) for char in "Invoice 649"} <= edit_fonts.coverage(font.content))

        found = self.client.get(reverse("edit-search", args=[session]), {"q": "invoice 69"})
        self.assertEqual(found.json()["total"], 11)  # 69 and 690-699

    def test_unknown_sessions_are_refused(self):
        self.assertEqual(self.client.get(reverse("edit-page", args=["0" * 32, 1])).status_code, 404)
        self.assertEqual(self.client.get(reverse("edit-page", args=["not-a-session", 1])).status_code, 404)
        self.assertEqual(self.client.get(reverse("edit-search", args=["x" * 32]), {"q": "a"}).status_code, 404)


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
