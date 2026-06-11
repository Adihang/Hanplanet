import time
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import caches
from django.http import HttpResponse, HttpResponsePermanentRedirect, JsonResponse


SUPPORTED_UI_LANG_COOKIE_VALUES = {"ko", "en"}
UI_LANG_COOKIE_NAME = "portfolio_ui_lang"
UI_LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365


class CanonicalPublicHostMiddleware:
    """Redirect bare public host requests to the configured canonical origin."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        redirect_response = self._build_redirect_response(request)
        if redirect_response is not None:
            return redirect_response
        return self.get_response(request)

    def _build_redirect_response(self, request):
        if not getattr(settings, "CANONICAL_PUBLIC_HOST_REDIRECT", False):
            return None
        if request.method not in {"GET", "HEAD"}:
            return None

        public_base_url = str(getattr(settings, "PUBLIC_BASE_URL", "") or "").strip().rstrip("/")
        parsed_public = urlparse(public_base_url)
        canonical_hostname = str(parsed_public.hostname or "").strip().lower()
        if not parsed_public.scheme or not parsed_public.netloc or not canonical_hostname:
            return None

        bare_hostname = canonical_hostname[4:] if canonical_hostname.startswith("www.") else ""
        if not bare_hostname:
            return None

        request_hostname = str(request.get_host() or "").split(":", 1)[0].strip().lower()
        if request_hostname != bare_hostname:
            return None

        return HttpResponsePermanentRedirect(f"{parsed_public.scheme}://{parsed_public.netloc}{request.get_full_path()}")


class UiLanguagePreferenceCookieMiddleware:
    """Keep the public UI language preference in a plain cookie for anonymous navigation."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        ui_lang = self._resolve_request_ui_lang(request)
        if ui_lang:
            response.set_cookie(
                UI_LANG_COOKIE_NAME,
                ui_lang,
                max_age=UI_LANG_COOKIE_MAX_AGE,
                path="/",
                secure=request.is_secure(),
                samesite="Lax",
            )
        return response

    def _resolve_request_ui_lang(self, request):
        query_lang = str(request.GET.get("lang", "") or "").strip().lower()
        if query_lang in SUPPORTED_UI_LANG_COOKIE_VALUES:
            return query_lang

        path = str(getattr(request, "path", "") or "")
        parts = path.split("/")
        if len(parts) > 1:
            path_lang = parts[1].strip().lower()
            if path_lang in SUPPORTED_UI_LANG_COOKIE_VALUES:
                return path_lang
        return ""


class GlobalRateLimitMiddleware:
    """Apply a simple fixed-window rate limit for all incoming Django requests."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._is_enabled() and not self._is_exempt_path(request.path or ""):
            limited_response = self._build_rate_limited_response_if_needed(request)
            if limited_response is not None:
                return limited_response

        return self.get_response(request)

    def _is_enabled(self):
        return getattr(settings, "GLOBAL_RATE_LIMIT_ENABLED", True)

    def _is_exempt_path(self, path):
        exempt_prefixes = getattr(
            settings,
            "GLOBAL_RATE_LIMIT_EXEMPT_PATH_PREFIXES",
            ("/static/", "/media/"),
        )
        return any(path.startswith(prefix) for prefix in exempt_prefixes)

    def _build_rate_limited_response_if_needed(self, request):
        cache_backend = self._get_cache_backend()
        request_limit = max(1, int(getattr(settings, "GLOBAL_RATE_LIMIT_REQUESTS", 240)))
        window_seconds = max(1, int(getattr(settings, "GLOBAL_RATE_LIMIT_WINDOW_SECONDS", 60)))
        now = int(time.time())

        client_ip = self._get_client_ip(request)
        window_bucket = now // window_seconds
        cache_key = f"global_rate_limit:{client_ip}:{window_bucket}"

        if cache_backend.add(cache_key, 1, timeout=window_seconds + 2):
            current_count = 1
        else:
            try:
                current_count = cache_backend.incr(cache_key)
            except ValueError:
                cache_backend.set(cache_key, 1, timeout=window_seconds + 2)
                current_count = 1

        if current_count <= request_limit:
            return None

        retry_after = max(1, window_seconds - (now % window_seconds))
        payload = {"error": "Too many requests. Try again later."}

        if self._expects_json(request):
            response = JsonResponse(payload, status=429)
        else:
            response = HttpResponse(payload["error"], status=429, content_type="text/plain; charset=utf-8")

        response["Retry-After"] = str(retry_after)
        return response

    def _get_cache_backend(self):
        cache_alias = getattr(settings, "GLOBAL_RATE_LIMIT_CACHE_ALIAS", "default")
        try:
            return caches[cache_alias]
        except Exception:
            return caches["default"]

    def _get_client_ip(self, request):
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "unknown")

    def _expects_json(self, request):
        accept = request.headers.get("Accept", "")
        requested_with = request.headers.get("X-Requested-With", "")
        path = request.path or ""

        return (
            "application/json" in accept
            or requested_with.lower() == "xmlhttprequest"
            or path.startswith("/api/")
            or "/handrive/api/" in path
            or "/handrive/api/" in path
            or "/handrive/api/" in path
        )
