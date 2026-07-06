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
import logging
import hashlib
import mimetypes
import time
import uuid as uuid_module
from pathlib import Path

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.http import HttpResponse, JsonResponse
from django.urls import reverse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from main.minio_client import (
    get_object_bytes,
    put_object_bytes,
)
from main.models import (
    SyncChangeLog,
    SyncFile,
    SyncUploadSession,
    UserProfile,
)
from main.sync_auth import login_and_issue_tokens, refresh_access_token, require_sync_auth
from main.handrive_views import (
    _DOCS_QUOTA_TYPE_META,
    calculate_handrive_quota_breakdown,
    calculate_handrive_repo_usage,
    format_handrive_bytes_display,
    get_scoped_handrive_home_dir,
    get_user_handrive_quota_bytes,
    handrive_root_dir,
    normalize_relative_path,
    resolve_path,
)

logger = logging.getLogger(__name__)

SYNC_ERROR_MESSAGES = {
    "unauthorized": {"ko": "인증이 필요합니다.", "en": "Authentication is required."},
    "username and password required": {"ko": "아이디와 비밀번호를 입력해주세요.", "en": "Username and password are required."},
    "invalid credentials": {"ko": "아이디 또는 비밀번호를 확인해주세요.", "en": "Please check your username or password."},
    "refresh_token required": {"ko": "refresh_token이 필요합니다.", "en": "refresh_token is required."},
    "invalid or expired refresh_token": {"ko": "refresh_token이 올바르지 않거나 만료되었습니다.", "en": "The refresh_token is invalid or expired."},
    "path, size, hash required": {"ko": "path, size, hash 값이 필요합니다.", "en": "path, size, and hash are required."},
    "invalid size": {"ko": "파일 크기 값이 올바르지 않습니다.", "en": "The file size is invalid."},
    "quota_exceeded": {"ko": "저장 공간이 부족합니다.", "en": "Storage quota exceeded."},
    "upload session not found": {"ko": "업로드 세션을 찾을 수 없습니다.", "en": "Upload session not found."},
    "content_length_mismatch": {"ko": "업로드 파일 크기가 일치하지 않습니다.", "en": "Uploaded content length does not match."},
    "not found": {"ko": "파일을 찾을 수 없습니다.", "en": "File not found."},
    "target_path required": {"ko": "target_path가 필요합니다.", "en": "target_path is required."},
    "path_conflict": {"ko": "같은 경로에 파일이 이미 존재합니다.", "en": "A file already exists at the target path."},
    "storage move failed": {"ko": "파일 이동에 실패했습니다.", "en": "Failed to move the file in storage."},
    "conflict": {"ko": "파일 버전이 충돌했습니다.", "en": "File version conflict."},
}


def _sync_error_response(error_code: str, *, status: int = 400, message_ko=None, message_en=None, **extra):
    messages = dict(SYNC_ERROR_MESSAGES.get(error_code) or {})
    if message_ko:
        messages["ko"] = message_ko
    if message_en:
        messages["en"] = message_en
    if not messages:
        messages = {"ko": error_code, "en": error_code}
    selected_message = messages.get("ko") or messages.get("en") or error_code
    return JsonResponse(
        {
            "error": error_code,
            "error_code": error_code,
            "error_message": selected_message,
            "error_messages": messages,
            **extra,
        },
        status=status,
    )


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


def _get_sync_excluded_paths(user) -> list[str]:
    profile = UserProfile.objects.filter(user=user).only("sync_excluded_paths").first()
    raw_paths = profile.sync_excluded_paths if profile else []
    if not isinstance(raw_paths, list):
        return []
    cleaned = []
    seen = set()
    for raw_path in raw_paths:
        try:
            normalized = normalize_relative_path(raw_path, allow_empty=True)
            candidate, _ = resolve_path(normalized, must_exist=True)
        except (ValueError, FileNotFoundError):
            continue
        if not (candidate.is_file() or candidate.is_dir()):
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(normalized)
    return cleaned


def _check_quota(user, additional_bytes: int) -> bool:
    """쿼터 초과 여부 확인. True = 허용, False = 초과."""
    quota_bytes = get_user_handrive_quota_bytes(user)

    used = (
        SyncFile.objects.filter(user=user, deleted=False)
        .aggregate(total=Sum("size"))["total"]
        or 0
    )
    return used + additional_bytes <= quota_bytes


def _get_sync_scope_relative_dir(user) -> str:
    username = str(user.get_username() or "").strip()
    if not username:
        raise ValueError("sync user has no username")
    return normalize_relative_path(f"users/{username}", allow_empty=False)


def _resolve_sync_storage_path(user, relative_path: str, *, must_exist: bool) -> tuple[Path, str]:
    scope_relative = _get_sync_scope_relative_dir(user)
    normalized_rel = normalize_relative_path(relative_path, allow_empty=False)
    sync_root = (handrive_root_dir() / scope_relative).resolve()
    sync_root.mkdir(parents=True, exist_ok=True)
    candidate = (sync_root / normalized_rel).resolve()
    if candidate != sync_root and sync_root not in candidate.parents:
        raise ValueError("허용되지 않은 경로입니다.")
    if must_exist and not candidate.exists():
        raise FileNotFoundError("경로를 찾을 수 없습니다.")
    return candidate, normalized_rel


def _hash_file(path_obj: Path) -> str:
    digest = hashlib.sha256()
    with path_obj.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _should_sync_index_file(path_obj: Path) -> bool:
    return path_obj.is_file() and path_obj.name not in {".DS_Store"}


def _ensure_sync_index_for_user(user) -> dict:
    scope_relative = _get_sync_scope_relative_dir(user)
    scope_root = (handrive_root_dir() / scope_relative).resolve()
    scope_root.mkdir(parents=True, exist_ok=True)

    existing_by_path = {
        sync_file.path: sync_file
        for sync_file in SyncFile.objects.filter(user=user)
    }
    seen_paths = set()
    created = 0
    updated = 0
    deleted = 0
    now_ms = _now_ms()

    for file_path in sorted(scope_root.rglob("*"), key=lambda candidate: candidate.as_posix().lower()):
        if not _should_sync_index_file(file_path):
            continue

        rel_path = file_path.relative_to(scope_root).as_posix()
        seen_paths.add(rel_path)
        stat = file_path.stat()
        client_modified_at = int(stat.st_mtime * 1000)
        existing = existing_by_path.get(rel_path)

        if (
            existing
            and not existing.deleted
            and existing.size == stat.st_size
            and existing.client_modified_at == client_modified_at
        ):
            continue

        file_hash = _hash_file(file_path)
        file_bytes = file_path.read_bytes()
        storage_key = existing.storage_key if existing and existing.storage_key else f"{user.id}/{uuid_module.uuid4()}"
        put_object_bytes(
            storage_key,
            file_bytes,
            content_type=mimetypes.guess_type(file_path.name)[0] or "application/octet-stream",
        )

        if existing:
            existing.size = stat.st_size
            existing.hash = file_hash
            existing.version = existing.version + 1 if not existing.deleted else max(1, existing.version)
            existing.storage_key = storage_key
            existing.client_modified_at = client_modified_at
            existing.server_modified_at = now_ms
            existing.deleted = False
            existing.save()
            change_type = SyncChangeLog.TYPE_UPDATE if existing.version > 1 else SyncChangeLog.TYPE_CREATE
            updated += 1
            sync_file = existing
        else:
            try:
                sync_file = SyncFile.objects.create(
                    id=uuid_module.uuid4(),
                    user=user,
                    path=rel_path,
                    size=stat.st_size,
                    hash=file_hash,
                    version=1,
                    storage_key=storage_key,
                    client_modified_at=client_modified_at,
                    server_modified_at=now_ms,
                    deleted=False,
                )
                change_type = SyncChangeLog.TYPE_CREATE
                created += 1
            except IntegrityError:
                sync_file = SyncFile.objects.get(user=user, path=rel_path)
                sync_file.size = stat.st_size
                sync_file.hash = file_hash
                sync_file.version += 1
                sync_file.storage_key = storage_key
                sync_file.client_modified_at = client_modified_at
                sync_file.server_modified_at = now_ms
                sync_file.deleted = False
                sync_file.save()
                change_type = SyncChangeLog.TYPE_UPDATE
                updated += 1

        SyncChangeLog.objects.create(
            user=user,
            file_id=sync_file.id,
            path=sync_file.path,
            type=change_type,
            version=sync_file.version,
            created_at=now_ms,
        )

    for rel_path, sync_file in existing_by_path.items():
        if rel_path in seen_paths or sync_file.deleted:
            continue
        sync_file.deleted = True
        sync_file.server_modified_at = now_ms
        sync_file.version += 1
        sync_file.save()
        deleted += 1
        SyncChangeLog.objects.create(
            user=user,
            file_id=sync_file.id,
            path=sync_file.path,
            type=SyncChangeLog.TYPE_DELETE,
            version=sync_file.version,
            created_at=now_ms,
        )

    if created or updated or deleted:
        logger.info(
            "[sync] index user=%s scope=%s created=%s updated=%s deleted=%s",
            user.username,
            scope_relative,
            created,
            updated,
            deleted,
        )
    return {"created": created, "updated": updated, "deleted": deleted}


def _auth_required(request):
    """인증 필요 뷰에서 사용. User 또는 JsonResponse(401) 반환."""
    user = require_sync_auth(request)
    if user is None:
        return None, _sync_error_response("unauthorized", status=401)
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
        return _sync_error_response("username and password required", status=400)

    tokens = login_and_issue_tokens(username, password)
    if tokens is None:
        return _sync_error_response("invalid credentials", status=401)
    return JsonResponse(tokens)


@csrf_exempt
@require_http_methods(["POST"])
def sync_auth_refresh(request):
    """POST /api/sync/auth/refresh — refresh_token → 새 access_token."""
    body = _json_body(request)
    refresh_token = body.get("refresh_token", "")
    if not refresh_token:
        return _sync_error_response("refresh_token required", status=400)

    new_access = refresh_access_token(refresh_token)
    if new_access is None:
        return _sync_error_response("invalid or expired refresh_token", status=401)
    return JsonResponse({"access_token": new_access})


# ── 파일 목록 ──────────────────────────────────────────────────────────────────

@csrf_exempt
@require_http_methods(["GET"])
def sync_files_list(request):
    """GET /api/sync/files — 전체 파일 목록 (삭제 포함, 초기 sync 용)."""
    user, err = _auth_required(request)
    if err:
        return err

    _ensure_sync_index_for_user(user)
    files = SyncFile.objects.filter(user=user).order_by("path")
    excluded_paths = _get_sync_excluded_paths(user)
    logger.info("[sync] list files user=%s count=%s", user.username, files.count())
    return JsonResponse({"files": [_file_to_dict(f) for f in files], "excluded_paths": excluded_paths})


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
        return _sync_error_response("path, size, hash required", status=400)
    if not isinstance(size, int) or size < 0:
        return _sync_error_response("invalid size", status=400)

    # 쿼터 체크 (기존 파일이면 delta만 계산)
    existing_at_path = SyncFile.objects.filter(user=user, path=path, deleted=False).first()
    delta = size - (existing_at_path.size if existing_at_path else 0)
    if delta > 0 and not _check_quota(user, delta):
        return _sync_error_response("quota_exceeded", status=413)

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
        logger.info(
            "[sync] init-upload dedup user=%s path=%s size=%s storage_key=%s",
            user.username,
            path,
            size,
            storage_key,
        )
        return JsonResponse({
            "skip_upload": True,
            "file_id": str(new_file_id),
            "upload_id": upload_id,
            "storage_key": storage_key,
        })

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

    # 현재 인프라가 미완성 상태여도 동작하도록 업로드는 Django proxy URL을 기본 사용한다.
    upload_url = request.build_absolute_uri(
        reverse("main:sync_upload_data", kwargs={"upload_id": upload_id})
    )
    logger.info(
        "[sync] init-upload user=%s path=%s size=%s upload_id=%s storage_key=%s upload_url=%s",
        user.username,
        path,
        size,
        upload_id,
        storage_key,
        upload_url,
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
        return _sync_error_response("upload session not found", status=404)

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
                return _sync_error_response("conflict", status=409, server_version=existing.version)
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
    logger.info(
        "[sync] complete-upload user=%s path=%s version=%s file_id=%s change=%s",
        user.username,
        sync_file.path,
        sync_file.version,
        sync_file.id,
        change_type,
    )
    return JsonResponse(_file_to_dict(sync_file))


@csrf_exempt
@require_http_methods(["PUT"])
def sync_upload_data(request, upload_id):
    """PUT /api/sync/uploads/<upload_id>/data — Django proxy 업로드."""
    user, err = _auth_required(request)
    if err:
        return err

    try:
        session = SyncUploadSession.objects.get(upload_id=upload_id, user=user)
    except SyncUploadSession.DoesNotExist:
        return _sync_error_response("upload session not found", status=404)

    body = request.body or b""
    if len(body) != session.size:
        return _sync_error_response("content_length_mismatch", status=400)
    content_type = request.headers.get("Content-Type", "application/octet-stream")
    try:
        target_path, normalized_path = _resolve_sync_storage_path(user, session.path, must_exist=False)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(body)
        put_object_bytes(session.storage_key, body, content_type=content_type)
    except Exception as exc:
        logger.exception(
            "[sync] upload-data failed user=%s upload_id=%s path=%s storage_key=%s size=%s",
            user.username,
            upload_id,
            session.path,
            session.storage_key,
            len(body),
        )
        return _sync_error_response(
            "storage error",
            status=502,
            message_ko=f"저장소 오류가 발생했습니다: {exc}",
            message_en=f"Storage error: {exc}",
        )

    logger.info(
        "[sync] upload-data ok user=%s upload_id=%s path=%s normalized=%s storage_key=%s size=%s",
        user.username,
        upload_id,
        session.path,
        normalized_path,
        session.storage_key,
        len(body),
    )
    return HttpResponse(status=200)


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
        return _sync_error_response("not found", status=404)

    url = request.build_absolute_uri(
        reverse("main:sync_files_download_proxy", kwargs={"file_id": sync_file.id})
    )
    logger.info(
        "[sync] download-url user=%s file_id=%s path=%s url=%s",
        user.username,
        sync_file.id,
        sync_file.path,
        url,
    )
    return JsonResponse({"download_url": url})


@csrf_exempt
@require_http_methods(["GET"])
def sync_files_download_proxy(request, file_id):
    """GET /api/sync/files/<uuid>/download — Django proxy 다운로드."""
    user, err = _auth_required(request)
    if err:
        return err

    try:
        sync_file = SyncFile.objects.get(id=file_id, user=user, deleted=False)
    except SyncFile.DoesNotExist:
        return _sync_error_response("not found", status=404)

    try:
        actual_path, _ = _resolve_sync_storage_path(user, sync_file.path, must_exist=True)
        data = actual_path.read_bytes()
        source = "handrive"
    except Exception:
        try:
            data = get_object_bytes(sync_file.storage_key)
            source = "blob"
        except Exception as exc:
            logger.exception(
                "[sync] download-proxy failed user=%s file_id=%s path=%s storage_key=%s",
                user.username,
                sync_file.id,
                sync_file.path,
                sync_file.storage_key,
            )
            return _sync_error_response(
                "storage error",
                status=502,
                message_ko=f"저장소 오류가 발생했습니다: {exc}",
                message_en=f"Storage error: {exc}",
            )

    response = HttpResponse(data, content_type="application/octet-stream")
    response["Content-Length"] = str(len(data))
    response["Content-Disposition"] = f'attachment; filename="{sync_file.path.split("/")[-1]}"'
    logger.info(
        "[sync] download-proxy ok user=%s file_id=%s path=%s size=%s source=%s",
        user.username,
        sync_file.id,
        sync_file.path,
        len(data),
        source,
    )
    return response


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
            try:
                target_path, _ = _resolve_sync_storage_path(user, sync_file.path, must_exist=False)
                if target_path.exists():
                    target_path.unlink()
            except Exception:
                logger.exception("[sync] delete physical file cleanup failed user=%s path=%s", user.username, sync_file.path)
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
        return _sync_error_response("not found", status=404)

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
        return _sync_error_response("target_path required", status=400)

    try:
        with transaction.atomic():
            sync_file = SyncFile.objects.select_for_update().get(id=file_id, user=user, deleted=False)

            if expected_version is not None and sync_file.version != expected_version:
                return _sync_error_response("conflict", status=409, server_version=sync_file.version)

            # 목표 경로 충돌 체크
            if SyncFile.objects.filter(user=user, path=target_path, deleted=False).exclude(id=file_id).exists():
                return _sync_error_response("path_conflict", status=409)

            old_path = sync_file.path
            try:
                source_path, _ = _resolve_sync_storage_path(user, old_path, must_exist=False)
                target_file_path, normalized_target_path = _resolve_sync_storage_path(user, target_path, must_exist=False)
                if source_path.exists():
                    target_file_path.parent.mkdir(parents=True, exist_ok=True)
                    source_path.replace(target_file_path)
                target_path = normalized_target_path
            except Exception:
                logger.exception("[sync] move physical file failed user=%s old=%s new=%s", user.username, old_path, target_path)
                return _sync_error_response("storage move failed", status=502)
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
        return _sync_error_response("not found", status=404)

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

    _ensure_sync_index_for_user(user)
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
    excluded_paths = _get_sync_excluded_paths(user)

    next_cursor = changes[-1]["id"] if changes else cursor
    logger.info(
        "[sync] changes user=%s cursor=%s returned=%s next_cursor=%s",
        user.username,
        cursor,
        len(changes),
        next_cursor,
    )
    return JsonResponse({"changes": changes, "next_cursor": next_cursor, "excluded_paths": excluded_paths})


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
    user = require_sync_auth(request)
    if not user:
        return _sync_error_response("unauthorized", status=401)
    quota_total = get_user_handrive_quota_bytes(user)
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    if scoped_home_dir:
        quota_root, _ = resolve_path(scoped_home_dir, must_exist=False)
        quota_used, _, quota_breakdown = calculate_handrive_quota_breakdown(quota_root)
        repo_bytes, repo_count = calculate_handrive_repo_usage(user)
        used_bytes = quota_used + repo_bytes
        breakdown = [
            {
                "label": label,
                "color": color,
                "display": format_handrive_bytes_display(quota_breakdown[key]["bytes"]),
                "bytes": quota_breakdown[key]["bytes"],
                "percent": round(quota_breakdown[key]["bytes"] / quota_total * 100, 2) if quota_total else 0,
            }
            for key, label, color in _DOCS_QUOTA_TYPE_META
            if quota_breakdown[key]["bytes"] > 0
        ]
        if repo_count > 0:
            breakdown.append({
                "label": "리포지토리",
                "color": "#7c3aed",
                "display": format_handrive_bytes_display(repo_bytes),
                "bytes": repo_bytes,
                "percent": round(repo_bytes / quota_total * 100, 2) if quota_total else 0,
            })
    else:
        used_bytes = 0
        breakdown = []

    free_bytes = max(0, quota_total - used_bytes)
    percent = min(100, round(used_bytes / quota_total * 100, 1)) if quota_total else 0

    payload = {
        "username": user.username,
        "quota_used_bytes": used_bytes,
        "quota_total_bytes": quota_total,
        "quota_percent": percent,
        "quota_used_display": format_handrive_bytes_display(used_bytes),
        "quota_total_display": format_handrive_bytes_display(quota_total),
        "quota_free_display": format_handrive_bytes_display(free_bytes),
        "quota_free_percent": round(free_bytes / quota_total * 100, 2) if quota_total else 100,
        "quota_breakdown": breakdown,
        "excluded_paths": _get_sync_excluded_paths(user),
    }
    logger.info(
        "[sync] me user=%s used=%s total=%s breakdown_items=%s",
        user.username,
        used_bytes,
        quota_total,
        len(breakdown),
    )
    return JsonResponse(payload)


@require_http_methods(["GET"])
def sync_storage_mode(request):
    """GET /api/sync/storage-mode — 서버의 현재 storage mode 반환.

    인증 불필요 (클라이언트 시작 시 호출).

    Response:
        {"mode": "ssd"} 또는 {"mode": "hdd"}
    """
    from storage_profile import get_disc_mode
    return JsonResponse({"mode": get_disc_mode()})
