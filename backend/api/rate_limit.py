"""
Rate limiting for GreyPDF.

Guests: GUEST_DAILY_LIMIT files per day (Redis, keyed by IP).
Logged-in users: unlimited when USER_DAILY_LIMIT is None (the DB counter is
still kept for analytics).

All dates are UTC to keep behavior consistent across servers.
"""

import logging
from datetime import datetime, timezone

import redis
from django.conf import settings
from django.db import transaction
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)


class RateLimitUnavailable(APIException):
    status_code = 503
    default_detail = "Usage limits are temporarily unavailable. Please try again."
    default_code = "rate_limit_unavailable"


def _get_redis():
    """Lazy redis client from REDIS_URL."""
    import os
    url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.from_url(url, decode_responses=True)


def _get_client_ip(request):
    """
    Extract the client IP, honoring X-Forwarded-For only when we are
    behind a trusted proxy.

    If TRUSTED_PROXY_COUNT is set (e.g., 1 for a single reverse proxy),
    we take that many rightmost IPs from X-Forwarded-For.

    Default: don't trust X-Forwarded-For at all — use REMOTE_ADDR.
    """
    trusted_proxies = getattr(settings, "TRUSTED_PROXY_COUNT", 0)

    if trusted_proxies > 0:
        xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if xff:
            parts = [p.strip() for p in xff.split(",") if p.strip()]
            # Take the IP `trusted_proxies` positions from the right
            # (the further right, the closer to our server).
            if parts:
                idx = max(0, len(parts) - trusted_proxies - 1)
                return parts[idx]

    return request.META.get("REMOTE_ADDR", "unknown")


def _utc_today():
    """Return today's date in UTC (matches DB TIME_ZONE='UTC')."""
    return datetime.now(timezone.utc).date()


def _utc_day_key():
    """String key for today in UTC."""
    return _utc_today().isoformat()


def check_and_increment_guest(request, increment_by=1):
    """
    For guests. Returns (allowed: bool, used: int, limit: int).

    Raises a 503 if Redis is unavailable so guest limits cannot be bypassed.
    """
    limit = getattr(settings, "GUEST_DAILY_LIMIT", 10)
    if increment_by < 1:
        raise ValueError("increment_by must be positive.")

    ip = _get_client_ip(request)
    day = _utc_day_key()
    key = f"guest_usage:{ip}:{day}"

    try:
        r = _get_redis()
        allowed, used = r.eval(
            """
            local current = tonumber(redis.call('GET', KEYS[1]) or '0')
            local increment = tonumber(ARGV[1])
            local limit = tonumber(ARGV[2])
            if current + increment > limit then
                return {0, current}
            end
            local updated = redis.call('INCRBY', KEYS[1], increment)
            redis.call('EXPIRE', KEYS[1], ARGV[3])
            return {1, updated}
            """,
            1,
            key,
            increment_by,
            limit,
            60 * 60 * 25,
        )
        allowed = bool(allowed)
    except redis.RedisError as e:
        logger.error("Redis error in guest rate limit: %s", e)
        raise RateLimitUnavailable() from e

    return allowed, int(used), limit


def check_and_increment_user(user, increment_by=1):
    """
    For authenticated users. Uses SELECT ... FOR UPDATE to make the
    counter update atomic across concurrent requests.

    Returns (allowed: bool, used: int, limit: int | None).
    """
    limit = getattr(settings, "USER_DAILY_LIMIT", None)
    today = _utc_today()
    if increment_by < 1:
        raise ValueError("increment_by must be positive.")

    from .models import User  # avoid circular import

    with transaction.atomic():
        # Re-fetch with row lock
        locked = User.objects.select_for_update().get(pk=user.pk)

        # Reset counter on new day (UTC)
        if locked.last_upload_reset != today:
            locked.daily_upload_count = 0
            locked.last_upload_reset = today

        if limit is not None and locked.daily_upload_count + increment_by > limit:
            locked.save(update_fields=["daily_upload_count", "last_upload_reset"])
            return False, locked.daily_upload_count, limit

        locked.daily_upload_count += increment_by
        locked.save(update_fields=["daily_upload_count", "last_upload_reset"])

        # Reflect the change back on the caller's instance so serializers
        # see the updated count.
        user.daily_upload_count = locked.daily_upload_count
        user.last_upload_reset = locked.last_upload_reset

        return True, locked.daily_upload_count, limit


def check_guest_preview_rate(request):
    """
    Previews don't count as processed files, but they do cost CPU, so guests
    get a separate hourly allowance. Returns True when the request may proceed.
    """
    limit = getattr(settings, "GUEST_PREVIEWS_PER_HOUR", 60)
    key = f"guest_previews:{_get_client_ip(request)}"
    try:
        r = _get_redis()
        used = r.incr(key)
        if used == 1:
            r.expire(key, 60 * 60)
    except redis.RedisError as e:
        logger.error("Redis error in preview rate limit: %s", e)
        raise RateLimitUnavailable() from e
    return used <= limit


def get_usage(request):
    """
    Read-only usage snapshot for the current caller. Never raises.
    """
    if request.user.is_authenticated:
        limit = getattr(settings, "USER_DAILY_LIMIT", None)
        today = _utc_today()
        used = (
            request.user.daily_upload_count
            if request.user.last_upload_reset == today
            else 0
        )
        return {
            "used": used,
            "limit": limit,
            "remaining": None if limit is None else max(0, limit - used),
            "is_guest": False,
        }

    limit = getattr(settings, "GUEST_DAILY_LIMIT", 10)
    ip = _get_client_ip(request)
    day = _utc_day_key()
    key = f"guest_usage:{ip}:{day}"

    try:
        r = _get_redis()
        used = int(r.get(key) or 0)
    except redis.RedisError as e:
        logger.error("Redis error reading guest usage: %s", e)
        raise RateLimitUnavailable() from e
    except ValueError as e:
        logger.error("Invalid guest usage value in Redis: %s", e)
        raise RateLimitUnavailable() from e

    return {
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
        "is_guest": True,
    }