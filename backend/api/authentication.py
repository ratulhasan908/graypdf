from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken


class CookieJWTAuthentication(JWTAuthentication):
    """
    Read JWTs from httpOnly cookies instead of the Authorization header.

    Tool endpoints allow anonymous use, so a request with an expired access
    token would quietly become a guest and hit guest limits. To prevent that,
    a valid refresh cookie also identifies the user. An invalid session is
    never an error here: the request simply continues as anonymous.
    """

    def authenticate(self, request):
        access = request.COOKIES.get("access_token")
        refresh = request.COOKIES.get("refresh_token")

        # No cookies: fall back to the header (API clients / curl).
        if access is None and refresh is None:
            return super().authenticate(request)

        if access:
            try:
                validated_token = self.get_validated_token(access)
                return self.get_user(validated_token), validated_token
            except (InvalidToken, TokenError, AuthenticationFailed):
                pass

        if refresh:
            try:
                token = RefreshToken(refresh)  # checks signature, expiry, blacklist
                return self.get_user(token), token
            except (TokenError, AuthenticationFailed):
                pass

        return None
