from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError


class CookieJWTAuthentication(JWTAuthentication):
    """
    Read JWT from httpOnly cookie instead of the Authorization header.

    IMPORTANT: If the cookie contains an invalid/expired token, we silently
    ignore it and treat the request as anonymous — so AllowAny views still work.
    """

    def authenticate(self, request):
        raw_token = request.COOKIES.get("access_token")

        # No cookie → fall back to header (for API clients / curl)
        if raw_token is None:
            return super().authenticate(request)

        # Cookie present → try to validate it. If invalid, return None
        # so the request continues as anonymous.
        try:
            validated_token = self.get_validated_token(raw_token)
            return self.get_user(validated_token), validated_token
        except (InvalidToken, TokenError):
            return None