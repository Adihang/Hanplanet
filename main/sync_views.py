"""Handrive Sync API 뷰.

엔드포인트 목록:
  POST   /api/sync/auth/token                  — access + refresh 발급
  POST   /api/sync/auth/refresh                — access 갱신
  GET    /api/sync/files                        — 파일 목록
  POST   /api/sync/files/init-upload            — presigned 업로드 URL 발급 (dedup 포함)
  POST   /api/sync/files/complete               — 업로드 완료 처리
  GET    /api/sync/files/<uuid>/download-url    — presigned 다운로드 URL
  DELETE /api/sync/files/<uuid>                 — soft delete
  PATCH  /api/sync/files/<uuid>/move            — rename / move
  GET    /api/sync/changes                      — 변경 이력 (cursor 기반)
"""
import json
import time
import uuid as uuid_module

from django.db import transaction
from django.db.models import Sum
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from main.minio_client import (
    delete_object,
    generate_presigned_download_url,
    generate_presigned_upload_url,
)
from main.models import (
    HandriveUserQuota,
    SyncChangeLog,
    SyncFile,
    SyncUploadSession,
)
from main.sync_auth import login_and_issue_tokens, refresh_access_token, require_sync_auth


# ── 내부 유틸리티 ──────────────────────────────────────────────────────────────

def _now_ms() -> int:
    return int(time.time() * 1000)


def _file_to_dict(f: SyncFile) -> dict:
    return {
        "id": str(f.id),
        "path": f.path,
        "size": f.size,
        "hash": f.hash,
        "version": f.version,
        "client_modified_at": f.client_modified_at,
        "server_modified_at": f.server_modified_at,
        "deleted": f.deleted,
    }


def _json_body(request) -> dict:
    try:
        return json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _check_quota(user, additional_bytes: int) -> bool:
    """쿼터 초과 여부 확인. True = 허용, False = 초과."""
    try:
        quota = HandriveUserQuota.objects.get(user=user)
    except HandriveUserQuota.DoesNotExist:
        quota_bytes = 1024 ** 3  # 기본 1GB
    else:
        quota_bytes = quota.quota_bytes

    used = (
        SyncFile.objects.filter(user=user, deleted=False)
        .aggregate(total=Sum("size"))["total"]
        or 0
    )
    return used + additional_bytes <= quota_bytes


def _auth_required(request):
    """인증 필요 뷰에서 사용. User 또는 JsonResponse(401) 반환."""
    user = require_sync_auth(request)
    if user is None:
        return None, JsonResponse({"error": "unauthorized"}, status=401)
    return user, None


# ── 인증 ──────────────────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["POST"])
def sync_auth_token(request):
    """POST /api/sync/auth/token — username/password → access + refresh."""
    body = _json_body(request)
    username = body.get("username", "").strip()
    password = body.get("password", "")
    if not username or not password:
        return JsonResponse({"error": "username and password required"}, status=400)

    tokens = login_and_issue_tokens(username, password)
    if tokens is None:
        return JsonResponse({"error": "invalid credentials"}, status=401)
    return JsonResponse(tokens)


@csrf_exempt
@require_http_methods(["POST"])
def sync_auth_refresh(request):
    """POST /api/sync/auth/refresh — refresh_token → 새 access_token."""
    body = _json_body(request)
    refresh_token = body.get("refresh_token", "")
    if not refresh_token:
        return JsonResponse({"error": "refresh_token required"}, status=400)

    new_access = refresh_access_token(refresh_token)
    if new_access is None:
        return JsonResponse({"error": "invalid or expired refresh_token"}, status=401)
    return JsonResponse({"access_token": new_access})


# ── 파일 목록 ──────────────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["GET"])
def sync_files_list(request):
    """GET /api/sync/files — 전체 파일 목록 (삭제 포함, 초기 sync 용)."""
    user, err = _auth_required(request)
    if err:
        return err

    files = SyncFile.objects.filter(user=user).order_by("path")
    return JsonResponse({"files": [_file_to_dict(f) for f in files]})


# ── 업로드 ──────────────────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["POST"])
def sync_files_init_upload(request):
    """POST /api/sync/files/init-upload — presigned URL 발급.

    요청 바디:
        path              — 파일 경로
        size              — 바이트 크기
        hash              — SHA-256 hex
        client_modified_at — 클라이언트 수정 시각 (ms)

    응답:
        upload_url (skip_upload=False 시)
        file_id
        upload_id
        version
        skip_upload       — True면 같은 hash 파일이 이미 존재 (storage 재사용)
    """
    user, err = _auth_required(request)
    if err:
        return err

    body = _json_body(request)
    path = body.get("path", "").strip()
    size = body.get("size")
    file_hash = body.get("hash", "").strip()
    client_modified_at = body.get("client_modified_at", _now_ms())

    if not path or size is None or not file_hash:
        return JsonResponse({"error": "path, size, hash required"}, status=400)
    if not isinstance(size, int) or size < 0:
        return JsonResponse({"error": "invalid size"}, status=400)

    # 쿼터 체크 (기존 파일이면 delta만 계산)
    existing_at_path = SyncFile.objects.filter(user=user, path=path, deleted=False).first()
    delta = size - (existing_at_path.size if existing_at_path else 0)
    if delta > 0 and not _check_quota(user, delta):
        return JsonResponse({"error": "quota_exceeded"}, status=413)

    # Dedup: 같은 hash 파일이 이미 존재하면 storage 재사용
    same_hash = SyncFile.objects.filter(user=user, hash=file_hash, deleted=False).first()

    new_file_id = uuid_module.uuid4()
    upload_id = str(uuid_module.uuid4())
    storage_key = f"{user.id}/{new_file_id}"

    if same_hash:
        # storage_key는 기존 것 재사용, file_id만 새로 생성
        storage_key = same_hash.storage_key
        SyncUploadSession.objects.create(
            upload_id=upload_id,
            user=user,
            file_id=new_file_id,
            path=path,
            size=size,
            hash=file_hash,
            storage_key=storage_key,
            created_at=_now_ms(),
        )
        return JsonResponse({
            "skip_upload": True,
            "file_id": str(new_file_id),
            "upload_id": upload_id,
            "storage_key": storage_key,
        })

    # 일반 업로드: presigned URL 발급
    try:
        upload_url = generate_presigned_upload_url(storage_key)
    except Exception as e:
        return JsonResponse({"error": f"storage error: {e}"}, status=502)

    SyncUploadSession.objects.create(
        upload_id=upload_id,
        user=user,
        file_id=new_file_id,
        path=path,
        size=size,
        hash=file_hash,
        storage_key=storage_key,
        created_at=_now_ms(),
    )

    return JsonResponse({
        "skip_upload": False,
        "upload_url": upload_url,
        "file_id": str(new_file_id),
        "upload_id": upload_id,
        "storage_key": storage_key,
    })


@csrf_exempt
@require_http_methods(["POST"])
def sync_files_complete(request):
    """POST /api/sync/files/complete — 업로드 완료 처리.

    요청 바디:
        upload_id
        expected_version  — 덮어쓸 기존 파일의 현재 version (새 파일이면 0)

    SELECT FOR UPDATE로 race condition 방어. 409 시 클라이언트가 재시도.
    """
    user, err = _auth_required(request)
    if err:
        return err

    body = _json_body(request)
    upload_id = body.get("upload_id", "")
    expected_version = body.get("expected_version", 0)

    try:
        session = SyncUploadSession.objects.get(upload_id=upload_id, user=user)
    except SyncUploadSession.DoesNotExist:
        return JsonResponse({"error": "upload session not found"}, status=404)

    now_ms = _now_ms()

    with transaction.atomic():
        existing = (
            SyncFile.objects.select_for_update()
            .filter(user=user, path=session.path)
            .first()
        )

        if existing:
            # 덮어쓰기: version 충돌 체크
            if existing.version != expected_version:
                return JsonResponse(
                    {"error": "conflict", "server_version": existing.version}, status=409
                )
            existing.size = session.size
            existing.hash = session.hash
            existing.version += 1
            existing.storage_key = session.storage_key
            existing.client_modified_at = session.created_at
            existing.server_modified_at = now_ms
            existing.deleted = False
            existing.save()
            sync_file = existing
            change_type = SyncChangeLog.TYPE_UPDATE
        else:
            # 신규 생성
            sync_file = SyncFile.objects.create(
                id=session.file_id,
                user=user,
                path=session.path,
                size=session.size,
                hash=session.hash,
                version=1,
                storage_key=session.storage_key,
                client_modified_at=session.created_at,
                server_modified_at=now_ms,
                deleted=False,
            )
            change_type = SyncChangeLog.TYPE_CREATE

        SyncChangeLog.objects.create(
            user=user,
            file_id=sync_file.id,
            path=sync_file.path,
            type=change_type,
            version=sync_file.version,
            created_at=now_ms,
        )

    session.delete()
    return JsonResponse(_file_to_dict(sync_file))


# ── 다운로드 ────────────────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["GET"])
def sync_files_download_url(request, file_id):
    """GET /api/sync/files/<uuid>/download-url — presigned 다운로드 URL."""
    user, err = _auth_required(request)
    if err:
        return err

    try:
        sync_file = SyncFile.objects.get(id=file_id, user=user, deleted=False)
    except SyncFile.DoesNotExist:
        return JsonResponse({"error": "not found"}, status=404)

    try:
        url = generate_presigned_download_url(sync_file.storage_key)
    except Exception as e:
        return JsonResponse({"error": f"storage error: {e}"}, status=502)

    return JsonResponse({"download_url": url})


# ── 삭제 ──────────────────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["DELETE"])
def sync_files_delete(request, file_id):
    """DELETE /api/sync/files/<uuid> — soft delete."""
    user, err = _auth_required(request)
    if err:
        return err

    try:
        with transaction.atomic():
            sync_file = SyncFile.objects.select_for_update().get(id=file_id, user=user, deleted=False)
            sync_file.deleted = True
            sync_file.server_modified_at = _now_ms()
            sync_file.save()
            SyncChangeLog.objects.create(
                user=user,
                file_id=sync_file.id,
                path=sync_file.path,
                type=SyncChangeLog.TYPE_DELETE,
                version=sync_file.version,
                created_at=_now_ms(),
            )
    except SyncFile.DoesNotExist:
        return JsonResponse({"error": "not found"}, status=404)

    return JsonResponse({"ok": True})


# ── 이동/이름변경 ──────────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["PATCH"])
def sync_files_move(request, file_id):
    """PATCH /api/sync/files/<uuid>/move — rename / move.

    요청 바디:
        target_path       — 이동할 경로
        expected_version  — 현재 파일의 version (충돌 방어)

    409: target_path에 다른 파일이 존재하는 경우 → 클라이언트가 conflict rename 처리.
    """
    user, err = _auth_required(request)
    if err:
        return err

    body = _json_body(request)
    target_path = body.get("target_path", "").strip()
    expected_version = body.get("expected_version")

    if not target_path:
        return JsonResponse({"error": "target_path required"}, status=400)

    try:
        with transaction.atomic():
            sync_file = SyncFile.objects.select_for_update().get(id=file_id, user=user, deleted=False)

            if expected_version is not None and sync_file.version != expected_version:
                return JsonResponse(
                    {"error": "conflict", "server_version": sync_file.version}, status=409
                )

            # 목표 경로 충돌 체크
            if SyncFile.objects.filter(user=user, path=target_path, deleted=False).exclude(id=file_id).exists():
                return JsonResponse({"error": "path_conflict"}, status=409)

            old_path = sync_file.path
            now_ms = _now_ms()
            sync_file.path = target_path
            sync_file.version += 1
            sync_file.server_modified_at = now_ms
            sync_file.save()

            SyncChangeLog.objects.create(
                user=user,
                file_id=sync_file.id,
                path=target_path,
                old_path=old_path,
                type=SyncChangeLog.TYPE_MOVE,
                version=sync_file.version,
                created_at=now_ms,
            )
    except SyncFile.DoesNotExist:
        return JsonResponse({"error": "not found"}, status=404)

    return JsonResponse(_file_to_dict(sync_file))


# ── Sync Changes (cursor 기반) ─────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["GET"])
def sync_changes(request):
    """GET /api/sync/changes?cursor=<id> — 변경 이력 조회.

    cursor = SyncChangeLog.id (PK, autoincrement).
    첫 sync: cursor=0.
    응답에 next_cursor 포함 → 클라이언트가 저장 후 다음 poll에 사용.
    """
    user, err = _auth_required(request)
    if err:
        return err

    try:
        cursor = int(request.GET.get("cursor", 0))
    except (ValueError, TypeError):
        cursor = 0

    PAGE_SIZE = 200
    logs = (
        SyncChangeLog.objects.filter(user=user, id__gt=cursor)
        .order_by("id")[:PAGE_SIZE]
    )

    changes = [
        {
            "id": log.id,
            "file_id": str(log.file_id),
            "path": log.path,
            "old_path": log.old_path,
            "type": log.type,
            "version": log.version,
            "created_at": log.created_at,
        }
        for log in logs
    ]

    next_cursor = changes[-1]["id"] if changes else cursor
    return JsonResponse({"changes": changes, "next_cursor": next_cursor})


@require_http_methods(["GET"])
def sync_me(request):
    """GET /api/sync/me — 로그인 계정 정보 + 용량 현황 반환.

    Response:
        {
            "username": "...",
            "quota_used_bytes": 12345,
            "quota_total_bytes": 10737418240,
            "quota_percent": 21.3,
            "quota_used_display": "2.1 GB",
            "quota_total_display": "10 GB",
            "quota_free_display": "7.9 GB",
            "quota_free_percent": 78.7,
            "quota_breakdown": [
                {"label": "사진", "color": "#f5b800", "display": "1.2 GB", "percent": 11.2},
                ...
            ]
        }
    """
    from main.sync_auth import require_sync_auth
    from main.models import SyncFile, HandriveUserQuota
    import os

    user = require_sync_auth(request)
    if not user:
        return JsonResponse({"error": "unauthorized"}, status=401)

    # 총 쿼터
    try:
        quota_total = user.handrive_quota.quota_bytes
    except HandriveUserQuota.DoesNotExist:
        quota_total = 10 * 1024 ** 3  # 기본 10 GB

    # SyncFile 기준 사용량 (MinIO 오브젝트 스토리지)
    TYPE_META = [
        ("photo",    "사진",   "#f5b800",
         {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif",
          ".avif", ".heic", ".heif", ".ico", ".svg"}),
        ("video",    "동영상", "#06d6a0",
         {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
          ".3gp", ".m2ts", ".ts", ".mts"}),
        ("document", "문서",   "#ef476f",
         {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
          ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm"}),
        ("audio",    "오디오", "#4361ee",
         {".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a", ".wma"}),
        ("other",    "기타",   "#adb5bd", set()),
    ]

    def classify_ext(path):
        ext = os.path.splitext(path)[1].lower()
        for key, _label, _color, exts in TYPE_META:
            if ext in exts:
                return key
        return "other"

    def fmt_bytes(n):
        GB, MB, KB = 1024**3, 1024**2, 1024
        if n >= GB:
            v = round(n / GB, 1)
            return f"{v:g} GB"
        if n >= MB:
            v = round(n / MB, 1)
            return f"{v:g} MB"
        if n >= KB:
            v = round(n / KB, 1)
            return f"{v:g} KB"
        return f"{n} B"

    files = SyncFile.objects.filter(user=user, deleted=False).values_list("path", "size")
    byte_map = {k: 0 for k, *_ in TYPE_META}
    for path, size in files:
        byte_map[classify_ext(path)] += size

    used_bytes = sum(byte_map.values())
    free_bytes = max(0, quota_total - used_bytes)
    percent = min(100, round(used_bytes / quota_total * 100, 1)) if quota_total else 0

    breakdown = [
        {
            "label": label,
            "color": color,
            "display": fmt_bytes(byte_map[key]),
            "bytes": byte_map[key],
            "percent": round(byte_map[key] / quota_total * 100, 2) if quota_total else 0,
        }
        for key, label, color, _ in TYPE_META
        if byte_map[key] > 0
    ]

    return JsonResponse({
        "username": user.username,
        "quota_used_bytes": used_bytes,
        "quota_total_bytes": quota_total,
        "quota_percent": percent,
        "quota_used_display": fmt_bytes(used_bytes),
        "quota_total_display": fmt_bytes(quota_total),
        "quota_free_display": fmt_bytes(free_bytes),
        "quota_free_percent": round(free_bytes / quota_total * 100, 2) if quota_total else 100,
        "quota_breakdown": breakdown,
    })


@require_http_methods(["GET"])
def sync_storage_mode(request):
    """GET /api/sync/storage-mode — 서버의 현재 storage mode 반환.

    인증 불필요 (클라이언트 시작 시 호출).

    Response:
        {"mode": "ssd"} 또는 {"mode": "hdd"}
    """
    from storage_profile import get_disc_mode
    return JsonResponse({"mode": get_disc_mode()})
