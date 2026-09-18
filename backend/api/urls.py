from django.urls import path
from . import views

urlpatterns = [
    path("health/", views.health_check, name="health-check"),
    path("auth/register/", views.register, name="register"),
    path("auth/login/", views.login, name="login"),
    path("auth/logout/", views.logout, name="logout"),
    path("auth/me/", views.me, name="me"),

    path("tools/merge/", views.merge_pdf, name="merge-pdf"),
    path("tools/split/", views.split_pdf, name="split-pdf"),

    path("jobs/<uuid:job_id>/status/", views.job_status, name="job-status"),
    path("jobs/<uuid:job_id>/download/", views.job_download, name="job-download"),
]