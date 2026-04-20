"""Ollama proxy — OpenAI-compatible API gateway."""

from __future__ import annotations

import json
import logging
import queue
import threading
from datetime import timedelta

import httpx
from django.conf import settings
from django.http import HttpRequest, HttpResponse, StreamingHttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

logger = logging.getLogger(__name__)

# Ollama base URL (override in settings.py: OLLAMA_BASE_URL)
_OLLAMA_BASE = getattr(settings, "OLLAMA_BASE_URL", "http://localhost:11434")

# Optional API key guard (set OLLAMA_PROXY_API_KEY in settings.py to enable)
_PROXY_API_KEY: str | None = getattr(settings, "OLLAMA_PROXY_API_KEY", None)


def _resolve_user(request: HttpRequest):
    """Return (username_str, User_instance_or_None) for the authenticated request."""
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not token or token == _PROXY_API_KEY:
        return "apikey", None
    try:
        from oauth2_provider.models import AccessToken
        at = AccessToken.objects.get(token=token)
        if at.expires > timezone.now():
            return at.user.username, at.user
    except Exception:
        pass
    try:
        from main.sync_auth import verify_access_token
        user = verify_access_token(token)
        if user is not None:
            return user.username, user
    except Exception:
        pass
    return "anonymous", None


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


def _get_current_session_usage(user_obj):
    """현재 활성 세션의 (session_start, session_end, used_tokens) 반환.

    세션 규칙:
    - 최초 요청 시 세션 시작, 5시간 후 만료
    - 만료된 세션 이후 첫 요청이 새 세션 시작
    - 세션 내 누적 토큰이 한도 대상

    10시간치 레코드를 조회해 만료된 이전 세션과의 경계를 정확히 찾는다.
    (5h만 보면 이전 세션 레코드가 잘려 세션 시작점을 잘못 계산할 수 있음)
    """
    from .models import AITokenUsage

    five_hours = timedelta(hours=5)
    now = timezone.now()
    look_back = now - five_hours * 2  # 최대 2개 세션 커버

    records = list(
        AITokenUsage.objects.filter(user=user_obj, created_at__gte=look_back)
        .order_by("created_at")
        .values_list("created_at", "total_tokens")
    )

    if not records:
        return None, None, 0

    # 텀블링 윈도우: 세션 경계 찾기
    session_start = records[0][0]
    session_end = session_start + five_hours

    for created_at, _ in records[1:]:
        if created_at >= session_end:
            # 이전 세션 만료 → 새 세션 시작
            session_start = created_at
            session_end = session_start + five_hours

    # 현재 세션이 아직 유효한지 확인
    if now > session_end:
        return None, None, 0

    # 현재 세션 내 토큰 합산
    used = sum(
        tokens for created_at, tokens in records
        if session_start <= created_at < session_end
    )

    return session_start, session_end, used


def _check_hanharness_enabled(user_obj) -> HttpResponse | None:
    """HanHarness 사용 허용 여부만 확인 (토큰 체크 없음)."""
    if user_obj is None:
        return None
    try:
        quota = user_obj.handrive_quota
    except Exception:
        return None
    if not quota.hanharness_enabled:
        logger.warning("ai.quota_denied user=%s reason=disabled", user_obj.username)
        return HttpResponse(
            json.dumps({
                "error": {
                    "message": "HanHarness 사용이 비활성화된 계정입니다.",
                    "type": "permission_denied",
                }
            }),
            status=403,
            content_type="application/json",
        )
    return None


def _check_hanharness_quota(user_obj) -> HttpResponse | None:
    """사용 허용 여부 + 5시간 세션 토큰 한도 확인."""
    if err := _check_hanharness_enabled(user_obj):
        return err

    if user_obj is None:
        return None

    try:
        quota = user_obj.handrive_quota
    except Exception:
        return None

    limit = quota.hanharness_token_limit_5h
    if limit == 0:
        return None  # 무제한

    _, session_end, used = _get_current_session_usage(user_obj)

    if used >= limit:
        logger.warning(
            "ai.quota_exceeded user=%s used=%s limit=%s",
            user_obj.username, used, limit,
        )
        return HttpResponse(
            json.dumps({
                "error": {
                    "message": (
                        f"5시간 토큰 한도를 초과했습니다. "
                        f"사용: {used:,} / 한도: {limit:,}"
                    ),
                    "type": "quota_exceeded",
                }
            }),
            status=429,
            content_type="application/json",
        )

    return None


def _save_token_usage(
    user_obj,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    is_stream: bool,
    request_user: str = "",
    is_estimated: bool = False,
) -> None:
    """Persist token usage to the DB (best-effort)."""
    if total_tokens == 0:
        return
    try:
        from .models import AITokenUsage
        AITokenUsage.objects.create(
            user=user_obj,
            request_user=request_user or getattr(user_obj, "username", ""),
            model_name=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            is_stream=is_stream,
            is_estimated=is_estimated,
        )
    except Exception:
        logger.exception("Failed to save AITokenUsage for user=%s", request_user or getattr(user_obj, "username", "?"))


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
    username, user_obj = _resolve_user(request)

    # HanHarness 사용 권한 + 토큰 한도 체크
    if err := _check_hanharness_quota(user_obj):
        return err

    # Ollama num_ctx 주입 — 명시하지 않으면 Ollama가 기본값(수천 토큰)을 사용해 컨텍스트 초과가 발생할 수 있음
    num_ctx = getattr(settings, "OLLAMA_NUM_CTX", 0)
    if num_ctx:
        body = {**body, "num_ctx": num_ctx}

    logger.info("ai.request user=%s model=%s path=%s stream=%s", username, model, path, is_stream)

    try:
        if is_stream:
            return _stream_response(target_url, headers, body, username=username, model=model, user_obj=user_obj)
        else:
            resp = _buffered_response(target_url, headers, body)
            try:
                payload = json.loads(resp.content)
                usage = payload.get("usage") or {}
                pt = usage.get("prompt_tokens", 0) or 0
                ct = usage.get("completion_tokens", 0) or 0
                tt = usage.get("total_tokens", 0) or 0
                is_estimated = False
                if not tt:
                    pt = _estimate_prompt_tokens(body)
                    ct = _estimate_tokens(_extract_completion_text(payload))
                    tt = pt + ct
                    is_estimated = bool(tt)
                logger.info(
                    "ai.usage user=%s model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
                    username, model, pt or "-", ct or "-", tt or "-",
                )
                _save_token_usage(user_obj, model, pt, ct, tt, is_stream=False, request_user=username, is_estimated=is_estimated)
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


_STREAM_DONE = object()
_KEEPALIVE_INTERVAL = 10  # 초 — client/proxy read timeout보다 충분히 짧아야 함


def _estimate_tokens(value) -> int:
    """Rough fallback when the upstream response does not include usage."""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    text = text.strip()
    if not text:
        return 0
    return max(1, round(len(text) / 4))


def _message_content_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(item))
        return "\n".join(part for part in parts if part)
    if content is None:
        return ""
    return str(content)


def _estimate_prompt_tokens(body: dict) -> int:
    parts = []
    for message in body.get("messages") or []:
        if isinstance(message, dict):
            parts.append(str(message.get("role") or ""))
            parts.append(_message_content_text(message.get("content")))
            if message.get("tool_calls"):
                parts.append(json.dumps(message.get("tool_calls"), ensure_ascii=False, separators=(",", ":")))
    if body.get("tools"):
        parts.append(json.dumps(body.get("tools"), ensure_ascii=False, separators=(",", ":")))
    return _estimate_tokens("\n".join(part for part in parts if part))


def _extract_completion_text(data: dict) -> str:
    parts = []
    for choice in data.get("choices") or []:
        delta = choice.get("delta") or {}
        message = choice.get("message") or {}
        for container in (delta, message):
            content = container.get("content")
            if content:
                parts.append(_message_content_text(content))
            if container.get("tool_calls"):
                parts.append(json.dumps(container.get("tool_calls"), ensure_ascii=False, separators=(",", ":")))
    return "".join(parts)


def _stream_response(url: str, headers: dict, body: dict, username: str = "-", model: str = "-", user_obj=None) -> StreamingHttpResponse:
    """Forward request and stream SSE chunks back to the client.

    threading + queue 패턴으로 keep-alive를 구현한다.
    백그라운드 스레드가 Ollama로부터 청크를 수신해 queue에 넣고,
    Django generator는 10초마다 타임아웃 시 ': ping' SSE 주석을 보내
    client/proxy read timeout 타이머를 리셋한다.
    """
    # tools가 없을 때만 stream_options 추가.
    # Ollama는 tools + stream_options 조합을 지원하지 않아 400을 반환한다.
    if "tools" not in body:
        body = {**body, "stream_options": {"include_usage": True}}

    chunk_queue: queue.Queue = queue.Queue()
    estimated_prompt_tokens = _estimate_prompt_tokens(body)

    def _fetch_thread() -> None:
        total_chunks = 0
        usage_saved = False
        completion_parts = []
        try:
            with httpx.Client(timeout=300) as client:
                with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code != 200:
                        body_bytes = resp.read()
                        logger.error(
                            "ai.stream_error user=%s model=%s status=%s body=%s",
                            username, model, resp.status_code, body_bytes[:200],
                        )
                        chunk_queue.put(
                            b"data: " +
                            json.dumps({"error": {"message": f"Upstream error {resp.status_code}", "type": "proxy_error"}}).encode() +
                            b"\n\ndata: [DONE]\n\n"
                        )
                        return
                    for line in resp.iter_lines():
                        total_chunks += 1
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                data = json.loads(line[6:])
                                completion_text = _extract_completion_text(data)
                                if completion_text:
                                    completion_parts.append(completion_text)
                                if usage := data.get("usage"):
                                    pt = usage.get("prompt_tokens", 0) or 0
                                    ct = usage.get("completion_tokens", 0) or 0
                                    tt = usage.get("total_tokens", 0) or 0
                                    if tt:
                                        usage_saved = True
                                        logger.info(
                                            "ai.usage user=%s model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
                                            username, model, pt, ct, tt,
                                        )
                                        _save_token_usage(user_obj, model, pt, ct, tt, is_stream=True, request_user=username)
                            except Exception:
                                pass
                        chunk_queue.put((line + "\n\n").encode())
        except Exception as exc:
            # Ollama가 스트림 도중 연결을 끊으면(메모리 부족, 타임아웃 등) 여기로 빠진다.
            logger.error(
                "ai.stream_interrupted user=%s model=%s chunks_so_far=%s error=%s",
                username, model, total_chunks, exc,
            )
            chunk_queue.put(
                b"data: " +
                json.dumps({"error": {"message": str(exc), "type": "stream_interrupted"}}).encode() +
                b"\n\ndata: [DONE]\n\n"
            )
        finally:
            if not usage_saved:
                ct = _estimate_tokens("".join(completion_parts))
                tt = estimated_prompt_tokens + ct
                if tt:
                    logger.info(
                        "ai.usage user=%s model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s estimated=true",
                        username, model, estimated_prompt_tokens or "-", ct or "-", tt,
                    )
                    _save_token_usage(
                        user_obj,
                        model,
                        estimated_prompt_tokens,
                        ct,
                        tt,
                        is_stream=True,
                        request_user=username,
                        is_estimated=True,
                    )
            chunk_queue.put(_STREAM_DONE)
        logger.info("ai.stream_done user=%s model=%s chunks=%s", username, model, total_chunks)

    def _generate():
        t = threading.Thread(target=_fetch_thread, daemon=True, name=f"ollama-stream-{username}")
        t.start()
        while True:
            try:
                item = chunk_queue.get(timeout=_KEEPALIVE_INTERVAL)
            except queue.Empty:
                # 청크 없음 → SSE 주석 전송으로 client/proxy 타이머 리셋
                yield b": ping\n\n"
                continue
            if item is _STREAM_DONE:
                break
            yield item

    response = StreamingHttpResponse(
        _generate(),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-cache, no-transform"
    response["X-Accel-Buffering"] = "no"  # nginx 버퍼링 비활성화
    response["Access-Control-Allow-Origin"] = "*"
    return response


@csrf_exempt
def ollama_models(request: HttpRequest) -> HttpResponse:
    """Proxy GET /ai/v1/models → Ollama /v1/models."""
    if err := _check_auth(request):
        return err
    username, user_obj = _resolve_user(request)

    # 모델 목록은 토큰을 소모하지 않으므로 활성화 여부만 확인
    if err := _check_hanharness_enabled(user_obj):
        return err

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
