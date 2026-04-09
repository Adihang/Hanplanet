"""Ollama proxy — OpenAI-compatible API gateway."""

from __future__ import annotations

import json
import logging

import httpx
from django.conf import settings
from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

logger = logging.getLogger(__name__)

# Ollama base URL (override in settings.py: OLLAMA_BASE_URL)
_OLLAMA_BASE = getattr(settings, "OLLAMA_BASE_URL", "http://localhost:11434")

# Optional API key guard (set OLLAMA_PROXY_API_KEY in settings.py to enable)
_PROXY_API_KEY: str | None = getattr(settings, "OLLAMA_PROXY_API_KEY", None)


def _resolve_user(request: HttpRequest) -> str:
    """Return username for the authenticated request, or 'apikey'/'anonymous'."""
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not token or token == _PROXY_API_KEY:
        return "apikey"
    try:
        from oauth2_provider.models import AccessToken
        from django.utils import timezone
        at = AccessToken.objects.get(token=token)
        if at.expires > timezone.now():
            return at.user.username
    except Exception:
        pass
    try:
        from main.sync_auth import verify_access_token
        user = verify_access_token(token)
        if user is not None:
            return user.username
    except Exception:
        pass
    return "anonymous"


def _check_auth(request: HttpRequest) -> HttpResponse | None:
    """Return 401 if the request is not authorised.

    Accepts two forms of credentials:
    - Static API key: Bearer token matches OLLAMA_PROXY_API_KEY
    - OAuth2 access token: validated via the local /o/userinfo/ endpoint
    - HanDrive sync JWT
    """
    if not _PROXY_API_KEY:
        return None

    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()

    if not token:
        return HttpResponse(
            json.dumps({"error": {"message": "Unauthorized", "type": "auth_error"}}),
            status=401,
            content_type="application/json",
        )

    # 1) Static API key match
    if token == _PROXY_API_KEY:
        return None

    # 2) OAuth2 access token — validate in-process via django-oauth-toolkit
    try:
        from oauth2_provider.models import AccessToken
        from django.utils import timezone
        access_token = AccessToken.objects.get(token=token)
        if access_token.expires > timezone.now():
            return None
    except Exception:
        pass

    # 3) HanDrive sync JWT
    try:
        from main.sync_auth import verify_access_token
        if verify_access_token(token) is not None:
            return None
    except Exception:
        pass

    return HttpResponse(
        json.dumps({"error": {"message": "Unauthorized", "type": "auth_error"}}),
        status=401,
        content_type="application/json",
    )


def _forward_headers(request: HttpRequest) -> dict[str, str]:
    """Pass through relevant headers to Ollama."""
    headers = {"Content-Type": "application/json"}
    for name in ("Accept", "Accept-Language"):
        if value := request.headers.get(name):
            headers[name] = value
    # Ollama doesn't check auth but we forward a dummy to stay OpenAI-compatible
    headers["Authorization"] = "Bearer ollama"
    return headers


@csrf_exempt
@require_http_methods(["POST", "GET", "OPTIONS"])
def ollama_proxy(request: HttpRequest, path: str) -> HttpResponse:
    """Transparent proxy: forward /ai/v1/<path> → Ollama /v1/<path>."""
    # CORS preflight
    if request.method == "OPTIONS":
        response = HttpResponse(status=204)
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        return response

    # Auth guard
    if err := _check_auth(request):
        return err

    target_url = f"{_OLLAMA_BASE}/v1/{path}"
    headers = _forward_headers(request)

    try:
        body = json.loads(request.body) if request.body else {}
    except json.JSONDecodeError:
        return HttpResponse(
            json.dumps({"error": {"message": "Invalid JSON body", "type": "invalid_request"}}),
            status=400,
            content_type="application/json",
        )

    is_stream = body.get("stream", False)
    model = body.get("model", "-")
    username = _resolve_user(request)
    logger.info("ai.request user=%s model=%s path=%s stream=%s", username, model, path, is_stream)

    try:
        if is_stream:
            return _stream_response(target_url, headers, body, username=username, model=model)
        else:
            resp = _buffered_response(target_url, headers, body)
            try:
                usage = json.loads(resp.content).get("usage") or {}
                logger.info(
                    "ai.usage user=%s model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
                    username, model,
                    usage.get("prompt_tokens", "-"),
                    usage.get("completion_tokens", "-"),
                    usage.get("total_tokens", "-"),
                )
            except Exception:
                pass
            return resp
    except httpx.ConnectError:
        logger.error("Cannot connect to Ollama at %s", _OLLAMA_BASE)
        return HttpResponse(
            json.dumps({
                "error": {
                    "message": f"Cannot connect to Ollama at {_OLLAMA_BASE}. Is Ollama running?",
                    "type": "connection_error",
                }
            }),
            status=503,
            content_type="application/json",
        )
    except Exception as exc:
        logger.exception("Ollama proxy error")
        return HttpResponse(
            json.dumps({"error": {"message": str(exc), "type": "proxy_error"}}),
            status=500,
            content_type="application/json",
        )


def _buffered_response(url: str, headers: dict, body: dict) -> HttpResponse:
    """Forward request and return the full response at once."""
    with httpx.Client(timeout=120) as client:
        resp = client.post(url, headers=headers, json=body)
    return HttpResponse(
        resp.content,
        status=resp.status_code,
        content_type=resp.headers.get("content-type", "application/json"),
    )


def _stream_response(url: str, headers: dict, body: dict, username: str = "-", model: str = "-") -> StreamingHttpResponse:
    """Forward request and stream SSE chunks back to the client."""

    def _generate():
        total_chunks = 0
        with httpx.Client(timeout=300) as client:
            with client.stream("POST", url, headers=headers, json=body) as resp:
                for chunk in resp.iter_bytes():
                    total_chunks += 1
                    yield chunk
        logger.info("ai.stream_done user=%s model=%s chunks=%s", username, model, total_chunks)

    response = StreamingHttpResponse(
        _generate(),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"  # nginx 버퍼링 비활성화
    response["Access-Control-Allow-Origin"] = "*"
    return response


@csrf_exempt
def ollama_models(request: HttpRequest) -> HttpResponse:
    """Proxy GET /ai/v1/models → Ollama /v1/models."""
    if err := _check_auth(request):
        return err
    username = _resolve_user(request)
    logger.info("ai.models user=%s", username)
    try:
        with httpx.Client(timeout=10) as client:
            resp = client.get(f"{_OLLAMA_BASE}/v1/models")
        return HttpResponse(
            resp.content,
            status=resp.status_code,
            content_type="application/json",
        )
    except httpx.ConnectError:
        return HttpResponse(
            json.dumps({
                "error": {
                    "message": f"Cannot connect to Ollama at {_OLLAMA_BASE}",
                    "type": "connection_error",
                }
            }),
            status=503,
            content_type="application/json",
        )
