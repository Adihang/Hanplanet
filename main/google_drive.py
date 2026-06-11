from __future__ import annotations

import json
import mimetypes
from dataclasses import dataclass
from datetime import timedelta
from typing import Iterable

import httpx
from django.utils import timezone

from git.models import GoogleAccountMapping

from .google_auth import GoogleAuthError, google_token_has_drive_scope, refresh_google_access_token


GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3"
GOOGLE_DRIVE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3"
GOOGLE_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder"
GOOGLE_DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut"
GOOGLE_WORKSPACE_MIME_PREFIX = "application/vnd.google-apps."

GOOGLE_DRIVE_FILE_FIELDS = (
    "id,name,mimeType,size,modifiedTime,createdTime,parents,iconLink,"
    "thumbnailLink,webViewLink,webContentLink,shortcutDetails"
)

GOOGLE_WORKSPACE_EXPORT_MIME_TYPES = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
    "application/vnd.google-apps.drawing": "image/png",
}


@dataclass
class GoogleDriveDownload:
    content: bytes
    filename: str
    mime_type: str
    exported: bool = False


class GoogleDriveError(Exception):
    def __init__(self, message: str, *, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _drive_auth_required_message() -> str:
    return "Google Drive 권한 승인이 필요합니다."


def _drive_headers(mapping: GoogleAccountMapping, *, accept: str = "application/json") -> dict[str, str]:
    access_token = str(getattr(mapping, "user_access_token", "") or "").strip()
    if not access_token:
        raise GoogleDriveError(_drive_auth_required_message(), status_code=403)
    return {
        "Accept": accept,
        "Authorization": f"Bearer {access_token}",
    }


def _ensure_drive_access_token(mapping: GoogleAccountMapping) -> None:
    if not bool(getattr(mapping, "google_drive_enabled", False)):
        raise GoogleDriveError("Google Drive가 비활성화되어 있습니다.", status_code=403)
    if not google_token_has_drive_scope(getattr(mapping, "token_scope", "")):
        raise GoogleDriveError(_drive_auth_required_message(), status_code=403)

    access_token = str(getattr(mapping, "user_access_token", "") or "").strip()
    expires_at = getattr(mapping, "user_access_token_expires_at", None)
    refresh_token = str(getattr(mapping, "user_refresh_token", "") or "").strip()
    if not access_token:
        if not refresh_token:
            raise GoogleDriveError(_drive_auth_required_message(), status_code=403)
        try:
            refresh_google_access_token(mapping)
        except GoogleAuthError as exc:
            raise GoogleDriveError(_drive_auth_required_message(), status_code=403) from exc
        return

    if expires_at and expires_at <= timezone.now() + timedelta(seconds=60) and refresh_token:
        try:
            refresh_google_access_token(mapping)
        except GoogleAuthError as exc:
            raise GoogleDriveError(_drive_auth_required_message(), status_code=403) from exc


def _extract_google_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        error_payload = payload.get("error")
        if isinstance(error_payload, dict):
            message = str(error_payload.get("message") or "").strip()
            if message:
                return message
        message = str(payload.get("error_description") or payload.get("message") or "").strip()
        if message:
            return message
    return "Google Drive 요청에 실패했습니다."


def _drive_request(
    mapping: GoogleAccountMapping,
    method: str,
    url: str,
    *,
    retry_refresh: bool = True,
    accept: str = "application/json",
    content_type: str | None = None,
    **kwargs,
) -> httpx.Response:
    _ensure_drive_access_token(mapping)
    headers = _drive_headers(mapping, accept=accept)
    if content_type:
        headers["Content-Type"] = content_type
    try:
        response = httpx.request(
            method,
            url,
            headers=headers,
            timeout=20.0,
            **kwargs,
        )
    except httpx.HTTPError as exc:
        raise GoogleDriveError("Google Drive 요청에 실패했습니다.") from exc

    if response.status_code == 401 and retry_refresh and str(getattr(mapping, "user_refresh_token", "") or "").strip():
        try:
            refresh_google_access_token(mapping)
        except GoogleAuthError as exc:
            raise GoogleDriveError(_drive_auth_required_message(), status_code=403) from exc
        return _drive_request(
            mapping,
            method,
            url,
            retry_refresh=False,
            accept=accept,
            content_type=content_type,
            **kwargs,
        )

    if response.status_code >= 400:
        status_code = 403 if response.status_code in {401, 403} else 502
        raise GoogleDriveError(_extract_google_error_message(response), status_code=status_code)
    return response


def is_google_workspace_file(mime_type: str | None) -> bool:
    mime = str(mime_type or "")
    return mime.startswith(GOOGLE_WORKSPACE_MIME_PREFIX) and mime != GOOGLE_DRIVE_FOLDER_MIME


def google_drive_guess_mime_type(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def list_google_drive_files(mapping: GoogleAccountMapping, folder_id: str = "root") -> list[dict]:
    folder = str(folder_id or "root").strip() or "root"
    files: list[dict] = []
    page_token = ""
    for _ in range(20):
        params = {
            "q": f"'{folder}' in parents and trashed=false",
            "fields": f"nextPageToken,files({GOOGLE_DRIVE_FILE_FIELDS})",
            "pageSize": "1000",
            "orderBy": "folder,name_natural",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if page_token:
            params["pageToken"] = page_token
        response = _drive_request(
            mapping,
            "GET",
            f"{GOOGLE_DRIVE_API_BASE_URL}/files",
            params=params,
        )
        try:
            payload = response.json()
        except ValueError as exc:
            raise GoogleDriveError("Google Drive 목록을 읽을 수 없습니다.") from exc
        raw_files = payload.get("files") if isinstance(payload, dict) else []
        if isinstance(raw_files, list):
            files.extend(item for item in raw_files if isinstance(item, dict))
        page_token = str(payload.get("nextPageToken") or "").strip() if isinstance(payload, dict) else ""
        if not page_token:
            break
    return files


def get_google_drive_file(mapping: GoogleAccountMapping, file_id: str) -> dict:
    normalized_id = str(file_id or "").strip()
    if not normalized_id:
        raise GoogleDriveError("Google Drive 파일을 찾을 수 없습니다.", status_code=404)
    response = _drive_request(
        mapping,
        "GET",
        f"{GOOGLE_DRIVE_API_BASE_URL}/files/{normalized_id}",
        params={
            "fields": GOOGLE_DRIVE_FILE_FIELDS,
            "supportsAllDrives": "true",
        },
    )
    try:
        payload = response.json()
    except ValueError as exc:
        raise GoogleDriveError("Google Drive 파일을 읽을 수 없습니다.") from exc
    if not isinstance(payload, dict) or not payload.get("id"):
        raise GoogleDriveError("Google Drive 파일을 찾을 수 없습니다.", status_code=404)
    return payload


def download_google_drive_file(mapping: GoogleAccountMapping, file_id: str, metadata: dict | None = None) -> GoogleDriveDownload:
    file_meta = metadata if isinstance(metadata, dict) else get_google_drive_file(mapping, file_id)
    mime_type = str(file_meta.get("mimeType") or "application/octet-stream")
    filename = str(file_meta.get("name") or file_id or "google-drive-file").strip() or "google-drive-file"

    if mime_type == GOOGLE_DRIVE_FOLDER_MIME:
        raise GoogleDriveError("폴더는 다운로드할 수 없습니다.", status_code=400)

    if is_google_workspace_file(mime_type):
        export_mime = GOOGLE_WORKSPACE_EXPORT_MIME_TYPES.get(mime_type, "text/plain")
        response = _drive_request(
            mapping,
            "GET",
            f"{GOOGLE_DRIVE_API_BASE_URL}/files/{file_meta['id']}/export",
            params={"mimeType": export_mime},
            accept=export_mime,
        )
        return GoogleDriveDownload(
            content=response.content or b"",
            filename=filename,
            mime_type=export_mime,
            exported=True,
        )

    response = _drive_request(
        mapping,
        "GET",
        f"{GOOGLE_DRIVE_API_BASE_URL}/files/{file_meta['id']}",
        params={"alt": "media", "supportsAllDrives": "true"},
        accept=mime_type or "application/octet-stream",
    )
    return GoogleDriveDownload(
        content=response.content or b"",
        filename=filename,
        mime_type=mime_type or "application/octet-stream",
        exported=False,
    )


def create_google_drive_folder(mapping: GoogleAccountMapping, parent_id: str, name: str) -> dict:
    response = _drive_request(
        mapping,
        "POST",
        f"{GOOGLE_DRIVE_API_BASE_URL}/files",
        params={"fields": GOOGLE_DRIVE_FILE_FIELDS, "supportsAllDrives": "true"},
        json={
            "name": name,
            "mimeType": GOOGLE_DRIVE_FOLDER_MIME,
            "parents": [str(parent_id or "root")],
        },
    )
    try:
        return response.json()
    except ValueError as exc:
        raise GoogleDriveError("Google Drive 폴더를 생성할 수 없습니다.") from exc


def create_google_drive_file(mapping: GoogleAccountMapping, parent_id: str, name: str, content: bytes, mime_type: str | None = None) -> dict:
    resolved_mime = str(mime_type or google_drive_guess_mime_type(name) or "application/octet-stream")
    metadata = {
        "name": name,
        "parents": [str(parent_id or "root")],
    }
    response = _drive_request(
        mapping,
        "POST",
        f"{GOOGLE_DRIVE_UPLOAD_BASE_URL}/files",
        params={
            "uploadType": "multipart",
            "fields": GOOGLE_DRIVE_FILE_FIELDS,
            "supportsAllDrives": "true",
        },
        files={
            "metadata": (None, json.dumps(metadata, ensure_ascii=False), "application/json; charset=UTF-8"),
            "file": (name, content or b"", resolved_mime),
        },
    )
    try:
        return response.json()
    except ValueError as exc:
        raise GoogleDriveError("Google Drive 파일을 생성할 수 없습니다.") from exc


def update_google_drive_file_content(mapping: GoogleAccountMapping, file_id: str, content: bytes, mime_type: str | None = None) -> dict:
    metadata = get_google_drive_file(mapping, file_id)
    if is_google_workspace_file(metadata.get("mimeType")):
        raise GoogleDriveError("Google Workspace 문서는 HanDrive에서 직접 저장할 수 없습니다.", status_code=400)
    resolved_mime = str(mime_type or metadata.get("mimeType") or "application/octet-stream")
    response = _drive_request(
        mapping,
        "PATCH",
        f"{GOOGLE_DRIVE_UPLOAD_BASE_URL}/files/{metadata['id']}",
        params={
            "uploadType": "media",
            "fields": GOOGLE_DRIVE_FILE_FIELDS,
            "supportsAllDrives": "true",
        },
        content=content or b"",
        content_type=resolved_mime,
    )
    try:
        return response.json()
    except ValueError:
        return get_google_drive_file(mapping, file_id)


def rename_google_drive_file(mapping: GoogleAccountMapping, file_id: str, name: str) -> dict:
    response = _drive_request(
        mapping,
        "PATCH",
        f"{GOOGLE_DRIVE_API_BASE_URL}/files/{file_id}",
        params={"fields": GOOGLE_DRIVE_FILE_FIELDS, "supportsAllDrives": "true"},
        json={"name": name},
    )
    try:
        return response.json()
    except ValueError as exc:
        raise GoogleDriveError("Google Drive 파일 이름을 바꿀 수 없습니다.") from exc


def move_google_drive_file(mapping: GoogleAccountMapping, file_id: str, parent_id: str) -> dict:
    metadata = get_google_drive_file(mapping, file_id)
    parents = [
        str(parent)
        for parent in metadata.get("parents", [])
        if str(parent or "").strip()
    ]
    response = _drive_request(
        mapping,
        "PATCH",
        f"{GOOGLE_DRIVE_API_BASE_URL}/files/{file_id}",
        params={
            "addParents": str(parent_id or "root"),
            "removeParents": ",".join(parents),
            "fields": GOOGLE_DRIVE_FILE_FIELDS,
            "supportsAllDrives": "true",
        },
        json={},
    )
    try:
        return response.json()
    except ValueError as exc:
        raise GoogleDriveError("Google Drive 파일을 이동할 수 없습니다.") from exc


def delete_google_drive_file(mapping: GoogleAccountMapping, file_id: str) -> None:
    _drive_request(
        mapping,
        "DELETE",
        f"{GOOGLE_DRIVE_API_BASE_URL}/files/{file_id}",
        params={"supportsAllDrives": "true"},
    )


def build_available_google_drive_name(existing_files: Iterable[dict], requested_name: str) -> str:
    raw_name = str(requested_name or "").strip()
    if not raw_name:
        raise GoogleDriveError("이름을 입력해주세요.", status_code=400)
    existing_names = {
        str(item.get("name") or "").strip()
        for item in existing_files
        if isinstance(item, dict)
    }
    if raw_name not in existing_names:
        return raw_name
    dot_index = raw_name.rfind(".")
    if dot_index > 0:
        stem = raw_name[:dot_index]
        suffix = raw_name[dot_index:]
    else:
        stem = raw_name
        suffix = ""
    index = 2
    while True:
        candidate = f"{stem} ({index}){suffix}"
        if candidate not in existing_names:
            return candidate
        index += 1
