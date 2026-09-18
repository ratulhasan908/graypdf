import redis
from datetime import date
from django.conf import settings


def _get_redis():
    """Lazy redis client from REDIS_URL."""
    import os
    url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.from_url(url, decode_responses=True)


def _get_client_ip(request):
    """Get the real client IP, honoring proxies."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")


def check_and_increment_guest(request):
    """
    For guests. Returns (allowed: bool, used: int, limit: int).
    Uses Redis with a key that expires at end of day UTC.
    """
    limit = getattr(settings, "GUEST_DAILY_LIMIT", 5)
    ip = _get_client_ip(request)
    today = date.today().isoformat()
    key = f"guest_usage:{ip}:{today}"

    r = _get_redis()
    used = r.incr(key)

    # Set expiry on first increment (expire at end of day, +1 hour buffer)
    if used == 1:
        r.expire(key, 60 * 60 * 25)

    if used > limit:
        # Roll back the increment so we don't inflate the count
        r.decr(key)
        return False, used - 1, limit

    return True, used, limit


def check_and_increment_user(user):
    """
    For authenticated users. Returns (allowed: bool, used: int, limit: int).
    Uses the User model fields to persist counts across restarts.
    Resets automatically when the day changes.
    """
    limit = getattr(settings, "USER_DAILY_LIMIT", 20)
    today = date.today()

    # Reset counter if last reset was a different day
    if user.last_upload_reset != today:
        user.daily_upload_count = 0
        user.last_upload_reset = today

    if user.daily_upload_count >= limit:
        user.save(update_fields=["daily_upload_count", "last_upload_reset"])
        return False, user.daily_upload_count, limit

    user.daily_upload_count += 1
    user.save(update_fields=["daily_upload_count", "last_upload_reset"])
    return True, user.daily_upload_count, limit


def get_usage(request):
    """
    Read-only check (does not increment). Used for /me and dashboard.
    Returns dict with used, limit, remaining, is_guest.
    """
    if request.user.is_authenticated:
        limit = getattr(settings, "USER_DAILY_LIMIT", 20)
        today = date.today()
        used = user_count if (user_count := (
            request.user.daily_upload_count
            if request.user.last_upload_reset == today
            else 0
        )) is not None else 0
        return {
            "used": used,
            "limit": limit,
            "remaining": max(0, limit - used),
            "is_guest": False,
        }

    limit = getattr(settings, "GUEST_DAILY_LIMIT", 5)
    ip = _get_client_ip(request)
    today = date.today().isoformat()
    key = f"guest_usage:{ip}:{today}"

    try:
        r = _get_redis()
        used = int(r.get(key) or 0)
    except Exception:
        used = 0

    return {
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
        "is_guest": True,
    }