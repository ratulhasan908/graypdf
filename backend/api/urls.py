from django.urls import path
from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("usage/", views.usage, name="usage"),

    path("auth/register/", views.register, name="register"),
    path("auth/login/", views.login, name="login"),
    path("auth/logout/", views.logout, name="logout"),
    path("auth/me/", views.me, name="me"),

    path("tools/merge/", views.merge_pdf, name="merge-pdf"),
    path("tools/split/", views.split_pdf, name="split-pdf"),
    path("tools/compress/", views.compress_pdf, name="compress-pdf"),
    path("tools/rotate/", views.rotate_pdf, name="rotate-pdf"),
    path("tools/pdf-to-jpg/", views.pdf_to_jpg, name="pdf-to-jpg"),
    path("tools/jpg-to-pdf/", views.jpg_to_pdf, name="jpg-to-pdf"),

    path("jobs/<uuid:job_id>/status/", views.job_status, name="job-status"),
    path("jobs/<uuid:job_id>/download/", views.job_download, name="job-download"),
]