from django.urls import path
from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("usage/", views.usage, name="usage"),

    path("auth/register/", views.register, name="register"),
    path("auth/login/", views.login, name="login"),
    path("auth/logout/", views.logout, name="logout"),
    path("auth/refresh/", views.refresh_token, name="refresh-token"),
    path("auth/me/", views.me, name="me"),
    path("auth/my-jobs/", views.my_jobs, name="my-jobs"),

    path("tools/merge/", views.merge_pdf, name="merge-pdf"),
    path("tools/split/", views.split_pdf, name="split-pdf"),
    path("tools/compress/", views.compress_pdf, name="compress-pdf"),
    path("tools/rotate/", views.rotate_pdf, name="rotate-pdf"),
    path("tools/pdf-to-jpg/", views.pdf_to_jpg, name="pdf-to-jpg"),
    path("tools/jpg-to-pdf/", views.jpg_to_pdf, name="jpg-to-pdf"),
    path("tools/protect/", views.protect_pdf, name="protect-pdf"),
    path("tools/unlock/", views.unlock_pdf, name="unlock-pdf"),
    path("tools/watermark/", views.watermark_pdf, name="watermark-pdf"),
    path("tools/page-numbers/", views.page_numbers, name="page-numbers"),
    path("tools/organize/", views.organize_pdf, name="organize-pdf"),
    path("tools/page-count/", views.pdf_page_count, name="pdf-page-count"),
    path("tools/crop/", views.crop_pdf, name="crop-pdf"),
    path("tools/html-to-pdf/", views.html_to_pdf, name="html-to-pdf"),
    path("tools/pdf-to-html/", views.pdf_to_html, name="pdf-to-html"),
    path("tools/markdown-to-pdf/", views.markdown_to_pdf, name="markdown-to-pdf"),
    path("tools/pdf-to-markdown/", views.pdf_to_markdown, name="pdf-to-markdown"),

    path("jobs/<uuid:job_id>/status/", views.job_status, name="job-status"),
    path("jobs/<uuid:job_id>/download/", views.job_download, name="job-download"),
]