from __future__ import annotations

"""HanDrive 웹 진입점과 API를 모아 둔 메인 view 모듈.

역할 구분:
- 이 파일: 경로 해석, 권한 검사, 템플릿 context 조합, JSON API 입출력
- ``main.handrive.preview``: 파일 내용을 브라우저 미리보기 HTML로 변환
- ``main.handrive.html_assets``: HTML 파일의 같은 이름 css/js companion asset 로드

핵심 난점은 일반 파일 경로와 git virtual path를 같은 UI에서 다뤄야 한다는 점이다.
그래서 대부분의 API는 먼저 일반 경로인지 repo/branch 가상 경로인지 판별한 뒤,
각기 다른 읽기/쓰기 경로로 분기한다.
"""

import base64
import binascii
import io
import logging
import json
import os
import sqlite3
import re
import shutil
import secrets
import subprocess
import sys
import tempfile
import time
import unicodedata
import uuid
import zipfile
from datetime import datetime
from contextvars import ContextVar
from functools import wraps
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse, unquote
import httpx

from django import forms
from django.contrib.auth import authenticate, login as auth_login
from django.contrib.auth import logout as auth_logout
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.html import escape
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.safestring import mark_safe
from django.views.csrf import csrf_failure as default_csrf_failure
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.http import require_http_methods

from config.utils import build_user_folder_icon_dir, sanitize_upload_segment
from .views import (
    SUPPORTED_UI_LANGS,
    apply_ui_context,
    get_account_display_name,
    redirect_to_localized_route,
    render_markdown_safely,
    resolve_ui_lang,
)
from .restart_utils import restart_gunicorn_and_wait
from .forgejo_client import ForgejoClient
from .handrive.html_assets import load_local_html_companion_assets, load_repo_html_companion_assets
from .handrive.preview import render_handrive_html_live_safely, render_handrive_office_preview_safely, render_handrive_pdf_safely
from .models import HandriveAccessRule, HandriveLoginAttemptGuard, HandriveSharedLink, HandriveUserQuota, UserProfile
from git.models import GitUserMapping
from portfolio.models import PortfolioProfile

logger = logging.getLogger(__name__)
GIT_BIN = "/usr/bin/git"
FORGEJO_SESSION_HELPER_BINARY_NAME = "hanplanet_forgejo_session_blob"
FORGEJO_AUTH_ERROR_CODE = "FORGEJO"

DOCS_FILE_EXTENSION = ".md"
DOCS_ALLOWED_FILE_EXTENSIONS = (
    ".md",
    ".txt",
    ".json",
    ".py",
)
INVALID_NAME_PATTERN = re.compile(r"[\\/]")
DOCS_LOGOUT_PATH_PATTERN = re.compile(r"^/(?:(ko|en)/)?(?:docs|ide|handrive)/logout/?$")
MARKDOWN_HELP_FILENAME_KO = "Markdown description_ko.md"
MARKDOWN_HELP_FILENAME_EN = "Markdown description_en.md"
MARKDOWN_HELP_FILENAME_KO_DOT_LEGACY = "Markdown description.ko.md"
MARKDOWN_HELP_FILENAME_EN_DOT_LEGACY = "Markdown description.en.md"
MARKDOWN_HELP_FILENAME_LEGACY = "Markdown description.md"
MARKDOWN_HELP_DIRECTORY = "help"
PAGE_HELP_FILE_BASENAMES = {
    "list": "list",
    "write": "write",
    "view": "read",
}
HANDRIVE_EDITOR_GROUP_NAME = "HandriveEditors"
DOCS_EDIT_PERMISSION_CODE = "main.can_edit_docs"
DOCS_PUBLIC_WRITE_GROUP_NAME = "__DOCS_PUBLIC_ALL__"
DOCS_URL_ONLY_GROUP_NAME = "url-only"
DOCS_META_TITLE = "Hanplanet"
DOCS_META_DESCRIPTION = "Hanplanet workspace"
DOCS_LOGIN_CAPTCHA_THRESHOLD = 1
DOCS_UPLOAD_RATE_LIMIT_BYTES_PER_SECOND = 10 * 1024 * 1024
DOCS_USER_SCOPED_QUOTA_BYTES = 1024 * 1024 * 1024  # 기본값 1GB
DOCS_USER_SCOPED_ENTRY_LIMIT = 100


def _sanitize_sync_excluded_paths(raw_paths, scoped_home_dir: str = "") -> list[str]:
    if not isinstance(raw_paths, list):
        return []

    cleaned: list[str] = []
    seen: set[str] = set()
    for raw_path in raw_paths:
        try:
            normalized = normalize_relative_path(raw_path, allow_empty=True)
        except ValueError:
            continue
        if scoped_home_dir and normalized and not is_path_in_handrive_scope(normalized, scoped_home_dir):
            continue
        try:
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


def _storage_unavailable_response(request, exc: Exception | None = None):
    message = "외장 저장소를 읽거나 쓸 수 없습니다."
    if exc is not None:
        logger.warning("HanDrive storage unavailable path=%s error=%s", getattr(request, "path", ""), exc)
    if str(getattr(request, "path", "")).startswith("/handrive/api/"):
        return JsonResponse({"error": message}, status=503)
    return HttpResponse(message, status=503)


def _map_image_relative_path_from_value(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    parsed = urlparse(text)
    if parsed.query:
        query = parse_qs(parsed.query)
        path_value = query.get("path", [""])[0].strip()
        if path_value:
            try:
                return normalize_relative_path(unquote(path_value), allow_empty=False)
            except ValueError:
                return None

    if "://" in text or text.startswith("/"):
        return None

    try:
        return normalize_relative_path(text, allow_empty=False)
    except ValueError:
        return None


def _collect_map_image_relative_paths(geojson_data: dict) -> set[str]:
    collected: set[str] = set()

    def add_value(value: object) -> None:
        if isinstance(value, list):
            for item in value:
                add_value(item)
            return
        relative_path = _map_image_relative_path_from_value(value)
        if relative_path:
            collected.add(relative_path)

    for feature in geojson_data.get("features") or []:
        if not isinstance(feature, dict):
            continue
        props = feature.get("properties")
        if not isinstance(props, dict):
            continue
        add_value(props.get("imageUrl"))
        add_value(props.get("imageUrls"))
        add_value(props.get("videoUrl"))
        add_value(props.get("videoUrls"))

    for group in geojson_data.get("groups") or []:
        if not isinstance(group, dict):
            continue
        add_value(group.get("imageUrl"))
        add_value(group.get("imageUrls"))
        add_value(group.get("videoUrl"))
        add_value(group.get("videoUrls"))

    for map_image in geojson_data.get("mapImages") or []:
        if not isinstance(map_image, dict):
            continue
        add_value(map_image.get("url"))
        add_value(map_image.get("path"))

    return collected


def _prune_empty_parent_dirs(path_obj: Path, stop_at: Path) -> None:
    current = path_obj.parent
    stop_at = stop_at.resolve()
    while current != stop_at and stop_at in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def _iter_descendants_safely(root_path: Path):
    """재귀 탐색 중 일부 항목에 접근할 수 없어도 전체 목록이 죽지 않게 한다."""
    stack = [root_path]
    while stack:
        current = stack.pop()
        try:
            children = list(current.iterdir())
        except (OSError, PermissionError):
            continue
        for child in sorted(children, key=lambda p: p.name.lower(), reverse=True):
            yield child
            if child.is_dir():
                stack.append(child)


def _map_attachment_folder_name(raw_name: str | None) -> str:
    folder_name = validate_name(raw_name, for_file=False)
    if folder_name.lower() in {MAP_ICONS_DIR.lower(), MAP_IMAGE_ATTACHMENTS_DIR.lower()}:
        raise ValueError("사용할 수 없는 이름입니다.")
    return folder_name


def get_user_handrive_quota_bytes(user) -> int:
    """사용자별 저장 용량을 반환한다. 어드민에서 매핑이 없으면 기본값(1GB)."""
    try:
        return user.handrive_quota.quota_bytes
    except Exception:
        return DOCS_USER_SCOPED_QUOTA_BYTES


def get_user_handrive_entry_limit(user) -> int | None:
    """사용자별 파일/폴더 개수 제한을 반환한다.
    - 설정 없음 → 기본값(100개)
    - 0 → 무제한(None 반환)
    - 양수 → 해당 값
    """
    try:
        limit = user.handrive_quota.scoped_entry_limit
        return None if limit == 0 else limit
    except Exception:
        return DOCS_USER_SCOPED_ENTRY_LIMIT
MAP_META_FILENAME = "_map_meta.json"
MAP_DATA_FILENAME = "map.geojson"
MAP_ICONS_DIR = "_icons"
MAP_IMAGE_ATTACHMENTS_DIR = "_images"
MAP_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tiff", ".tif", ".avif"})
FOLDER_ICON_EXTENSIONS = MAP_IMAGE_EXTENSIONS
IMAGE_EDITOR_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".avif"})
MAP_VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m4v", ".ogv"})
MAP_MEDIA_EXTENSIONS = MAP_IMAGE_EXTENSIONS | MAP_VIDEO_EXTENSIONS
MAP_IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".avif": "image/avif",
}
MAP_VIDEO_MIME_TYPES = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".wmv": "video/x-ms-wmv",
    ".m4v": "video/x-m4v",
    ".ogv": "video/ogg",
}
HANDRIVE_LOGIN_CAPTCHA_QUESTION_SESSION_KEY = "handrive_login_captcha_question"
HANDRIVE_LOGIN_CAPTCHA_ANSWER_SESSION_KEY = "handrive_login_captcha_answer"

# 2FA pending session keys
HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY = "handrive_2fa_pending_user_id"
HANDRIVE_2FA_PENDING_NEXT_URL_SESSION_KEY = "handrive_2fa_pending_next_url"
HANDRIVE_2FA_PENDING_UI_LANG_SESSION_KEY = "handrive_2fa_pending_ui_lang"
HANDRIVE_2FA_PENDING_FORGEJO_KEY_SESSION_KEY = "handrive_2fa_pending_forgejo_key"
HANDRIVE_2FA_PENDING_REQUIRES_ATTACH_SESSION_KEY = "handrive_2fa_pending_requires_attach"
HANDRIVE_SIGNUP_2FA_SESSION_KEY = "handrive_signup_2fa_pending"  # 회원가입 AJAX 이메일 인증 세션 키
DOCS_SIGNUP_FORBIDDEN_TERMS = (
    "admin",
    "administrator",
    "root",
    "system",
    "operator",
    "staff",
    "moderator",
    "program",
    "developer",
    "dev",
    "engineer",
    "ops",
    "sql",
    "mysql",
    "postgres",
    "oracle",
    "mssql",
    "sqlserver",
    "dba",
)
DOCS_SIGNUP_SQL_PATTERN = re.compile(
    r"(?:--|/\*|\*/|;|\b(select|insert|update|delete|drop|alter|create|truncate|union|into|from|where|or|and)\b)",
    re.IGNORECASE,
)
DOCS_RENDER_MODE_MARKDOWN = "markdown"
DOCS_RENDER_MODE_PLAIN_TEXT = "plain_text"
DOCS_RENDER_MODE_MEDIA_IMAGE = "media_image"
DOCS_RENDER_MODE_MEDIA_VIDEO = "media_video"
DOCS_RENDER_MODE_MEDIA_AUDIO = "media_audio"
DOCS_RENDER_MODE_OFFICE = "office"
DOCS_RENDER_MODE_PDF = "pdf"
DOCS_RENDER_MODE_UNSUPPORTED = "unsupported"
HANDRIVE_ACTIVE_ROOT_DIR: ContextVar[Path | None] = ContextVar("handrive_active_root_dir", default=None)
HANDRIVE_ACTIVE_REQUEST: ContextVar[object | None] = ContextVar("handrive_active_request", default=None)
HANDRIVE_ARCHIVE_VIRTUAL_PREFIX = ".handrive-archive"
HANDRIVE_SUPPORTED_ARCHIVE_EXTENSIONS = frozenset({".zip"})
DOCS_DEFAULT_RENDER_PROFILE = {
    "mode": DOCS_RENDER_MODE_PLAIN_TEXT,
    "css_class": "handrive-plain-text",
}
DOCS_UNSUPPORTED_RENDER_PROFILE = {
    "mode": DOCS_RENDER_MODE_UNSUPPORTED,
    "css_class": "handrive-unsupported",
}
DOCS_RENDER_PROFILES_BY_EXTENSION = {
    DOCS_FILE_EXTENSION: {
        "mode": DOCS_RENDER_MODE_MARKDOWN,
        "css_class": "handrive-markdown",
    },
    ".html": {
        "mode": DOCS_RENDER_MODE_PLAIN_TEXT,
        "css_class": "handrive-html",
    },
    ".css": {
        "mode": DOCS_RENDER_MODE_PLAIN_TEXT,
        "css_class": "handrive-css",
    },
    ".js": {
        "mode": DOCS_RENDER_MODE_PLAIN_TEXT,
        "css_class": "handrive-js",
    },
    ".py": {
        "mode": DOCS_RENDER_MODE_PLAIN_TEXT,
        "css_class": "handrive-py",
    },
    ".json": {
        "mode": DOCS_RENDER_MODE_PLAIN_TEXT,
        "css_class": "handrive-json",
    },
    ".doc": {
        "mode": DOCS_RENDER_MODE_OFFICE,
        "css_class": "handrive-office handrive-office-word",
    },
    ".docx": {
        "mode": DOCS_RENDER_MODE_OFFICE,
        "css_class": "handrive-office handrive-office-word",
    },
    ".xls": {
        "mode": DOCS_RENDER_MODE_OFFICE,
        "css_class": "handrive-office handrive-office-sheet",
    },
    ".xlsx": {
        "mode": DOCS_RENDER_MODE_OFFICE,
        "css_class": "handrive-office handrive-office-sheet",
    },
    ".ppt": {
        "mode": DOCS_RENDER_MODE_OFFICE,
        "css_class": "handrive-office handrive-office-presentation",
    },
    ".pptx": {
        "mode": DOCS_RENDER_MODE_OFFICE,
        "css_class": "handrive-office handrive-office-presentation",
    },
    ".pdf": {
        "mode": DOCS_RENDER_MODE_PDF,
        "css_class": "handrive-media handrive-media-pdf",
    },
    ".png": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".jpg": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".jpeg": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".gif": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".webp": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".svg": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".bmp": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".avif": {
        "mode": DOCS_RENDER_MODE_MEDIA_IMAGE,
        "css_class": "handrive-media handrive-media-image",
    },
    ".mp4": {
        "mode": DOCS_RENDER_MODE_MEDIA_VIDEO,
        "css_class": "handrive-media handrive-media-video",
    },
    ".webm": {
        "mode": DOCS_RENDER_MODE_MEDIA_VIDEO,
        "css_class": "handrive-media handrive-media-video",
    },
    ".mov": {
        "mode": DOCS_RENDER_MODE_MEDIA_VIDEO,
        "css_class": "handrive-media handrive-media-video",
    },
    ".mkv": {
        "mode": DOCS_RENDER_MODE_MEDIA_VIDEO,
        "css_class": "handrive-media handrive-media-video",
    },
    ".m4v": {
        "mode": DOCS_RENDER_MODE_MEDIA_VIDEO,
        "css_class": "handrive-media handrive-media-video",
    },
    ".ogv": {
        "mode": DOCS_RENDER_MODE_MEDIA_VIDEO,
        "css_class": "handrive-media handrive-media-video",
    },
    ".mp3": {
        "mode": DOCS_RENDER_MODE_MEDIA_AUDIO,
        "css_class": "handrive-media handrive-media-audio",
    },
    ".wav": {
        "mode": DOCS_RENDER_MODE_MEDIA_AUDIO,
        "css_class": "handrive-media handrive-media-audio",
    },
    ".ogg": {
        "mode": DOCS_RENDER_MODE_MEDIA_AUDIO,
        "css_class": "handrive-media handrive-media-audio",
    },
    ".m4a": {
        "mode": DOCS_RENDER_MODE_MEDIA_AUDIO,
        "css_class": "handrive-media handrive-media-audio",
    },
    ".aac": {
        "mode": DOCS_RENDER_MODE_MEDIA_AUDIO,
        "css_class": "handrive-media handrive-media-audio",
    },
    ".flac": {
        "mode": DOCS_RENDER_MODE_MEDIA_AUDIO,
        "css_class": "handrive-media handrive-media-audio",
    },
    ".weba": {
        "mode": DOCS_RENDER_MODE_MEDIA_AUDIO,
        "css_class": "handrive-media handrive-media-audio",
    },
}
DOCS_NON_EDITABLE_MEDIA_MODES = {
    DOCS_RENDER_MODE_MEDIA_IMAGE,
    DOCS_RENDER_MODE_MEDIA_VIDEO,
    DOCS_RENDER_MODE_MEDIA_AUDIO,
    DOCS_RENDER_MODE_OFFICE,
    DOCS_RENDER_MODE_PDF,
}

DOCS_TEXT = {
    "ko": {
        "list_title": "Files",
        "write_button": "작성",
        "help_button": "도움말",
        "search_button": "검색",
        "search_placeholder": "파일 검색",
        "list_aria_label": "목록",
        "menu_open": "열기",
        "menu_download": "다운로드",
        "menu_upload": "업로드",
        "menu_rename": "이름 바꾸기",
        "menu_permissions": "권한",
        "menu_edit": "수정",
        "menu_delete": "삭제",
        "menu_create_repo": "Repo 생성",
        "menu_manage_repo": "Repo 관리",
        "menu_delete_repo": "Repo 삭제",
        "menu_change_icon": "아이콘 변경",
        "menu_extract_archive": "압축해제",
        "menu_create_archive": "압축하기",
        "menu_new_folder": "새 폴더",
        "menu_new_document": "새 파일",
        "archive_extract_title": "압축해제",
        "archive_extract_message": "압축을 어디에 풀까요?",
        "archive_extract_current_folder": "이 폴더에",
        "archive_extract_named_folder": "압축파일명 폴더에",
        "rename_title": "이름 바꾸기",
        "commit_message_title": "커밋 메시지",
        "commit_message_label": "메시지",
        "commit_message_placeholder": "커밋 메시지를 입력해주세요.",
        "clipboard_filename_title": "파일명 입력",
        "clipboard_filename_label": "파일명",
        "clipboard_filename_placeholder": "비워두면 기본 파일명으로 업로드됩니다.",
        "clipboard_filename_target_prefix": "업로드 위치",
        "clipboard_filename_target_root": "업로드 위치: HanDrive",
        "clipboard_filename_placeholder_with_default": "비워두면 기본 파일명으로 업로드됩니다.",
        "clipboard_filename_blank_default_prefix": "비워두면 ",
        "clipboard_filename_blank_default_suffix": " 이름으로 업로드됩니다.",
        "rename_new_name": "새 이름",
        "rename_new_name_placeholder": "새 이름",
        "cancel": "취소",
        "upload_cancel": "업로드 취소",
        "queue_cancel": "취소",
        "queue_remove": "목록에서 제거",
        "queue_status_active": "처리 중",
        "queue_status_pending": "대기 중",
        "queue_status_delete_queued": "삭제 대기",
        "queue_status_deleting": "삭제 중",
        "queue_status_delete_done": "삭제 완료",
        "queue_status_move_queued": "이동 대기",
        "queue_status_moving": "이동 중",
        "queue_status_move_done": "이동 완료",
        "queue_status_extract_queued": "압축해제 대기",
        "queue_status_extracting": "압축해제 중",
        "queue_status_extract_done": "압축해제 완료",
        "queue_status_archive_create_queued": "압축파일 생성 대기",
        "queue_status_archive_creating": "압축파일 생성 중",
        "queue_status_archive_create_done": "압축파일 생성 완료",
        "apply": "변경",
        "edit_button": "수정",
        "image_editor_save_ok": "저장 완료",
        "image_editor_save_error": "저장 실패",
        "image_editor_saving": "저장 중...",
        "image_editor_resize_title": "크기 조정",
        "image_editor_save_as_title": "다른 이름으로 저장",
        "image_editor_resize_width": "너비",
        "image_editor_resize_height": "높이",
        "image_editor_resize_lock_ratio": "비율 유지",
        "image_editor_unsaved_warning": "저장되지 않은 변경 사항이 있습니다. 계속하시겠습니까?",
        "delete_button": "삭제",
        "delete_repo_button": "Repo 삭제",
        "download_button": "다운로드",
        "write_title_edit": "수정",
        "write_title_create": "새 파일",
        "markdown_guide_button": "마크다운 가이드",
        "markdown_preview_button": "미리보기",
        "markdown_snippet_aria": "마크다운 문법 빠른 입력",
        "markdown_snippet_heading2": "제목 2",
        "markdown_snippet_heading3": "제목 3",
        "markdown_snippet_bold": "굵게",
        "markdown_snippet_italic": "기울임",
        "markdown_snippet_link": "링크",
        "markdown_snippet_image": "이미지",
        "markdown_snippet_code_inline": "인라인 코드",
        "markdown_snippet_code_block": "코드 블록",
        "markdown_snippet_list_bullet": "글머리 목록",
        "markdown_snippet_list_numbered": "번호 목록",
        "markdown_snippet_list_check": "체크리스트",
        "markdown_snippet_quote": "인용문",
        "markdown_snippet_divider": "구분선",
        "markdown_snippet_table": "표",
        "editor_snippet_py_def": "함수 템플릿",
        "editor_snippet_py_class": "클래스 템플릿",
        "editor_snippet_py_ifmain": "실행 블록",
        "editor_snippet_py_comment": "주석",
        "editor_snippet_js_function": "함수 템플릿",
        "editor_snippet_js_if": "If Statement",
        "editor_snippet_js_comment": "주석",
        "editor_snippet_css_rule": "선택자 블록",
        "editor_snippet_css_media": "미디어 쿼리",
        "editor_snippet_css_var": "CSS Variable",
        "editor_snippet_json_pair": "키-값 항목",
        "editor_snippet_json_object": "객체 템플릿",
        "editor_snippet_html_basic": "Basic HTML Structure",
        "editor_snippet_html_div": "div Block",
        "markdown_placeholder_heading": "제목",
        "markdown_placeholder_bold": "강조 텍스트",
        "markdown_placeholder_italic": "기울임 텍스트",
        "markdown_placeholder_link_text": "링크 텍스트",
        "markdown_placeholder_image_alt": "이미지 설명",
        "markdown_placeholder_inline_code": "코드",
        "markdown_placeholder_code_lang": "언어",
        "markdown_placeholder_code_body": "코드를 입력하세요",
        "markdown_placeholder_list_item": "항목",
        "markdown_placeholder_quote": "인용문",
        "markdown_placeholder_table_col1": "항목",
        "markdown_placeholder_table_col2": "설명",
        "save_button": "저장",
        "unsaved_changes_title": "수정 사항이 있습니다",
        "unsaved_changes_message": "저장되지 않은 변경 사항이 있습니다. 이동 전에 저장할까요?",
        "unsaved_changes_leave_button": "확인",
        "unsaved_changes_save_button": "저장",
        "list_preview_title": "파일 미리보기",
        "list_preview_empty": "파일을 선택하면 미리보기가 표시됩니다.",
        "list_preview_loading": "미리보기를 불러오는 중...",
        "list_preview_error": "미리보기를 불러오지 못했습니다.",
        "list_preview_unsupported": "미리보기 미지원",
        "view_read_unsupported": "읽기 미지원",
        "list_button": "목록",
        "filename_label": "파일명",
        "filename_placeholder": "확장자 포함",
        "save_filename_label": "파일명",
        "save_filename_label_main": "파일명",
        "save_filename_label_sub": "(확장자 포함)",
        "save_filename_placeholder": "확장자 포함",
        "file_extension_label": "확장자",
        "file_extension_quick_label": "확장자 빠른 선택",
        "file_extension_custom_option": "직접 입력",
        "file_extension_placeholder": ".md",
        "zoom_out_button": "축소",
        "zoom_in_button": "확대",
        "content_label": "내용",
        "save_location_title": "저장 위치 선택",
        "close_label": "닫기",
        "up_button": "상위",
        "quick_paths_title": "빠른 경로",
        "folder_title": "폴더",
        "selected_path_label": "선택 경로",
        "selected_path_placeholder": "경로 선택",
        "create_folder_button": "폴더 생성",
        "save_confirm_button": "저장",
        "folder_modal_title": "새 폴더 생성",
        "folder_name_label": "폴더명",
        "folder_name_placeholder": "폴더명 입력",
        "branch_name_placeholder": "e.g. feature/my-work",
        "map_create_placeholder": "지도 이름을 입력하세요",
        "folder_icon_title": "아이콘 변경",
        "folder_icon_file_label": "이미지 파일 선택",
        "folder_icon_delete_button": "아이콘 삭제",
        "git_repo_name_placeholder": "my-repo (letters, numbers, ., -, _)",
        "git_repo_create_title": "Git 리포지토리 생성",
        "git_repo_manage_title": "Git 리포지토리 관리",
        "git_repo_name_label": "리포지토리 이름",
        "git_repo_linked": "연결된 리포지토리",
        "git_repo_creating": "생성 중...",
        "git_repo_create_failed": "생성 실패",
        "git_repo_retrying": "재시도 중...",
        "git_repo_retry_failed": "재시도 실패",
        "git_repo_status_error": "상태 조회 중 오류가 발생했습니다.",
        "git_repo_load_failed": "저장소 정보를 불러올 수 없습니다. 페이지를 새로고침해주세요.",
        "git_repo_name_required": "리포지토리 이름을 입력해주세요.",
        "git_repo_request_failed": "요청 실패",
        "git_repo_unknown_error": "알 수 없는 오류",
        "git_repo_copy_button": "복사",
        "git_repo_copied_button": "복사됨!",
        "git_repo_open_button": "관리 페이지",
        "git_repo_retry_button": "재시도",
        "map_name_placeholder": "이름을 입력하세요",
        "map_marker_name_placeholder": "마커 이름",
        "menu_create_map": "지도 제작",
        "menu_git_create_branch": "브랜치 생성",
        "menu_git_delete_branch": "브랜치 삭제",
        "map_create_title": "지도 제작",
        "map_create_name_label": "지도명",
        "map_create_confirm": "지도 만들기",
        "branch_create_title": "브랜치 생성",
        "branch_create_name_label": "새 브랜치 이름",
        "map_zone_title": "이름 입력",
        "map_clickable_title": "클릭 가능",
        "map_zone_icon_visible_title": "아이콘/구역 표시",
        "map_marker_icon_visible_title": "아이콘 표시",
        "map_marker_title": "마커 정보",
        "map_name_label": "이름",
        "map_icon_label": "아이콘",
        "map_desc_label": "설명",
        "map_desc_placeholder": "설명 (선택)",
        "map_image_label": "이미지",
        "map_image_attach": "이미지 첨부",
        "map_video_label": "영상",
        "map_video_attach": "영상 첨부",
        "map_bind_title": "다른 아이콘/구역과 연결",
        "map_bind_button": "바인딩",
        "map_confirm_button": "확인",
        "map_delete_button_label": "삭제",
        "create_button": "생성",
        "create_folder_in_label": "생성 위치",
        "permission_title": "권한 설정",
        "permission_read_users": "읽기 사용자",
        "permission_read_groups": "읽기 그룹",
        "permission_write_users": "쓰기 사용자",
        "permission_write_groups": "쓰기 그룹",
        "url_share_button": "공유",
        "url_unshare_button": "Disable URL Sharing",
        "url_share_title": "공유",
        "url_share_enabled_label": "URL Sharing",
        "url_share_label": "URL",
        "url_share_copy_button": "복사",
        "url_share_copied": "복사됨",
        "job_queue_title": "작업 내역",
        "job_queue_empty": "작업 대기 없음",
        "job_status_queued": "대기 중",
        "job_status_uploading": "업로드 중",
        "job_status_done": "업로드 완료",
        "job_status_failed": "실패",
        "upload_error_file_too_large": "단일 용량 초과",
        "upload_error_timeout": "대기시간 초과",
        "upload_error_file_type_not_allowed": "업로드 불가능한 파일 형식",
        "permission_help": "읽기/쓰기 권한을 각각 독립적으로 설정합니다. 읽기 권한을 비워두면 누구나 읽을 수 있습니다.",
        "permission_save_button": "저장",
        "permission_loading": "불러오는 중...",
        "permission_empty_users": "표시할 사용자가 없습니다.",
        "permission_empty_groups": "표시할 그룹이 없습니다.",
        "permission_public_group_label": "전체",
        "public_write_badge": "전체 허용",
        "repository_badge": "Repository",
        "branch_badge": "Branch",
        "markdown_help_aria": "마크다운 문법 안내",
        "markdown_help_fallback_title": "마크다운 문법",
        "markdown_help_fallback_missing": "안내 파일을 찾을 수 없습니다.",
        "markdown_help_fallback_read_error": "문법 안내 파일을 읽을 수 없습니다.",
        "markdown_preview_aria": "마크다운 미리보기",
        "markdown_preview_loading": "미리보기를 불러오는 중...",
        "js_error_path_required": "경로를 입력해주세요.",
        "js_error_parent_path_not_allowed": "상위 경로(..)는 사용할 수 없습니다.",
        "js_error_request_failed": "요청 처리 중 오류가 발생했습니다.",
        "js_error_processing_failed": "처리 중 오류가 발생했습니다.",
        "js_confirm_delete_entry": "{path}",
        "js_confirm_delete_entries": "선택한 {count}개 항목을 삭제할까요?",
        "js_confirm_delete_repo_entry": "이 Repo를 삭제하면 Forgejo 저장소가 삭제되고 폴더는 내 루트 폴더로 이동합니다.\n{path}",
        "js_confirm_delete_repo_entries": "선택한 {count}개 항목 중 Repo를 삭제하면 Forgejo 저장소가 삭제되고 폴더는 각 사용자 루트 폴더로 이동합니다.",
        "js_permission_target_multiple": "{count}개 항목",
        "js_empty_documents": "파일이 없습니다.",
        "js_confirm_delete_doc": "이 파일을 삭제할까요?",
        "js_current_folder_label": "현재 폴더",
        "js_handrive_root_label": "HanDrive",
        "js_no_child_folders": "하위 폴더가 없습니다.",
        "js_filename_required": "파일명을 입력해주세요.",
        "js_extension_required": "확장자를 입력해주세요.",
        "js_extension_invalid": "확장자 형식이 올바르지 않습니다. 예: .md",
        "js_extension_not_allowed": "지원하지 않는 확장자입니다.",
        "js_select_or_create_folder": "저장 위치를 선택하거나 폴더를 먼저 생성해주세요.",
        "js_folder_name_required": "폴더 이름을 입력해주세요.",
        "js_invalid_selected_path": "선택 경로가 유효하지 않습니다. 목록에서 폴더를 선택해주세요.",
        "js_folder_create_requires_folder": "폴더에서만 새 폴더를 만들 수 있습니다.",
        "js_permission_save_failed": "권한 저장 중 오류가 발생했습니다.",
        "auth_login_button": "로그인",
        "auth_my_portfolio_button": "내 포트폴리오",
        "auth_logout_button": "로그아웃",
        "admin_button": "Admin",
        "ops_apply_static_and_restart_button": "Apply Static + Restart Gunicorn",
        "auth_login_title": "Hanplanet Login",
        "auth_username_label": "아이디",
        "auth_password_label": "비밀번호",
        "auth_login_submit": "로그인",
        "auth_signup_button": "회원가입",
        "auth_previous_page": "이전 페이지",
        "auth_signup_title": "Hanplanet Sign Up",
        "auth_signup_submit": "가입하기",
        "auth_name_label": "이름",
        "auth_email_label": "이메일 주소",
        "auth_password_confirm_label": "비밀번호 확인",
        "auth_privacy_consent_label": "개인정보 처리방침 및 이용약관에 동의합니다.",
        "auth_privacy_consent_error": "개인정보 처리방침 및 이용약관 동의가 필요합니다.",
        "auth_signup_error": "회원가입 정보를 확인해주세요.",
        "auth_login_error": "아이디 또는 비밀번호를 확인해주세요.",
        "auth_login_captcha_label": "캡챠 인증",
        "auth_login_captcha_hint": "아래 보안 인증을 완료해주세요.",
        "auth_login_captcha_placeholder": "정답 입력",
        "auth_login_captcha_error": "캡챠 인증에 실패했습니다. 다시 시도해주세요.",
        "auth_login_captcha_unavailable": "캡챠 설정이 준비되지 않았습니다. 관리자에게 문의해주세요.",
        "auth_logout_confirm": "로그아웃 하시겠습니까?",
        "auth_profile_label": "프로필",
        "auth_2fa_title": "이메일 인증",
        "auth_2fa_hint": "인증 코드가 아래 이메일로 발송되었습니다:",
        "auth_2fa_code_label": "인증 코드",
        "auth_2fa_code_placeholder": "6자리 코드 입력",
        "auth_2fa_submit": "확인",
        "auth_2fa_code_error": "인증 코드가 올바르지 않거나 만료되었습니다. 다시 확인해주세요.",
        "auth_2fa_email_send_error": "인증 코드 발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
        "auth_2fa_send_code_button": "인증번호 요청",
        "auth_2fa_verify_code_button": "확인",
        "auth_2fa_verified_label": "이메일 인증 완료",
        "auth_2fa_email_not_verified": "이메일 인증을 완료해주세요.",
        "auth_2fa_rate_limit": "잠시 후 다시 시도해주세요.",
        "auth_2fa_resend_button": "인증코드 재전송",
        "auth_2fa_resend_success": "인증 코드가 재전송되었습니다.",
        "auth_2fa_session_expired": "인증 세션이 만료되었습니다. 다시 로그인해주세요.",
        "auth_register_email_title": "이메일 등록",
        "auth_register_email_hint": "2차 인증을 위해 이메일 주소를 등록해주세요.",
        "auth_register_email_label": "이메일 주소",
        "auth_register_email_submit": "등록 및 인증 코드 받기",
        "auth_register_email_invalid": "올바른 이메일 주소를 입력해주세요.",
    },
    "en": {
        "list_title": "Files",
        "write_button": "Write",
        "help_button": "Help",
        "search_button": "Search",
        "search_placeholder": "Search files",
        "list_aria_label": "File list",
        "menu_open": "Open",
        "menu_download": "Download",
        "menu_upload": "Upload",
        "menu_rename": "Rename",
        "menu_permissions": "Permissions",
        "menu_edit": "Edit",
        "menu_delete": "Delete",
        "menu_create_repo": "Create Repo",
        "menu_manage_repo": "Manage Repo",
        "menu_delete_repo": "Delete Repo",
        "menu_change_icon": "Change Icon",
        "menu_extract_archive": "Extract",
        "menu_create_archive": "Compress",
        "menu_new_folder": "New Folder",
        "menu_new_document": "New File",
        "archive_extract_title": "Extract",
        "archive_extract_message": "Where should this archive be extracted?",
        "archive_extract_current_folder": "Here",
        "archive_extract_named_folder": "Into archive-name folder",
        "rename_title": "Rename",
        "commit_message_title": "Commit Message",
        "commit_message_label": "Message",
        "commit_message_placeholder": "Enter a commit message.",
        "clipboard_filename_title": "File Name",
        "clipboard_filename_label": "File name",
        "clipboard_filename_placeholder": "Leave blank to upload with the default file name.",
        "clipboard_filename_target_prefix": "Upload location",
        "clipboard_filename_target_root": "Upload location: HanDrive",
        "clipboard_filename_placeholder_with_default": "Leave blank to upload with the default file name.",
        "clipboard_filename_blank_default_prefix": "Leave blank to upload as ",
        "clipboard_filename_blank_default_suffix": ".",
        "rename_new_name": "New name",
        "rename_new_name_placeholder": "New name",
        "cancel": "Cancel",
        "upload_cancel": "Cancel Upload",
        "apply": "Apply",
        "edit_button": "Edit",
        "image_editor_save_ok": "Saved",
        "image_editor_save_error": "Save failed",
        "image_editor_saving": "Saving...",
        "image_editor_resize_title": "Resize",
        "image_editor_save_as_title": "Save As",
        "image_editor_resize_width": "Width",
        "image_editor_resize_height": "Height",
        "image_editor_resize_lock_ratio": "Lock ratio",
        "image_editor_unsaved_warning": "You have unsaved changes. Continue?",
        "delete_button": "Delete",
        "delete_repo_button": "Delete Repo",
        "download_button": "Download",
        "write_title_edit": "Edit File",
        "write_title_create": "New File",
        "markdown_guide_button": "Markdown Guide",
        "markdown_preview_button": "Preview",
        "markdown_snippet_aria": "Markdown quick insert",
        "markdown_snippet_heading2": "Heading 2",
        "markdown_snippet_heading3": "Heading 3",
        "markdown_snippet_bold": "Bold",
        "markdown_snippet_italic": "Italic",
        "markdown_snippet_link": "Link",
        "markdown_snippet_image": "Image",
        "markdown_snippet_code_inline": "Inline Code",
        "markdown_snippet_code_block": "Code Block",
        "markdown_snippet_list_bullet": "Bullet List",
        "markdown_snippet_list_numbered": "Numbered List",
        "markdown_snippet_list_check": "Checklist",
        "markdown_snippet_quote": "Quote",
        "markdown_snippet_divider": "Divider",
        "markdown_snippet_table": "Table",
        "editor_snippet_py_def": "Function Template",
        "editor_snippet_py_class": "Class Template",
        "editor_snippet_py_ifmain": "Run Block",
        "editor_snippet_py_comment": "Comment",
        "editor_snippet_js_function": "Function Template",
        "editor_snippet_js_if": "if 문",
        "editor_snippet_js_comment": "Comment",
        "editor_snippet_css_rule": "Selector Block",
        "editor_snippet_css_media": "Media Query",
        "editor_snippet_css_var": "CSS 변수",
        "editor_snippet_json_pair": "Key-Value Pair",
        "editor_snippet_json_object": "Object Template",
        "editor_snippet_html_basic": "HTML 기본 구조",
        "editor_snippet_html_div": "div 블록",
        "markdown_placeholder_heading": "Heading",
        "markdown_placeholder_bold": "bold text",
        "markdown_placeholder_italic": "italic text",
        "markdown_placeholder_link_text": "link text",
        "markdown_placeholder_image_alt": "image description",
        "markdown_placeholder_inline_code": "code",
        "markdown_placeholder_code_lang": "lang",
        "markdown_placeholder_code_body": "type your code",
        "markdown_placeholder_list_item": "item",
        "markdown_placeholder_quote": "quote",
        "markdown_placeholder_table_col1": "Item",
        "markdown_placeholder_table_col2": "Description",
        "save_button": "Save",
        "unsaved_changes_title": "Unsaved Changes",
        "unsaved_changes_message": "You have unsaved changes. Save before leaving?",
        "unsaved_changes_leave_button": "Continue",
        "unsaved_changes_save_button": "Save",
        "list_preview_title": "File Preview",
        "list_preview_empty": "Select a file to preview.",
        "list_preview_loading": "Loading preview...",
        "list_preview_error": "Failed to load preview.",
        "list_preview_unsupported": "Preview unavailable",
        "view_read_unsupported": "Read unavailable",
        "list_button": "List",
        "filename_label": "File name",
        "filename_placeholder": "Include extension",
        "save_filename_label": "File name",
        "save_filename_label_main": "File name",
        "save_filename_label_sub": "(with extension)",
        "save_filename_placeholder": "Include extension",
        "file_extension_label": "Extension",
        "file_extension_quick_label": "Extension quick pick",
        "file_extension_custom_option": "Custom input",
        "file_extension_placeholder": ".md",
        "zoom_out_button": "Zoom out",
        "zoom_in_button": "Zoom in",
        "content_label": "Content",
        "save_location_title": "Choose Save Location",
        "close_label": "Close",
        "up_button": "Up",
        "quick_paths_title": "Quick Paths",
        "folder_title": "Folders",
        "selected_path_label": "Selected Path",
        "selected_path_placeholder": "Select a path",
        "create_folder_button": "Create Folder",
        "save_confirm_button": "Save",
        "folder_modal_title": "Create Folder",
        "folder_name_label": "Folder name",
        "folder_name_placeholder": "Enter folder name",
        "branch_name_placeholder": "e.g. feature/my-work",
        "map_create_placeholder": "Enter map name",
        "folder_icon_title": "Change Icon",
        "folder_icon_file_label": "Choose image file",
        "folder_icon_delete_button": "Remove Icon",
        "git_repo_name_placeholder": "my-repo (letters, numbers, ., -, _)",
        "git_repo_create_title": "Create Git Repository",
        "git_repo_manage_title": "Manage Git Repository",
        "git_repo_name_label": "Repository name",
        "git_repo_linked": "Connected repository",
        "git_repo_creating": "Creating...",
        "git_repo_create_failed": "Create failed",
        "git_repo_retrying": "Retrying...",
        "git_repo_retry_failed": "Retry failed",
        "git_repo_status_error": "An error occurred while checking status.",
        "git_repo_load_failed": "Could not load repository information. Please refresh the page.",
        "git_repo_name_required": "Please enter a repository name.",
        "git_repo_request_failed": "Request failed",
        "git_repo_unknown_error": "Unknown error",
        "git_repo_copy_button": "Copy",
        "git_repo_copied_button": "Copied!",
        "git_repo_open_button": "Manage Page",
        "git_repo_retry_button": "Retry",
        "map_name_placeholder": "Enter a name",
        "map_marker_name_placeholder": "Marker name",
        "menu_create_map": "Create Map",
        "menu_git_create_branch": "Create Branch",
        "menu_git_delete_branch": "Delete Branch",
        "map_create_title": "Create Map",
        "map_create_name_label": "Map Name",
        "map_create_confirm": "Create Map",
        "branch_create_title": "Create Branch",
        "branch_create_name_label": "New Branch Name",
        "map_zone_title": "Enter Name",
        "map_clickable_title": "Clickable",
        "map_zone_icon_visible_title": "Show Icon/Zone",
        "map_marker_icon_visible_title": "Show Icon",
        "map_marker_title": "Marker Info",
        "map_name_label": "Name",
        "map_icon_label": "Icon",
        "map_desc_label": "Description",
        "map_desc_placeholder": "Description (optional)",
        "map_image_label": "Image",
        "map_image_attach": "Attach Image",
        "map_video_label": "Video",
        "map_video_attach": "Attach Video",
        "map_bind_title": "Link to another icon/zone",
        "map_bind_button": "Link",
        "map_confirm_button": "Confirm",
        "map_delete_button_label": "Delete",
        "create_button": "Create",
        "create_folder_in_label": "Create in",
        "permission_title": "Access Control",
        "permission_read_users": "Read Users",
        "permission_read_groups": "Read Groups",
        "permission_write_users": "Write Users",
        "permission_write_groups": "Write Groups",
        "url_share_button": "Share",
        "url_unshare_button": "Disable URL Sharing",
        "url_share_title": "Share",
        "url_share_enabled_label": "URL Sharing",
        "url_share_label": "URL",
        "url_share_copy_button": "Copy",
        "url_share_copied": "Copied",
        "job_queue_title": "Jobs",
        "job_queue_empty": "No pending jobs",
        "job_status_queued": "Queued",
        "job_status_uploading": "Uploading",
        "job_status_done": "Uploaded",
        "job_status_failed": "Failed",
        "queue_cancel": "Cancel",
        "queue_remove": "Remove from list",
        "queue_status_active": "In progress",
        "queue_status_pending": "Queued",
        "queue_status_delete_queued": "Delete queued",
        "queue_status_deleting": "Deleting",
        "queue_status_delete_done": "Deleted",
        "queue_status_move_queued": "Move queued",
        "queue_status_moving": "Moving",
        "queue_status_move_done": "Move complete",
        "queue_status_extract_queued": "Extract queued",
        "queue_status_extracting": "Extracting",
        "queue_status_extract_done": "Extract complete",
        "queue_status_archive_create_queued": "Compress queued",
        "queue_status_archive_creating": "Compressing",
        "queue_status_archive_create_done": "Compress complete",
        "upload_error_file_too_large": "File too large",
        "upload_error_timeout": "Upload timed out",
        "upload_error_file_type_not_allowed": "Unsupported file type",
        "permission_help": "Configure read and write independently. If read access is empty, everyone can read.",
        "permission_save_button": "Save",
        "permission_loading": "Loading...",
        "permission_empty_users": "No users to display.",
        "permission_empty_groups": "No groups to display.",
        "permission_public_group_label": "All",
        "public_write_badge": "Public Write",
        "repository_badge": "Repository",
        "branch_badge": "Branch",
        "markdown_help_aria": "Markdown syntax guide",
        "markdown_help_fallback_title": "Markdown Guide",
        "markdown_help_fallback_missing": "Guide file not found.",
        "markdown_help_fallback_read_error": "Failed to read the guide file.",
        "markdown_preview_aria": "Markdown preview",
        "markdown_preview_loading": "Loading preview...",
        "js_error_path_required": "Please enter a path.",
        "js_error_parent_path_not_allowed": "Parent path (..) is not allowed.",
        "js_error_request_failed": "Request failed while processing the request.",
        "js_error_processing_failed": "An error occurred while processing.",
        "js_confirm_delete_entry": "{path}",
        "js_confirm_delete_entries": "Delete {count} selected items?",
        "js_confirm_delete_repo_entry": "Deleting this Repo also deletes the Forgejo repository, then moves the folder back to your root folder.\n{path}",
        "js_confirm_delete_repo_entries": "Deleting Repo items among the selected {count} entries also deletes the Forgejo repositories, then moves each folder back to its user's root folder.",
        "js_permission_target_multiple": "{count} items",
        "js_empty_documents": "No files found.",
        "js_confirm_delete_doc": "Delete this file?",
        "js_current_folder_label": "Current folder",
        "js_handrive_root_label": "HanDrive",
        "js_no_child_folders": "No subfolders.",
        "js_filename_required": "Please enter a file name.",
        "js_extension_required": "Please enter a file extension.",
        "js_extension_invalid": "Invalid extension format. Example: .md",
        "js_extension_not_allowed": "Unsupported file extension.",
        "js_select_or_create_folder": "Select a save location or create a folder first.",
        "js_folder_name_required": "Please enter a folder name.",
        "js_invalid_selected_path": "Selected path is invalid. Please choose a folder from the list.",
        "js_folder_create_requires_folder": "New folders can only be created inside a folder.",
        "js_permission_save_failed": "Failed to save permissions.",
        "auth_login_button": "Login",
        "auth_my_portfolio_button": "My Portfolio",
        "auth_logout_button": "Logout",
        "admin_button": "Admin",
        "ops_apply_static_and_restart_button": "Apply Static + Restart Gunicorn",
        "auth_login_title": "Hanplanet Login",
        "auth_username_label": "Username",
        "auth_password_label": "Password",
        "auth_login_submit": "Login",
        "auth_signup_button": "Sign Up",
        "auth_previous_page": "Previous Page",
        "auth_signup_title": "Hanplanet Sign Up",
        "auth_signup_submit": "Create account",
        "auth_name_label": "Name",
        "auth_email_label": "Email address",
        "auth_password_confirm_label": "Confirm password",
        "auth_privacy_consent_label": "I agree to the Privacy Policy and Terms of Service.",
        "auth_privacy_consent_error": "You must agree to the Privacy Policy and Terms of Service.",
        "auth_signup_error": "Please check the sign up information.",
        "auth_login_error": "Please check your username or password.",
        "auth_login_captcha_label": "Captcha Verification",
        "auth_login_captcha_hint": "Complete the security verification below.",
        "auth_login_captcha_placeholder": "Enter answer",
        "auth_login_captcha_error": "Captcha verification failed. Please try again.",
        "auth_login_captcha_unavailable": "Captcha is not configured. Please contact the administrator.",
        "auth_logout_confirm": "Do you want to log out?",
        "auth_profile_label": "Profile",
        "auth_2fa_title": "Email Verification",
        "auth_2fa_hint": "A verification code was sent to:",
        "auth_2fa_code_label": "Verification Code",
        "auth_2fa_code_placeholder": "Enter 6-digit code",
        "auth_2fa_submit": "Verify",
        "auth_2fa_code_error": "The code is invalid or expired. Please check and try again.",
        "auth_2fa_email_send_error": "Failed to send the verification code. Please try again later.",
        "auth_2fa_send_code_button": "Send Code",
        "auth_2fa_verify_code_button": "Confirm",
        "auth_2fa_verified_label": "Email verified",
        "auth_2fa_email_not_verified": "Please verify your email address.",
        "auth_2fa_rate_limit": "Please wait a moment before trying again.",
        "auth_2fa_resend_button": "Resend Code",
        "auth_2fa_resend_success": "Verification code resent.",
        "auth_2fa_session_expired": "Session expired. Please log in again.",
        "auth_register_email_title": "Register Email",
        "auth_register_email_hint": "Please register an email address for two-factor authentication.",
        "auth_register_email_label": "Email address",
        "auth_register_email_submit": "Register & Get Verification Code",
        "auth_register_email_invalid": "Please enter a valid email address.",
    },
}


def get_handrive_text(ui_lang: str | None) -> dict:
    """UI 언어에 맞는 HanDrive 문자열 사본을 반환한다."""
    lang = (ui_lang or "").strip().lower()
    if lang not in DOCS_TEXT:
        lang = "ko"
    return DOCS_TEXT[lang].copy()


def _collect_allowed_return_hosts(request) -> set[str]:
    """Hanplanet 인증 흐름에서 next 파라미터로 허용할 호스트를 모은다."""
    allowed_hosts = {request.get_host()}

    for candidate in (
        getattr(settings, "PUBLIC_BASE_URL", ""),
        getattr(settings, "PUBLIC_GIT_BASE_URL", ""),
    ):
        parsed = urlparse(str(candidate or "").strip())
        if parsed.netloc:
            allowed_hosts.add(parsed.netloc)

    return {host for host in allowed_hosts if host}


def get_request_handrive_root_dir(request=None) -> Path:
    """요청 사용자 기준 HanDrive root 를 계산한다."""
    media_root = Path(settings.MEDIA_ROOT)
    root = media_root / "HanDrive"
    legacy_root = media_root / "docs"
    legacy_ide_root = media_root / "ide"
    # 기존 legacy 저장소를 HanDrive 로 자동 이전해 기존 파일 접근이 끊기지 않게 유지한다.
    if not root.exists() and legacy_root.exists():
        legacy_root.rename(root)
    if not root.exists() and legacy_ide_root.exists():
        legacy_ide_root.rename(root)
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def handrive_root_dir() -> Path:
    """현재 요청 기준 HanDrive 루트 디렉터리를 반환한다."""
    active_root = HANDRIVE_ACTIVE_ROOT_DIR.get()
    if active_root is not None:
        return active_root
    return get_request_handrive_root_dir()


def with_request_handrive_root(view_func):
    """요청 처리 동안 HanDrive root/request contextvar 를 주입한다."""
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        try:
            active_root = get_request_handrive_root_dir(request)
        except (OSError, PermissionError) as exc:
            return _storage_unavailable_response(request, exc)
        token = HANDRIVE_ACTIVE_ROOT_DIR.set(active_root)
        request_token = HANDRIVE_ACTIVE_REQUEST.set(request)
        try:
            return view_func(request, *args, **kwargs)
        finally:
            HANDRIVE_ACTIVE_ROOT_DIR.reset(token)
            HANDRIVE_ACTIVE_REQUEST.reset(request_token)

    return _wrapped


def normalize_relative_path(raw_path: str | None, allow_empty: bool = True) -> str:
    """사용자 입력 경로를 안전한 HanDrive 상대경로로 정규화한다."""
    value = (raw_path or "").strip().replace("\\", "/")
    value = value.strip("/")
    if not value:
        if allow_empty:
            return ""
        raise ValueError("경로를 입력해주세요.")

    parts = []
    for part in value.split("/"):
        stripped = part.strip()
        if not stripped or stripped == ".":
            continue
        if stripped == "..":
            raise ValueError("상위 경로(..)는 사용할 수 없습니다.")
        parts.append(stripped)

    normalized = "/".join(parts)
    if not normalized and not allow_empty:
        raise ValueError("경로를 입력해주세요.")
    return normalized


def resolve_path(relative_path: str | None, must_exist: bool = True) -> tuple[Path, str]:
    """상대경로를 현재 HanDrive root 아래 절대경로로 변환한다."""
    root = handrive_root_dir().resolve()
    normalized = normalize_relative_path(relative_path)
    candidate = (root / normalized).absolute()

    if candidate != root and root not in candidate.parents:
        raise ValueError("허용되지 않은 경로입니다.")

    if must_exist and not candidate.exists():
        raise FileNotFoundError("경로를 찾을 수 없습니다.")

    return candidate, normalized


def normalize_file_extension(extension: str | None, *, allow_empty: bool = False) -> str:
    """확장자를 ``.ext`` 형태로 정규화하고 허용 패턴을 검사한다."""
    candidate = (extension or "").strip().lower()
    if not candidate:
        if allow_empty:
            return ""
        return DOCS_FILE_EXTENSION
    if not candidate.startswith("."):
        candidate = f".{candidate}"
    if not re.fullmatch(r"\.[a-z0-9][a-z0-9._-]{0,15}", candidate):
        raise ValueError("확장자 형식이 올바르지 않습니다.")
    return candidate


def normalize_handrive_relative_path(raw_path: str | None, must_exist: bool = True) -> tuple[Path, str]:
    """HanDrive 일반 문서 경로를 정규화하고 기본 확장자를 보정한다."""
    normalized = normalize_relative_path(raw_path, allow_empty=False)
    normalized_path = Path(normalized)
    suffix = normalized_path.suffix.lower()
    normalized_name = normalized_path.name
    if not suffix:
        if must_exist:
            try:
                exact_path_obj, exact_rel_path = resolve_path(normalized, must_exist=True)
                if exact_path_obj.is_file():
                    return exact_path_obj, exact_rel_path
            except FileNotFoundError:
                pass
        if not normalized_name.startswith("."):
            normalized = f"{normalized}{DOCS_FILE_EXTENSION}"

    path_obj, rel_path = resolve_path(normalized, must_exist=must_exist)
    if must_exist:
        if not path_obj.is_file():
            raise FileNotFoundError("파일을 찾을 수 없습니다.")

    return path_obj, rel_path


def normalize_markdown_relative_path(raw_path: str | None, must_exist: bool = True) -> tuple[Path, str]:
    """Backward-compatible alias used across HanDrive views."""
    return normalize_handrive_relative_path(raw_path, must_exist=must_exist)


def validate_name(
    name: str | None,
    *,
    for_file: bool = False,
    file_extension: str | None = DOCS_FILE_EXTENSION,
) -> str:
    """새 파일/폴더 이름을 검증하고 저장 가능한 형태로 반환한다."""
    candidate = (name or "").strip()
    if not candidate:
        raise ValueError("이름을 입력해주세요.")
    if candidate in {".", ".."}:
        raise ValueError("사용할 수 없는 이름입니다.")
    if INVALID_NAME_PATTERN.search(candidate):
        raise ValueError("이름에 슬래시를 사용할 수 없습니다.")

    if for_file:
        normalized_extension = normalize_file_extension(file_extension)
        if candidate.lower().endswith(normalized_extension):
            candidate = candidate[: -len(normalized_extension)].strip()
            if not candidate:
                raise ValueError("파일명을 입력해주세요.")

    return candidate


def resolve_file_name_and_extension(
    name: str | None,
    *,
    fallback_extension: str | None = DOCS_FILE_EXTENSION,
) -> tuple[str, str]:
    """파일명 입력에서 stem과 extension을 분리한다.

    확장자가 명시되면 그 값을 우선하고, 없으면 fallback_extension을 붙인다.
    """
    candidate = (name or "").strip()
    if not candidate:
        raise ValueError("이름을 입력해주세요.")
    if candidate in {".", ".."}:
        raise ValueError("사용할 수 없는 이름입니다.")
    if INVALID_NAME_PATTERN.search(candidate):
        raise ValueError("이름에 슬래시를 사용할 수 없습니다.")

    ext_match = re.match(r"^(.*?)(\.[A-Za-z0-9]+)$", candidate)
    if ext_match and ext_match[1] and not ext_match[1].endswith("."):
        base_name = validate_name(ext_match[1].strip(), for_file=False)
        extension = normalize_file_extension(ext_match[2])
        return base_name, extension

    if candidate.endswith("."):
        raise ValueError("확장자 형식이 올바르지 않습니다. 예: .md")

    base_name = validate_name(candidate, for_file=False)
    extension = normalize_file_extension(fallback_extension)
    return base_name, extension


def build_available_upload_path(parent_dir: Path, original_name: str) -> Path:
    """동일 이름 충돌이 없도록 업로드 대상 파일 경로를 계산한다."""
    raw_name = (original_name or "").strip()
    if not raw_name:
        raise ValueError("업로드할 파일 이름이 올바르지 않습니다.")

    suffix = Path(raw_name).suffix.lower()
    normalized_extension = normalize_file_extension(suffix, allow_empty=True)
    if normalized_extension:
        base_name = validate_name(
            raw_name,
            for_file=True,
            file_extension=normalized_extension,
        )
    else:
        base_name = validate_name(raw_name, for_file=False)

    candidate = parent_dir / f"{base_name}{normalized_extension}"
    if not candidate.exists():
        return candidate

    index = 2
    while True:
        candidate = parent_dir / f"{base_name} ({index}){normalized_extension}"
        if not candidate.exists():
            return candidate
        index += 1


def get_handrive_upload_tmp_dir() -> Path:
    """업로드 임시 파일 저장 디렉터리를 반환한다."""
    temp_dir = Path(tempfile.gettempdir()) / "hanplanet_handrive_uploads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    return temp_dir


def relative_from_root(path_obj: Path) -> str:
    """HanDrive root 기준 상대경로를 ``posix`` 문자열로 돌려준다."""
    root = handrive_root_dir().resolve()
    absolute_path = path_obj.absolute()
    try:
        return absolute_path.relative_to(root).as_posix()
    except ValueError:
        return path_obj.resolve().relative_to(root).as_posix()


def markdown_slug_from_relative(relative_path: str) -> str:
    """문서 상대경로에서 기본 마크다운 확장자를 제거한 slug 를 만든다."""
    if relative_path.lower().endswith(DOCS_FILE_EXTENSION):
        return relative_path[: -len(DOCS_FILE_EXTENSION)]
    return relative_path


def is_handrive_supported_archive_path(path_obj_or_name) -> bool:
    return Path(str(path_obj_or_name or "")).suffix.lower() in HANDRIVE_SUPPORTED_ARCHIVE_EXTENSIONS


def build_archive_virtual_path(archive_relative_path: str, inner_path: str = "") -> str:
    archive_relative = normalize_relative_path(archive_relative_path, allow_empty=False)
    token = base64.urlsafe_b64encode(archive_relative.encode("utf-8")).decode("ascii").rstrip("=")
    normalized_inner = normalize_relative_path(inner_path, allow_empty=True)
    if normalized_inner:
        return f"{HANDRIVE_ARCHIVE_VIRTUAL_PREFIX}/{token}/{normalized_inner}"
    return f"{HANDRIVE_ARCHIVE_VIRTUAL_PREFIX}/{token}"


def parse_archive_virtual_path(path_value: str | None) -> tuple[str, str] | None:
    normalized = normalize_relative_path(path_value, allow_empty=True)
    prefix = f"{HANDRIVE_ARCHIVE_VIRTUAL_PREFIX}/"
    if not normalized.startswith(prefix):
        return None
    remainder = normalized[len(prefix):]
    token, _, inner = remainder.partition("/")
    if not token:
        raise ValueError("압축파일 경로가 올바르지 않습니다.")
    padded_token = token + ("=" * (-len(token) % 4))
    try:
        archive_relative = normalize_relative_path(
            base64.urlsafe_b64decode(padded_token.encode("ascii")).decode("utf-8"),
            allow_empty=False,
        )
    except (ValueError, UnicodeDecodeError, binascii.Error):
        raise ValueError("압축파일 경로가 올바르지 않습니다.")
    inner_path = normalize_relative_path(inner, allow_empty=True)
    return archive_relative, inner_path


def normalize_archive_member_name(member_name: str | None) -> str:
    value = str(member_name or "").replace("\\", "/").lstrip("/")
    parts = []
    for part in value.split("/"):
        stripped = part.strip()
        if not stripped or stripped == ".":
            continue
        if stripped == "..":
            return ""
        parts.append(stripped)
    return "/".join(parts)


def build_archive_directory_meta(request, archive_relative: str, inner_path: str, entries: list[dict]) -> dict:
    normalized_inner = normalize_relative_path(inner_path, allow_empty=True)
    virtual_path = build_archive_virtual_path(archive_relative, normalized_inner)
    archive_path, _ = resolve_path(archive_relative, must_exist=True)
    modified_display = ""
    try:
        modified_display = format_handrive_modified_display_from_timestamp(archive_path.stat().st_mtime)
    except OSError:
        pass
    return {
        "path": virtual_path,
        "is_root": False,
        "can_edit": False,
        "can_write_children": False,
        "has_children": bool(entries),
        "is_git_repo_root": False,
        "requires_commit_message": False,
        "git_branch_root": False,
        "git_commit_message": "",
        "git_commit_author_username": "",
        "modified_display": modified_display,
        "size_display": "",
        "git_repo": None,
        "is_archive_virtual": True,
        "archive_path": archive_relative,
        "archive_member_path": normalized_inner,
    }


def list_archive_entries(archive_path: Path, archive_relative: str, inner_path: str, request=None) -> list[dict]:
    normalized_inner = normalize_archive_member_name(inner_path)
    prefix = f"{normalized_inner}/" if normalized_inner else ""
    children: dict[str, dict] = {}

    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            member_name = normalize_archive_member_name(info.filename)
            if not member_name or (normalized_inner and member_name != normalized_inner and not member_name.startswith(prefix)):
                continue
            remainder = member_name[len(prefix):] if prefix else member_name
            if not remainder:
                continue
            child_name, _, child_rest = remainder.partition("/")
            child_member_path = f"{prefix}{child_name}" if prefix else child_name
            is_dir = bool(child_rest) or info.is_dir()
            existing = children.get(child_name)
            if existing is None:
                entry = {
                    "name": child_name,
                    "path": build_archive_virtual_path(archive_relative, child_member_path),
                    "type": "dir" if is_dir else "file",
                    "modified_display": format_handrive_modified_display(datetime(*info.date_time)),
                    "can_edit": False,
                    "can_write_children": False,
                    "can_delete": False,
                    "is_public_write": False,
                    "is_url_only": False,
                    "write_acl_labels": [],
                    "share_url": "",
                    "share_is_inherited": False,
                    "is_archive_member": True,
                    "can_extract": True,
                    "archive_path": archive_relative,
                    "archive_member_path": child_member_path,
                    "has_children": is_dir,
                }
                if not is_dir:
                    entry["size_display"] = format_handrive_bytes_display(info.file_size)
                children[child_name] = entry
            else:
                existing["has_children"] = bool(existing.get("has_children") or is_dir)
                if is_dir:
                    existing["type"] = "dir"

    return sorted(children.values(), key=lambda item: (0 if item.get("type") == "dir" else 1, item.get("name", "").lower()))


def build_available_archive_directory_path(parent_dir: Path, raw_name: str) -> Path:
    base_name = validate_name(raw_name or "archive", for_file=False)
    candidate = parent_dir / base_name
    if not candidate.exists():
        return candidate
    index = 2
    while True:
        candidate = parent_dir / f"{base_name} ({index})"
        if not candidate.exists():
            return candidate
        index += 1


def build_available_archive_file_path(parent_dir: Path, raw_stem: str) -> Path:
    base_name = validate_name(raw_stem or "archive", for_file=False)
    candidate = parent_dir / f"{base_name}.zip"
    if not candidate.exists():
        return candidate
    index = 2
    while True:
        candidate = parent_dir / f"{base_name} ({index}).zip"
        if not candidate.exists():
            return candidate
        index += 1


def render_plain_text_safely(text: str) -> str:
    """plain text 를 안전한 ``pre/code`` HTML 로 감싼다."""
    escaped_text = escape(text or "")
    return mark_safe(f"<pre><code>{escaped_text}</code></pre>")


_HANDRIVE_UNSUPPORTED_ICON_URLS: dict[str, str] = {
    ".exe": "/static/media/icons/handrive/exe.svg",
}

_HANDRIVE_UNSUPPORTED_GENERIC_ICON = (
    '<svg class="handrive-unsupported-icon" viewBox="0 0 24 24" width="48" height="48"'
    ' fill="none" stroke="currentColor" stroke-width="1.5"'
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
    '<polyline points="14,2 14,8 20,8"/>'
    "</svg>"
)

_HANDRIVE_GENERIC_FILE_ICON_KEYS = {
    "file",
    "image",
    "video",
    "audio",
    "archive",
    "pdf",
    "text",
    "word",
    "excel",
    "powerpoint",
    "data",
    "code",
    "json",
    "markdown",
    "font",
}


def get_handrive_file_icon_key(path_value: str) -> str:
    """목록과 동일한 파일 아이콘 키를 서버 렌더에서도 재사용한다."""
    extension = Path(str(path_value or "")).suffix.lower()
    if not extension:
        return "file"
    if extension in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif", ".heic"}:
        return "image"
    if extension in {".mp4", ".mov", ".webm", ".mkv", ".avi", ".wmv", ".m4v"}:
        return "video"
    if extension in {".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"}:
        return "audio"
    if extension in {".zip", ".7z", ".rar", ".tar", ".gz", ".bz2", ".xz"}:
        return "archive"
    if extension == ".pdf":
        return "pdf"
    if extension in {".md", ".txt", ".rtf"}:
        return "text"
    if extension in {".doc", ".docx"}:
        return "word"
    if extension in {".xls", ".xlsx"}:
        return "excel"
    if extension in {".ppt", ".pptx"}:
        return "powerpoint"
    if extension == ".json":
        return "json"
    if extension in {".js", ".mjs", ".cjs"}:
        return "js"
    if extension in {".ts", ".tsx"}:
        return "ts"
    if extension == ".jsx":
        return "jsx"
    if extension == ".py":
        return "py"
    if extension == ".java":
        return "java"
    if extension == ".kt":
        return "kotlin"
    if extension == ".swift":
        return "swift"
    if extension == ".go":
        return "go"
    if extension == ".rs":
        return "rust"
    if extension == ".rb":
        return "ruby"
    if extension == ".php":
        return "php"
    if extension == ".c":
        return "c"
    if extension in {".cpp", ".hpp", ".h"}:
        return "cpp"
    if extension == ".cs":
        return "csharp"
    if extension == ".scala":
        return "scala"
    if extension == ".sql":
        return "data"
    if extension in {".sh", ".zsh", ".bash"}:
        return "shell"
    if extension in {".html", ".htm"}:
        return "html"
    if extension in {".css", ".scss", ".sass", ".less"}:
        return "css"
    if extension == ".md":
        return "markdown"
    if extension in {".lua", ".dart", ".elm", ".ex", ".exs", ".erl", ".fs", ".fsx", ".groovy", ".jl", ".nim", ".pl", ".r", ".vb"}:
        return "code"
    if extension in {".ttf", ".otf", ".woff", ".woff2"}:
        return "font"
    if extension == ".exe":
        return "exe"
    return "file"


def render_handrive_unsupported_safely(
    file_name: str,
    file_extension: str = "",
    *,
    message: str = "미리보기 미지원",
) -> str:
    """지원하지 않는 파일 형식을 아이콘 + 파일명 + 안내 문구로 표시하는 HTML 조각을 반환한다."""
    escaped_name = escape(str(file_name))
    escaped_message = escape(str(message or ""))
    icon_key = get_handrive_file_icon_key(f"unsupported{file_extension or ''}")
    icon_classes = "handrive-item-type-icon handrive-unsupported-file-icon is-file"
    if icon_key in _HANDRIVE_GENERIC_FILE_ICON_KEYS:
        icon_classes += " is-generic"
    icon_html = (
        f'<span class="{icon_classes}" data-file-icon="{escape(icon_key)}" aria-hidden="true"></span>'
    )
    return mark_safe(
        f'<div class="handrive-unsupported-file">'
        f"{icon_html}"
        f'<span class="handrive-unsupported-name">{escaped_name}</span>'
        f'<span class="handrive-unsupported-message">{escaped_message}</span>'
        f"</div>"
    )


def build_handrive_download_url(relative_path: str, share_owner: str = "", share_slug: str = "") -> str:
    """문서/공유문서 다운로드 API URL 을 생성한다."""
    encoded_path = quote(relative_path or "")
    url = f"{reverse('main:handrive_api_download')}?path={encoded_path}"
    if share_owner and share_slug:
        url += f"&share_owner={quote(share_owner)}&share_slug={quote(share_slug)}"
    return url


def render_handrive_media_safely(source_path: Path, relative_path: str, share_owner: str = "", share_slug: str = "") -> str:
    """이미지·비디오·오디오 파일을 HanDrive 미리보기용 HTML로 감싼다."""
    source_url = escape(build_handrive_download_url(relative_path, share_owner=share_owner, share_slug=share_slug))
    extension = source_path.suffix.lower()
    if extension in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif"}:
        return mark_safe(
            '<div class="handrive-media-wrap handrive-media-image-wrap">'
            f'<img class="handrive-media-element handrive-media-image-element" src="{source_url}" alt="{escape(source_path.name)}" loading="eager">'
            "</div>"
        )
    if extension in {".mp4", ".webm", ".mov", ".mkv", ".m4v", ".ogv"}:
        return mark_safe(
            '<div class="handrive-media-wrap handrive-media-video-wrap">'
            f'<video class="handrive-media-element handrive-media-video-element" src="{source_url}" controls preload="metadata"></video>'
            "</div>"
        )
    return mark_safe(
        '<div class="handrive-media-wrap handrive-media-audio-wrap">'
        f'<audio class="handrive-media-element handrive-media-audio-element" src="{source_url}" controls preload="metadata"></audio>'
        "</div>"
    )


def load_handrive_html_companion_assets(source_path: Path, request=None) -> tuple[str, str]:
    """일반 HTML 파일과 같은 이름의 css/js companion asset 을 읽는다."""
    def _can_read(asset_path: Path) -> bool:
        if request is None:
            return True
        try:
            asset_relative_path = relative_from_root(asset_path)
        except (ValueError, OSError):
            return False
        return has_handrive_read_access(request, asset_relative_path)

    return load_local_html_companion_assets(source_path, can_read_path=_can_read)


def load_git_repo_html_companion_assets(request, repo, branch_name: str, repo_relative_path: str) -> tuple[str, str]:
    """repo branch 내부 HTML 파일의 companion css/js asset 을 읽는다."""
    normalized_relative = normalize_relative_path(repo_relative_path, allow_empty=False)
    del request

    def _path_exists(path_value: str) -> bool:
        return _git_repo_path_exists(repo, branch_name, path_value)

    def _read_text(path_value: str) -> str:
        try:
            return _git_repo_read_file_bytes(repo, branch_name, path_value).decode("utf-8")
        except (OSError, UnicodeDecodeError):
            return ""

    return load_repo_html_companion_assets(
        normalized_relative,
        path_exists=_path_exists,
        read_text_file=_read_text,
    )


def resolve_handrive_render_profile(file_extension: str | None) -> dict[str, str]:
    """확장자별 preview render mode 와 CSS class 조합을 반환한다."""
    try:
        normalized_extension = normalize_file_extension(file_extension, allow_empty=True)
    except ValueError:
        normalized_extension = ""
    if not normalized_extension:
        normalized_extension = DOCS_FILE_EXTENSION

    extension_profile = DOCS_RENDER_PROFILES_BY_EXTENSION.get(normalized_extension)
    if not extension_profile:
        extension_profile = DOCS_DEFAULT_RENDER_PROFILE

    return {
        "extension": normalized_extension,
        "mode": extension_profile["mode"],
        "css_class": extension_profile["css_class"],
    }


def get_handrive_save_extension_options() -> list[str]:
    """쓰기 화면의 빠른 확장자 선택 목록을 만든다."""
    options = []
    for extension, profile in DOCS_RENDER_PROFILES_BY_EXTENSION.items():
        if (
            profile.get("mode") == DOCS_RENDER_MODE_MARKDOWN
            or profile.get("css_class") != "handrive-plain-text"
        ):
            options.append(extension)

    if DOCS_FILE_EXTENSION in options:
        ordered = [DOCS_FILE_EXTENSION]
        ordered.extend(sorted(ext for ext in options if ext != DOCS_FILE_EXTENSION))
        return ordered
    return sorted(options)


def render_handrive_content(
    content: str,
    file_extension: str | None,
    *,
    source_path: Path | None = None,
    source_bytes: bytes | None = None,
    companion_css: str = "",
    companion_js: str = "",
    relative_path: str = "",
    request=None,
    share_owner: str = "",
    share_slug: str = "",
) -> tuple[str, dict[str, str]]:
    """파일 확장자에 맞는 미리보기 렌더러를 선택한다.

    markdown/plain text/media/office 렌더 경로를 한곳에서 통합하고,
    필요하면 source bytes 와 HTML companion asset 도 함께 사용한다.
    """
    if request is not None and not (share_owner and share_slug):
        shared_context = get_handrive_shared_access_context(request)
        if shared_context:
            share_owner = shared_context["owner_username"]
            share_slug = shared_context["share_slug"]
    profile = resolve_handrive_render_profile(file_extension)
    if profile["css_class"] == "handrive-html":
        resolved_companion_css = companion_css or ""
        resolved_companion_js = companion_js or ""
        if source_path is not None and not (resolved_companion_css or resolved_companion_js):
            resolved_companion_css, resolved_companion_js = load_handrive_html_companion_assets(source_path, request=request)
        rendered = render_handrive_html_live_safely(
            content,
            companion_css=resolved_companion_css,
            companion_js=resolved_companion_js,
        )
    elif profile["mode"] == DOCS_RENDER_MODE_PDF:
        file_name = source_path.name if source_path is not None else "preview.pdf"
        if relative_path:
            encoded_path = quote(relative_path)
            pdf_url = f"{reverse('main:handrive_api_pdf_preview')}?path={encoded_path}"
            if share_owner and share_slug:
                pdf_url += f"&share_owner={quote(share_owner)}&share_slug={quote(share_slug)}"
        else:
            pdf_url = ""
        rendered = render_handrive_pdf_safely(b"", file_name=file_name, pdf_url=pdf_url)
    elif profile["mode"] == DOCS_RENDER_MODE_OFFICE:
        office_bytes = source_bytes
        if office_bytes is None and source_path is not None:
            try:
                office_bytes = source_path.read_bytes()
            except OSError:
                office_bytes = b""
        rendered = render_handrive_office_preview_safely(profile["extension"], office_bytes or b"")
    elif profile["mode"] == DOCS_RENDER_MODE_MARKDOWN:
        rendered = render_markdown_safely(content)
    elif profile["mode"] in {
        DOCS_RENDER_MODE_MEDIA_IMAGE,
        DOCS_RENDER_MODE_MEDIA_VIDEO,
        DOCS_RENDER_MODE_MEDIA_AUDIO,
    } and source_path is not None:
        rendered = render_handrive_media_safely(source_path, relative_path, share_owner=share_owner, share_slug=share_slug)
    else:
        rendered = render_plain_text_safely(content)
    return str(rendered), profile


def is_handrive_non_editable_media_extension(file_extension: str | None) -> bool:
    """에디터 대신 전용 preview 를 써야 하는 확장자인지 판별한다."""
    return resolve_handrive_render_profile(file_extension).get("mode") in DOCS_NON_EDITABLE_MEDIA_MODES


def load_handrive_source_content(file_path: Path, *, request=None, relative_path: str = "") -> str:
    """편집 가능한 텍스트 파일의 원본 내용을 읽는다."""
    if is_handrive_non_editable_media_extension(file_path.suffix.lower()):
        return ""
    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        if request is not None:
            raise Http404("파일을 읽을 수 없습니다.")
        raise


def decode_handrive_text_bytes(source_bytes: bytes, *, request=None, relative_path: str = "") -> str:
    """UTF-8 텍스트로 읽을 수 없는 바이너리 파일은 읽기 미지원으로 처리한다."""
    try:
        return (source_bytes or b"").decode("utf-8")
    except UnicodeDecodeError:
        if request is not None:
            raise Http404("파일을 읽을 수 없습니다.")
        raise


def build_entry(path_obj: Path) -> dict:
    """filesystem 경로를 list API 엔트리 dict 로 직렬화한다."""
    rel_path = relative_from_root(path_obj)
    is_dir = path_obj.is_dir()
    data = {
        "name": path_obj.name,
        "path": rel_path,
        "type": "dir" if is_dir else "file",
        "modified_display": "",
    }
    try:
        stat_result = path_obj.stat()
    except OSError:
        stat_result = None
    if stat_result is not None:
        data["modified_display"] = format_handrive_modified_display_from_timestamp(stat_result.st_mtime)

    if is_dir:
        try:
            data["has_children"] = any(path_obj.iterdir())
        except OSError:
            data["has_children"] = False
        try:
            total_bytes = sum(
                child.stat().st_size
                for child in path_obj.rglob("*")
                if child.is_file()
            )
            data["size_display"] = format_handrive_bytes_display(total_bytes)
        except OSError:
            data["size_display"] = ""
        map_meta_file = path_obj / MAP_META_FILENAME
        if map_meta_file.is_file():
            try:
                meta = json.loads(map_meta_file.read_text(encoding="utf-8"))
                if meta.get("type") == "map":
                    data["is_map_folder"] = True
                    data["map_base_image"] = meta.get("base_image", "")
            except Exception:
                pass
    else:
        data["slug_path"] = markdown_slug_from_relative(rel_path)
        try:
            data["size_display"] = format_handrive_bytes_display(stat_result.st_size if stat_result is not None else path_obj.stat().st_size)
        except OSError:
            data["size_display"] = ""

    return data


def build_acl_candidate_paths(path_value: str | None) -> list[str]:
    """한 경로에 적용 가능한 상위 ACL 후보 경로들을 반환한다."""
    normalized = normalize_relative_path(path_value, allow_empty=True)
    if not normalized:
        return [""]

    candidates = [normalized]
    parts = normalized.split("/")
    while len(parts) > 1:
        parts = parts[:-1]
        candidates.append("/".join(parts))
    candidates.append("")
    return candidates


def get_handrive_acl_rule_map(request) -> dict[str, HandriveAccessRule]:
    """요청 단위 ACL rule 캐시 맵을 반환한다."""
    rule_map = getattr(request, "_handrive_acl_rule_map", None)
    if rule_map is None:
        rules = HandriveAccessRule.objects.prefetch_related(
            "read_users",
            "read_groups",
            "write_users",
            "write_groups",
        ).all()
        rule_map = {rule.path: rule for rule in rules}
        setattr(request, "_handrive_acl_rule_map", rule_map)
    return rule_map


def get_effective_handrive_acl_rule(request, path_value: str | None) -> tuple[HandriveAccessRule | None, str]:
    """경로에 실제 적용되는 가장 가까운 ACL rule 을 찾는다."""
    normalized = normalize_relative_path(path_value, allow_empty=True)
    cache = getattr(request, "_handrive_acl_effective_cache", None)
    if cache is None:
        cache = {}
        setattr(request, "_handrive_acl_effective_cache", cache)
    if normalized in cache:
        return cache[normalized]

    rule_map = get_handrive_acl_rule_map(request)
    for candidate in build_acl_candidate_paths(normalized):
        rule = rule_map.get(candidate)
        if rule is not None:
            cache[normalized] = (rule, candidate)
            return rule, candidate

    cache[normalized] = (None, "")
    return None, ""


def has_descendant_handrive_acl_rule(request, path_value: str | None) -> bool:
    """하위 트리에 별도 ACL rule 이 존재하는지 확인한다."""
    normalized = normalize_relative_path(path_value, allow_empty=True)

    cache = getattr(request, "_handrive_acl_descendant_rule_cache", None)
    if cache is None:
        cache = {}
        setattr(request, "_handrive_acl_descendant_rule_cache", cache)
    if normalized in cache:
        return cache[normalized]

    rule_map = get_handrive_acl_rule_map(request)
    if not normalized:
        has_descendant_rule = any(rule_path != "" for rule_path in rule_map.keys())
        cache[normalized] = has_descendant_rule
        return has_descendant_rule

    prefix = normalized + "/"
    has_descendant_rule = any(rule_path.startswith(prefix) for rule_path in rule_map.keys())
    cache[normalized] = has_descendant_rule
    return has_descendant_rule


def get_handrive_public_write_group() -> Group:
    """공개 쓰기 pseudo-group 을 보장하고 반환한다."""
    group, _ = Group.objects.get_or_create(name=DOCS_PUBLIC_WRITE_GROUP_NAME)
    return group


def rule_has_public_group(rule: HandriveAccessRule, group_relation: str) -> bool:
    """ACL rule relation 안에 public-write marker group 이 있는지 검사한다."""
    groups = getattr(rule, group_relation).all()
    return any(group.name == DOCS_PUBLIC_WRITE_GROUP_NAME for group in groups)


def get_public_group_display_label(request) -> str:
    """UI 언어에 맞는 공개 그룹 표시 라벨을 캐시해 반환한다."""
    cached = getattr(request, "_handrive_public_group_display_label", None)
    if isinstance(cached, str) and cached:
        return cached
    handrive_text = get_handrive_text(resolve_ui_lang(request, None))
    label = handrive_text.get("permission_public_group_label", "전체")
    setattr(request, "_handrive_public_group_display_label", label)
    return label


def is_handrive_public_write_enabled(request, path_value: str | None) -> bool:
    """주어진 경로에 public-write ACL 이 적용되는지 확인한다."""
    rule, _ = get_effective_handrive_acl_rule(request, path_value)
    if rule is None:
        return False
    return rule_has_public_group(rule, "write_groups")


def is_handrive_url_only_enabled(request, path_value: str | None) -> bool:
    """URL-only 그룹으로 제한된 경로인지 확인한다."""
    rule, _ = get_effective_handrive_acl_rule(request, path_value)
    if rule is None:
        return False
    return any(group.name == DOCS_URL_ONLY_GROUP_NAME for group in rule.read_groups.all()) or any(
        group.name == DOCS_URL_ONLY_GROUP_NAME for group in rule.write_groups.all()
    )


def get_handrive_shared_access_context(request):
    """현재 요청이 유효한 HanDrive 공유 링크 컨텍스트인지 반환한다."""
    cached = getattr(request, "_handrive_shared_access_context", None)
    if cached is not None:
        return cached

    owner_username = str(
        getattr(request, "_handrive_shared_owner_username", "")
        or request.GET.get("share_owner", "")
        or ""
    ).strip()
    share_slug = str(
        getattr(request, "_handrive_shared_slug", "")
        or request.GET.get("share_slug", "")
        or ""
    ).strip()

    if not owner_username or not share_slug:
        setattr(request, "_handrive_shared_access_context", False)
        return None

    shared_link = HandriveSharedLink.objects.select_related("owner").filter(
        owner__username=owner_username,
        share_slug=share_slug,
    ).first()
    if shared_link is None or not is_handrive_url_only_enabled(request, shared_link.path):
        setattr(request, "_handrive_shared_access_context", False)
        return None

    try:
        target_path, normalized_path = resolve_path(shared_link.path, must_exist=True)
    except (ValueError, FileNotFoundError):
        shared_link.delete()
        setattr(request, "_handrive_shared_access_context", False)
        return None

    context = {
        "owner_username": owner_username,
        "share_slug": share_slug,
        "shared_link": shared_link,
        "root_path": normalized_path,
        "target_path": target_path,
        "is_dir": target_path.is_dir(),
    }
    setattr(request, "_handrive_shared_access_context", context)
    return context


def has_handrive_shared_read_access(request, path_value: str | None) -> bool:
    """공유 링크 컨텍스트에서 현재 경로 읽기가 허용되는지 판정한다."""
    shared_context = get_handrive_shared_access_context(request)
    if not shared_context:
        return False

    normalized_path = normalize_relative_path(path_value, allow_empty=True)
    shared_root = str(shared_context["root_path"] or "").strip()
    if not shared_root:
        return False
    if normalized_path == shared_root:
        return True
    if not shared_context["is_dir"]:
        return False
    return normalized_path.startswith(shared_root + "/")


def get_write_acl_display_labels(request, path_value: str | None) -> list[str]:
    """쓰기 권한 배지에 노출할 사용자/그룹 라벨을 만든다."""
    rule, _ = get_effective_handrive_acl_rule(request, path_value)
    if rule is None:
        return []

    labels = []
    group_names = sorted(
        {
            group.name
            for group in rule.write_groups.all()
            if group.name and group.name != DOCS_PUBLIC_WRITE_GROUP_NAME
        },
        key=lambda value: value.lower(),
    )
    user_names = sorted(
        {
            user.get_username()
            for user in rule.write_users.all()
            if user.get_username()
        },
        key=lambda value: value.lower(),
    )

    labels.extend(f"#{group_name}" for group_name in group_names)
    labels.extend(f"@{username}" for username in user_names)
    return labels


def get_request_user_group_ids(request) -> set[int]:
    """현재 요청 사용자의 group id 집합을 캐시해 반환한다."""
    cached = getattr(request, "_handrive_acl_user_group_ids", None)
    if cached is not None:
        return cached

    user = getattr(request, "user", None)
    if not (user and user.is_authenticated):
        cached = set()
    else:
        cached = set(user.groups.values_list("id", flat=True))
    setattr(request, "_handrive_acl_user_group_ids", cached)
    return cached


def user_matches_handrive_acl_rule(
    request,
    rule: HandriveAccessRule,
    *,
    user_relation: str,
    group_relation: str,
) -> bool:
    """사용자가 특정 ACL rule 의 user/group relation 에 포함되는지 판정한다."""
    user = getattr(request, "user", None)
    if user and user.is_superuser:
        return True
    if not (user and user.is_authenticated):
        return False

    user_id = getattr(user, "id", None)
    allowed_users = getattr(rule, user_relation).all()
    if user_id and any(allowed_user.id == user_id for allowed_user in allowed_users):
        return True

    user_group_ids = get_request_user_group_ids(request)
    if not user_group_ids:
        return False

    allowed_groups = getattr(rule, group_relation).all()
    rule_group_ids = {group.id for group in allowed_groups}
    return bool(user_group_ids & rule_group_ids)


def has_handrive_read_access(request, path_value: str | None) -> bool:
    """주어진 경로를 읽을 수 있는지 최종 판정한다."""
    if has_handrive_shared_read_access(request, path_value):
        return True
    user = getattr(request, "user", None)
    if user and user.is_superuser:
        return True
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    normalized_path = normalize_relative_path(path_value, allow_empty=True)
    if not is_path_in_handrive_scope(normalized_path, scoped_home_dir):
        return False
    if scoped_home_dir:
        return True

    if is_handrive_acl_admin(request):
        return True

    rule, _ = get_effective_handrive_acl_rule(request, path_value)
    if rule is None:
        return True
    if rule_has_public_group(rule, "read_groups"):
        return True

    read_user_ids = {user.id for user in rule.read_users.all()}
    read_group_ids = {
        group.id
        for group in rule.read_groups.all()
        if group.name not in {DOCS_PUBLIC_WRITE_GROUP_NAME, DOCS_URL_ONLY_GROUP_NAME}
    }
    has_url_only_share = any(group.name == DOCS_URL_ONLY_GROUP_NAME for group in rule.read_groups.all())

    if not read_user_ids and not read_group_ids:
        return not has_url_only_share

    if user and user.is_authenticated and user.id in read_user_ids:
        return True

    user_group_ids = get_request_user_group_ids(request)
    if not user_group_ids:
        return False
    return bool(user_group_ids & read_group_ids)


def has_handrive_write_access(request, path_value: str | None) -> bool:
    """파일 단위 쓰기 권한을 판정한다."""
    user = getattr(request, "user", None)
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    normalized_path = normalize_relative_path(path_value, allow_empty=True)
    git_virtual = _get_git_virtual_context(request, normalized_path)
    if git_virtual is not None:
        return git_virtual["kind"] == "branch_file" and str(git_virtual.get("repo_permission") or "").lower() in {"write", "admin", "owner"}
    if is_handrive_git_repo_mounted_path(request, normalized_path):
        return False
    if user and user.is_superuser:
        return True
    is_scoped_public_user = bool(scoped_home_dir and is_public_group_scoped_user(request))
    in_scoped_home = is_path_in_handrive_scope(normalized_path, scoped_home_dir)
    if is_scoped_public_user and in_scoped_home:
        return True

    rule, matched_rule_path = get_effective_handrive_acl_rule(request, path_value)
    has_descendant_rule = has_descendant_handrive_acl_rule(request, normalized_path)
    if rule is None:
        if scoped_home_dir and not in_scoped_home:
            return False
        # Root directory keeps editor-default write access even when
        # descendant ACL rules exist. This allows HandriveEditors to create
        # new files/folders at unconfigured root scope by default.
        if normalized_path == "":
            return is_handrive_editor(request)
        if has_descendant_rule:
            return False
        return is_handrive_editor(request)
    if matched_rule_path != normalized_path and has_descendant_rule:
        return False
    if rule_has_public_group(rule, "write_groups"):
        # Safety guard for legacy-invalid ACL data:
        # public-write ACL is only valid on markdown files, never on directories.
        try:
            target_path, _ = resolve_path(normalized_path, must_exist=True)
        except (ValueError, FileNotFoundError):
            return True
        if target_path.is_dir():
            return False
        return True

    return user_matches_handrive_acl_rule(
        request,
        rule,
        user_relation="write_users",
        group_relation="write_groups",
    )


def has_handrive_directory_write_access(request, path_value: str | None) -> bool:
    """폴더 하위 생성/업로드 가능 여부를 판정한다."""
    user = getattr(request, "user", None)
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    normalized_path = normalize_relative_path(path_value, allow_empty=True)
    git_virtual = _get_git_virtual_context(request, normalized_path)
    if git_virtual is not None:
        return git_virtual["kind"] == "branch_dir" and str(git_virtual.get("repo_permission") or "").lower() in {"write", "admin", "owner"}
    if is_handrive_git_repo_mounted_path(request, normalized_path):
        return False
    if user and user.is_superuser:
        return True
    is_scoped_public_user = bool(scoped_home_dir and is_public_group_scoped_user(request))
    in_scoped_home = is_path_in_handrive_scope(normalized_path, scoped_home_dir)
    if is_scoped_public_user and in_scoped_home:
        return True

    rule, _ = get_effective_handrive_acl_rule(request, path_value)
    if rule is None:
        if scoped_home_dir and not in_scoped_home:
            return False
        return is_handrive_editor(request)

    if rule_has_public_group(rule, "write_groups"):
        # public-write ACL is only valid on markdown files, never on directories.
        return False

    return user_matches_handrive_acl_rule(
        request,
        rule,
        user_relation="write_users",
        group_relation="write_groups",
    )


def move_handrive_acl_rules(source_path: str, destination_path: str) -> None:
    """경로 이동/이름변경 시 ACL rule 들도 같은 상대위치로 이동한다."""
    source_normalized = normalize_relative_path(source_path, allow_empty=True)
    destination_normalized = normalize_relative_path(destination_path, allow_empty=True)
    if source_normalized == destination_normalized:
        return

    rules = list(HandriveAccessRule.objects.filter(path=source_normalized))
    if source_normalized:
        rules += list(
            HandriveAccessRule.objects.filter(path__startswith=source_normalized + "/").exclude(
                path=source_normalized
            )
        )

    for rule in rules:
        old_path = rule.path
        suffix = old_path[len(source_normalized):] if source_normalized else old_path
        new_path = destination_normalized + suffix
        if not destination_normalized:
            new_path = suffix.lstrip("/")

        target_rule = HandriveAccessRule.objects.filter(path=new_path).exclude(pk=rule.pk).first()
        if target_rule:
            merged_read_user_ids = set(target_rule.read_users.values_list("id", flat=True)) | set(
                rule.read_users.values_list("id", flat=True)
            )
            merged_read_group_ids = set(target_rule.read_groups.values_list("id", flat=True)) | set(
                rule.read_groups.values_list("id", flat=True)
            )
            merged_write_user_ids = set(target_rule.write_users.values_list("id", flat=True)) | set(
                rule.write_users.values_list("id", flat=True)
            )
            merged_write_group_ids = set(target_rule.write_groups.values_list("id", flat=True)) | set(
                rule.write_groups.values_list("id", flat=True)
            )
            target_rule.read_users.set(merged_read_user_ids)
            target_rule.read_groups.set(merged_read_group_ids)
            target_rule.write_users.set(merged_write_user_ids)
            target_rule.write_groups.set(merged_write_group_ids)
            rule.delete()
            continue

        rule.path = new_path
        rule.save(update_fields=["path", "updated_at"])


def delete_handrive_acl_rules_for_path(path_value: str) -> None:
    """경로와 하위 트리에 연결된 ACL rule 을 삭제한다."""
    normalized = normalize_relative_path(path_value, allow_empty=True)
    if not normalized:
        HandriveAccessRule.objects.filter(path="").delete()
        return

    HandriveAccessRule.objects.filter(path=normalized).delete()
    HandriveAccessRule.objects.filter(path__startswith=normalized + "/").delete()


def _iter_updated_sync_excluded_paths_for_move(paths, source_path: str, destination_path: str):
    source_normalized = normalize_relative_path(source_path, allow_empty=True)
    destination_normalized = normalize_relative_path(destination_path, allow_empty=True)
    seen: set[str] = set()
    updated_paths: list[str] = []
    changed = False

    for raw_path in paths or []:
        try:
            normalized = normalize_relative_path(raw_path, allow_empty=True)
        except ValueError:
            normalized = raw_path

        next_path = normalized
        if normalized == source_normalized:
            next_path = destination_normalized
        elif source_normalized and isinstance(normalized, str) and normalized.startswith(source_normalized + "/"):
            next_path = destination_normalized + normalized[len(source_normalized):]

        if next_path in seen:
            changed = True
            continue
        seen.add(next_path)
        updated_paths.append(next_path)
        if next_path != raw_path:
            changed = True

    return updated_paths, changed


def move_handrive_sync_excluded_paths(source_path: str, destination_path: str) -> None:
    source_normalized = normalize_relative_path(source_path, allow_empty=True)
    destination_normalized = normalize_relative_path(destination_path, allow_empty=True)
    if source_normalized == destination_normalized:
        return

    for profile in UserProfile.objects.only("id", "sync_excluded_paths"):
        updated_paths, changed = _iter_updated_sync_excluded_paths_for_move(
            profile.sync_excluded_paths,
            source_normalized,
            destination_normalized,
        )
        if not changed:
            continue
        profile.sync_excluded_paths = updated_paths
        profile.save(update_fields=["sync_excluded_paths", "updated_at"])


def delete_handrive_sync_excluded_paths_for_path(path_value: str) -> None:
    normalized = normalize_relative_path(path_value, allow_empty=True)
    for profile in UserProfile.objects.only("id", "sync_excluded_paths"):
        seen: set[str] = set()
        updated_paths: list[str] = []
        changed = False
        for raw_path in profile.sync_excluded_paths or []:
            try:
                candidate = normalize_relative_path(raw_path, allow_empty=True)
            except ValueError:
                candidate = raw_path

            should_delete = candidate == normalized
            if normalized and isinstance(candidate, str) and candidate.startswith(normalized + "/"):
                should_delete = True
            if should_delete:
                changed = True
                continue
            if candidate in seen:
                changed = True
                continue
            seen.add(candidate)
            updated_paths.append(candidate)
            if candidate != raw_path:
                changed = True

        if not changed:
            continue
        profile.sync_excluded_paths = updated_paths
        profile.save(update_fields=["sync_excluded_paths", "updated_at"])


def list_directory_entries(directory: Path, request=None) -> list[dict]:
    """실제 디렉터리 엔트리와 가상 repo root 엔트리를 함께 구성한다."""
    entries = []
    existing_entry_paths = set()
    try:
        _children = [directory / p.name for p in directory.resolve().iterdir()]
    except (PermissionError, OSError):
        _children = []
    for child in sorted(_children, key=lambda p: (0 if p.is_dir() else 1, p.name.lower())):
        if child.is_dir():
            entry = build_entry(child)
            can_edit = False
            can_read = True
            if request is not None:
                can_edit = has_handrive_write_access(request, entry["path"])
                can_read = has_handrive_read_access(request, entry["path"])
                if not can_read and not can_edit:
                    continue
                if is_handrive_url_only_enabled(request, entry["path"]) and not can_edit and not has_handrive_shared_read_access(request, entry["path"]):
                    continue
            if request is not None:
                is_git_repo_root = is_handrive_git_repo_root_path(request, entry["path"])
                entry["can_edit"] = can_edit
                entry["can_write_children"] = has_handrive_directory_write_access(request, entry["path"])
                entry["can_delete"] = can_edit or is_git_repo_root
                entry["is_public_write"] = False
                entry["is_url_only"] = is_handrive_url_only_enabled(request, entry["path"])
                entry["write_acl_labels"] = get_write_acl_display_labels(request, entry["path"])
                share_info = build_handrive_existing_share_info(request, entry["path"])
                entry["share_url"] = share_info["share_url"]
                entry["share_is_inherited"] = share_info["share_is_inherited"]
                # 커스텀 폴더 아이콘 URL 주입
                _owner_key = get_folder_icon_owner_key_for_user(request.user)
                if _owner_key and _owner_key != "anon":
                    _stem = sanitize_upload_segment(child.name) or "folder"
                    _icons_dir = Path(settings.MEDIA_ROOT) / build_user_folder_icon_dir(_owner_key)
                    if any(_icons_dir.glob(f"{_stem}.*")):
                        entry["folder_icon_url"] = (
                            f"/handrive/api/folder-icon?owner_key={quote(_owner_key)}&folder_stem={quote(_stem)}"
                        )
            entries.append(entry)
            existing_entry_paths.add(entry["path"])
            continue
        if child.is_file():
            entry = build_entry(child)
            can_edit = False
            can_read = True
            if request is not None:
                can_edit = has_handrive_write_access(request, entry["path"])
                can_read = has_handrive_read_access(request, entry["path"])
                if not can_read and not can_edit:
                    continue
                if is_handrive_url_only_enabled(request, entry["path"]) and not can_edit and not has_handrive_shared_read_access(request, entry["path"]):
                    continue
            if request is not None:
                entry["can_edit"] = can_edit
                entry["can_write_children"] = False
                entry["can_delete"] = can_edit
                entry["is_public_write"] = is_handrive_public_write_enabled(request, entry["path"])
                entry["is_url_only"] = is_handrive_url_only_enabled(request, entry["path"])
                entry["write_acl_labels"] = get_write_acl_display_labels(request, entry["path"])
                share_info = build_handrive_existing_share_info(request, entry["path"])
                entry["share_url"] = share_info["share_url"]
                entry["share_is_inherited"] = share_info["share_is_inherited"]
                if is_handrive_supported_archive_path(child):
                    entry["is_archive"] = True
                    entry["can_extract"] = can_read
                    entry["archive_path"] = entry["path"]
                    entry["archive_virtual_path"] = build_archive_virtual_path(entry["path"])
                    entry["has_children"] = True
            entries.append(entry)
            existing_entry_paths.add(entry["path"])

    # 디렉토리 엔트리에 git repo 정보 일괄 추가
    if request is not None and hasattr(request, "user") and request.user.is_authenticated:
        current_dir_relative = relative_from_root(directory)
        visible_repos = _get_visible_git_repositories(request)
        visible_repo_map = {
            _get_visible_git_repo_root_relative(request, repo): repo
            for repo in visible_repos
        }
        dir_paths = [e["path"] for e in entries if e.get("type") == "dir"]
        for entry in entries:
            if entry.get("type") != "dir":
                continue
            repo = visible_repo_map.get(entry["path"])
            if repo is None:
                continue
            permission = _get_git_repo_permission_for_request(request, repo)
            entry["git_repo"] = {
                "id": repo.id,
                "status": repo.status,
                "permission": permission,
                "is_owner": bool(repo.owner_id == getattr(request.user, "id", None)),
                "owner_username": str(repo.forgejo_owner or getattr(repo.owner, "username", "") or "").strip(),
                "can_delete": permission == "owner",
                "can_manage": permission in {"read", "write", "admin", "owner"},
            }
            entry["can_edit"] = False
            entry["can_write_children"] = False
            entry["can_delete"] = permission == "owner"

        virtual_repo_entries = []
        for repo in visible_repos:
            repo_path = _get_visible_git_repo_root_relative(request, repo)
            repo_parent = normalize_relative_path(str(Path(repo_path).parent).replace("\\", "/"), allow_empty=True)
            if repo_parent == ".":
                repo_parent = ""
            if repo_parent != current_dir_relative or repo_path in existing_entry_paths:
                continue
            if not has_handrive_read_access(request, repo_path):
                continue
            repo_name = Path(repo_path).name
            permission = _get_git_repo_permission_for_request(request, repo)
            _repo_storage = _get_repo_storage_path(repo.owner, repo.repo_name)
            try:
                _repo_size = sum(p.stat().st_size for p in _repo_storage.rglob("*") if p.is_file()) if _repo_storage.exists() else 0
                _repo_size_display = format_handrive_bytes_display(_repo_size) if _repo_size else ""
            except OSError:
                _repo_size_display = ""
            virtual_repo_entries.append(
                {
                    "name": repo_name,
                    "path": repo_path,
                    "type": "dir",
                    "has_children": True,
                    "modified_display": format_handrive_modified_display(getattr(repo, "updated_at", None)),
                    "size_display": _repo_size_display,
                    "can_edit": False,
                    "can_write_children": False,
                    "can_delete": permission == "owner",
                    "is_public_write": False,
                    "is_url_only": False,
                    "write_acl_labels": get_write_acl_display_labels(request, repo_path),
                    "git_repo": {
                        "id": repo.id,
                        "status": repo.status,
                        "permission": permission,
                        "is_owner": bool(repo.owner_id == getattr(request.user, "id", None)),
                        "owner_username": str(repo.forgejo_owner or getattr(repo.owner, "username", "") or "").strip(),
                        "can_delete": permission == "owner",
                        "can_manage": permission in {"read", "write", "admin", "owner"},
                    },
                }
            )
        if virtual_repo_entries:
            entries.extend(sorted(virtual_repo_entries, key=lambda item: (0, item["name"].lower())))
            entries.sort(key=lambda item: (0 if item.get("type") == "dir" else 1, item.get("name", "").lower()))

    return entries


def _get_current_dir_git_repo(request, current_dir: str):
    """현재 디렉토리 자체의 GitRepository 정보를 반환 (없으면 None)."""
    if not current_dir or request is None or not hasattr(request, "user") or not request.user.is_authenticated:
        return None
    repo = _get_git_repo_for_relative_path(request, current_dir)
    if repo is None:
        git_virtual = _get_git_virtual_context(request, current_dir)
        if git_virtual is not None:
            repo = git_virtual.get("repo")
    if repo:
        permission = _get_git_repo_permission_for_request(request, repo)
        return {
            "id": repo.id,
            "repo_name": str(repo.forgejo_repo_name or repo.repo_name or "").strip(),
            "status": repo.status,
            "permission": permission,
            "is_owner": bool(repo.owner_id == getattr(request.user, "id", None)),
            "owner_username": str(repo.forgejo_owner or getattr(repo.owner, "username", "") or "").strip(),
            "can_delete": permission == "owner",
            "can_manage": permission in {"read", "write", "admin", "owner"},
        }
    return None


def _build_handrive_directory_meta(request, current_dir: str, entries: list | None = None) -> dict:
    """목록 페이지가 현재 디렉터리를 클라이언트에서 재구성할 수 있도록 메타데이터를 반환한다."""
    normalized_dir = normalize_relative_path(current_dir, allow_empty=True)
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    git_virtual = _get_git_virtual_context(request, normalized_dir)
    current_dir_size_display = ""
    current_dir_modified_display = ""
    current_dir_commit_meta = {"subject": "", "author_username": "", "modified_display": ""}

    if git_virtual is None:
        directory, normalized_dir = resolve_path(normalized_dir, must_exist=True)
        if not directory.is_dir():
            raise FileNotFoundError("폴더를 찾을 수 없습니다.")
        if directory.is_dir():
            dir_bytes = calculate_handrive_quota_breakdown(directory)[0]
            is_root = (scoped_home_dir and normalized_dir == scoped_home_dir) or (not scoped_home_dir and normalized_dir == "")
            if is_root and request.user.is_authenticated:
                repo_extra, _ = calculate_handrive_repo_usage(request.user)
                dir_bytes += repo_extra
            current_dir_size_display = format_handrive_bytes_display(dir_bytes)
        try:
            current_dir_modified_display = format_handrive_modified_display_from_timestamp(directory.stat().st_mtime)
        except OSError:
            current_dir_modified_display = ""
    else:
        if git_virtual["kind"] == "branch_file":
            raise FileNotFoundError("폴더를 찾을 수 없습니다.")
        if git_virtual["kind"] == "branch_dir" and git_virtual["repo_relative_path"]:
            current_dir_commit_meta = _git_repo_latest_commit_meta(
                git_virtual["repo"],
                git_virtual["branch_name"],
                git_virtual["repo_relative_path"],
            )

    effective_entries = entries if entries is not None else []
    return {
        "path": normalized_dir,
        "is_root": bool((scoped_home_dir and normalized_dir == scoped_home_dir) or (not scoped_home_dir and normalized_dir == "")),
        "can_edit": has_handrive_write_access(request, normalized_dir),
        "can_write_children": has_handrive_directory_write_access(request, normalized_dir),
        "has_children": bool(effective_entries),
        "is_git_repo_root": is_handrive_git_repo_root_path(request, normalized_dir),
        "requires_commit_message": bool(git_virtual is not None and git_virtual["kind"] == "branch_dir"),
        "git_branch_root": bool(
            git_virtual is not None
            and git_virtual["kind"] == "branch_dir"
            and not git_virtual["repo_relative_path"]
        ),
        "git_commit_message": current_dir_commit_meta.get("subject", ""),
        "git_commit_author_username": current_dir_commit_meta.get("author_username", ""),
        "modified_display": current_dir_commit_meta.get("modified_display", "") or current_dir_modified_display,
        "size_display": current_dir_size_display,
        "git_repo": _get_current_dir_git_repo(request, normalized_dir),
    }


def _get_git_repo_for_relative_path(request, relative_path: str):
    """현재 사용자에게 보이는 repo root 경로와 정확히 일치하는 GitRepository 를 찾는다."""
    if request is None or not hasattr(request, "user") or not request.user.is_authenticated:
        return None
    normalized = normalize_relative_path(relative_path, allow_empty=False)
    for repo in _get_visible_git_repositories(request):
        if _get_visible_git_repo_root_relative(request, repo) == normalized:
            return repo
    return None


def _sync_git_collaborators_from_forgejo(repo) -> None:
    """Forgejo collaborator 목록을 Django ``GitCollaborator`` 테이블과 동기화한다."""
    from git.models import GitCollaborator

    owner_name = str(repo.forgejo_owner or getattr(repo.owner, "username", "") or "").strip()
    repo_name = str(repo.forgejo_repo_name or repo.repo_name or "").strip()
    if not owner_name or not repo_name:
        return

    try:
        collaborators = ForgejoClient().list_collaborators(owner_name, repo_name)
    except Exception:
        return

    usernames = []
    permission_map = {}
    for collaborator in collaborators:
        username = str(collaborator.get("username") or collaborator.get("login") or "").strip()
        if not username:
            continue
        usernames.append(username)
        try:
            permission_map[username] = ForgejoClient().get_collaborator_permission(owner_name, repo_name, username)
        except Exception:
            permission_map[username] = "read"

    User = get_user_model()
    users_by_username = {
        user.username: user
        for user in User.objects.filter(username__in=usernames, is_active=True)
    }
    existing = {
        collaborator.user.username: collaborator
        for collaborator in GitCollaborator.objects.filter(repository=repo).select_related("user")
    }

    seen_usernames = set()
    for username in usernames:
        user = users_by_username.get(username)
        if user is None:
            continue
        seen_usernames.add(username)
        GitCollaborator.objects.update_or_create(
            repository=repo,
            user=user,
            defaults={"permission": permission_map.get(username, "read")},
        )

    stale_usernames = set(existing.keys()) - seen_usernames
    if stale_usernames:
        GitCollaborator.objects.filter(
            repository=repo,
            user__username__in=stale_usernames,
        ).delete()


def _get_visible_git_repositories(request):
    """현재 사용자 기준 owner/collaborator repo 목록과 permission 캐시를 만든다."""
    cached = getattr(request, "_visible_git_repositories", None)
    if cached is not None:
        return cached
    if request is None or not hasattr(request, "user") or not request.user.is_authenticated:
        setattr(request, "_visible_git_repositories", [])
        setattr(request, "_visible_git_repo_permissions", {})
        return []

    from git.models import GitRepository

    all_repos = list(
        GitRepository.objects.exclude(status="deleted")
        .select_related("owner")
        .prefetch_related("collaborators")
    )
    for repo in all_repos:
        _sync_git_collaborators_from_forgejo(repo)
    repos = list(
        GitRepository.objects.filter(
            Q(owner=request.user) | Q(collaborators__user=request.user)
        )
        .exclude(status="deleted")
        .select_related("owner")
        .prefetch_related("collaborators")
        .distinct()
    )
    permissions = {}
    current_user_id = getattr(request.user, "id", None)
    for repo in repos:
        if repo.owner_id == current_user_id:
            permissions[repo.id] = "owner"
            continue
        collaborator = next((item for item in repo.collaborators.all() if item.user_id == current_user_id), None)
        permissions[repo.id] = str(getattr(collaborator, "permission", "") or "read").lower()
    setattr(request, "_visible_git_repositories", repos)
    setattr(request, "_visible_git_repo_permissions", permissions)
    return repos


def _get_git_repo_permission_for_request(request, repo) -> str:
    """현재 요청 사용자의 repo permission 문자열을 반환한다."""
    permissions = getattr(request, "_visible_git_repo_permissions", None)
    if permissions is None:
        _get_visible_git_repositories(request)
        permissions = getattr(request, "_visible_git_repo_permissions", {})
    return str((permissions or {}).get(repo.id, "") or "").lower()


def _get_visible_git_repo_root_relative(request, repo) -> str:
    """현재 사용자가 HanDrive 에서 보게 될 repo root 상대경로를 계산한다."""
    if request is not None and hasattr(request, "user") and getattr(request.user, "is_authenticated", False):
        if repo.owner_id != getattr(request.user, "id", None):
            viewer_root = _get_owner_visible_root_relative(request.user)
            if viewer_root:
                return normalize_relative_path(f"{viewer_root}/{repo.repo_name}", allow_empty=False)
    return normalize_relative_path(repo.handrive_path, allow_empty=False)


def _get_git_repo_mount_prefixes(request) -> tuple[str, ...]:
    """가상 repo mount prefix 목록을 길이순으로 캐시해 반환한다."""
    cached = getattr(request, "_handrive_git_repo_mount_prefixes", None)
    if cached is not None:
        return cached

    prefixes = tuple(
        sorted(
            {_get_visible_git_repo_root_relative(request, repo) for repo in _get_visible_git_repositories(request)},
            key=len,
        )
    )
    setattr(request, "_handrive_git_repo_mount_prefixes", prefixes)
    return prefixes


def _get_owner_visible_root_relative(owner) -> str:
    """소유자 유형에 따라 repo 가 노출될 HanDrive 루트 경로를 계산한다."""
    username = str(getattr(owner, "username", "") or "").strip()
    if not username:
        return ""
    if getattr(owner, "is_superuser", False):
        return f"media/HanDrive/users/{username}"
    if owner.groups.filter(name=DOCS_PUBLIC_WRITE_GROUP_NAME).exists():
        return f"users/{username}"
    return ""


def _get_repo_restore_relative_path(owner, repo_name: str) -> str:
    """repo 삭제 후 일반 폴더로 복원될 HanDrive 상대경로를 계산한다."""
    base = _get_owner_visible_root_relative(owner)
    return f"{base}/{repo_name}" if base else repo_name


def _get_repo_storage_path(owner, repo_name: str) -> Path:
    """Forgejo bare repo 의 실제 저장 경로를 반환한다."""
    return (Path(settings.FORGEJO_REPOS_ROOT) / owner.username / f"{repo_name}.git").resolve()


def _encode_git_branch_segment(branch_name: str) -> str:
    """브랜치명을 HanDrive path segment 로 안전하게 인코딩한다."""
    return quote(str(branch_name or ""), safe="")


def _decode_git_branch_segment(branch_segment: str) -> str:
    """HanDrive path segment 에서 원래 브랜치명을 복원한다."""
    return unquote(str(branch_segment or ""))


def _copy_tree_contents(source_dir: Path, destination_dir: Path) -> None:
    """디렉터리 내용을 symlink 보존 상태로 새 대상 경로에 복사한다."""
    destination_dir.mkdir(parents=True, exist_ok=False)
    for child in source_dir.iterdir():
        target_child = destination_dir / child.name
        if child.is_dir():
            shutil.copytree(child, target_child, symlinks=True)
        else:
            shutil.copy2(child, target_child)


def _run_git_repo_command(repo, *args: str, text: bool = True, check: bool = True, timeout: int = 120):
    """bare repo 를 대상으로 git 명령을 실행하는 공통 helper."""
    repo_storage_path = _get_repo_storage_path(repo.owner, repo.repo_name)
    command = [GIT_BIN, f"--git-dir={repo_storage_path}", *args]
    result = subprocess.run(
        command,
        capture_output=True,
        text=text,
        timeout=timeout,
    )
    if check and result.returncode != 0:
        stderr = result.stderr.strip() if isinstance(result.stderr, str) else ""
        raise RuntimeError(stderr or f"git command failed: {' '.join(command)}")
    return result


def _git_repo_branches(repo) -> list[str]:
    """repo 에 존재하는 local branch 이름 목록을 반환한다."""
    result = _run_git_repo_command(
        repo,
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
    )
    return [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]


def _git_repo_object_type(repo, branch_name: str, repo_relative_path: str = "") -> str:
    """branch/path 가 tree 인지 blob 인지 확인한다."""
    spec = branch_name if not repo_relative_path else f"{branch_name}:{repo_relative_path}"
    result = _run_git_repo_command(repo, "cat-file", "-t", spec)
    return (result.stdout or "").strip()


def _git_repo_read_file_bytes(repo, branch_name: str, repo_relative_path: str) -> bytes:
    """branch 내부 파일을 bare repo 에서 직접 읽는다."""
    spec = f"{branch_name}:{repo_relative_path}"
    result = _run_git_repo_command(repo, "show", spec, text=False)
    return result.stdout or b""


def _git_repo_list_tree(repo, branch_name: str, repo_relative_path: str = "") -> list[dict]:
    """branch 디렉터리 엔트리를 HanDrive list 용 dict 목록으로 변환한다."""
    spec = branch_name if not repo_relative_path else f"{branch_name}:{repo_relative_path}"
    result = _run_git_repo_command(repo, "ls-tree", "-z", spec, text=False)
    payload = result.stdout or b""
    entries = []
    for raw_item in payload.split(b"\x00"):
        if not raw_item:
            continue
        meta, name_bytes = raw_item.split(b"\t", 1)
        _mode, object_type, object_sha = meta.decode("utf-8").split(" ", 2)
        name = name_bytes.decode("utf-8")
        if name == ".gitkeep":
            continue
        entry = {
            "name": name,
            "type": object_type,
            "sha": object_sha,
            "size_display": "",
        }
        if object_type == "blob":
            size_result = _run_git_repo_command(repo, "cat-file", "-s", object_sha)
            try:
                entry["size_display"] = format_handrive_bytes_display(int((size_result.stdout or "0").strip() or "0"))
            except ValueError:
                entry["size_display"] = ""
        entries.append(entry)
    return sorted(entries, key=lambda item: (0 if item["type"] == "tree" else 1, item["name"].lower()))


def _git_repo_latest_commit_meta(repo, branch_name: str, repo_relative_path: str = "") -> dict[str, str]:
    """경로 기준 최신 커밋 subject/author 를 조회한다."""
    args = ["log", "-1", "--format=%s%x1f%an%x1f%ct", branch_name]
    normalized_path = normalize_relative_path(repo_relative_path, allow_empty=True)
    if normalized_path:
        args.extend(["--", normalized_path])
    result = _run_git_repo_command(repo, *args)
    output = (result.stdout or "").strip()
    if not output:
        return {"subject": "", "author_username": "", "modified_display": ""}
    subject, _, remainder = output.partition("\x1f")
    author_username, _, committed_at = remainder.partition("\x1f")
    return {
        "subject": str(subject or "").strip(),
        "author_username": str(author_username or "").strip(),
        "modified_display": format_handrive_modified_display_from_timestamp(str(committed_at or "").strip()),
    }


def _git_repo_latest_commit_subject(repo, branch_name: str, repo_relative_path: str = "") -> str:
    """최신 커밋 제목만 필요한 곳을 위한 helper."""
    return _git_repo_latest_commit_meta(repo, branch_name, repo_relative_path).get("subject", "")


def _git_repo_path_exists(repo, branch_name: str, repo_relative_path: str) -> bool:
    """branch 내부 경로가 실제로 존재하는지 확인한다."""
    normalized_path = normalize_relative_path(repo_relative_path, allow_empty=False)
    spec = f"{branch_name}:{normalized_path}"
    result = _run_git_repo_command(repo, "cat-file", "-e", spec, check=False)
    return result.returncode == 0


def _resolve_git_worktree_path(worktree_dir: Path, repo_relative_path: str = "") -> Path:
    """temp clone worktree 안의 안전한 대상 경로를 계산한다."""
    normalized_path = normalize_relative_path(repo_relative_path, allow_empty=True)
    target_path = worktree_dir if not normalized_path else worktree_dir.joinpath(*normalized_path.split("/"))
    resolved_root = worktree_dir.resolve()
    resolved_target = target_path.resolve()
    if resolved_target != resolved_root and resolved_root not in resolved_target.parents:
        raise ValueError("잘못된 Repo 경로입니다.")
    return target_path


def _remove_gitkeep_placeholder(directory: Path) -> None:
    """빈 폴더 보존용 ``.gitkeep`` placeholder 를 제거한다."""
    placeholder = directory / ".gitkeep"
    if placeholder.exists():
        placeholder.unlink()


def _ensure_gitkeep_if_empty(directory: Path, repo_root: Path) -> None:
    """삭제 후 폴더가 비면 ``.gitkeep`` 를 넣어 empty dir 을 유지한다."""
    current = directory
    resolved_root = repo_root.resolve()
    while True:
        resolved_current = current.resolve()
        if resolved_current == resolved_root:
            return
        if current.exists() and current.is_dir() and not any(current.iterdir()):
            (current / ".gitkeep").write_text("", encoding="utf-8")
            return
        return


def _copy_local_item_to_git_worktree(source_path: Path, destination_path: Path) -> None:
    """일반 HanDrive 파일/폴더를 temp git worktree 로 복사한다."""
    if source_path.is_dir():
        shutil.copytree(source_path, destination_path, symlinks=True)
        git_dir = destination_path / ".git"
        if git_dir.exists():
            shutil.rmtree(git_dir, ignore_errors=True)
        return
    shutil.copy2(source_path, destination_path)


def _commit_git_branch_mutation(repo, branch_name: str, commit_message: str, author_user, mutator) -> None:
    """temp clone 에 mutation 을 적용한 뒤 commit/push 까지 수행한다."""
    message = str(commit_message or "").strip()
    if not message:
        raise ValueError("커밋 메시지를 입력해주세요.")

    client = ForgejoClient()
    clone_url = client.internal_authed_clone_url(repo.forgejo_owner or repo.owner.username, repo.forgejo_repo_name or repo.repo_name)
    with tempfile.TemporaryDirectory(prefix="handrive_git_commit_") as temp_dir:
        clone_result = subprocess.run(
            [GIT_BIN, "clone", "--branch", branch_name, "--single-branch", clone_url, temp_dir],
            capture_output=True,
            text=True,
            timeout=180,
        )
        if clone_result.returncode != 0:
            raise RuntimeError(clone_result.stderr.strip() or "repo clone failed")

        subprocess.run([GIT_BIN, "-C", temp_dir, "config", "user.name", author_user.username], capture_output=True, timeout=10)
        subprocess.run(
            [GIT_BIN, "-C", temp_dir, "config", "user.email", getattr(author_user, "email", "") or f"{author_user.username}@hanplanet.local"],
            capture_output=True,
            timeout=10,
        )

        mutator(Path(temp_dir))

        status_result = subprocess.run([GIT_BIN, "-C", temp_dir, "status", "--porcelain"], capture_output=True, text=True, timeout=30)
        if not (status_result.stdout or "").strip():
            raise ValueError("변경된 내용이 없습니다.")

        add_result = subprocess.run([GIT_BIN, "-C", temp_dir, "add", "-A"], capture_output=True, text=True, timeout=60)
        if add_result.returncode != 0:
            raise RuntimeError(add_result.stderr.strip() or "git add failed")
        commit_result = subprocess.run([GIT_BIN, "-C", temp_dir, "commit", "-m", message], capture_output=True, text=True, timeout=60)
        if commit_result.returncode != 0:
            raise RuntimeError(commit_result.stderr.strip() or "git commit failed")
        push_result = subprocess.run([GIT_BIN, "-C", temp_dir, "push", "origin", branch_name], capture_output=True, text=True, timeout=180)
        if push_result.returncode != 0:
            raise RuntimeError(push_result.stderr.strip() or "git push failed")


def _build_available_git_repo_filename(repo, branch_name: str, repo_relative_dir: str, original_name: str) -> str:
    """repo branch 내부에서 충돌 없는 업로드 파일명을 계산한다."""
    raw_name = (original_name or "").strip()
    if not raw_name:
        raise ValueError("업로드할 파일 이름이 올바르지 않습니다.")

    existing_names = {
        item["name"]
        for item in _git_repo_list_tree(repo, branch_name, repo_relative_dir)
        if item["type"] == "blob"
    }

    suffix = Path(raw_name).suffix.lower()
    normalized_extension = normalize_file_extension(suffix, allow_empty=True)
    if normalized_extension:
        base_name = validate_name(raw_name, for_file=True, file_extension=normalized_extension)
    else:
        base_name = validate_name(raw_name, for_file=False)

    candidate = f"{base_name}{normalized_extension}"
    if candidate not in existing_names:
        return candidate

    index = 2
    while True:
        candidate = f"{base_name} ({index}){normalized_extension}"
        if candidate not in existing_names:
            return candidate
        index += 1


def _get_git_virtual_context(request, path_value: str | None):
    """HanDrive 가상 repo 경로를 repo/branch 메타로 해석한다.

    예:
    - ``users/adihang/repo`` -> repo_root
    - ``users/adihang/repo/main`` -> branch_dir
    - ``users/adihang/repo/main/src/app.js`` -> branch_file
    """
    if request is None or not hasattr(request, "user") or not request.user.is_authenticated:
        return None

    normalized = normalize_relative_path(path_value, allow_empty=True)
    if not normalized:
        return None

    repo = None
    repo_root = ""
    for candidate in _get_visible_git_repositories(request):
        candidate_root = _get_visible_git_repo_root_relative(request, candidate)
        if normalized == candidate_root or normalized.startswith(candidate_root + "/"):
            if len(candidate_root) > len(repo_root):
                repo = candidate
                repo_root = candidate_root
    if repo is None:
        return None

    remaining = normalized[len(repo_root):].lstrip("/")
    if not remaining:
        return {
            "repo": repo,
            "repo_permission": _get_git_repo_permission_for_request(request, repo),
            "repo_root": repo_root,
            "kind": "repo_root",
            "display_path": repo_root,
            "branch_segment": "",
            "branch_name": "",
            "repo_relative_path": "",
        }

    segments = remaining.split("/")
    branch_segment = segments[0]
    branch_name = _decode_git_branch_segment(branch_segment)
    if branch_name not in _git_repo_branches(repo):
        return None

    repo_relative_path = "/".join(segments[1:])
    kind = "branch_dir"
    if repo_relative_path:
        try:
            object_type = _git_repo_object_type(repo, branch_name, repo_relative_path)
        except RuntimeError:
            return None
        kind = "branch_dir" if object_type == "tree" else "branch_file"

    return {
        "repo": repo,
        "repo_permission": _get_git_repo_permission_for_request(request, repo),
        "repo_root": repo_root,
        "kind": kind,
        "display_path": normalized,
        "branch_segment": branch_segment,
        "branch_name": branch_name,
        "repo_relative_path": repo_relative_path,
    }


def _build_git_virtual_breadcrumbs(request, base_url: str, current_path: str, *, scoped_home_dir: str = "", root_url: str | None = None):
    """repo/branch 가상 경로를 포함한 breadcrumb 목록을 생성한다."""
    context = _get_git_virtual_context(request, current_path)
    if context is None:
        return build_handrive_breadcrumbs(
            base_url,
            current_path,
            scoped_home_dir=scoped_home_dir,
            root_label=get_handrive_root_label(request, scoped_home_dir),
            root_url=root_url,
        )

    breadcrumbs = build_handrive_breadcrumbs(
        base_url,
        context["repo_root"],
        scoped_home_dir=scoped_home_dir,
        root_label=get_handrive_root_label(request, scoped_home_dir),
        root_url=root_url,
    )
    if context["kind"] == "repo_root":
        return breadcrumbs

    if breadcrumbs:
        breadcrumbs[-1]["is_current"] = False
    branch_path = f"{context['repo_root']}/{context['branch_segment']}"
    breadcrumbs.append(
        {
            "label": context["branch_name"],
            "url": build_handrive_list_url(base_url, branch_path),
            "is_current": context["kind"] == "branch_dir" and not context["repo_relative_path"],
            "path": branch_path,
        }
    )

    if context["repo_relative_path"]:
        parts = [part for part in context["repo_relative_path"].split("/") if part]
        accumulated = []
        for index, part in enumerate(parts):
            accumulated.append(part)
            path_value = branch_path + "/" + "/".join(accumulated)
            breadcrumbs.append(
                {
                    "label": part,
                    "url": build_handrive_list_url(base_url, path_value),
                    "is_current": index == len(parts) - 1,
                    "path": path_value,
                }
            )
    return breadcrumbs


def _build_git_virtual_entries(request, context) -> list[dict]:
    """repo root 또는 branch 경로를 HanDrive list entry 목록으로 변환한다."""
    repo = context["repo"]
    repo_root = context["repo_root"]
    repo_permission = str(context.get("repo_permission") or "").lower()
    can_write_repo = repo_permission in {"write", "admin", "owner"}
    can_delete_repo_items = repo_permission in {"write", "admin", "owner"}
    if context["kind"] == "repo_root":
        return [
            {
                "name": branch_name,
                "path": f"{repo_root}/{_encode_git_branch_segment(branch_name)}",
                "type": "dir",
                "has_children": True,
                "modified_display": _git_repo_latest_commit_meta(repo, branch_name).get("modified_display", ""),
                "size_display": "",
                "can_edit": False,
                "can_write_children": can_write_repo,
                "can_delete": False,
                "is_public_write": False,
                "is_url_only": False,
                "write_acl_labels": [],
                "git_branch_root": True,
                "git_repo_branch": branch_name,
                "git_repo_id": repo.id,
                "requires_commit_message": True,
            }
            for branch_name in _git_repo_branches(repo)
        ]

    branch_prefix = f"{repo_root}/{context['branch_segment']}"
    entries = []
    for item in _git_repo_list_tree(repo, context["branch_name"], context["repo_relative_path"]):
        entry_path = f"{branch_prefix}/{item['name']}" if not context["repo_relative_path"] else f"{branch_prefix}/{context['repo_relative_path']}/{item['name']}"
        entry = {
            "name": item["name"],
            "path": entry_path,
            "type": "dir" if item["type"] == "tree" else "file",
            "modified_display": "",
            "size_display": item.get("size_display", ""),
            "can_edit": can_write_repo,
            "can_write_children": item["type"] == "tree" and can_write_repo,
            "can_delete": can_delete_repo_items,
            "is_public_write": False,
            "is_url_only": False,
            "write_acl_labels": [],
            "git_repo_branch": context["branch_name"],
            "requires_commit_message": True,
        }
        repo_relative_entry_path = item["name"] if not context["repo_relative_path"] else f"{context['repo_relative_path']}/{item['name']}"
        commit_meta = _git_repo_latest_commit_meta(repo, context["branch_name"], repo_relative_entry_path)
        entry["modified_display"] = commit_meta.get("modified_display", "")
        if item["type"] == "tree":
            entry["has_children"] = True
            entry["git_commit_message"] = commit_meta.get("subject", "")
            entry["git_commit_author_username"] = commit_meta.get("author_username", "")
        else:
            entry["slug_path"] = entry_path
            entry["git_commit_message"] = commit_meta.get("subject", "")
            entry["git_commit_author_username"] = commit_meta.get("author_username", "")
        entries.append(entry)
    return entries


def _commit_git_branch_changes(repo, branch_name: str, commit_message: str, file_updates: dict[str, bytes], author_user) -> None:
    """메모리의 파일 업데이트 dict 를 branch commit 으로 반영한다."""
    def _mutate(worktree_dir: Path) -> None:
        for repo_relative_path, content_bytes in file_updates.items():
            target_file = _resolve_git_worktree_path(worktree_dir, repo_relative_path)
            target_file.parent.mkdir(parents=True, exist_ok=True)
            _remove_gitkeep_placeholder(target_file.parent)
            target_file.write_bytes(content_bytes)

    _commit_git_branch_mutation(repo, branch_name, commit_message, author_user, _mutate)


def _materialize_git_repo_mount(target_path: Path, destination_path: Path) -> None:
    """bare repo 내용을 일반 폴더 형태로 checkout 해서 복원한다."""
    with tempfile.TemporaryDirectory(prefix="handrive_repo_restore_") as temp_dir:
        checkout_path = Path(temp_dir) / "checkout"
        result = subprocess.run(
            [GIT_BIN, "clone", "--depth=1", str(target_path), str(checkout_path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "failed to clone repo contents")
        git_metadata_dir = checkout_path / ".git"
        if git_metadata_dir.exists():
            shutil.rmtree(git_metadata_dir, ignore_errors=True)
        _copy_tree_contents(checkout_path, destination_path)


def is_handrive_git_repo_mounted_path(request, path_value: str | None) -> bool:
    if request is None:
        request = HANDRIVE_ACTIVE_REQUEST.get()
    if request is None:
        return False

    normalized = normalize_relative_path(path_value, allow_empty=True)
    if not normalized:
        return False

    for prefix in _get_git_repo_mount_prefixes(request):
        if normalized == prefix or normalized.startswith(prefix + "/"):
            return True
    return False


def is_handrive_git_repo_root_path(request, path_value: str | None) -> bool:
    if request is None:
        request = HANDRIVE_ACTIVE_REQUEST.get()
    if request is None:
        return False

    normalized = normalize_relative_path(path_value, allow_empty=True)
    if not normalized:
        return False
    return normalized in _get_git_repo_mount_prefixes(request)


def list_all_directories(request=None) -> list[str]:
    root = handrive_root_dir()
    directories = []
    if request is None or has_handrive_directory_write_access(request, ""):
        directories.append("")
    for directory in sorted(
        [p for p in _iter_descendants_safely(root) if p.is_dir()],
        key=lambda p: p.as_posix().lower(),
    ):
        rel_path = relative_from_root(directory)
        if request is not None and not has_handrive_directory_write_access(request, rel_path):
            continue
        directories.append(rel_path)
    return directories


def build_handrive_list_url(base_url: str, relative_path: str) -> str:
    normalized = normalize_relative_path(relative_path, allow_empty=True)
    if not normalized:
        return base_url
    encoded = "/".join(quote(segment, safe="") for segment in normalized.split("/"))
    return f"{base_url}/{encoded}/list"


def get_scoped_handrive_home_dir(request) -> str:
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated):
        return "all"
    if not (user.is_superuser or user.groups.filter(name=DOCS_PUBLIC_WRITE_GROUP_NAME).exists()):
        return ""
    username = str(user.get_username() or "").strip()
    if not username:
        return ""
    try:
        return normalize_relative_path(f"users/{username}", allow_empty=False)
    except ValueError:
        return ""


def get_handrive_initial_landing_dir(request) -> str:
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated):
        return get_scoped_handrive_home_dir(request)
    username = str(user.get_username() or "").strip()
    return get_scoped_handrive_home_dir(request)


def is_public_group_scoped_user(request) -> bool:
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated):
        return False
    return user.groups.filter(name=DOCS_PUBLIC_WRITE_GROUP_NAME).exists()


def is_path_in_handrive_scope(path_value: str, scoped_home_dir: str) -> bool:
    if not scoped_home_dir:
        return True
    if not path_value:
        return False
    return path_value == scoped_home_dir or path_value.startswith(scoped_home_dir + "/")


def ensure_scoped_home_dir(scoped_home_dir: str) -> None:
    if not scoped_home_dir:
        return
    path_obj, _ = resolve_path(scoped_home_dir, must_exist=False)
    path_obj.mkdir(parents=True, exist_ok=True)


def get_handrive_scoped_quota_root(request, path_value: str | None) -> Path | None:
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    if not scoped_home_dir:
        return None
    normalized_path = normalize_relative_path(path_value, allow_empty=True)
    if not is_path_in_handrive_scope(normalized_path, scoped_home_dir):
        return None
    scoped_root, _ = resolve_path(scoped_home_dir, must_exist=False)
    scoped_root.mkdir(parents=True, exist_ok=True)
    return scoped_root


def calculate_handrive_tree_usage(root_path: Path) -> tuple[int, int]:
    total_bytes = 0
    total_entries = 0
    if not root_path.exists():
        return total_bytes, total_entries

    for path_obj in _iter_descendants_safely(root_path):
        total_entries += 1
        if path_obj.is_file():
            try:
                total_bytes += path_obj.stat().st_size
            except OSError:
                continue
    return total_bytes, total_entries


def enforce_handrive_scoped_quota(
    request,
    *,
    quota_path: str | None,
    extra_bytes: int = 0,
    extra_entries: int = 0,
) -> None:
    scoped_root = get_handrive_scoped_quota_root(request, quota_path)
    if scoped_root is None:
        return

    current_bytes, current_entries = calculate_handrive_tree_usage(scoped_root)
    repo_bytes, _ = calculate_handrive_repo_usage(request.user)
    projected_bytes = current_bytes + repo_bytes + max(0, extra_bytes)
    projected_entries = current_entries + max(0, extra_entries)

    user_quota_bytes = get_user_handrive_quota_bytes(request.user)
    if projected_bytes > user_quota_bytes:
        quota_display = format_handrive_bytes_display(user_quota_bytes)
        raise ValueError(f"개인 폴더 용량이 {quota_display}를 초과해 더 이상 업로드하거나 생성할 수 없습니다.")
    user_entry_limit = get_user_handrive_entry_limit(request.user)
    if user_entry_limit is not None and projected_entries > user_entry_limit:
        raise ValueError(f"개인 폴더의 하위 폴더/파일 수가 {user_entry_limit:,}개를 초과해 더 이상 업로드하거나 생성할 수 없습니다.")


def format_handrive_bytes_display(byte_count: int) -> str:
    GB = 1024**3
    MB = 1024**2
    KB = 1024
    if byte_count >= GB:
        return f"{byte_count / GB:g} GB" if byte_count % GB == 0 else f"{round(byte_count / GB, 1):g} GB"
    elif byte_count >= MB:
        return f"{byte_count / MB:g} MB" if byte_count % MB == 0 else f"{round(byte_count / MB, 1):g} MB"
    elif byte_count >= KB:
        return f"{byte_count / KB:g} KB" if byte_count % KB == 0 else f"{round(byte_count / KB, 1):g} KB"
    return f"{byte_count} B"


def format_handrive_modified_display(value) -> str:
    if value is None:
        return ""
    try:
        dt_value = value if isinstance(value, datetime) else None
        if dt_value is None:
            return ""
        if timezone.is_naive(dt_value):
            dt_value = timezone.make_aware(dt_value, timezone.get_current_timezone())
        return timezone.localtime(dt_value).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def format_handrive_modified_display_from_timestamp(timestamp_value) -> str:
    try:
        dt_value = datetime.fromtimestamp(float(timestamp_value), tz=timezone.get_current_timezone())
    except Exception:
        return ""
    return format_handrive_modified_display(dt_value)


_DOCS_QUOTA_TYPE_EXTS: dict[str, frozenset[str]] = {
    "photo": frozenset({
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif",
        ".avif", ".heic", ".heif", ".ico", ".svg",
    }),
    "video": frozenset({
        ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
        ".3gp", ".m2ts", ".ts", ".mts",
    }),
    "document": frozenset({
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm",
        ".py", ".js", ".ts", ".css", ".rb", ".go", ".java", ".c", ".cpp",
        ".h", ".rs", ".sh", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".log",
    }),
    "audio": frozenset({
        ".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus", ".aiff",
    }),
}

_DOCS_QUOTA_TYPE_META: list[tuple[str, str, str]] = [
    ("photo",    "사진",   "#f5b800"),
    ("video",    "동영상", "#06d6a0"),
    ("document", "문서",   "#ef476f"),
    ("audio",    "오디오", "#4361ee"),
    ("other",    "기타",   "#adb5bd"),
]


def _handrive_quota_file_type(suffix: str) -> str:
    s = suffix.lower()
    for key, exts in _DOCS_QUOTA_TYPE_EXTS.items():
        if s in exts:
            return key
    return "other"


def calculate_handrive_quota_breakdown(root_path: Path) -> tuple[int, int, dict[str, dict]]:
    """Returns (total_bytes, total_entries, breakdown).
    breakdown keys: photo, video, document, audio, other → {"bytes": int, "count": int}
    """
    type_keys = [k for k, _, _ in _DOCS_QUOTA_TYPE_META]
    byte_map = {k: 0 for k in type_keys}
    count_map = {k: 0 for k in type_keys}
    total_entries = 0
    if root_path.exists():
        for path_obj in _iter_descendants_safely(root_path):
            total_entries += 1
            if path_obj.is_file():
                tk = _handrive_quota_file_type(path_obj.suffix)
                count_map[tk] += 1
                try:
                    byte_map[tk] += path_obj.stat().st_size
                except OSError:
                    pass
    total_bytes = sum(byte_map.values())
    breakdown = {k: {"bytes": byte_map[k], "count": count_map[k]} for k in type_keys}
    return total_bytes, total_entries, breakdown


def calculate_handrive_repo_usage(user) -> tuple[int, int]:
    """유저의 활성 리포지토리 총 크기(bytes)와 리포 개수를 반환한다."""
    from git.models import GitRepository
    total_bytes = 0
    total_repos = 0
    for repo in GitRepository.objects.filter(owner=user, status="active"):
        repo_path = _get_repo_storage_path(user, repo.repo_name)
        if not repo_path.exists():
            continue
        total_repos += 1
        for path_obj in _iter_descendants_safely(repo_path):
            if path_obj.is_file():
                try:
                    total_bytes += path_obj.stat().st_size
                except OSError:
                    continue
    return total_bytes, total_repos


def build_handrive_breadcrumbs(
    base_url: str,
    current_dir: str,
    *,
    scoped_home_dir: str = "",
    root_label: str = "HanDrive",
    root_url: str | None = None,
    include_root_parent: bool = False,
    root_parent_label: str = "Hanplanet",
) -> list[dict]:
    effective_root_url = root_url or base_url
    if not scoped_home_dir:
        breadcrumbs = [{"label": root_label, "url": effective_root_url, "is_current": current_dir == "", "path": ""}]
        if not current_dir:
            return breadcrumbs

        parts = [part for part in current_dir.split("/") if part]
        for index, part in enumerate(parts):
            parent_path = "/".join(parts[: index + 1])
            breadcrumbs.append(
                {
                    "label": part,
                    "url": build_handrive_list_url(base_url, parent_path),
                    "is_current": index == len(parts) - 1,
                    "path": parent_path,
                }
            )
        return breadcrumbs

    current_parts = [part for part in current_dir.split("/") if part]
    home_parts = [part for part in scoped_home_dir.split("/") if part]
    home_label = home_parts[-1] if home_parts else scoped_home_dir
    breadcrumbs = []
    if include_root_parent:
        breadcrumbs.append(
            {
                "label": root_parent_label,
                "url": effective_root_url,
                "is_current": False,
                "path": "",
            }
        )
    breadcrumbs.append(
        {
            "label": home_label,
            "url": build_handrive_list_url(base_url, scoped_home_dir),
            "is_current": current_dir == scoped_home_dir,
            "path": scoped_home_dir,
        }
    )
    start_index = len(home_parts) if current_parts[: len(home_parts)] == home_parts else 0
    for index in range(start_index, len(current_parts)):
        part = current_parts[index]
        parent_path = "/".join(current_parts[: index + 1])
        breadcrumbs.append(
            {
                "label": part,
                "url": build_handrive_list_url(base_url, parent_path),
                "is_current": index == len(current_parts) - 1,
                "path": parent_path,
            }
        )
    return breadcrumbs


def get_handrive_root_label(request, scoped_home_dir: str = "") -> str:
    if scoped_home_dir:
        home_parts = [part for part in scoped_home_dir.split("/") if part]
        return home_parts[-1] if home_parts else scoped_home_dir
    return "HanDrive"


def get_handrive_js_root_label(request, scoped_home_dir: str = "") -> str:
    return get_handrive_root_label(request, scoped_home_dir)


def is_handrive_editor(request) -> bool:
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated):
        return False
    if user.is_superuser:
        return True
    return user.has_perm(DOCS_EDIT_PERMISSION_CODE)


def is_handrive_acl_admin(request) -> bool:
    user = getattr(request, "user", None)
    if not (user and user.is_authenticated):
        return False
    return bool(user.is_staff or user.is_superuser)


def require_handrive_superuser(view_func):
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        user = getattr(request, "user", None)
        if not (user and user.is_authenticated and user.is_superuser):
            raise PermissionDenied("관리자 권한이 필요합니다.")
        return view_func(request, *args, **kwargs)

    return _wrapped


def require_handrive_editor_json(view_func):
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if not is_handrive_editor(request):
            return json_error("파일 수정 권한이 필요합니다.", status=403)
        return view_func(request, *args, **kwargs)

    return _wrapped


def require_handrive_acl_admin_json(view_func):
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if not is_handrive_acl_admin(request):
            return json_error("권한 관리는 관리자만 사용할 수 있습니다.", status=403)
        return view_func(request, *args, **kwargs)

    return _wrapped


def resolve_next_url(request, fallback_url: str) -> str:
    candidate = (request.POST.get("next") or request.GET.get("next") or "").strip()
    if candidate and url_has_allowed_host_and_scheme(
        url=candidate,
        allowed_hosts=_collect_allowed_return_hosts(request),
        require_https=request.is_secure(),
    ):
        return candidate
    return fallback_url


def resolve_auth_breadcrumb_url(request, fallback_url: str) -> str:
    next_url = resolve_next_url(request, fallback_url)
    if next_url and next_url != fallback_url:
        return next_url

    referer = str(request.META.get("HTTP_REFERER", "") or "").strip()
    if referer and url_has_allowed_host_and_scheme(
        url=referer,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        parsed = urlparse(referer)
        referer_path = parsed.path or "/"
        if not DOCS_LOGOUT_PATH_PATTERN.match(referer_path):
            return referer_path

    return fallback_url


def is_handrive_share_auth_entry(request, fallback_url: str) -> bool:
    next_url = resolve_next_url(request, fallback_url)
    if "/handrive/share/" in next_url or "/handrive/share/" in next_url:
        return True

    referer = str(request.META.get("HTTP_REFERER", "") or "").strip()
    if referer and url_has_allowed_host_and_scheme(
        url=referer,
        allowed_hosts={request.get_host()},
        require_https=request.is_secure(),
    ):
        parsed = urlparse(referer)
        return "/handrive/share/" in (parsed.path or "") or "/handrive/share/" in (parsed.path or "")

    return False


def get_global_help_root() -> Path:
    """헬프 파일은 사용자별이 아닌 전역 콘텐츠 — 슈퍼유저 여부와 무관하게 고정 경로 사용."""
    return Path(settings.MEDIA_ROOT) / "HanDrive" / MARKDOWN_HELP_DIRECTORY


def get_markdown_help_candidates(ui_lang: str | None) -> list[Path]:
    help_root = get_global_help_root()
    markdown_help_candidates: list[Path] = []
    if ui_lang == "en":
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_EN)
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_KO)
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_EN_DOT_LEGACY)
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_KO_DOT_LEGACY)
    else:
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_KO)
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_EN)
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_KO_DOT_LEGACY)
        markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_EN_DOT_LEGACY)
    markdown_help_candidates.append(help_root / MARKDOWN_HELP_FILENAME_LEGACY)

    try:
        handrive_root = handrive_root_dir()
    except OSError:
        handrive_root = None

    # Backward compatibility for older deployments that still have root-level help files.
    if handrive_root is not None:
        if ui_lang == "en":
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_EN)
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_KO)
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_EN_DOT_LEGACY)
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_KO_DOT_LEGACY)
        else:
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_KO)
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_EN)
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_KO_DOT_LEGACY)
            markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_EN_DOT_LEGACY)
        markdown_help_candidates.append(handrive_root / MARKDOWN_HELP_FILENAME_LEGACY)
    return markdown_help_candidates


def resolve_markdown_help_file(ui_lang: str | None) -> Path | None:
    for markdown_help_path in get_markdown_help_candidates(ui_lang):
        if markdown_help_path.exists() and markdown_help_path.is_file():
            return markdown_help_path
    return None


def get_page_help_candidates(ui_lang: str | None, page_type: str) -> list[Path]:
    help_root = get_global_help_root()
    base_name = PAGE_HELP_FILE_BASENAMES.get(page_type)
    if not base_name:
        return []

    preferred_lang = "en" if ui_lang == "en" else "ko"
    secondary_lang = "ko" if preferred_lang == "en" else "en"
    return [
        help_root / f"{base_name}_{preferred_lang}{DOCS_FILE_EXTENSION}",
        help_root / f"{base_name}_{secondary_lang}{DOCS_FILE_EXTENSION}",
        help_root / f"{base_name}.{preferred_lang}{DOCS_FILE_EXTENSION}",
        help_root / f"{base_name}.{secondary_lang}{DOCS_FILE_EXTENSION}",
        help_root / f"{base_name}{DOCS_FILE_EXTENSION}",
    ]


def resolve_page_help_file(ui_lang: str | None, page_type: str) -> Path | None:
    for page_help_path in get_page_help_candidates(ui_lang, page_type):
        if page_help_path.exists() and page_help_path.is_file():
            return page_help_path
    return None


def build_page_help_html(ui_lang: str | None, page_type: str, handrive_text: dict) -> str:
    page_help_path = resolve_page_help_file(ui_lang, page_type)
    try:
        if page_help_path is not None:
            return render_markdown_safely(page_help_path.read_text(encoding="utf-8"))
        fallback_markdown = (
            f"# {handrive_text.get('help_button', 'Help')}\n\n"
            f"{handrive_text['markdown_help_fallback_missing']}"
        )
    except OSError:
        fallback_markdown = (
            f"# {handrive_text.get('help_button', 'Help')}\n\n"
            f"{handrive_text['markdown_help_fallback_read_error']}"
        )
    return render_markdown_safely(fallback_markdown)


def build_handrive_help_url(ui_lang: str | None, handrive_base_url: str) -> str:
    help_file = resolve_markdown_help_file(ui_lang)
    if help_file is None:
        return handrive_base_url

    try:
        help_relative = relative_from_root(help_file)
    except ValueError:
        return handrive_base_url
    help_slug = markdown_slug_from_relative(help_relative)

    if ui_lang in SUPPORTED_UI_LANGS:
        return reverse("main:handrive_view_lang", kwargs={"ui_lang": ui_lang, "doc_path": help_slug})
    return reverse("main:handrive_view", kwargs={"doc_path": help_slug})


def build_handrive_view_url(ui_lang: str | None, slug_path: str) -> str:
    if ui_lang in SUPPORTED_UI_LANGS:
        return reverse("main:handrive_view_lang", kwargs={"ui_lang": ui_lang, "doc_path": slug_path})
    return reverse("main:handrive_view", kwargs={"doc_path": slug_path})


def build_handrive_shared_view_url(ui_lang: str | None, owner_username: str, share_slug: str) -> str:
    if ui_lang in SUPPORTED_UI_LANGS:
        return reverse(
            "main:handrive_shared_view_lang",
            kwargs={"ui_lang": ui_lang, "owner_username": owner_username, "share_slug": share_slug},
        )
    return reverse("main:handrive_shared_view", kwargs={"owner_username": owner_username, "share_slug": share_slug})


def build_handrive_shared_view_child_url(
    ui_lang: str | None,
    owner_username: str,
    share_slug: str,
    child_path: str = "",
) -> str:
    base_url = build_handrive_shared_view_url(ui_lang, owner_username, share_slug)
    normalized_child_path = normalize_relative_path(child_path, allow_empty=True)
    if not normalized_child_path:
        return base_url
    return f"{base_url.rstrip('/')}/{quote(normalized_child_path)}"


def build_handrive_shared_breadcrumbs(
    request,
    ui_lang: str | None,
    shared_context: dict,
    current_path: str,
) -> list[dict]:
    owner_username = str(shared_context.get("owner_username") or "")
    share_slug = str(shared_context.get("share_slug") or "")
    shared_root = normalize_relative_path(shared_context.get("root_path"), allow_empty=False)
    normalized_current = normalize_relative_path(current_path, allow_empty=True)
    if normalized_current != shared_root and not normalized_current.startswith(shared_root + "/"):
        normalized_current = shared_root

    base_url = build_handrive_shared_view_url(ui_lang, owner_username, share_slug)
    root_label = Path(shared_root).name or shared_root
    breadcrumbs = [
        {
            "label": owner_username,
            "url": base_url,
            "is_current": False,
            "path": shared_root,
        },
        {
            "label": root_label,
            "url": base_url,
            "is_current": normalized_current == shared_root,
            "path": shared_root,
        },
    ]
    if normalized_current == shared_root:
        return breadcrumbs

    relative_child_path = normalized_current[len(shared_root) + 1:]
    child_parts = [part for part in relative_child_path.split("/") if part]
    accumulated_parts = []
    for index, part in enumerate(child_parts):
        accumulated_parts.append(part)
        child_path = "/".join(accumulated_parts)
        absolute_path = f"{shared_root}/{child_path}"
        breadcrumbs.append(
            {
                "label": part,
                "url": build_handrive_shared_view_child_url(ui_lang, owner_username, share_slug, child_path),
                "is_current": index == len(child_parts) - 1,
                "path": absolute_path,
            }
        )
    return breadcrumbs


def append_handrive_share_query(url: str, owner_username: str = "", share_slug: str = "") -> str:
    if not owner_username or not share_slug:
        return url
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}share_owner={quote(owner_username)}&share_slug={quote(share_slug)}"


def build_handrive_share_slug(relative_path: str) -> str:
    base_name = Path(markdown_slug_from_relative(relative_path)).name.strip()
    return base_name or "document"


def get_unique_handrive_share_slug(owner, relative_path: str, *, exclude_path: str | None = None) -> str:
    base_slug = build_handrive_share_slug(relative_path)
    candidate = base_slug
    suffix = 2
    queryset = HandriveSharedLink.objects.filter(owner=owner)
    if exclude_path:
        queryset = queryset.exclude(path=exclude_path)
    existing_slugs = set(queryset.values_list("share_slug", flat=True))
    while candidate in existing_slugs:
        candidate = f"{base_slug}-{suffix}"
        suffix += 1
    return candidate


def ensure_handrive_shared_link(path_value: str, owner) -> HandriveSharedLink:
    shared_link = HandriveSharedLink.objects.filter(path=path_value).select_related("owner").first()
    if shared_link:
        return shared_link
    share_slug = get_unique_handrive_share_slug(owner, path_value)
    return HandriveSharedLink.objects.create(path=path_value, owner=owner, share_slug=share_slug)


def build_handrive_existing_share_info(request, path_value: str) -> dict:
    """Return share URL details for direct or inherited URL-only links."""
    empty = {"share_url": "", "share_is_inherited": False}
    if not request or not path_value or not is_handrive_url_only_enabled(request, path_value):
        return empty
    try:
        normalized_path = normalize_relative_path(path_value, allow_empty=False)
    except ValueError:
        return empty

    ui_lang = resolve_ui_lang(request, getattr(getattr(request, "resolver_match", None), "kwargs", {}).get("ui_lang"))
    shared_context = get_handrive_shared_access_context(request)
    if shared_context:
        shared_root = str(shared_context["root_path"] or "").strip()
        if normalized_path == shared_root or normalized_path.startswith(shared_root + "/"):
            child_path = "" if normalized_path == shared_root else normalized_path[len(shared_root) + 1:]
            return {
                "share_url": request.build_absolute_uri(
                    build_handrive_shared_view_child_url(
                        ui_lang,
                        shared_context["owner_username"],
                        shared_context["share_slug"],
                        child_path,
                    )
                ),
                "share_is_inherited": bool(child_path),
            }

    candidate_paths = [normalized_path]
    parent_path = Path(normalized_path).parent
    while str(parent_path) not in ("", "."):
        candidate_paths.append(str(parent_path))
        parent_path = parent_path.parent

    shared_links = list(
        HandriveSharedLink.objects.select_related("owner").filter(path__in=candidate_paths)
    )
    shared_link_by_path = {shared_link.path: shared_link for shared_link in shared_links}
    shared_link = next(
        (
            shared_link_by_path[candidate_path]
            for candidate_path in candidate_paths[1:]
            if candidate_path in shared_link_by_path and is_handrive_url_only_enabled(request, candidate_path)
        ),
        None,
    )
    if shared_link is None and normalized_path in shared_link_by_path and is_handrive_url_only_enabled(request, normalized_path):
        shared_link = shared_link_by_path[normalized_path]
    if shared_link is None:
        return empty

    child_path = "" if shared_link.path == normalized_path else normalized_path[len(shared_link.path) + 1:]
    return {
        "share_url": request.build_absolute_uri(
            build_handrive_shared_view_child_url(ui_lang, shared_link.owner.username, shared_link.share_slug, child_path)
        ),
        "share_is_inherited": bool(child_path),
    }


def build_handrive_existing_share_url(request, path_value: str) -> str:
    """Return the absolute share URL for an existing URL-only link, including inherited folder shares."""
    return build_handrive_existing_share_info(request, path_value)["share_url"]


def move_handrive_shared_links(source_path: str, destination_path: str) -> None:
    normalized_source = normalize_relative_path(source_path, allow_empty=False)
    normalized_destination = normalize_relative_path(destination_path, allow_empty=False)
    links = list(HandriveSharedLink.objects.filter(path=normalized_source) | HandriveSharedLink.objects.filter(path__startswith=normalized_source + "/"))
    for link in links:
        old_path = link.path
        if old_path == normalized_source:
            link.path = normalized_destination
        else:
            link.path = normalized_destination + old_path[len(normalized_source):]
        link.save(update_fields=["path", "updated_at"])


def delete_handrive_shared_links_for_path(path_value: str) -> None:
    normalized = normalize_relative_path(path_value, allow_empty=False)
    HandriveSharedLink.objects.filter(path=normalized).delete()
    HandriveSharedLink.objects.filter(path__startswith=normalized + "/").delete()


def handrive_common_context(request, ui_lang):
    """HanDrive 전 페이지가 공유하는 기본 템플릿 context를 구성한다."""
    context = {}
    apply_ui_context(request, context, ui_lang)
    handrive_text = get_handrive_text(ui_lang)

    if ui_lang in SUPPORTED_UI_LANGS:
        handrive_base_url = reverse("main:handrive_root_lang", kwargs={"ui_lang": ui_lang})
        handrive_write_url = reverse("main:handrive_write_lang", kwargs={"ui_lang": ui_lang})
        handrive_login_url = reverse("main:handrive_login_lang", kwargs={"ui_lang": ui_lang})
        handrive_signup_url = reverse("main:handrive_signup_lang", kwargs={"ui_lang": ui_lang})
        handrive_logout_url = reverse("main:handrive_logout_lang", kwargs={"ui_lang": ui_lang})
        handrive_ops_apply_static_url = reverse("main:handrive_ops_apply_static_lang", kwargs={"ui_lang": ui_lang})
    else:
        handrive_base_url = reverse("main:handrive_root")
        handrive_write_url = reverse("main:handrive_write")
        handrive_login_url = reverse("main:handrive_login")
        handrive_signup_url = reverse("main:handrive_signup")
        handrive_logout_url = reverse("main:handrive_logout")
        handrive_ops_apply_static_url = reverse("main:handrive_ops_apply_static")
    handrive_help_url = build_handrive_help_url(ui_lang, handrive_base_url)
    handrive_root_url = handrive_base_url
    if request.user.is_authenticated:
        profile = PortfolioProfile.objects.filter(user=request.user).only("profile_img").first()
        handrive_my_portfolio_url = reverse(
            "main:portfolio_user_lang",
            kwargs={"ui_lang": ui_lang, "user_id": request.user.username},
        )
        account_profile_image_url = profile.profile_img.url if profile and profile.profile_img else ""
        account_display_name = get_account_display_name(request.user)
        account_email = str(request.user.email or "").strip()
        if ui_lang in SUPPORTED_UI_LANGS:
            account_profile_upload_url = reverse(
                "main:account_profile_image_upload_lang",
                kwargs={"ui_lang": ui_lang},
            )
        else:
            account_profile_upload_url = reverse("main:account_profile_image_upload")
        _quota_home = get_scoped_handrive_home_dir(request)
        if _quota_home:
            _quota_root, _ = resolve_path(_quota_home, must_exist=False)
            _quota_used, _, _breakdown = calculate_handrive_quota_breakdown(_quota_root)
            _repo_bytes, _repo_count = calculate_handrive_repo_usage(request.user)
            _total_used = _quota_used + _repo_bytes
            _user_quota = get_user_handrive_quota_bytes(request.user)
            handrive_quota_used_bytes = _total_used
            handrive_quota_total_bytes = _user_quota
            handrive_quota_percent = min(100, round(_total_used / _user_quota * 100, 1))
            handrive_quota_used_display = format_handrive_bytes_display(_total_used)
            handrive_quota_total_display = format_handrive_bytes_display(_user_quota)
            _free_bytes = max(0, _user_quota - _total_used)
            handrive_quota_free_bytes = _free_bytes
            handrive_quota_free_display = format_handrive_bytes_display(_free_bytes)
            handrive_quota_free_percent = round(_free_bytes / _user_quota * 100, 2)
            handrive_quota_breakdown = [
                {
                    "key": key,
                    "label": label,
                    "color": color,
                    "bytes": _breakdown[key]["bytes"],
                    "count": _breakdown[key]["count"],
                    "display": format_handrive_bytes_display(_breakdown[key]["bytes"]),
                    "percent": round(_breakdown[key]["bytes"] / _user_quota * 100, 2),
                }
                for key, label, color in _DOCS_QUOTA_TYPE_META
            ]
            if _repo_count > 0:
                handrive_quota_breakdown.append({
                    "key": "repo",
                    "label": "리포지토리",
                    "color": "#7c3aed",
                    "bytes": _repo_bytes,
                    "count": _repo_count,
                    "display": format_handrive_bytes_display(_repo_bytes),
                    "percent": round(_repo_bytes / _user_quota * 100, 2),
                })
        else:
            handrive_quota_used_bytes = None
            handrive_quota_total_bytes = None
            handrive_quota_percent = None
            handrive_quota_used_display = ""
            handrive_quota_total_display = ""
            handrive_quota_free_bytes = None
            handrive_quota_free_display = ""
            handrive_quota_free_percent = None
            handrive_quota_breakdown = []
    else:
        handrive_my_portfolio_url = reverse("main:main_lang", kwargs={"ui_lang": ui_lang})
        account_profile_image_url = ""
        account_display_name = ""
        account_email = ""
        account_profile_upload_url = ""
        handrive_quota_used_bytes = None
        handrive_quota_total_bytes = None
        handrive_quota_percent = None
        handrive_quota_used_display = ""
        handrive_quota_total_display = ""
        handrive_quota_free_bytes = None
        handrive_quota_free_display = ""
        handrive_quota_free_percent = None
        handrive_quota_breakdown = []

    context.update(
        {
            "meta_title": DOCS_META_TITLE,
            "meta_og_title": DOCS_META_TITLE,
            "meta_site_name": DOCS_META_TITLE,
            "meta_description": DOCS_META_DESCRIPTION,
            "meta_og_description": DOCS_META_DESCRIPTION,
            "meta_robots": "index,follow",
            "handrive_base_url": handrive_base_url,
            "handrive_root_url": handrive_root_url,
            "handrive_write_url": handrive_write_url,
            "handrive_login_url": handrive_login_url,
            "handrive_signup_url": handrive_signup_url,
            "handrive_logout_url": handrive_logout_url,
            "handrive_ops_apply_static_url": handrive_ops_apply_static_url,
            "handrive_auth_next": request.get_full_path(),
            "handrive_logout_next": handrive_base_url,
            "handrive_help_url": handrive_help_url,
            "handrive_my_portfolio_url": handrive_my_portfolio_url,
            "account_my_portfolio_url": handrive_my_portfolio_url,
            "account_logout_form_id": "auth-logout-form",
            "account_logout_next": handrive_base_url,
            "account_logout_url": handrive_logout_url,
            "account_profile_image_url": account_profile_image_url,
            "account_display_name": account_display_name,
            "account_email": account_email,
            "account_profile_upload_url": account_profile_upload_url,
            "handrive_api_list_url": reverse("main:handrive_api_list"),
            "handrive_api_search_url": reverse("main:handrive_api_search"),
            "handrive_api_save_url": reverse("main:handrive_api_save"),
            "handrive_api_preview_url": reverse("main:handrive_api_preview"),
            "handrive_api_rename_url": reverse("main:handrive_api_rename"),
            "handrive_api_delete_url": reverse("main:handrive_api_delete"),
            "handrive_api_mkdir_url": reverse("main:handrive_api_mkdir"),
            "handrive_api_move_url": reverse("main:handrive_api_move"),
            "handrive_api_archive_extract_url": reverse("main:handrive_api_archive_extract"),
            "handrive_api_archive_create_url": reverse("main:handrive_api_archive_create"),
            "handrive_api_upload_url": reverse("main:handrive_api_upload"),
            "handrive_api_upload_cancel_url": reverse("main:handrive_api_upload_cancel"),
            "handrive_api_download_url": reverse("main:handrive_api_download"),
            "handrive_api_acl_url": reverse("main:handrive_api_acl"),
            "handrive_api_acl_options_url": reverse("main:handrive_api_acl_options"),
            "handrive_api_url_share_url": reverse("main:handrive_api_url_share"),
            "handrive_api_sync_settings_url": reverse("main:handrive_api_sync_settings"),
            "handrive_api_map_create_url": reverse("main:handrive_api_map_create"),
            "handrive_api_map_data_url": reverse("main:handrive_api_map_data"),
            "handrive_api_map_icon_upload_url": reverse("main:handrive_api_map_icon_upload"),
            "handrive_api_map_icon_delete_url": reverse("main:handrive_api_map_icon_delete"),
            "handrive_api_folder_icon_upload_url": reverse("main:handrive_api_folder_icon_upload"),
            "handrive_api_folder_icon_delete_url": reverse("main:handrive_api_folder_icon_delete"),
            "handrive_api_map_image_url": reverse("main:handrive_api_map_image"),
            "handrive_map_editor_base_url": "/handrive/map-editor/",
            "handrive_map_viewer_base_url": "/handrive/map-viewer/",
            "handrive_image_editor_save_url": reverse("main:handrive_api_image_editor_save"),
            "handrive_can_edit": has_handrive_directory_write_access(request, ""),
            "handrive_can_manage_acl": is_handrive_acl_admin(request),
            "handrive_file_extension_options": get_handrive_save_extension_options(),
            "handrive_text": handrive_text,
            "handrive_quota_used_bytes": handrive_quota_used_bytes,
            "handrive_quota_total_bytes": handrive_quota_total_bytes,
            "handrive_quota_percent": handrive_quota_percent,
            "handrive_quota_used_display": handrive_quota_used_display,
            "handrive_quota_total_display": handrive_quota_total_display,
            "handrive_quota_free_bytes": handrive_quota_free_bytes,
            "handrive_quota_free_display": handrive_quota_free_display,
            "handrive_quota_free_percent": handrive_quota_free_percent,
            "handrive_quota_breakdown": handrive_quota_breakdown,
        }
    )
    return context


def handrive_csrf_failure(request, reason="", template_name="403_csrf.html"):
    path = request.path or ""
    logout_match = DOCS_LOGOUT_PATH_PATTERN.match(path)
    if logout_match:
        matched_lang = (logout_match.group(1) or "").strip().lower()
        if matched_lang in SUPPORTED_UI_LANGS:
            return redirect(reverse("main:handrive_root_lang", kwargs={"ui_lang": matched_lang}))
        return redirect_to_localized_route(request, "main:handrive_root_lang")
    return default_csrf_failure(request, reason=reason, template_name=template_name)


@with_request_handrive_root
def handrive_root(request, ui_lang=None):
    user = getattr(request, "user", None)
    landing_dir = get_handrive_initial_landing_dir(request)
    if landing_dir:
        ensure_scoped_home_dir(landing_dir)
        resolved_lang = resolve_ui_lang(request, ui_lang)
        if resolved_lang in SUPPORTED_UI_LANGS:
            return redirect(
                reverse("main:handrive_list_lang", kwargs={"ui_lang": resolved_lang, "folder_path": landing_dir})
            )
        return redirect(reverse("main:handrive_list", kwargs={"folder_path": landing_dir}))
    return handrive_list(request, folder_path="", ui_lang=ui_lang)


def handrive_root_legacy_redirect(request, ui_lang=None):
    return redirect_to_localized_route(request, "main:handrive_root_lang", ui_lang=ui_lang)


def handrive_list_root_legacy_redirect(request, ui_lang=None):
    return redirect_to_localized_route(request, "main:handrive_root_lang", ui_lang=ui_lang)


def handrive_write_legacy_redirect(request, ui_lang=None):
    return redirect_to_localized_route(request, "main:handrive_write_lang", ui_lang=ui_lang)


def handrive_list_legacy_redirect(request, folder_path, ui_lang=None):
    return redirect_to_localized_route(request, "main:handrive_list_lang", ui_lang=ui_lang, folder_path=folder_path)


def handrive_view_legacy_redirect(request, doc_path, ui_lang=None):
    return redirect_to_localized_route(request, "main:handrive_view_lang", ui_lang=ui_lang, doc_path=doc_path)


def _resolve_handrive_login_target_user(username_value: str | None):
    username = (username_value or "").strip()
    if not username:
        return None
    UserModel = get_user_model()
    try:
        return UserModel.objects.get(username=username)
    except UserModel.DoesNotExist:
        return None


def _get_handrive_login_guard(user):
    if user is None:
        return None
    guard, _ = HandriveLoginAttemptGuard.objects.get_or_create(user=user)
    return guard


def _is_handrive_login_captcha_required(user) -> bool:
    if user is None:
        return False
    guard = HandriveLoginAttemptGuard.objects.filter(user=user).only("captcha_required").first()
    return bool(guard and guard.captcha_required)


def _register_handrive_login_failure(user):
    guard = _get_handrive_login_guard(user)
    if guard is None:
        return
    guard.failed_attempts = int(guard.failed_attempts or 0) + 1
    if guard.failed_attempts >= DOCS_LOGIN_CAPTCHA_THRESHOLD:
        guard.captcha_required = True
    guard.save(update_fields=["failed_attempts", "captcha_required", "updated_at"])


def _issue_session_token(user) -> str:
    """로그인 시 새 session_token 을 발급해 UserProfile 에 저장하고 반환한다."""
    import secrets
    import logging
    log = logging.getLogger(__name__)
    token = secrets.token_hex(32)
    try:
        from main.models import UserProfile
        profile, _ = UserProfile.objects.get_or_create(user=user)
        profile.session_token = token
        profile.save(update_fields=["session_token", "updated_at"])
        log.warning("[_issue_session_token] saved token=%s for user=%s", token[:8], user.username)
    except Exception as e:
        log.warning("[_issue_session_token] FAILED user=%s error=%s", user.username, e)
    return token


def _revoke_session_token(user):
    """로그아웃 시 session_token 을 초기화해 기존 세션을 모두 무효화한다."""
    try:
        profile = user.profile
        profile.session_token = ""
        profile.save(update_fields=["session_token"])
    except Exception:
        pass


def _purge_stale_user_sessions(user):
    """로그인 직전에 만료된 세션만 정리한다."""
    try:
        from django.contrib.sessions.models import Session
        from django.utils import timezone
        Session.objects.filter(expire_date__lte=timezone.now()).delete()
    except Exception:
        pass


def _reset_handrive_login_guard(user):
    if user is None:
        return
    guard = HandriveLoginAttemptGuard.objects.filter(user=user).first()
    if guard is None:
        return
    guard.failed_attempts = 0
    guard.captcha_required = False
    guard.save(update_fields=["failed_attempts", "captcha_required", "updated_at"])


# ── 2FA 헬퍼 ──────────────────────────────────────────────────────────────────

def _generate_and_store_2fa_code(user) -> str:
    """6자리 인증 코드를 생성하고 EmailVerificationCode 레코드를 저장한 뒤 반환한다."""
    from datetime import timedelta
    from django.utils import timezone
    from main.models import EmailVerificationCode
    code = str(secrets.randbelow(900000) + 100000)  # 100000–999999
    expiry = timezone.now() + timedelta(minutes=settings.TWO_FA_CODE_EXPIRY_MINUTES)
    # 기존 미사용 코드를 모두 무효화 (최신 코드만 유효)
    EmailVerificationCode.objects.filter(user=user, used=False).update(used=True)
    EmailVerificationCode.objects.create(user=user, code=code, expires_at=expiry)
    return code


def _send_2fa_email(user, code: str) -> bool:
    """인증 코드를 사용자 이메일로 발송한다. 성공하면 True, 실패하면 False."""
    from django.core.mail import send_mail
    email = str(getattr(user, "email", "") or "").strip()
    if not email:
        return False
    subject = "[Hanplanet] 이메일 인증 코드"
    body = (
        f"안녕하세요,\n\n"
        f"Hanplanet 로그인 인증 코드입니다.\n\n"
        f"인증 코드: {code}\n\n"
        f"이 코드는 {settings.TWO_FA_CODE_EXPIRY_MINUTES}분 후 만료됩니다.\n"
        f"본인이 요청하지 않은 경우 이 메일을 무시하세요."
    )
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [email])
        return True
    except Exception:
        logger.exception("[2FA] Failed to send verification email to user %s", getattr(user, "username", "?"))
        return False


def _verify_2fa_code(user, submitted_code: str) -> bool:
    """제출된 코드가 유효한지 확인하고, 유효하면 used=True로 표시한다."""
    from django.utils import timezone
    from main.models import EmailVerificationCode
    submitted = str(submitted_code or "").strip()
    if not submitted:
        return False
    record = (
        EmailVerificationCode.objects
        .filter(user=user, code=submitted, used=False, expires_at__gt=timezone.now())
        .order_by("-created_at")
        .first()
    )
    if record is None:
        return False
    record.used = True
    record.save(update_fields=["used"])
    return True


def _read_device_token(request) -> str:
    """쿠키에서 디바이스 토큰을 읽는다. 없으면 빈 문자열 반환."""
    cookie_name = getattr(settings, "TWO_FA_DEVICE_COOKIE_NAME", "hp_device_id")
    return str(request.COOKIES.get(cookie_name, "") or "").strip()


def _is_device_trusted(user, device_token: str) -> bool:
    """디바이스 토큰이 3일 이내에 사용된 신뢰 기기인지 확인한다.
    만료된 레코드는 이 자리에서 lazy 삭제한다."""
    if not device_token:
        return False
    from datetime import timedelta
    from django.utils import timezone
    from main.models import TrustedDevice
    cutoff = timezone.now() - timedelta(days=settings.TWO_FA_DEVICE_TRUSTED_DAYS)
    # 3일 초과된 해당 유저의 레코드 삭제 (lazy cleanup)
    TrustedDevice.objects.filter(user=user, last_seen_at__lt=cutoff).delete()
    record = TrustedDevice.objects.filter(
        user=user, device_token=device_token, last_seen_at__gte=cutoff
    ).first()
    if record is None:
        return False
    # 마지막 확인 시각 갱신
    record.last_seen_at = timezone.now()
    record.save(update_fields=["last_seen_at"])
    return True


def _register_trusted_device(user, device_token: str) -> None:
    """신뢰된 기기 레코드를 생성하거나 last_seen_at을 갱신한다."""
    from django.utils import timezone
    from main.models import TrustedDevice
    TrustedDevice.objects.update_or_create(
        device_token=device_token,
        defaults={"user": user, "last_seen_at": timezone.now()},
    )


def _set_device_cookie(response, device_token: str) -> None:
    """응답에 hp_device_id 쿠키를 설정한다 (90일 유효)."""
    cookie_name = getattr(settings, "TWO_FA_DEVICE_COOKIE_NAME", "hp_device_id")
    response.set_cookie(
        cookie_name,
        device_token,
        max_age=60 * 60 * 24 * 90,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="Lax",
    )


def _clear_2fa_pending_session(request) -> None:
    """세션에서 2FA pending 상태를 모두 제거한다."""
    cleared = False
    for key in (
        HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY,
        HANDRIVE_2FA_PENDING_NEXT_URL_SESSION_KEY,
        HANDRIVE_2FA_PENDING_UI_LANG_SESSION_KEY,
        HANDRIVE_2FA_PENDING_FORGEJO_KEY_SESSION_KEY,
        HANDRIVE_2FA_PENDING_REQUIRES_ATTACH_SESSION_KEY,
    ):
        if key in request.session:
            request.session.pop(key, None)
            cleared = True
    if cleared:
        request.session.modified = True


def _set_2fa_pending_session(
    request,
    user,
    target_url: str,
    ui_lang: str,
    forgejo_session_key: str | None,
    requires_direct_attach: bool,
) -> None:
    """새 2FA 대상 계정으로 pending 상태를 교체한다."""
    _clear_2fa_pending_session(request)
    request.session[HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY] = user.pk
    request.session[HANDRIVE_2FA_PENDING_NEXT_URL_SESSION_KEY] = target_url
    request.session[HANDRIVE_2FA_PENDING_UI_LANG_SESSION_KEY] = ui_lang
    request.session[HANDRIVE_2FA_PENDING_FORGEJO_KEY_SESSION_KEY] = forgejo_session_key or ""
    request.session[HANDRIVE_2FA_PENDING_REQUIRES_ATTACH_SESSION_KEY] = requires_direct_attach
    request.session.modified = True


def _mask_email(email: str) -> str:
    """'user@example.com' → 'us**@example.com' 형태로 이메일을 가린다."""
    if not email or "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    visible = local[:2] if len(local) >= 2 else local[:1]
    return f"{visible}{'*' * max(2, len(local) - 2)}@{domain}"


def _complete_login_or_require_2fa(
    request,
    user,
    target_url: str,
    ui_lang,
    *,
    forgejo_session_key,
    requires_direct_attach: bool,
    captcha_was_shown: bool = False,
    on_2fa_needed=None,
):
    """비밀번호 검증 후 최종 로그인 완료 또는 2FA 흐름으로 분기한다.

    1. 이메일 없음 → /register-email/ 로 유도
    2. 신뢰된 기기   → 즉시 로그인 완료
    3. 새 기기       → 2FA 코드 발송 후 /2fa-verify/ 로 redirect
    """
    if captcha_was_shown:
        _clear_handrive_login_captcha(request)

    resolved_ui_lang = str(ui_lang or "ko").strip() or "ko"

    # 1) 이메일이 없는 경우 → 이메일 등록 유도
    user_email = str(getattr(user, "email", "") or "").strip()
    if not user_email:
        _set_2fa_pending_session(
            request,
            user,
            target_url,
            resolved_ui_lang,
            forgejo_session_key,
            requires_direct_attach,
        )
        register_url = reverse("main:handrive_register_email_lang", kwargs={"ui_lang": resolved_ui_lang})
        return redirect(register_url)

    # 2) 신뢰된 기기인지 확인
    device_token = _read_device_token(request)
    if device_token and _is_device_trusted(user, device_token):
        _reset_handrive_login_guard(user)
        _purge_stale_user_sessions(user)
        token = _issue_session_token(user)
        auth_login(request, user)
        request.session["_hp_session_token"] = token
        if not requires_direct_attach:
            response = _build_post_hanplanet_login_response(target_url, user)
        else:
            response = _build_forgejo_redirect_base(target_url)
            if forgejo_session_key:
                response = _apply_forgejo_session_cookie(response, forgejo_session_key)
        _set_device_cookie(response, device_token)
        return response

    # 3) 새 기기 → 2FA 필요
    code = _generate_and_store_2fa_code(user)
    email_sent = _send_2fa_email(user, code)
    if not email_sent:
        logger.error("[2FA] Email send failed for user %s, email=%s", user.username, user.email)
        if on_2fa_needed is not None:
            # 인라인 표시: 발송 실패 에러를 caller가 처리
            return on_2fa_needed(_mask_email(user_email), send_failed=True)
        login_url = reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_ui_lang})
        return redirect(f"{login_url}?2fa_error=send_failed")

    _set_2fa_pending_session(
        request,
        user,
        target_url,
        resolved_ui_lang,
        forgejo_session_key,
        requires_direct_attach,
    )

    if on_2fa_needed is not None:
        # 인라인 표시: 같은 페이지에서 2FA 코드 입력창 노출
        return on_2fa_needed(_mask_email(user_email))

    verify_url = reverse("main:handrive_2fa_verify_lang", kwargs={"ui_lang": resolved_ui_lang})
    return redirect(verify_url)


def _verify_handrive_turnstile_token(token: str | None, remote_ip: str | None) -> bool:
    # 디버그 모드에서는 항상 통과
    if settings.DEBUG:
        return True
        
    secret_key = str(getattr(settings, "TURNSTILE_SECRET_KEY", "") or "").strip()
    if not secret_key:
        return False
    response_token = str(token or "").strip()
    if not response_token:
        return False

    payload = {
        "secret": secret_key,
        "response": response_token,
    }
    if remote_ip:
        payload["remoteip"] = str(remote_ip).strip()

    try:
        response = httpx.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data=payload,
            timeout=5.0,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError):
        return False
    return bool(data.get("success"))


def _clear_handrive_login_captcha(request):
    request.session.pop(HANDRIVE_LOGIN_CAPTCHA_QUESTION_SESSION_KEY, None)
    request.session.pop(HANDRIVE_LOGIN_CAPTCHA_ANSWER_SESSION_KEY, None)


def _build_handrive_login_captcha(request, refresh: bool = False) -> str:
    if not refresh:
        existing_question = str(request.session.get(HANDRIVE_LOGIN_CAPTCHA_QUESTION_SESSION_KEY, "") or "").strip()
        existing_answer = str(request.session.get(HANDRIVE_LOGIN_CAPTCHA_ANSWER_SESSION_KEY, "") or "").strip()
        if existing_question and existing_answer:
            return existing_question

    left = secrets.randbelow(8) + 2
    right = secrets.randbelow(8) + 2
    question = f"{left} + {right} = ?"
    request.session[HANDRIVE_LOGIN_CAPTCHA_QUESTION_SESSION_KEY] = question
    request.session[HANDRIVE_LOGIN_CAPTCHA_ANSWER_SESSION_KEY] = str(left + right)
    request.session.modified = True
    return question


def _verify_handrive_login_captcha_answer(request) -> bool:
    expected = str(request.session.get(HANDRIVE_LOGIN_CAPTCHA_ANSWER_SESSION_KEY, "") or "").strip()
    provided = str(request.POST.get("handrive-captcha-answer", "") or "").strip()
    if not expected or not provided:
        return False
    return provided == expected


def _resolve_handrive_post_login_url(request, ui_lang: str | None, fallback_next_url: str, user) -> str:
    fallback_path = urlparse(str(fallback_next_url or "")).path
    if fallback_path and not re.match(r"^/(?:(ko|en)/)?(?:docs|ide|handrive)(/|$)", fallback_path):
        return fallback_next_url

    # lang 없는 handrive URL이면 lang 붙인 버전으로 교정
    if ui_lang in SUPPORTED_UI_LANGS:
        lang_base = reverse("main:handrive_root_lang", kwargs={"ui_lang": ui_lang})
    else:
        lang_base = reverse("main:handrive_root")

    if re.match(r"^/(?:(ko|en)/)?handrive/all/list/?$", fallback_path):
        return lang_base

    # Preserve explicit shared-link destinations. The scoped landing directory is
    # only a fallback for generic HanDrive entry points, not a replacement for
    # a user-selected shared URL.
    if re.match(r"^/(?:(ko|en)/)?handrive/share(?:/|$)", fallback_path):
        return fallback_next_url

    landing_dir = get_handrive_initial_landing_dir(request)
    if user and user.is_authenticated and landing_dir:
        ensure_scoped_home_dir(landing_dir)
        if ui_lang in SUPPORTED_UI_LANGS:
            return reverse("main:handrive_list_lang", kwargs={"ui_lang": ui_lang, "folder_path": landing_dir})
        return reverse("main:handrive_list", kwargs={"folder_path": landing_dir})
    return lang_base


class HandriveSignupForm(UserCreationForm):
    first_name = forms.CharField(max_length=150, required=False)
    email = forms.EmailField(required=True)
    privacy_consent = forms.BooleanField(required=True)
    # 이메일 AJAX 인증 완료 후 서버에서 발급한 서명 토큰 (hidden)
    email_2fa_token = forms.CharField(required=False, widget=forms.HiddenInput)

    def __init__(self, *args, ui_lang: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        handrive_text = get_handrive_text(ui_lang)
        self.fields["first_name"].label = handrive_text.get("auth_name_label", "이름")
        self.fields["email"].label = handrive_text.get("auth_email_label", "이메일 주소")
        self.fields["privacy_consent"].label = handrive_text.get("auth_privacy_consent_label", "개인정보 처리방침 및 이용약관에 동의합니다.")
        self.fields["privacy_consent"].error_messages = {
            "required": handrive_text.get("auth_privacy_consent_error", "개인정보 처리방침 및 이용약관 동의가 필요합니다."),
        }
        self._handrive_text = handrive_text
        self.fields["username"].widget.attrs.update({"autocomplete": "username", "placeholder": "아이디를 입력하세요"})
        self.fields["password1"].widget.attrs.update({"autocomplete": "new-password", "placeholder": "비밀번호 입력"})
        self.fields["password2"].widget.attrs.update({"autocomplete": "new-password", "placeholder": "비밀번호 다시 입력"})
        self.fields["first_name"].widget.attrs.update({"autocomplete": "name", "placeholder": "이름 입력"})
        self.fields["email"].widget.attrs.update({"autocomplete": "email", "placeholder": "example@email.com", "id": "id_signup_email"})

    def clean_email(self):
        email = str(self.cleaned_data.get("email", "") or "").strip()
        if not email:
            raise ValidationError("이메일 주소를 입력해주세요.")
        return email

    def clean(self):
        from django.core import signing
        cleaned = super().clean()
        token = str(cleaned.get("email_2fa_token", "") or "").strip()
        email = str(cleaned.get("email", "") or "").strip()
        not_verified_msg = (
            getattr(self, "_handrive_text", {}).get("auth_2fa_email_not_verified", "이메일 인증을 완료해주세요.")
        )
        if not token:
            self.add_error(None, not_verified_msg)
            return cleaned
        if email:
            try:
                data = signing.loads(token, salt="signup-email-verified", max_age=30 * 60)
                if data.get("email") != email:
                    self.add_error(None, not_verified_msg)
            except Exception:
                self.add_error(None, not_verified_msg)
        return cleaned

    def save(self, commit=True):
        user = super().save(commit=False)
        user.first_name = str(self.cleaned_data.get("first_name", "") or "").strip()
        user.email = str(self.cleaned_data.get("email", "") or "").strip()
        if commit:
            user.save()
        return user

    def _contains_forbidden_term(self, value: str) -> bool:
        lowered = value.lower()
        return any(term in lowered for term in DOCS_SIGNUP_FORBIDDEN_TERMS)

    def clean_username(self):
        username = str(self.cleaned_data.get("username", "") or "").strip()
        if self._contains_forbidden_term(username):
            raise ValidationError("아이디에 사용할 수 없는 단어가 포함되어 있습니다.")
        if DOCS_SIGNUP_SQL_PATTERN.search(username):
            raise ValidationError("아이디에 SQL 구문으로 해석될 수 있는 입력은 사용할 수 없습니다.")
        return username

    def clean_password1(self):
        password = str(self.cleaned_data.get("password1", "") or "")
        if self._contains_forbidden_term(password):
            raise ValidationError("비밀번호에 사용할 수 없는 단어가 포함되어 있습니다.")
        if DOCS_SIGNUP_SQL_PATTERN.search(password):
            raise ValidationError("비밀번호에 SQL 구문으로 해석될 수 있는 입력은 사용할 수 없습니다.")
        return password


def _ensure_forgejo_mapping_for_user(user):
    """Forgejo 계정이 없으면 만들고, GitUserMapping을 보장한다."""
    if not user or not user.is_authenticated:
        return None

    mapping = GitUserMapping.objects.filter(user=user).first()
    if mapping and mapping.forgejo_user_id and mapping.forgejo_username:
        return mapping

    try:
        client = ForgejoClient()
        # 실제 이메일은 기존 Forgejo 계정과 충돌할 수 있으므로 placeholder 사용
        gitea_user = client.ensure_user(user.username, "")
    except Exception:
        logger.exception("Failed to ensure Forgejo user for %s", getattr(user, "username", "unknown"))
        return mapping

    mapping, _ = GitUserMapping.objects.update_or_create(
        user=user,
        defaults={
            "forgejo_user_id":  gitea_user["id"],
            "forgejo_username": gitea_user["login"],
            "forgejo_token":    (mapping.forgejo_token if mapping and mapping.forgejo_token else ""),
        },
    )
    return mapping


def _find_go_binary() -> str:
    """Forgejo 세션 helper 빌드에 사용할 Go 바이너리 경로를 찾는다."""
    go_bin = shutil.which("go")
    if go_bin:
        return go_bin

    for candidate in ("/opt/homebrew/bin/go", "/usr/local/bin/go"):
        if Path(candidate).exists():
            return candidate

    raise FileNotFoundError("go executable not found")


def _forgejo_session_helper_source_path() -> Path:
    return Path(settings.BASE_DIR) / "scripts" / "forgejo_session_blob.go"


def _forgejo_session_helper_binary_path() -> Path:
    return Path(tempfile.gettempdir()) / FORGEJO_SESSION_HELPER_BINARY_NAME


def _ensure_forgejo_session_helper_binary() -> Path:
    """고정 Go helper 바이너리를 준비한다. 소스가 바뀌면 다시 빌드한다."""
    source_path = _forgejo_session_helper_source_path()
    binary_path = _forgejo_session_helper_binary_path()

    if not source_path.exists():
        raise FileNotFoundError(f"forgejo session helper source missing: {source_path}")

    needs_build = not binary_path.exists()
    if not needs_build:
        try:
            needs_build = source_path.stat().st_mtime > binary_path.stat().st_mtime
        except OSError:
            needs_build = True

    if not needs_build:
        return binary_path

    go_bin = _find_go_binary()
    result = subprocess.run(
        [go_bin, "build", "-o", str(binary_path), str(source_path)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "go build failed")
    return binary_path


def _build_forgejo_session_blob(user_id: int, username: str, has_two_factor_auth: bool = False) -> bytes | None:
    """Forgejo session 테이블에 넣을 gob blob을 생성한다."""
    if getattr(settings, "RUNNING_TESTS", False):
        return None

    try:
        helper_binary = _ensure_forgejo_session_helper_binary()
        result = subprocess.run(
            [
                str(helper_binary),
                str(int(user_id)),
                str(username),
                str(bool(has_two_factor_auth)).lower(),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "go run failed")
        return base64.b64decode((result.stdout or "").strip())
    except Exception:
        logger.exception("Failed to build Forgejo session blob for %s", username)
        return None


def _forgejo_db_path() -> Path:
    """Forgejo SQLite DB 경로를 반환한다."""
    return Path(settings.BASE_DIR) / "forgejo" / "data" / "gitea.db"


def _persist_forgejo_session(session_key: str, session_blob: bytes, expiry: int) -> None:
    """Forgejo session 테이블에 웹 세션을 저장한다."""
    with sqlite3.connect(_forgejo_db_path()) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO session (key, data, expiry) VALUES (?, ?, ?)",
            (session_key, session_blob, expiry),
        )
        conn.commit()


def _delete_forgejo_session_artifacts(forgejo_user_id: int, forgejo_session_key: str = "") -> None:
    """Forgejo 웹 로그인 흔적만 삭제한다. PAT/auth_token 은 유지한다."""
    with sqlite3.connect(_forgejo_db_path(), timeout=1) as conn:
        conn.execute("DELETE FROM oauth2_grant WHERE user_id = ?", (forgejo_user_id,))
        if forgejo_session_key:
            conn.execute("DELETE FROM session WHERE key = ?", (forgejo_session_key,))
        conn.commit()


def _build_forgejo_auth_error_message(ui_lang: str | None, error_code: str) -> str:
    if (ui_lang or "").strip().lower() == "en":
        return f"Login failed ({error_code})"
    return f"로그인 실패 ({error_code})"


def _prepare_forgejo_login_session(user) -> tuple[str | None, str | None]:
    """Forgejo 세션 생성에 필요한 서버 상태를 미리 준비한다."""
    mapping = _ensure_forgejo_mapping_for_user(user)
    if not mapping or not mapping.forgejo_user_id or not mapping.forgejo_username:
        logger.error("Forgejo mapping missing for %s", getattr(user, "username", "unknown"))
        return None, FORGEJO_AUTH_ERROR_CODE

    session_blob = _build_forgejo_session_blob(
        mapping.forgejo_user_id,
        mapping.forgejo_username,
        False,
    )
    if not session_blob:
        return None, FORGEJO_AUTH_ERROR_CODE

    session_key = secrets.token_hex(8)
    expiry = int(time.time()) + 60 * 60 * 24 * 30

    try:
        _persist_forgejo_session(session_key, session_blob, expiry)
    except Exception:
        logger.exception("Failed to persist Forgejo session for %s", getattr(user, "username", "unknown"))
        return None, FORGEJO_AUTH_ERROR_CODE

    return session_key, None


def _is_forgejo_oauth_handoff_url(target_url: str) -> bool:
    """OAuth authorize 페이지로의 리다이렉트인지 확인한다.
    Forgejo SSO든 일반 OAuth 클라이언트든, /o/authorize/ 로 가는 경우
    Forgejo 세션 직접 준비를 건너뛴다."""
    parsed = urlparse(str(target_url or ""))
    return parsed.path == "/o/authorize/"


def _apply_forgejo_session_cookie(response, session_key: str):
    """준비된 Forgejo session key 를 응답 쿠키에 반영한다."""
    _secure = bool(getattr(settings, "DEFAULT_SECURE_TRANSPORT", True))
    shared_cookie_kwargs = dict(domain=".hanplanet.com", path="/", secure=_secure, samesite="Lax")
    if "i_like_gitea" in response.cookies:
        del response.cookies["i_like_gitea"]
    response.set_cookie("i_like_gitea", session_key, httponly=True, **shared_cookie_kwargs)
    response.delete_cookie("hp_relogin", domain=".hanplanet.com", path="/")
    response.delete_cookie("hp_sso_return", domain=".hanplanet.com", path="/")
    return response


def _attach_forgejo_login_session(response, user):
    """Forgejo 웹 세션을 생성하고 i_like_gitea 쿠키를 응답에 심는다."""
    session_key, error_code = _prepare_forgejo_login_session(user)
    if error_code or not session_key:
        return response
    return _apply_forgejo_session_cookie(response, session_key)


def _clear_forgejo_sync_cookies(response):
    """Hanplanet/Forgejo 연동에 쓰는 공유 쿠키들을 응답에서 정리한다."""
    response.delete_cookie("i_like_gitea", domain=".hanplanet.com", path="/")
    response.delete_cookie("i_like_gitea", path="/")
    response.delete_cookie("hp_logout", domain=".hanplanet.com", path="/")
    response.delete_cookie("hp_logout_return", domain=".hanplanet.com", path="/")
    response.delete_cookie("hp_relogin", domain=".hanplanet.com", path="/")
    response.delete_cookie("hp_sso_return", domain=".hanplanet.com", path="/")
    return response


def _build_forgejo_redirect_base(target_url: str):
    """Forgejo 연동 쿠키만 정리한 기본 redirect 응답을 만든다."""
    response = redirect(target_url)
    return _clear_forgejo_sync_cookies(response)


def _build_forgejo_authenticated_redirect(target_url: str, user):
    """레거시 연동 쿠키를 정리한 뒤 Forgejo 세션까지 붙인 redirect 응답을 만든다."""
    response = _build_forgejo_redirect_base(target_url)
    return _attach_forgejo_login_session(response, user)


def _build_forgejo_logged_out_redirect(target_url: str):
    """Forgejo 연동 쿠키를 정리한 로그아웃 redirect 응답을 만든다."""
    response = _build_forgejo_redirect_base(target_url)
    response.delete_cookie("_csrf", domain=".hanplanet.com", path="/")
    response.delete_cookie("redirect_to", domain=".hanplanet.com", path="/")
    response.delete_cookie("gitea_flash", domain=".hanplanet.com", path="/")
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path=getattr(settings, "SESSION_COOKIE_PATH", "/"))
    return response


def _build_post_hanplanet_login_response(target_url: str, user):
    """로그인 후 direct Forgejo attach 와 OAuth handoff 를 구분한다."""
    if _is_forgejo_oauth_handoff_url(target_url):
        return redirect(target_url)
    return _build_forgejo_authenticated_redirect(target_url, user)


def _render_handrive_login_page(
    request,
    context,
    form,
    next_url: str,
    login_error_message: str,
    login_error_popup_message: str,
    show_captcha: bool,
    turnstile_site_key: str,
    captcha_question: str,
    auth_breadcrumb_url: str,
    hide_global_nav: bool,
    show_2fa: bool = False,
    twofa_masked_email: str = "",
    twofa_error_message: str = "",
):
    handrive_text = context["handrive_text"]
    return render(
        request,
        "handrive/login.html",
        {
            **context,
            "handrive_login_form": form,
            "handrive_login_next": next_url,
            "handrive_login_error_message": login_error_message,
            "handrive_login_error_popup_message": login_error_popup_message,
            "handrive_login_show_captcha": show_captcha,
            "handrive_turnstile_site_key": turnstile_site_key,
            "handrive_login_captcha_question": captcha_question,
            "handrive_api_login_captcha_status_url": reverse("main:handrive_api_login_captcha_status"),
            "handrive_auth_breadcrumb_url": auth_breadcrumb_url,
            "handrive_auth_breadcrumb_label": handrive_text.get("auth_previous_page", "Previous Page"),
            "hide_global_nav": hide_global_nav,
            "handrive_login_show_2fa": show_2fa,
            "handrive_login_2fa_masked_email": twofa_masked_email,
            "handrive_login_2fa_error_message": twofa_error_message,
            "handrive_api_login_2fa_resend_code_url": reverse("main:handrive_api_login_2fa_resend_code"),
        },
    )


def _render_handrive_signup_page(
    request,
    context,
    form,
    next_url: str,
    signup_error_message: str,
    signup_error_popup_message: str,
    auth_breadcrumb_url: str,
    hide_global_nav: bool,
):
    handrive_text = context["handrive_text"]
    return render(
        request,
        "handrive/signup.html",
        {
            **context,
            "handrive_signup_form": form,
            "handrive_signup_next": next_url,
            "handrive_signup_error_message": signup_error_message,
            "handrive_signup_error_popup_message": signup_error_popup_message,
            "handrive_auth_breadcrumb_url": auth_breadcrumb_url,
            "handrive_auth_breadcrumb_label": handrive_text.get("auth_previous_page", "Previous Page"),
            "hide_global_nav": hide_global_nav,
            "handrive_api_signup_2fa_send_code_url": reverse("main:handrive_api_signup_2fa_send_code"),
            "handrive_api_signup_2fa_verify_code_url": reverse("main:handrive_api_signup_2fa_verify_code"),
        },
    )


@require_http_methods(["GET"])
def handrive_gitea_sso_relay(request):
    """레거시 Gitea SSO 릴레이 엔드포인트.

    이제 Hanplanet 로그인 응답에서 Forgejo 세션을 직접 생성하므로
    git.hanplanet.com 경유 리다이렉트 없이 next 로 바로 복귀시킨다.
    """
    if not request.user.is_authenticated:
        return redirect("/ko/login")

    next_url = resolve_next_url(request, "/")
    return _build_forgejo_authenticated_redirect(next_url, request.user)


@require_http_methods(["GET"])
def handrive_logout_bridge(request, ui_lang=None):
    """Gitea에서 Django 로그아웃으로 안전하게 넘기는 브리지 페이지."""
    resolved_lang = resolve_ui_lang(request, ui_lang)
    logout_url = reverse("main:handrive_logout_lang", kwargs={"ui_lang": resolved_lang})
    next_url = resolve_next_url(
        request,
        reverse("main:none_lang", kwargs={"ui_lang": resolved_lang}),
    )
    return render(
        request,
        "popup/root/auth_logout_bridge.html",
        {
            "logout_url": logout_url,
            "logout_next_url": next_url,
        },
    )


@require_http_methods(["GET", "POST"])
def handrive_login(request, ui_lang=None):
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]
    next_url = resolve_next_url(request, context["handrive_base_url"])
    auth_breadcrumb_url = resolve_auth_breadcrumb_url(request, context["handrive_base_url"])
    hide_global_nav = is_handrive_share_auth_entry(request, context["handrive_base_url"])

    if request.user.is_authenticated:
        db_token = getattr(getattr(request.user, "profile", None), "session_token", "")
        if db_token:
            # 정상 로그인 상태 → next로 이동
            if not request.session.get("_hp_session_token"):
                request.session["_hp_session_token"] = db_token
            return _build_post_hanplanet_login_response(
                _resolve_handrive_post_login_url(request, resolved_lang, next_url, request.user),
                request.user,
            )
        # db_token 없음 = 앱 레벨 로그아웃 상태 (다른 도메인/기기에서 로그아웃)
        # → Django 세션 클리어, 리다이렉트 없이 즉시 로그인 폼 표시 (루프 방지)
        from django.contrib.auth import logout as auth_logout
        auth_logout(request)

    login_error_message = ""
    login_error_popup_message = ""
    show_captcha = False
    captcha_question = ""
    show_2fa = False
    twofa_masked_email = ""
    twofa_error_message = ""

    # 디버그 모드에서는 Turnstile 비활성화 (콜백보다 먼저 초기화)
    if settings.DEBUG:
        turnstile_site_key = ""
        turnstile_secret_key = ""
    else:
        turnstile_site_key = str(getattr(settings, "TURNSTILE_SITE_KEY", "") or "").strip()
        turnstile_secret_key = str(getattr(settings, "TURNSTILE_SECRET_KEY", "") or "").strip()

    if request.method == "GET" and request.session.get(HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY):
        _clear_2fa_pending_session(request)

    # ── 인라인 2FA 콜백 ───────────────────────────────────────────────────────
    def _render_login_with_2fa(masked_email, send_failed=False):
        err = handrive_text.get("auth_2fa_email_send_error", "인증 코드 발송에 실패했습니다.") if send_failed else ""
        return _render_handrive_login_page(
            request, context, AuthenticationForm(request),
            next_url, "", "", False, turnstile_site_key, "",
            auth_breadcrumb_url, hide_global_nav,
            show_2fa=True, twofa_masked_email=masked_email, twofa_error_message=err,
        )

    # ── 2FA 코드 제출 처리 (phase 2) ─────────────────────────────────────────
    if (request.method == "POST"
            and request.POST.get("handrive_2fa_phase") == "verify"
            and request.session.get(HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY)):
        UserModel = get_user_model()
        pending_user_id = request.session.get(HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY)
        try:
            pending_user = UserModel.objects.get(pk=pending_user_id)
        except UserModel.DoesNotExist:
            _clear_2fa_pending_session(request)
            return redirect(reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang}))

        submitted_code = str(request.POST.get("code", "") or "").strip()
        if _verify_2fa_code(pending_user, submitted_code):
            _p_target_url = request.session.get(HANDRIVE_2FA_PENDING_NEXT_URL_SESSION_KEY, "")
            _p_forgejo_key = request.session.get(HANDRIVE_2FA_PENDING_FORGEJO_KEY_SESSION_KEY, "") or None
            _p_requires_attach = request.session.get(HANDRIVE_2FA_PENDING_REQUIRES_ATTACH_SESSION_KEY, True)
            _clear_2fa_pending_session(request)
            _reset_handrive_login_guard(pending_user)
            _purge_stale_user_sessions(pending_user)
            token = _issue_session_token(pending_user)
            auth_login(request, pending_user, backend="django.contrib.auth.backends.ModelBackend")
            request.session["_hp_session_token"] = token
            existing_device_token = _read_device_token(request)
            device_token = existing_device_token if existing_device_token else secrets.token_hex(32)
            _register_trusted_device(pending_user, device_token)
            if not _p_requires_attach:
                response = _build_post_hanplanet_login_response(_p_target_url, pending_user)
            else:
                response = _build_forgejo_redirect_base(_p_target_url)
                if _p_forgejo_key:
                    response = _apply_forgejo_session_cookie(response, _p_forgejo_key)
            _set_device_cookie(response, device_token)
            return response
        else:
            # 코드 오류 → 2FA 화면 유지
            _masked = _mask_email(str(getattr(pending_user, "email", "") or ""))
            return _render_handrive_login_page(
                request, context, AuthenticationForm(request),
                next_url, "", "", False, turnstile_site_key, "",
                auth_breadcrumb_url, hide_global_nav,
                show_2fa=True, twofa_masked_email=_masked,
                twofa_error_message=handrive_text.get("auth_2fa_code_error", "인증 코드가 올바르지 않거나 만료되었습니다."),
            )

    form = AuthenticationForm(request, data=request.POST or None)

    if request.method == "POST":
        if request.POST.get("handrive_2fa_phase") != "verify":
            _clear_2fa_pending_session(request)
        username_value = request.POST.get("username", "")
        target_user = _resolve_handrive_login_target_user(username_value)
        show_captcha = _is_handrive_login_captcha_required(target_user)

        if settings.DEBUG:
            show_captcha = False
            captcha_question = ""
            _clear_handrive_login_captcha(request)

        if show_captcha:
            captcha_question = _build_handrive_login_captcha(request)
            if not turnstile_site_key or not turnstile_secret_key:
                login_error_message = handrive_text.get(
                    "auth_login_captcha_unavailable",
                    "캡챠 설정이 준비되지 않았습니다. 관리자에게 문의해주세요.",
                )
            elif not _verify_handrive_login_captcha_answer(request) or not _verify_handrive_turnstile_token(
                request.POST.get("cf-turnstile-response", ""),
                request.META.get("REMOTE_ADDR", ""),
            ):
                login_error_message = handrive_text.get("auth_login_captcha_error", "캡챠 인증에 실패했습니다. 다시 시도해주세요.")
                captcha_question = _build_handrive_login_captcha(request, refresh=True)
            elif form.is_valid():
                authed_user = form.get_user()
                target_url = _resolve_handrive_post_login_url(request, resolved_lang, next_url, authed_user)
                requires_direct_attach = not _is_forgejo_oauth_handoff_url(target_url)
                forgejo_session_key = None
                if requires_direct_attach:
                    forgejo_session_key, forgejo_error_code = _prepare_forgejo_login_session(authed_user)
                    if forgejo_error_code or not forgejo_session_key:
                        login_error_message = _build_forgejo_auth_error_message(resolved_lang, forgejo_error_code or FORGEJO_AUTH_ERROR_CODE)
                        login_error_popup_message = login_error_message
                        captcha_question = _build_handrive_login_captcha(request, refresh=True) if show_captcha else ""
                        return _render_handrive_login_page(
                            request,
                            context,
                            form,
                            next_url,
                            login_error_message,
                            login_error_popup_message,
                            show_captcha,
                            turnstile_site_key,
                            captcha_question,
                            auth_breadcrumb_url,
                            hide_global_nav,
                        )
                return _complete_login_or_require_2fa(
                    request, authed_user, target_url, resolved_lang,
                    forgejo_session_key=forgejo_session_key,
                    requires_direct_attach=requires_direct_attach,
                    captcha_was_shown=True,
                    on_2fa_needed=_render_login_with_2fa,
                )
            else:
                login_error_message = handrive_text.get("auth_login_error", "아이디 또는 비밀번호를 확인해주세요.")
                captcha_question = _build_handrive_login_captcha(request, refresh=True)
                if target_user is not None:
                    _register_handrive_login_failure(target_user)
                    show_captcha = _is_handrive_login_captcha_required(target_user)
        elif form.is_valid():
            authed_user = form.get_user()
            target_url = _resolve_handrive_post_login_url(request, resolved_lang, next_url, authed_user)
            requires_direct_attach = not _is_forgejo_oauth_handoff_url(target_url)
            forgejo_session_key = None
            if requires_direct_attach:
                forgejo_session_key, forgejo_error_code = _prepare_forgejo_login_session(authed_user)
                if forgejo_error_code or not forgejo_session_key:
                    login_error_message = _build_forgejo_auth_error_message(resolved_lang, forgejo_error_code or FORGEJO_AUTH_ERROR_CODE)
                    login_error_popup_message = login_error_message
                    return _render_handrive_login_page(
                        request,
                        context,
                        form,
                        next_url,
                        login_error_message,
                        login_error_popup_message,
                        show_captcha,
                        turnstile_site_key,
                        captcha_question,
                        auth_breadcrumb_url,
                        hide_global_nav,
                    )
            return _complete_login_or_require_2fa(
                request, authed_user, target_url, resolved_lang,
                forgejo_session_key=forgejo_session_key,
                requires_direct_attach=requires_direct_attach,
                captcha_was_shown=False,
                on_2fa_needed=_render_login_with_2fa,
            )
        else:
            login_error_message = handrive_text.get("auth_login_error", "아이디 또는 비밀번호를 확인해주세요.")
            if target_user is not None:
                _register_handrive_login_failure(target_user)
                show_captcha = _is_handrive_login_captcha_required(target_user)
                if show_captcha:
                    captcha_question = _build_handrive_login_captcha(request, refresh=True)
    return _render_handrive_login_page(
        request,
        context,
        form,
        next_url,
        login_error_message,
        login_error_popup_message,
        show_captcha,
        turnstile_site_key,
        captcha_question,
        auth_breadcrumb_url,
        hide_global_nav,
    )


@require_http_methods(["GET"])
def handrive_api_login_captcha_status(request):
    username_value = request.GET.get("username", "")
    target_user = _resolve_handrive_login_target_user(username_value)
    required = _is_handrive_login_captcha_required(target_user)
    question = ""
    if required:
        question = _build_handrive_login_captcha(request)
    else:
        _clear_handrive_login_captcha(request)
    return JsonResponse({"ok": True, "required": required, "question": question})


@require_http_methods(["POST"])
@csrf_protect
def handrive_api_login_2fa_resend_code(request, ui_lang=None):
    """로그인 2FA 인증 코드 재전송 API (AJAX).

    세션에 pending_user_id가 있어야 동작한다. 60초 재전송 제한 적용.
    """
    from .models import EmailVerificationCode
    resolved_lang = resolve_ui_lang(request, ui_lang)
    handrive_text = get_handrive_text(resolved_lang)

    pending_user_id = request.session.get(HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY)
    if not pending_user_id:
        return JsonResponse(
            {"ok": False, "error": handrive_text.get("auth_2fa_session_expired", "인증 세션이 만료되었습니다. 다시 로그인해주세요.")},
            status=400,
        )

    UserModel = get_user_model()
    try:
        pending_user = UserModel.objects.get(pk=pending_user_id)
    except UserModel.DoesNotExist:
        _clear_2fa_pending_session(request)
        return JsonResponse(
            {"ok": False, "error": handrive_text.get("auth_2fa_session_expired", "인증 세션이 만료되었습니다. 다시 로그인해주세요.")},
            status=400,
        )

    # 60초 재전송 속도 제한
    last_code = EmailVerificationCode.objects.filter(user=pending_user).order_by("-created_at").first()
    if last_code:
        elapsed = (timezone.now() - last_code.created_at).total_seconds()
        if elapsed < 60:
            return JsonResponse(
                {"ok": False, "error": handrive_text.get("auth_2fa_rate_limit", "잠시 후 다시 시도해주세요.")},
                status=429,
            )

    code = _generate_and_store_2fa_code(pending_user)
    email_sent = _send_2fa_email(pending_user, code)
    if not email_sent:
        return JsonResponse(
            {"ok": False, "error": handrive_text.get("auth_2fa_email_send_error", "인증 코드 발송에 실패했습니다.")},
            status=500,
        )

    return JsonResponse({"ok": True})


@require_http_methods(["POST"])
@csrf_protect
def handrive_api_signup_2fa_send_code(request, ui_lang=None):
    """회원가입 이메일 2FA 인증 코드 발송 API (AJAX)."""
    from django.core.mail import send_mail as _send_mail
    resolved_lang = resolve_ui_lang(request, ui_lang)
    handrive_text = get_handrive_text(resolved_lang)

    email = str(request.POST.get("email", "") or "").strip()
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        return JsonResponse({"ok": False, "error": handrive_text.get("auth_register_email_invalid", "올바른 이메일 주소를 입력해주세요.")}, status=400)

    # 연속 발송 속도 제한 (60초)
    pending = request.session.get(HANDRIVE_SIGNUP_2FA_SESSION_KEY) or {}
    import time as _time
    now_ts = _time.time()
    if pending.get("email") == email and (now_ts - pending.get("sent_at_ts", 0)) < 60:
        return JsonResponse({"ok": False, "error": handrive_text.get("auth_2fa_rate_limit", "잠시 후 다시 시도해주세요.")}, status=429)

    code = str(secrets.randbelow(1000000)).zfill(6)
    expires_at_ts = now_ts + 600  # 10분
    request.session[HANDRIVE_SIGNUP_2FA_SESSION_KEY] = {
        "email": email,
        "code": code,
        "sent_at_ts": now_ts,
        "expires_at_ts": expires_at_ts,
    }

    try:
        _send_mail(
            subject="[Hanplanet] 이메일 인증 코드",
            message=f"인증 코드: {code}\n\n이 코드는 10분간 유효합니다.",
            html_message=(
                f"<p>Hanplanet 이메일 인증 코드입니다.</p>"
                f"<p>인증 코드: <strong>{code}</strong></p>"
                f"<p>이 코드는 10분간 유효합니다.</p>"
            ),
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@hanplanet.com"),
            recipient_list=[email],
            fail_silently=False,
        )
    except Exception:
        logger.exception("Failed to send signup 2FA email to %s", email)
        return JsonResponse({"ok": False, "error": handrive_text.get("auth_2fa_email_send_error", "인증 코드 발송에 실패했습니다.")}, status=500)

    return JsonResponse({"ok": True})


@require_http_methods(["POST"])
@csrf_protect
def handrive_api_signup_2fa_verify_code(request, ui_lang=None):
    """회원가입 이메일 2FA 코드 검증 API (AJAX) → 검증 성공 시 서명 토큰 반환."""
    from django.core import signing
    import time as _time
    resolved_lang = resolve_ui_lang(request, ui_lang)
    handrive_text = get_handrive_text(resolved_lang)
    code_error = handrive_text.get("auth_2fa_code_error", "인증 코드가 올바르지 않거나 만료되었습니다.")

    submitted_code = str(request.POST.get("code", "") or "").strip()
    pending = request.session.get(HANDRIVE_SIGNUP_2FA_SESSION_KEY) or {}

    if not pending or not submitted_code:
        return JsonResponse({"ok": False, "error": code_error}, status=400)

    if _time.time() > pending.get("expires_at_ts", 0):
        return JsonResponse({"ok": False, "error": code_error}, status=400)

    if pending.get("code") != submitted_code:
        return JsonResponse({"ok": False, "error": code_error}, status=400)

    email = pending.get("email", "")
    # 세션 코드 소비
    try:
        del request.session[HANDRIVE_SIGNUP_2FA_SESSION_KEY]
    except KeyError:
        pass

    # 30분 유효 서명 토큰 발급
    token = signing.dumps({"email": email}, salt="signup-email-verified")
    return JsonResponse({"ok": True, "token": token})


@require_http_methods(["GET", "POST"])
def handrive_signup(request, ui_lang=None):
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]
    next_url = resolve_next_url(request, context["handrive_base_url"])
    auth_breadcrumb_url = resolve_auth_breadcrumb_url(request, context["handrive_base_url"])
    hide_global_nav = is_handrive_share_auth_entry(request, context["handrive_base_url"])

    if request.user.is_authenticated:
        return _build_post_hanplanet_login_response(
            _resolve_handrive_post_login_url(request, resolved_lang, next_url, request.user),
            request.user,
        )

    form = HandriveSignupForm(request.POST or None, ui_lang=resolved_lang)
    signup_error_message = ""
    signup_error_popup_message = ""

    if request.method == "POST":
        if form.is_valid():
            user = form.save()
            profile, _ = UserProfile.objects.get_or_create(user=user)
            consented_at = timezone.now()
            profile.privacy_policy_agreed_at = consented_at
            profile.terms_of_service_agreed_at = consented_at
            profile.save(update_fields=["privacy_policy_agreed_at", "terms_of_service_agreed_at", "updated_at"])
            public_group = get_handrive_public_write_group()
            user.groups.add(public_group)
            scoped_home_dir = get_scoped_handrive_home_dir(request)
            if not scoped_home_dir:
                try:
                    scoped_home_dir = normalize_relative_path(f"users/{user.get_username()}", allow_empty=False)
                except ValueError:
                    scoped_home_dir = ""
            try:
                ensure_scoped_home_dir(scoped_home_dir)
            except OSError:
                logger.exception("Failed to initialize scoped HanDrive home for signup user %s", user.get_username())
            authed_user = authenticate(
                request,
                username=user.get_username(),
                password=form.cleaned_data.get("password1", ""),
            )
            if authed_user is None:
                authed_user = user
            target_url = _resolve_handrive_post_login_url(request, resolved_lang, next_url, user)
            requires_direct_attach = not _is_forgejo_oauth_handoff_url(target_url)
            forgejo_session_key = None
            if requires_direct_attach:
                forgejo_session_key, forgejo_error_code = _prepare_forgejo_login_session(authed_user)
                if forgejo_error_code or not forgejo_session_key:
                    signup_error_message = _build_forgejo_auth_error_message(resolved_lang, forgejo_error_code or FORGEJO_AUTH_ERROR_CODE)
                    signup_error_popup_message = signup_error_message
                    return _render_handrive_signup_page(
                        request,
                        context,
                        form,
                        next_url,
                        signup_error_message,
                        signup_error_popup_message,
                        auth_breadcrumb_url,
                        hide_global_nav,
                    )
            # 이메일 인증이 이미 AJAX로 완료되었으므로 2FA 없이 즉시 로그인
            _purge_stale_user_sessions(authed_user)
            token = _issue_session_token(authed_user)
            auth_login(request, authed_user, backend="django.contrib.auth.backends.ModelBackend")
            request.session["_hp_session_token"] = token
            # 신규 가입 = 신규 기기 → 새 device_token 발급 후 신뢰 등록
            device_token = secrets.token_hex(32)
            _register_trusted_device(authed_user, device_token)
            if not requires_direct_attach:
                response = _build_post_hanplanet_login_response(target_url, authed_user)
            else:
                response = _build_forgejo_redirect_base(target_url)
                if forgejo_session_key:
                    response = _apply_forgejo_session_cookie(response, forgejo_session_key)
            _set_device_cookie(response, device_token)
            return response
        signup_error_message = handrive_text.get("auth_signup_error", "회원가입 정보를 확인해주세요.")
    return _render_handrive_signup_page(
        request,
        context,
        form,
        next_url,
        signup_error_message,
        signup_error_popup_message,
        auth_breadcrumb_url,
        hide_global_nav,
    )


@require_http_methods(["GET", "POST"])
def handrive_2fa_verify(request, ui_lang=None):
    """이메일 2FA 코드 입력/검증 페이지."""
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]

    pending_user_id = request.session.get(HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY)
    if not pending_user_id:
        return redirect(reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang}))

    UserModel = get_user_model()
    try:
        pending_user = UserModel.objects.get(pk=pending_user_id)
    except UserModel.DoesNotExist:
        _clear_2fa_pending_session(request)
        return redirect(reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang}))

    target_url = request.session.get(HANDRIVE_2FA_PENDING_NEXT_URL_SESSION_KEY, "")
    forgejo_session_key = request.session.get(HANDRIVE_2FA_PENDING_FORGEJO_KEY_SESSION_KEY, "") or None
    requires_direct_attach = request.session.get(HANDRIVE_2FA_PENDING_REQUIRES_ATTACH_SESSION_KEY, True)

    error_message = ""

    if request.method == "POST":
        submitted_code = str(request.POST.get("code", "") or "").strip()
        if _verify_2fa_code(pending_user, submitted_code):
            _clear_2fa_pending_session(request)
            _reset_handrive_login_guard(pending_user)
            _purge_stale_user_sessions(pending_user)
            token = _issue_session_token(pending_user)
            # multiple backends 환경에서 backend를 명시해야 auth_login이 정상 작동함
            auth_login(request, pending_user, backend="django.contrib.auth.backends.ModelBackend")
            request.session["_hp_session_token"] = token

            # 신뢰된 기기 등록 (기존 쿠키 재사용 또는 신규 발급)
            existing_device_token = _read_device_token(request)
            device_token = existing_device_token if existing_device_token else secrets.token_hex(32)
            _register_trusted_device(pending_user, device_token)

            if not requires_direct_attach:
                response = _build_post_hanplanet_login_response(target_url, pending_user)
            else:
                response = _build_forgejo_redirect_base(target_url)
                if forgejo_session_key:
                    response = _apply_forgejo_session_cookie(response, forgejo_session_key)
            _set_device_cookie(response, device_token)
            return response
        else:
            error_message = handrive_text.get("auth_2fa_code_error", "인증 코드가 올바르지 않거나 만료되었습니다.")

    return render(request, "handrive/2fa_verify.html", {
        **context,
        "handrive_2fa_error_message": error_message,
        "handrive_2fa_user_email_masked": _mask_email(str(getattr(pending_user, "email", "") or "")),
        "hide_global_nav": True,
    })


@require_http_methods(["GET", "POST"])
def handrive_register_email(request, ui_lang=None):
    """이메일이 없는 기존 계정의 이메일 등록 및 2FA 코드 발송 페이지."""
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]

    pending_user_id = request.session.get(HANDRIVE_2FA_PENDING_USER_ID_SESSION_KEY)
    if not pending_user_id:
        return redirect(reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang}))

    UserModel = get_user_model()
    try:
        pending_user = UserModel.objects.get(pk=pending_user_id)
    except UserModel.DoesNotExist:
        _clear_2fa_pending_session(request)
        return redirect(reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang}))

    error_message = ""

    if request.method == "POST":
        email_input = str(request.POST.get("email", "") or "").strip()
        if not email_input or "@" not in email_input:
            error_message = handrive_text.get("auth_register_email_invalid", "올바른 이메일 주소를 입력해주세요.")
        else:
            # 이메일 저장
            pending_user.email = email_input
            pending_user.save(update_fields=["email"])
            # 2FA 코드 발송
            code = _generate_and_store_2fa_code(pending_user)
            email_sent = _send_2fa_email(pending_user, code)
            if not email_sent:
                error_message = handrive_text.get("auth_2fa_email_send_error", "인증 코드 발송에 실패했습니다.")
            else:
                verify_url = reverse("main:handrive_2fa_verify_lang", kwargs={"ui_lang": resolved_lang})
                return redirect(verify_url)

    return render(request, "handrive/register_email.html", {
        **context,
        "handrive_register_email_error_message": error_message,
        "hide_global_nav": True,
    })


@require_http_methods(["POST"])
@csrf_protect
def handrive_logout(request, ui_lang=None):
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    next_url = resolve_next_url(request, context["handrive_base_url"])
    forgejo_session_key = str(request.COOKIES.get("i_like_gitea", "") or "").strip()
    # Forgejo 세션/토큰 서버사이드 선제 삭제 (로그아웃 전에 user 정보 참조)
    _forgejo_server_logout(request.user, forgejo_session_key=forgejo_session_key)
    # session_token 무효화 → 기존 세션이 남아있어도 OAuth dispatch에서 차단
    _revoke_session_token(request.user)
    auth_logout(request)
    return _build_forgejo_logged_out_redirect(next_url)



def _forgejo_server_logout(user, forgejo_session_key: str = ""):
    """Forgejo DB에서 현재 브라우저 세션과 사용자 grant 를 삭제해 서버사이드 세션을 무효화한다."""
    if not user or not user.is_authenticated:
        return
    try:
        from git.models import GitUserMapping
        mapping = GitUserMapping.objects.filter(user=user).first()
        if not mapping:
            return
        _delete_forgejo_session_artifacts(mapping.forgejo_user_id, forgejo_session_key=forgejo_session_key)
    except Exception:
        pass  # 실패해도 www 로그아웃 및 클라이언트사이드 로그아웃은 정상 진행


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
@require_handrive_superuser
def handrive_ops_apply_static(request, ui_lang=None):
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    next_url = resolve_next_url(request, context["handrive_base_url"])
    venv_python = settings.BASE_DIR / ".venv" / "bin" / "python"
    python_executable = str(venv_python) if venv_python.exists() else sys.executable

    subprocess.run(
        [python_executable, "manage.py", "collectstatic", "--noinput"],
        cwd=str(settings.BASE_DIR),
        check=True,
    )
    if not restart_gunicorn_and_wait(timeout_seconds=180):
        return json_error("gunicorn 재시작 후 응답 확인에 실패했습니다.", status=503)
    return redirect(next_url)


@with_request_handrive_root
def handrive_list(request, folder_path="", ui_lang=None):
    """HanDrive 목록 페이지를 렌더한다."""
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]
    shared_context = get_handrive_shared_access_context(request)
    is_superuser = bool(getattr(request.user, "is_superuser", False))
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    requested_dir = normalize_relative_path(folder_path, allow_empty=True)
    if scoped_home_dir and not shared_context:
        ensure_scoped_home_dir(scoped_home_dir)
        if not requested_dir:
            if resolved_lang in SUPPORTED_UI_LANGS:
                return redirect(
                    reverse("main:handrive_list_lang", kwargs={"ui_lang": resolved_lang, "folder_path": scoped_home_dir})
                )
            return redirect(reverse("main:handrive_list", kwargs={"folder_path": scoped_home_dir}))
        if not is_superuser and not is_path_in_handrive_scope(requested_dir, scoped_home_dir):
            if not request.user.is_authenticated:
                from urllib.parse import urlencode
                if resolved_lang in SUPPORTED_UI_LANGS:
                    login_url = reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang})
                else:
                    login_url = reverse("main:handrive_login")
                return redirect(login_url + "?" + urlencode({"next": request.get_full_path()}))
            raise PermissionDenied("파일을 볼 권한이 없습니다.")

    try:
        current_dir = normalize_relative_path(folder_path, allow_empty=True)
    except ValueError:
        raise Http404("폴더를 찾을 수 없습니다.")

    git_virtual = _get_git_virtual_context(request, current_dir)
    if git_virtual is None:
        try:
            directory, current_dir = resolve_path(folder_path, must_exist=True)
        except (ValueError, FileNotFoundError):
            raise Http404("폴더를 찾을 수 없습니다.")
        if not directory.is_dir():
            raise Http404("폴더를 찾을 수 없습니다.")
        initial_entries = list_directory_entries(directory, request=request)
    else:
        if git_virtual["kind"] == "branch_file":
            raise Http404("폴더를 찾을 수 없습니다.")
        try:
            initial_entries = _build_git_virtual_entries(request, git_virtual)
        except RuntimeError:
            raise Http404("Git 저장소를 찾을 수 없습니다.")

    if not has_handrive_read_access(request, current_dir):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")

    directory_meta = _build_handrive_directory_meta(request, current_dir, initial_entries)

    shared_root_url = context["handrive_root_url"]
    if shared_context:
        shared_root_url = build_handrive_shared_view_url(
            resolved_lang,
            shared_context["owner_username"],
            shared_context["share_slug"],
        )

    if shared_context:
        breadcrumbs = build_handrive_shared_breadcrumbs(request, resolved_lang, shared_context, current_dir)
    else:
        breadcrumbs = _build_git_virtual_breadcrumbs(
            request,
            context["handrive_base_url"],
            current_dir,
            scoped_home_dir=scoped_home_dir,
            root_url=shared_root_url,
        )

    sync_excluded_paths = []
    if request.user.is_authenticated:
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        sync_excluded_paths = _sanitize_sync_excluded_paths(profile.sync_excluded_paths, scoped_home_dir)

    context.update(
        {
            "current_dir": current_dir,
            "current_dir_display": current_dir or get_handrive_root_label(request, scoped_home_dir),
            "current_path_label": current_dir or get_handrive_root_label(request, scoped_home_dir),
            "handrive_root_label": get_handrive_js_root_label(request, scoped_home_dir),
            "scoped_home_dir": scoped_home_dir,
            "current_dir_is_root": directory_meta["is_root"],
            "current_dir_can_edit": directory_meta["can_edit"],
            "current_dir_can_write_children": directory_meta["can_write_children"],
            "current_dir_has_children": directory_meta["has_children"],
            "current_dir_is_git_repo_root": directory_meta["is_git_repo_root"],
            "current_dir_requires_commit_message": directory_meta["requires_commit_message"],
            "current_dir_git_branch_root": directory_meta["git_branch_root"],
            "current_dir_git_commit_message": directory_meta["git_commit_message"],
            "current_dir_git_commit_author_username": directory_meta["git_commit_author_username"],
            "breadcrumbs": breadcrumbs,
            "initial_entries": initial_entries,
            "current_dir_git_repo": directory_meta["git_repo"],
            "list_current_dir_size_display": directory_meta["size_display"],
            "current_dir_modified_display": directory_meta["modified_display"],
            "page_help_html": build_page_help_html(resolved_lang, "list", handrive_text),
            "hide_global_nav": bool(shared_context) and not request.user.is_authenticated,
            "is_handrive_shared_view": bool(shared_context),
            "handrive_shared_owner_username": shared_context["owner_username"] if shared_context else "",
            "handrive_shared_slug": shared_context["share_slug"] if shared_context else "",
            "handrive_shared_root_path": shared_context["root_path"] if shared_context else "",
            "handrive_root_url": shared_root_url,
            "sync_excluded_paths": sync_excluded_paths,
        }
    )
    return render(request, "handrive/list.html", context)


@with_request_handrive_root
def handrive_view(request, doc_path, ui_lang=None):
    """HanDrive 단일 파일 보기 페이지를 렌더한다."""
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]
    shared_context = get_handrive_shared_access_context(request)
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    is_superuser = bool(getattr(request.user, "is_superuser", False))

    try:
        relative_file_path = normalize_relative_path(doc_path, allow_empty=False)
    except ValueError:
        raise Http404("파일을 찾을 수 없습니다.")
    git_virtual = _get_git_virtual_context(request, relative_file_path)
    if git_virtual is None:
        try:
            file_path, relative_file_path = normalize_handrive_relative_path(doc_path, must_exist=True)
        except (ValueError, FileNotFoundError):
            raise Http404("파일을 찾을 수 없습니다.")
        file_name = file_path.name
        file_extension = file_path.suffix.lower()
        file_size_display = format_handrive_bytes_display(file_path.stat().st_size) if file_path.exists() else ""
        if resolve_handrive_render_profile(file_extension).get("mode") == DOCS_RENDER_MODE_OFFICE:
            content = ""
            rendered_content_html, render_profile = render_handrive_content(
                content,
                file_extension,
                source_path=file_path,
                relative_path=relative_file_path,
                request=request,
            )
        else:
            try:
                content = load_handrive_source_content(file_path, request=request, relative_path=relative_file_path)
                rendered_content_html, render_profile = render_handrive_content(
                    content,
                    file_extension,
                    source_path=file_path,
                    relative_path=relative_file_path,
                    request=request,
                )
            except Http404:
                rendered_content_html = render_handrive_unsupported_safely(
                    file_path.name,
                    file_extension,
                    message=handrive_text.get("view_read_unsupported", "읽기 미지원"),
                )
                render_profile = DOCS_UNSUPPORTED_RENDER_PROFILE
    else:
        if git_virtual["kind"] != "branch_file":
            raise Http404("파일을 찾을 수 없습니다.")
        file_name = Path(git_virtual["repo_relative_path"]).name
        file_extension = Path(file_name).suffix.lower()
        repo_file_bytes = _git_repo_read_file_bytes(
            git_virtual["repo"],
            git_virtual["branch_name"],
            git_virtual["repo_relative_path"],
        )
        file_size_display = format_handrive_bytes_display(len(repo_file_bytes))
        if is_handrive_non_editable_media_extension(file_extension):
            content = ""
            rendered_content_html, render_profile = render_handrive_content(
                content,
                file_extension,
                source_path=Path(file_name),
                source_bytes=repo_file_bytes,
                relative_path=relative_file_path,
                request=request,
            )
        else:
            try:
                content = ""
                if resolve_handrive_render_profile(file_extension).get("mode") != DOCS_RENDER_MODE_OFFICE:
                    content = decode_handrive_text_bytes(
                        repo_file_bytes,
                        request=request,
                        relative_path=relative_file_path,
                    )
                companion_css, companion_js = load_git_repo_html_companion_assets(
                    request,
                    git_virtual["repo"],
                    git_virtual["branch_name"],
                    git_virtual["repo_relative_path"],
                )
                rendered_content_html, render_profile = render_handrive_content(
                    content,
                    file_extension,
                    source_bytes=repo_file_bytes,
                    companion_css=companion_css,
                    companion_js=companion_js,
                    relative_path=relative_file_path,
                    request=request,
                )
            except Http404:
                rendered_content_html = render_handrive_unsupported_safely(
                    file_name,
                    file_extension,
                    message=handrive_text.get("view_read_unsupported", "읽기 미지원"),
                )
                render_profile = DOCS_UNSUPPORTED_RENDER_PROFILE
    if not shared_context and not is_superuser and not is_path_in_handrive_scope(relative_file_path, scoped_home_dir):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")
    if not has_handrive_read_access(request, relative_file_path):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")
    slug_path = markdown_slug_from_relative(relative_file_path)
    parent_dir = str(Path(relative_file_path).parent).replace("\\", "/")
    if parent_dir == ".":
        parent_dir = ""

    doc_is_url_only = is_handrive_url_only_enabled(request, relative_file_path)
    doc_share_info = build_handrive_existing_share_info(request, relative_file_path)
    doc_share_url = doc_share_info["share_url"]
    doc_share_is_inherited = doc_share_info["share_is_inherited"]

    shared_root_url = context["handrive_root_url"]
    if shared_context:
        shared_root_url = build_handrive_shared_view_url(
            resolved_lang,
            shared_context["owner_username"],
            shared_context["share_slug"],
        )

    if shared_context:
        view_breadcrumbs = build_handrive_shared_breadcrumbs(request, resolved_lang, shared_context, parent_dir)
    else:
        view_breadcrumbs = _build_git_virtual_breadcrumbs(
            request,
            context["handrive_base_url"],
            parent_dir,
            scoped_home_dir=scoped_home_dir,
            root_url=shared_root_url,
        )

    context.update(
        {
            "doc_title": file_name,
            "doc_relative_path": relative_file_path,
            "doc_slug_path": slug_path,
            "doc_parent_dir": parent_dir,
            "doc_can_edit": has_handrive_write_access(request, relative_file_path),
            "doc_can_show_edit": has_handrive_write_access(request, relative_file_path)
            and not is_handrive_non_editable_media_extension(file_extension)
            and render_profile["mode"] != DOCS_RENDER_MODE_UNSUPPORTED,
            "doc_is_url_only": doc_is_url_only,
            "doc_share_url": doc_share_url,
            "doc_share_is_inherited": doc_share_is_inherited,
            "doc_content_html": rendered_content_html,
            "doc_content_mode": render_profile["mode"],
            "doc_content_class": render_profile["css_class"],
            "view_breadcrumbs": view_breadcrumbs,
            "view_current_file_name": file_name,
            "view_current_file_size_display": file_size_display,
            "page_help_html": build_page_help_html(resolved_lang, "view", handrive_text),
            "hide_global_nav": bool(shared_context) and not request.user.is_authenticated,
            "is_handrive_shared_view": bool(shared_context),
            "handrive_shared_owner_username": shared_context["owner_username"] if shared_context else "",
            "handrive_shared_slug": shared_context["share_slug"] if shared_context else "",
            "handrive_shared_root_path": shared_context["root_path"] if shared_context else "",
            "handrive_root_url": shared_root_url,
        }
    )
    return render(request, "handrive/view.html", context)


@with_request_handrive_root
def handrive_shared_view(request, owner_username, share_slug, ui_lang=None, shared_subpath=""):
    shared_link = HandriveSharedLink.objects.select_related("owner").filter(
        owner__username=owner_username,
        share_slug=share_slug,
    ).first()
    if shared_link is None:
        raise Http404("공유 문서를 찾을 수 없습니다.")
    if not is_handrive_url_only_enabled(request, shared_link.path):
        raise Http404("공유 문서를 찾을 수 없습니다.")

    setattr(request, "_handrive_shared_owner_username", owner_username)
    setattr(request, "_handrive_shared_slug", share_slug)
    setattr(request, "_handrive_shared_access_context", None)

    try:
        target_path, relative_path = resolve_path(shared_link.path, must_exist=True)
    except (ValueError, FileNotFoundError):
        shared_link.delete()
        raise Http404("공유 문서를 찾을 수 없습니다.")

    if shared_subpath:
        if not target_path.is_dir():
            raise Http404("공유 문서를 찾을 수 없습니다.")
        try:
            normalized_subpath = normalize_relative_path(shared_subpath, allow_empty=False)
            requested_relative_path = normalize_relative_path(f"{relative_path}/{normalized_subpath}", allow_empty=False)
            target_path, relative_path = resolve_path(requested_relative_path, must_exist=True)
        except (ValueError, FileNotFoundError):
            raise Http404("공유 문서를 찾을 수 없습니다.")
        shared_root_path = normalize_relative_path(shared_link.path, allow_empty=False)
        if relative_path != shared_root_path and not relative_path.startswith(shared_root_path + "/"):
            raise Http404("공유 문서를 찾을 수 없습니다.")

    if target_path.is_dir():
        if (target_path / MAP_META_FILENAME).is_file():
            return handrive_map_viewer(request, map_path=str(relative_path), ui_lang=ui_lang)
        return handrive_list(request, folder_path=relative_path, ui_lang=ui_lang)

    if shared_subpath:
        return handrive_view(request, doc_path=relative_path, ui_lang=ui_lang)

    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]

    try:
        content = load_handrive_source_content(target_path, request=request, relative_path=relative_path)
        rendered_content_html, render_profile = render_handrive_content(
            content,
            target_path.suffix.lower(),
            source_path=target_path,
            relative_path=relative_path,
            request=request,
            share_owner=owner_username,
            share_slug=share_slug,
        )
    except Http404:
        rendered_content_html = render_handrive_unsupported_safely(
            target_path.name,
            target_path.suffix.lower(),
            message=handrive_text.get("view_read_unsupported", "읽기 미지원"),
        )
        render_profile = DOCS_UNSUPPORTED_RENDER_PROFILE

    context.update(
        {
            "doc_title": target_path.name,
            "doc_relative_path": "",
            "doc_slug_path": share_slug,
            "doc_parent_dir": "",
            "doc_can_edit": False,
            "doc_is_url_only": True,
            "doc_share_url": request.build_absolute_uri(build_handrive_shared_view_url(resolved_lang, owner_username, share_slug)),
            "doc_share_is_inherited": False,
            "hide_global_nav": not request.user.is_authenticated,
            "is_handrive_shared_view": True,
            "doc_content_html": rendered_content_html,
            "doc_content_mode": render_profile["mode"],
            "doc_content_class": render_profile["css_class"],
            "view_breadcrumbs": [
                {
                    "label": owner_username,
                    "url": build_handrive_shared_view_url(resolved_lang, owner_username, share_slug),
                }
            ],
            "view_current_file_name": target_path.name,
            "view_current_file_size_display": format_handrive_bytes_display(target_path.stat().st_size) if target_path.exists() else "",
            "page_help_html": build_page_help_html(resolved_lang, "view", handrive_text),
        }
    )
    return render(request, "handrive/view.html", context)


@with_request_handrive_root
def handrive_write(request, ui_lang=None):
    """HanDrive 편집 페이지를 렌더한다.

    새 문서 작성과 기존 파일 수정이 같은 view를 사용한다.
    repo branch 내부에서는 commit message 요구 여부도 함께 계산한다.
    """
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    handrive_text = context["handrive_text"]
    scoped_home_dir = get_scoped_handrive_home_dir(request)
    is_superuser = bool(getattr(request.user, "is_superuser", False))
    if scoped_home_dir:
        ensure_scoped_home_dir(scoped_home_dir)

    requested_path = request.GET.get("path", "")
    requested_dir = request.GET.get("dir", "")

    mode = "create"
    original_relative_path = ""
    initial_filename = ""
    initial_extension = DOCS_FILE_EXTENSION
    initial_filename_input = ""
    initial_dir = ""
    initial_content = ""
    write_current_file_name = ""
    write_public_direct_save = False
    write_requires_commit_message = False

    if requested_path:
        try:
            original_relative_path = normalize_relative_path(requested_path, allow_empty=False)
        except ValueError:
            raise Http404("수정할 파일을 찾을 수 없습니다.")
        git_virtual = _get_git_virtual_context(request, original_relative_path)
        if git_virtual is None:
            try:
                file_path, original_relative_path = normalize_markdown_relative_path(requested_path, must_exist=True)
            except (ValueError, FileNotFoundError):
                raise Http404("수정할 파일을 찾을 수 없습니다.")
            file_name = file_path.name
            initial_filename = file_path.stem
            initial_extension = file_path.suffix.lower() if file_path.suffix else DOCS_FILE_EXTENSION
            initial_content = file_path.read_text(encoding="utf-8")
        else:
            if git_virtual["kind"] != "branch_file":
                raise Http404("수정할 파일을 찾을 수 없습니다.")
            file_name = Path(git_virtual["repo_relative_path"]).name
            initial_filename = Path(file_name).stem
            initial_extension = Path(file_name).suffix.lower() if Path(file_name).suffix else DOCS_FILE_EXTENSION
            initial_content = _git_repo_read_file_bytes(
                git_virtual["repo"],
                git_virtual["branch_name"],
                git_virtual["repo_relative_path"],
            ).decode("utf-8")
            write_requires_commit_message = True
            write_public_direct_save = True
        if not is_superuser and not is_path_in_handrive_scope(original_relative_path, scoped_home_dir):
            raise PermissionDenied("파일을 수정할 권한이 없습니다.")
        if not has_handrive_write_access(request, original_relative_path):
            raise PermissionDenied("파일을 수정할 권한이 없습니다.")
        write_public_direct_save = write_public_direct_save or is_handrive_public_write_enabled(request, original_relative_path)
        mode = "edit"
        initial_filename_input = f"{initial_filename}{initial_extension}"
        write_current_file_name = file_name
        parent_dir = str(Path(original_relative_path).parent).replace("\\", "/")
        initial_dir = "" if parent_dir == "." else parent_dir
    elif requested_dir:
        initial_dir = normalize_relative_path(requested_dir)
        if not is_superuser and not is_path_in_handrive_scope(initial_dir, scoped_home_dir):
            raise PermissionDenied("파일을 수정할 권한이 없습니다.")
        git_virtual = _get_git_virtual_context(request, initial_dir)
        if git_virtual is None:
            target_dir, _ = resolve_path(initial_dir, must_exist=True)
            if not target_dir.is_dir():
                raise Http404("대상 폴더를 찾을 수 없습니다.")
        else:
            if git_virtual["kind"] != "branch_dir":
                raise Http404("대상 폴더를 찾을 수 없습니다.")
            write_requires_commit_message = True
        if not has_handrive_directory_write_access(request, initial_dir):
            raise PermissionDenied("파일을 수정할 권한이 없습니다.")
    else:
        if scoped_home_dir:
            initial_dir = scoped_home_dir
        if not has_handrive_directory_write_access(request, initial_dir):
            raise PermissionDenied("파일을 수정할 권한이 없습니다.")

    markdown_help_path = resolve_markdown_help_file(resolved_lang)
    try:
        if markdown_help_path is not None:
            markdown_help_content = markdown_help_path.read_text(encoding="utf-8")
        else:
            markdown_help_content = (
                f"# {handrive_text['markdown_help_fallback_title']}\n\n"
                f"{handrive_text['markdown_help_fallback_missing']}"
            )
    except OSError:
        markdown_help_content = (
            f"# {handrive_text['markdown_help_fallback_title']}\n\n"
            f"{handrive_text['markdown_help_fallback_read_error']}"
        )

    context.update(
        {
            "write_mode": mode,
            "original_relative_path": original_relative_path,
            "initial_filename": initial_filename,
            "initial_extension": initial_extension,
            "write_is_markdown": initial_extension == DOCS_FILE_EXTENSION,
            "initial_filename_input": initial_filename_input,
            "initial_dir": initial_dir,
            "initial_content": initial_content,
            "available_directories": list_all_directories(request=request),
            "markdown_help_html": render_markdown_safely(markdown_help_content),
            "page_help_html": build_page_help_html(resolved_lang, "write", handrive_text),
            "write_breadcrumbs": build_handrive_breadcrumbs(
                context["handrive_base_url"],
                initial_dir,
                scoped_home_dir=scoped_home_dir,
                root_label=get_handrive_root_label(request, scoped_home_dir),
                root_url=context["handrive_root_url"],
            ),
            "write_current_file_name": write_current_file_name,
            "write_public_direct_save": write_public_direct_save,
            "write_requires_commit_message": write_requires_commit_message,
        }
    )
    return render(request, "handrive/write.html", context)


def parse_json_body(request):
    try:
        return json.loads(request.body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("요청 데이터 형식이 올바르지 않습니다.")


def json_error(message, status=400):
    return JsonResponse({"ok": False, "error": message}, status=status)


def get_folder_icon_owner_key_for_user(user) -> str:
    if not getattr(user, "is_authenticated", False):
        return "anon"
    username_key = sanitize_upload_segment(getattr(user, "username", ""))
    if username_key:
        return username_key
    return "anon"


def extract_folder_icon_path_value(request) -> str:
    path_value = request.POST.get("path", "").strip()
    if path_value:
        return path_value
    try:
        payload = parse_json_body(request)
    except ValueError:
        return ""
    return str(payload.get("path", "") or "").strip()


def parse_id_list(raw_value, field_name: str) -> list[int]:
    if raw_value in (None, ""):
        return []
    if not isinstance(raw_value, list):
        raise ValueError(f"{field_name} 형식이 올바르지 않습니다.")

    parsed_ids = []
    for item in raw_value:
        try:
            parsed = int(item)
        except (TypeError, ValueError):
            raise ValueError(f"{field_name} 형식이 올바르지 않습니다.")
        if parsed <= 0:
            continue
        parsed_ids.append(parsed)
    return sorted(set(parsed_ids))


def parse_path_values(payload: dict, allow_empty: bool) -> list[str]:
    if "paths" in payload:
        raw_paths = payload.get("paths")
        if not isinstance(raw_paths, list):
            raise ValueError("paths 형식이 올바르지 않습니다.")
        if len(raw_paths) == 0:
            raise ValueError("경로를 입력해주세요.")
        candidates = raw_paths
    else:
        candidates = [payload.get("path")]

    parsed_paths = []
    seen_paths = set()
    for candidate in candidates:
        normalized = normalize_relative_path(candidate, allow_empty=allow_empty)
        if normalized in seen_paths:
            continue
        seen_paths.add(normalized)
        parsed_paths.append(normalized)
    return parsed_paths


@require_http_methods(["GET"])
@require_handrive_acl_admin_json
@with_request_handrive_root
def handrive_api_acl_options(request):
    public_group = get_handrive_public_write_group()
    url_only_group, _ = Group.objects.get_or_create(name=DOCS_URL_ONLY_GROUP_NAME)
    User = get_user_model()
    users = [
        {
            "id": user.id,
            "username": user.get_username(),
        }
        for user in User.objects.filter(is_active=True).order_by("username")
    ]
    groups = [
        {
            "id": public_group.id,
            "name": public_group.name,
            "label": get_public_group_display_label(request),
            "is_public_all": True,
        },
        {
            "id": url_only_group.id,
            "name": url_only_group.name,
            "label": url_only_group.name,
            "is_public_all": False,
        }
    ] + [
        {
            "id": group.id,
            "name": group.name,
            "label": group.name,
            "is_public_all": False,
        }
        for group in Group.objects.exclude(id__in=[public_group.id, url_only_group.id]).order_by("name")
    ]
    return JsonResponse({"ok": True, "users": users, "groups": groups})


@require_http_methods(["GET", "POST"])
@csrf_protect
@require_handrive_acl_admin_json
@with_request_handrive_root
def handrive_api_acl(request):
    if request.method == "GET":
        rel_path_raw = request.GET.get("path", "")
        try:
            rel_path = normalize_relative_path(rel_path_raw, allow_empty=True)
            target_path_obj, rel_path = resolve_path(rel_path, must_exist=True)
        except (ValueError, FileNotFoundError) as exc:
            return json_error(str(exc), status=404)
    else:
        try:
            payload = parse_json_body(request)
        except ValueError as exc:
            return json_error(str(exc), status=400)

    if request.method == "GET":
        rule = HandriveAccessRule.objects.filter(path=rel_path).prefetch_related(
            "read_users",
            "read_groups",
            "write_users",
            "write_groups",
        ).first()
        read_user_ids = sorted([user.id for user in rule.read_users.all()]) if rule else []
        read_group_ids = sorted([group.id for group in rule.read_groups.all()]) if rule else []
        write_user_ids = sorted([user.id for user in rule.write_users.all()]) if rule else []
        write_group_ids = sorted([group.id for group in rule.write_groups.all()]) if rule else []
        return JsonResponse(
            {
                "ok": True,
                "path": rel_path,
                "read_user_ids": read_user_ids,
                "read_group_ids": read_group_ids,
                "write_user_ids": write_user_ids,
                "write_group_ids": write_group_ids,
            }
        )

    try:
        read_user_ids = parse_id_list(payload.get("read_user_ids"), "read_user_ids")
        read_group_ids = parse_id_list(payload.get("read_group_ids"), "read_group_ids")
        write_user_ids = parse_id_list(payload.get("write_user_ids"), "write_user_ids")
        write_group_ids = parse_id_list(payload.get("write_group_ids"), "write_group_ids")
        path_values = parse_path_values(payload, allow_empty=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    resolved_targets: list[tuple[Path, str]] = []
    seen_paths = set()
    try:
        for path_value in path_values:
            resolved_path_obj, resolved_relative = resolve_path(path_value, must_exist=True)
            if resolved_relative in seen_paths:
                continue
            seen_paths.add(resolved_relative)
            resolved_targets.append((resolved_path_obj, resolved_relative))
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=404)

    all_user_ids = sorted(set(read_user_ids) | set(write_user_ids))
    all_group_ids = sorted(set(read_group_ids) | set(write_group_ids))
    public_group_id = get_handrive_public_write_group().id

    if any(path_obj.is_dir() for path_obj, _ in resolved_targets) and (
        public_group_id in read_group_ids or public_group_id in write_group_ids
    ):
        return json_error("폴더에는 전체 권한을 설정할 수 없습니다.", status=400)

    User = get_user_model()
    valid_user_ids = set(User.objects.filter(id__in=all_user_ids, is_active=True).values_list("id", flat=True))
    valid_group_ids = set(Group.objects.filter(id__in=all_group_ids).values_list("id", flat=True))
    if len(valid_user_ids) != len(all_user_ids) or len(valid_group_ids) != len(all_group_ids):
        return json_error("존재하지 않는 사용자 또는 그룹이 포함되어 있습니다.", status=400)

    target_paths = [relative_path for _, relative_path in resolved_targets]
    if not all_user_ids and not all_group_ids:
        HandriveAccessRule.objects.filter(path__in=target_paths).delete()
        response_payload = {
            "ok": True,
            "paths": target_paths,
            "read_user_ids": [],
            "read_group_ids": [],
            "write_user_ids": [],
            "write_group_ids": [],
        }
        if len(target_paths) == 1:
            response_payload["path"] = target_paths[0]
        return JsonResponse(response_payload)

    read_users_queryset = User.objects.filter(id__in=read_user_ids)
    write_users_queryset = User.objects.filter(id__in=write_user_ids)
    read_groups_queryset = Group.objects.filter(id__in=read_group_ids)
    write_groups_queryset = Group.objects.filter(id__in=write_group_ids)

    with transaction.atomic():
        for target_path in target_paths:
            rule, _ = HandriveAccessRule.objects.get_or_create(path=target_path)
            rule.read_users.set(read_users_queryset)
            rule.read_groups.set(read_groups_queryset)
            rule.write_users.set(write_users_queryset)
            rule.write_groups.set(write_groups_queryset)

    response_payload = {
        "ok": True,
        "paths": target_paths,
        "read_user_ids": read_user_ids,
        "read_group_ids": read_group_ids,
        "write_user_ids": write_user_ids,
        "write_group_ids": write_group_ids,
    }
    if len(target_paths) == 1:
        response_payload["path"] = target_paths[0]
    return JsonResponse(response_payload)


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_url_share(request):
    try:
        payload = parse_json_body(request)
        rel_path = normalize_relative_path(payload.get("path"), allow_empty=False)
        enabled = bool(payload.get("enabled"))
        target_path_obj, rel_path = resolve_path(rel_path, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if target_path_obj.is_dir():
        if not has_handrive_write_access(request, rel_path):
            return json_error("폴더를 수정할 권한이 없습니다.", status=403)
    else:
        if not has_handrive_write_access(request, rel_path):
            return json_error("파일을 수정할 권한이 없습니다.", status=403)
    if not request.user.is_authenticated:
        return json_error("로그인한 사용자만 url공유를 설정할 수 있습니다.", status=403)

    url_only_group, _ = Group.objects.get_or_create(name=DOCS_URL_ONLY_GROUP_NAME)
    rule, _ = HandriveAccessRule.objects.get_or_create(path=rel_path)
    shared_link = None

    if enabled:
        rule.read_groups.add(url_only_group)
        shared_link = ensure_handrive_shared_link(rel_path, request.user)
    else:
        rule.read_groups.remove(url_only_group)
        HandriveSharedLink.objects.filter(path=rel_path).delete()
        if (
            not rule.read_users.exists()
            and not rule.read_groups.exists()
            and not rule.write_users.exists()
            and not rule.write_groups.exists()
        ):
            rule.delete()

    for attr_name in (
        "_handrive_acl_rule_map",
        "_handrive_acl_effective_cache",
        "_handrive_acl_descendant_rule_cache",
    ):
        if hasattr(request, attr_name):
            delattr(request, attr_name)

    ui_lang = resolve_ui_lang(request, getattr(getattr(request, "resolver_match", None), "kwargs", {}).get("ui_lang"))
    slug_path = markdown_slug_from_relative(rel_path)
    share_url = ""
    owner_username = ""
    if shared_link is not None:
        owner_username = shared_link.owner.username
        share_url = request.build_absolute_uri(
            build_handrive_shared_view_url(ui_lang, owner_username, shared_link.share_slug)
        )

    return JsonResponse(
        {
            "ok": True,
            "path": rel_path,
            "slug_path": slug_path,
            "is_url_only": enabled,
            "share_url": share_url,
            "owner_username": owner_username,
            "share_slug": shared_link.share_slug if shared_link is not None else "",
        }
    )


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_sync_settings(request):
    is_english = (resolve_ui_lang(request, getattr(getattr(request, "resolver_match", None), "kwargs", {}).get("ui_lang")) == "en")
    if not request.user.is_authenticated:
        msg = "Login required." if is_english else "로그인이 필요합니다."
        return JsonResponse({"ok": False, "error": msg}, status=401)

    try:
        payload = json.loads(request.body or "{}")
    except (TypeError, ValueError):
        msg = "Invalid request." if is_english else "잘못된 요청입니다."
        return JsonResponse({"ok": False, "error": msg}, status=400)

    scoped_home_dir = get_scoped_handrive_home_dir(request)
    excluded_paths = _sanitize_sync_excluded_paths(payload.get("excluded_paths"), scoped_home_dir)

    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    profile.sync_excluded_paths = excluded_paths
    profile.save(update_fields=["sync_excluded_paths", "updated_at"])

    return JsonResponse({"ok": True, "excluded_paths": excluded_paths})


@require_http_methods(["GET"])
@with_request_handrive_root
def handrive_api_list(request):
    """디렉터리 엔트리 목록을 JSON으로 반환한다."""
    rel_path = request.GET.get("path", "")

    try:
        normalized = normalize_relative_path(rel_path, allow_empty=True)
    except ValueError as exc:
        return json_error(str(exc), status=404)

    try:
        archive_virtual = parse_archive_virtual_path(normalized)
    except ValueError as exc:
        return json_error(str(exc), status=404)
    if archive_virtual is not None:
        archive_relative, archive_inner_path = archive_virtual
        try:
            archive_path, archive_relative = resolve_path(archive_relative, must_exist=True)
        except (ValueError, FileNotFoundError) as exc:
            return json_error(str(exc), status=404)
        if not archive_path.is_file() or not is_handrive_supported_archive_path(archive_path):
            return json_error("지원하지 않는 압축파일입니다.", status=400)
        if not has_handrive_read_access(request, archive_relative):
            return json_error("파일을 볼 권한이 없습니다.", status=403)
        try:
            entries = list_archive_entries(archive_path, archive_relative, archive_inner_path, request=request)
        except zipfile.BadZipFile:
            return json_error("압축파일을 읽을 수 없습니다.", status=400)
        normalized = build_archive_virtual_path(archive_relative, archive_inner_path)
        return JsonResponse(
            {
                "ok": True,
                "path": normalized,
                "entries": entries,
                "directory": build_archive_directory_meta(request, archive_relative, archive_inner_path, entries),
            }
        )

    git_virtual = _get_git_virtual_context(request, normalized)
    if git_virtual is None:
        # 경로 존재 여부 노출을 막기 위해 권한 검사를 먼저 수행한다.
        if not has_handrive_read_access(request, normalized):
            return json_error("폴더를 찾을 수 없습니다.", status=404)
        try:
            target_dir, normalized = resolve_path(rel_path, must_exist=True)
        except (ValueError, FileNotFoundError) as exc:
            return json_error(str(exc), status=404)
        if not target_dir.is_dir():
            return json_error("폴더 경로가 아닙니다.", status=400)
        entries = list_directory_entries(target_dir, request=request)
    else:
        if git_virtual["kind"] == "branch_file":
            return json_error("폴더 경로가 아닙니다.", status=400)
        if not has_handrive_read_access(request, normalized):
            return json_error("폴더를 찾을 수 없습니다.", status=404)
        try:
            entries = _build_git_virtual_entries(request, git_virtual)
        except RuntimeError as exc:
            return json_error(str(exc), status=500)

    try:
        directory_meta = _build_handrive_directory_meta(request, normalized, entries)
    except (ValueError, FileNotFoundError):
        return json_error("폴더를 찾을 수 없습니다.", status=404)

    return JsonResponse(
        {
            "ok": True,
            "path": normalized,
            "entries": entries,
            "directory_meta": directory_meta,
        }
    )


@require_http_methods(["GET"])
@with_request_handrive_root
def handrive_api_search(request):
    """디렉터리를 재귀 탐색하여 이름에 검색어가 포함된 엔트리를 반환한다."""
    rel_path = request.GET.get("path", "")
    query = request.GET.get("q", "").strip()

    if not query:
        return JsonResponse({"ok": True, "entries": []})

    try:
        base_dir, normalized_base = resolve_path(rel_path, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=404)

    if not base_dir.is_dir():
        return json_error("폴더 경로가 아닙니다.", status=400)

    if not has_handrive_read_access(request, normalized_base):
        return json_error("파일을 볼 권한이 없습니다.", status=403)

    # macOS 는 파일명을 NFD 로 저장하므로 쿼리도 NFC → NFD 방향으로 정규화해 비교한다.
    normalized_query = unicodedata.normalize("NFC", query).lower()
    root = handrive_root_dir().resolve()
    matches = []

    def _name_matches(name: str) -> bool:
        return unicodedata.normalize("NFC", name).lower().find(normalized_query) != -1

    for dirpath, dirnames, filenames in os.walk(base_dir):
        # 숨김 디렉터리 스킵 (in-place 수정으로 하위 탐색도 차단)
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]

        current_dir_path = Path(dirpath)
        rel_current = str(current_dir_path.relative_to(root)).replace("\\", "/")

        # git repo 가상 마운트 경로는 아래 git 검색에서 별도로 처리한다.
        if is_handrive_git_repo_mounted_path(request, rel_current) and current_dir_path != base_dir:
            dirnames.clear()
            continue

        # 현재 디렉터리 자체가 매칭되는지 (base_dir 자체는 제외)
        if current_dir_path != base_dir:
            dir_name = current_dir_path.name
            if _name_matches(dir_name):
                rel_dir = rel_current
                if has_handrive_read_access(request, rel_dir):
                    share_info = build_handrive_existing_share_info(request, rel_dir)
                    try:
                        has_children = any(current_dir_path.iterdir())
                    except OSError:
                        has_children = False
                    entry = {
                        "name": dir_name,
                        "path": rel_dir,
                        "type": "dir",
                        "has_children": has_children,
                        "modified_display": format_handrive_modified_display_from_timestamp(file_path.stat().st_mtime) if file_path.exists() else "",
                        "size_display": "",
                        "can_edit": has_handrive_write_access(request, rel_dir),
                        "can_write_children": has_handrive_directory_write_access(request, rel_dir),
                        "can_delete": has_handrive_write_access(request, rel_dir),
                        "is_public_write": False,
                        "is_url_only": is_handrive_url_only_enabled(request, rel_dir),
                        "write_acl_labels": get_write_acl_display_labels(request, rel_dir),
                        "share_url": share_info["share_url"],
                        "share_is_inherited": share_info["share_is_inherited"],
                    }
                    matches.append(entry)

        # 파일 매칭
        for filename in filenames:
            if _name_matches(filename):
                file_path = current_dir_path / filename
                rel_file = (rel_current + "/" + filename) if rel_current != "." else filename
                if has_handrive_read_access(request, rel_file):
                    share_info = build_handrive_existing_share_info(request, rel_file)
                    try:
                        size = file_path.stat().st_size
                        size_display = format_handrive_bytes_display(size)
                    except OSError:
                        size_display = ""
                    entry = {
                        "name": filename,
                        "path": rel_file,
                        "type": "file",
                        "modified_display": format_handrive_modified_display_from_timestamp(file_path.stat().st_mtime),
                        "size_display": size_display,
                        "can_edit": has_handrive_write_access(request, rel_file),
                        "can_write_children": False,
                        "can_delete": has_handrive_write_access(request, rel_file),
                        "is_public_write": is_handrive_public_write_enabled(request, rel_file),
                        "is_url_only": is_handrive_url_only_enabled(request, rel_file),
                        "write_acl_labels": get_write_acl_display_labels(request, rel_file),
                        "share_url": share_info["share_url"],
                        "share_is_inherited": share_info["share_is_inherited"],
                    }
                    matches.append(entry)

    # git 가상 경로 검색: 검색 범위에 포함되는 repo 를 재귀 탐색한다.
    for repo in _get_visible_git_repositories(request):
        if repo.status != "active":
            continue
        repo_root = _get_visible_git_repo_root_relative(request, repo)
        # 검색 base 가 repo root 의 부모이거나 동일한 경우에만 탐색
        if not (
            normalized_base == ""
            or repo_root == normalized_base
            or repo_root.startswith(normalized_base + "/")
            or normalized_base.startswith(repo_root + "/")
        ):
            continue

        repo_permission = _get_git_repo_permission_for_request(request, repo)
        can_write_repo = repo_permission in {"write", "admin", "owner"}

        try:
            branches = _git_repo_branches(repo)
        except Exception:
            continue

        for branch_name in branches:
            branch_segment = _encode_git_branch_segment(branch_name)
            branch_prefix = f"{repo_root}/{branch_segment}"

            try:
                result = _run_git_repo_command(repo, "ls-tree", "-r", "-t", "-z", branch_name, text=False)
            except Exception:
                continue

            payload = result.stdout or b""
            for raw_item in payload.split(b"\x00"):
                if not raw_item:
                    continue
                try:
                    meta, path_bytes = raw_item.split(b"\t", 1)
                    _mode, object_type, _sha = meta.decode("utf-8").split(" ", 2)
                    git_path = path_bytes.decode("utf-8")
                except Exception:
                    continue

                name = git_path.rsplit("/", 1)[-1]
                if not name or name == ".gitkeep":
                    continue
                if not _name_matches(name):
                    continue

                is_tree = object_type == "tree"
                entry_path = f"{branch_prefix}/{git_path}"
                entry = {
                    "name": name,
                    "path": entry_path,
                    "type": "dir" if is_tree else "file",
                    "modified_display": _git_repo_latest_commit_meta(repo, branch_name, git_path).get("modified_display", ""),
                    "size_display": "",
                    "can_edit": can_write_repo,
                    "can_write_children": is_tree and can_write_repo,
                    "can_delete": can_write_repo,
                    "is_public_write": False,
                    "is_url_only": False,
                    "write_acl_labels": [],
                    "git_repo_branch": branch_name,
                    "requires_commit_message": True,
                }
                if is_tree:
                    entry["has_children"] = True
                else:
                    entry["slug_path"] = entry_path
                    entry["share_url"] = ""
                matches.append(entry)

    return JsonResponse({"ok": True, "entries": matches})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_rename(request):
    """파일/폴더 이름 변경 API.

    일반 경로는 파일 시스템 rename 을, repo branch 경로는 temp clone + commit/push 를 사용한다.
    """
    try:
        payload = parse_json_body(request)
        rel_path = normalize_relative_path(payload.get("path"), allow_empty=False)
        new_name = validate_name(payload.get("new_name"), for_file=False)
        commit_message = str(payload.get("commit_message") or "").strip()
        git_virtual_source = _get_git_virtual_context(request, rel_path)
        if git_virtual_source is None:
            source_path, source_relative = resolve_path(rel_path, must_exist=True)
        else:
            source_path = None
            source_relative = rel_path
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if source_relative == "":
        return json_error("루트 폴더는 이름을 바꿀 수 없습니다.", status=400)
    mounted_repo = _get_git_repo_for_relative_path(request, source_relative)
    if mounted_repo is not None:
        return json_error("Repo 루트는 이름을 바꿀 수 없습니다.", status=400)
    if git_virtual_source is not None:
        if git_virtual_source["kind"] == "repo_root":
            return json_error("Repo 루트는 이름을 바꿀 수 없습니다.", status=400)
        if git_virtual_source["kind"] == "branch_dir" and not git_virtual_source["repo_relative_path"]:
            return json_error("브랜치 이름은 여기서 바꿀 수 없습니다.", status=400)
        old_repo_relative = normalize_relative_path(git_virtual_source["repo_relative_path"], allow_empty=False)
        old_name = Path(old_repo_relative).name
        suffix = Path(old_name).suffix.lower()
        if git_virtual_source["kind"] == "branch_file":
            candidate_name, candidate_extension = resolve_file_name_and_extension(
                new_name,
                fallback_extension=suffix,
            )
            new_leaf_name = f"{candidate_name}{candidate_extension}"
        else:
            candidate_name = validate_name(new_name, for_file=False)
            new_leaf_name = candidate_name
        parent_relative = normalize_relative_path(str(Path(old_repo_relative).parent).replace("\\", "/"), allow_empty=True)
        if parent_relative == ".":
            parent_relative = ""
        new_repo_relative = f"{parent_relative}/{new_leaf_name}" if parent_relative else new_leaf_name
        if _git_repo_path_exists(git_virtual_source["repo"], git_virtual_source["branch_name"], new_repo_relative):
            return json_error("같은 이름의 항목이 이미 존재합니다.", status=409)

        def _mutate(worktree_dir: Path) -> None:
            source_target = _resolve_git_worktree_path(worktree_dir, old_repo_relative)
            destination_target = _resolve_git_worktree_path(worktree_dir, new_repo_relative)
            destination_target.parent.mkdir(parents=True, exist_ok=True)
            _remove_gitkeep_placeholder(destination_target.parent)
            source_target.rename(destination_target)

        try:
            _commit_git_branch_mutation(git_virtual_source["repo"], git_virtual_source["branch_name"], commit_message, request.user, _mutate)
        except ValueError as exc:
            return json_error(str(exc), status=400)
        relative_destination = f"{git_virtual_source['repo_root']}/{git_virtual_source['branch_segment']}/{new_repo_relative}"
        response = {
            "ok": True,
            "path": relative_destination,
            "type": "dir" if git_virtual_source["kind"] == "branch_dir" else "file",
        }
        if git_virtual_source["kind"] == "branch_file":
            response["slug_path"] = relative_destination
        return JsonResponse(response)
    if not has_handrive_write_access(request, source_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)
    if source_path.is_file() and is_handrive_public_write_enabled(request, source_relative):
        return json_error("전체 허용 파일은 이름을 바꿀 수 없습니다.", status=403)

    parent = source_path.parent
    if source_path.is_file():
        source_extension = source_path.suffix.lower()
        try:
            source_extension = normalize_file_extension(source_extension)
        except ValueError:
            return json_error("파일만 이름을 바꿀 수 있습니다.", status=400)
        candidate_name, candidate_extension = resolve_file_name_and_extension(
            new_name,
            fallback_extension=source_extension,
        )
        destination = parent / f"{candidate_name}{candidate_extension}"
    else:
        destination = parent / new_name

    same_path_case_change_only = destination.name.lower() == source_path.name.lower()
    if destination.exists() and destination.resolve() != source_path.resolve() and not same_path_case_change_only:
        return json_error("같은 이름의 항목이 이미 존재합니다.", status=409)

    source_path.rename(destination)
    relative_destination = relative_from_root(destination)
    move_handrive_acl_rules(source_relative, relative_destination)
    move_handrive_shared_links(source_relative, relative_destination)
    move_handrive_sync_excluded_paths(source_relative, relative_destination)

    response = {
        "ok": True,
        "path": relative_destination,
        "type": "dir" if destination.is_dir() else "file",
    }
    if destination.is_file():
        response["slug_path"] = markdown_slug_from_relative(relative_destination)

    return JsonResponse(response)


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_delete(request):
    """파일/폴더 삭제 API.

    repo root 삭제는 일반 삭제와 분리해서 다룬다.
    또한 repo branch 내부 다중 삭제는 같은 repo/branch 묶음만 허용한다.
    """
    try:
        payload = parse_json_body(request)
        path_values = parse_path_values(payload, allow_empty=False)
        commit_message = str(payload.get("commit_message") or "").strip()
        repo_delete_requested = bool(payload.get("repo_delete"))
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    resolved_targets: list[tuple[Path | None, str, dict | None]] = []
    seen_paths = set()
    try:
        for path_value in path_values:
            git_virtual = _get_git_virtual_context(request, path_value)
            if git_virtual is None:
                target_path, target_relative = resolve_path(path_value, must_exist=True)
            else:
                target_path = None
                target_relative = path_value
            if target_relative in seen_paths:
                continue
            seen_paths.add(target_relative)
            resolved_targets.append((target_path, target_relative, git_virtual))
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    git_virtual_targets = [item for item in resolved_targets if item[2] is not None]
    if git_virtual_targets:
        if len(git_virtual_targets) != len(resolved_targets):
            return json_error("Repo 브랜치 항목과 일반 항목은 함께 삭제할 수 없습니다.", status=400)
        repo_ids = {item[2]["repo"].id for item in git_virtual_targets}
        branch_names = {item[2]["branch_name"] for item in git_virtual_targets}
        if len(repo_ids) != 1 or len(branch_names) != 1:
            return json_error("같은 Repo 브랜치의 항목만 함께 삭제할 수 있습니다.", status=400)
        for _target_path, target_relative, git_virtual in git_virtual_targets:
            if git_virtual["kind"] == "repo_root":
                return json_error("Repo 루트 삭제는 Repo 삭제를 사용해주세요.", status=400)
            if git_virtual["kind"] == "branch_dir" and not git_virtual["repo_relative_path"]:
                return json_error("브랜치 루트는 삭제할 수 없습니다.", status=400)

        selected_directory_paths = {
            target_relative
            for _target_path, target_relative, git_virtual in git_virtual_targets
            if git_virtual["kind"] == "branch_dir"
        }
        effective_targets = []
        for item in git_virtual_targets:
            _target_path, target_relative, _git_virtual = item
            is_descendant_of_selected_directory = any(
                target_relative != selected_dir and target_relative.startswith(f"{selected_dir}/")
                for selected_dir in selected_directory_paths
            )
            if not is_descendant_of_selected_directory:
                effective_targets.append(item)

        repo = effective_targets[0][2]["repo"]
        branch_name = effective_targets[0][2]["branch_name"]
        repo_relative_targets = [normalize_relative_path(item[2]["repo_relative_path"], allow_empty=False) for item in effective_targets]

        def _mutate(worktree_dir: Path) -> None:
            for repo_relative_path in repo_relative_targets:
                target_path = _resolve_git_worktree_path(worktree_dir, repo_relative_path)
                parent_path = target_path.parent
                if target_path.is_dir():
                    shutil.rmtree(target_path)
                elif target_path.exists():
                    target_path.unlink()
                _ensure_gitkeep_if_empty(parent_path, worktree_dir)

        try:
            _commit_git_branch_mutation(repo, branch_name, commit_message, request.user, _mutate)
        except ValueError as exc:
            return json_error(str(exc), status=400)
        return JsonResponse({"ok": True, "deleted_paths": [item[1] for item in effective_targets]})

    for target_path, target_relative, _git_virtual in resolved_targets:
        if target_relative == "":
            return json_error("루트 폴더는 삭제할 수 없습니다.", status=400)
        is_repo_root_delete = target_path.is_dir() and is_handrive_git_repo_root_path(request, target_relative)
        if is_repo_root_delete and not repo_delete_requested:
            return json_error("Repo 루트 삭제는 Repo 삭제를 사용해주세요.", status=403)
        if not is_repo_root_delete and not has_handrive_write_access(request, target_relative):
            return json_error("파일을 수정할 권한이 없습니다.", status=403)
        if target_path.is_file() and is_handrive_public_write_enabled(request, target_relative):
            return json_error("전체 허용 파일은 삭제할 수 없습니다.", status=403)
        if target_path.is_file():
            try:
                normalize_file_extension(target_path.suffix.lower())
            except ValueError:
                return json_error("파일만 삭제할 수 있습니다.", status=400)

    selected_directory_paths = {
        target_relative
        for target_path, target_relative, _git_virtual in resolved_targets
        if target_path.is_dir()
    }
    effective_targets: list[tuple[Path, str]] = []
    for target_path, target_relative, _git_virtual in resolved_targets:
        is_descendant_of_selected_directory = any(
            target_relative != selected_dir and target_relative.startswith(f"{selected_dir}/")
            for selected_dir in selected_directory_paths
        )
        if is_descendant_of_selected_directory:
            continue
        effective_targets.append((target_path, target_relative))

    deleted_paths = []
    for target_path, target_relative in effective_targets:
        git_repo = _get_git_repo_for_relative_path(request, target_relative) if target_path.is_dir() else None
        if git_repo is not None:
            owner_name = git_repo.forgejo_owner or request.user.username
            repo_name = git_repo.forgejo_repo_name or git_repo.repo_name
            restore_relative = _get_repo_restore_relative_path(git_repo.owner, git_repo.repo_name)
            restore_path, _ = resolve_path(restore_relative, must_exist=False)
            if restore_path != target_path and (restore_path.exists() or restore_path.is_symlink()):
                return json_error("Repo를 되돌릴 루트 폴더에 같은 이름의 항목이 이미 존재합니다.", status=409)
            with tempfile.TemporaryDirectory(prefix="handrive_repo_restore_") as temp_dir:
                staged_restore_path = Path(temp_dir) / "restored"
                _materialize_git_repo_mount(target_path, staged_restore_path)
                ForgejoClient().delete_repo(owner_name, repo_name)
                if target_path.is_symlink() or target_path.is_file():
                    target_path.unlink()
                elif target_path.exists():
                    shutil.rmtree(target_path)
                _copy_tree_contents(staged_restore_path, restore_path)
                if restore_path != target_path:
                    move_handrive_acl_rules(target_relative, restore_relative)
                    move_handrive_shared_links(target_relative, restore_relative)
                    move_handrive_sync_excluded_paths(target_relative, restore_relative)
            git_repo.delete()
            deleted_paths.append(target_relative)
            continue
        if target_path.is_dir():
            if target_path.is_symlink():
                target_path.unlink()
            else:
                shutil.rmtree(target_path)
        else:
            target_path.unlink()
        delete_handrive_acl_rules_for_path(target_relative)
        delete_handrive_shared_links_for_path(target_relative)
        delete_handrive_sync_excluded_paths_for_path(target_relative)
        deleted_paths.append(target_relative)

    return JsonResponse({"ok": True, "deleted_paths": deleted_paths})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_archive_extract(request):
    """ZIP 전체 또는 ZIP 내부 선택 항목을 실제 HanDrive 폴더로 압축해제한다."""
    try:
        payload = parse_json_body(request)
        source_path_value = normalize_relative_path(payload.get("source_path"), allow_empty=False)
        target_dir_value = normalize_relative_path(payload.get("target_dir"), allow_empty=True)
        destination_mode = str(payload.get("destination_mode") or "current").strip().lower()
        if destination_mode not in {"current", "folder"}:
            raise ValueError("압축해제 위치가 올바르지 않습니다.")
        archive_virtual = parse_archive_virtual_path(source_path_value)
        if archive_virtual is None:
            archive_relative = source_path_value
            selected_member_path = ""
        else:
            archive_relative, selected_member_path = archive_virtual
        archive_path, archive_relative = resolve_path(archive_relative, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if not archive_path.is_file() or not is_handrive_supported_archive_path(archive_path):
        return json_error("지원하지 않는 압축파일입니다.", status=400)
    if not has_handrive_read_access(request, archive_relative):
        return json_error("파일을 볼 권한이 없습니다.", status=403)

    try:
        if target_dir_value:
            target_dir_path, target_dir_relative = resolve_path(target_dir_value, must_exist=True)
        else:
            target_dir_path = archive_path.parent
            target_dir_relative = relative_from_root(target_dir_path)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)
    if not target_dir_path.is_dir():
        return json_error("압축해제 대상 경로가 폴더가 아닙니다.", status=400)
    if not has_handrive_directory_write_access(request, target_dir_relative):
        return json_error("폴더에 쓸 권한이 없습니다.", status=403)

    destination_root = target_dir_path
    if destination_mode == "folder":
        destination_root = build_available_archive_directory_path(target_dir_path, archive_path.stem)
        destination_root.mkdir(parents=True, exist_ok=True)

    selected_member_path = normalize_archive_member_name(selected_member_path)
    selected_prefix = f"{selected_member_path}/" if selected_member_path else ""
    selected_parent = str(Path(selected_member_path).parent).replace("\\", "/") if selected_member_path else ""
    if selected_parent == ".":
        selected_parent = ""
    extracted_top_paths = set()
    extracted_count = 0
    destination_root_resolved = destination_root.resolve()
    handrive_root_resolved = handrive_root_dir().resolve()
    if destination_root_resolved != handrive_root_resolved and handrive_root_resolved not in destination_root_resolved.parents:
        return json_error("압축해제 대상 경로가 올바르지 않습니다.", status=400)

    # Zip Bomb 방어: 개별 파일 최대 4GB, 전체 압축해제 최대 8GB
    _EXTRACT_MAX_SINGLE_BYTES = 4 * 1024 ** 3
    _EXTRACT_MAX_TOTAL_BYTES = 8 * 1024 ** 3

    try:
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            if selected_member_path and not any(
                normalize_archive_member_name(info.filename) == selected_member_path
                or normalize_archive_member_name(info.filename).startswith(selected_prefix)
                for info in infos
            ):
                return json_error("압축파일 안에서 항목을 찾을 수 없습니다.", status=404)

            total_uncompressed = sum(
                info.file_size for info in infos
                if not (info.is_dir() or info.filename.endswith("/"))
            )
            if total_uncompressed > _EXTRACT_MAX_TOTAL_BYTES:
                return json_error("압축해제 크기가 허용 한도(8GB)를 초과합니다.", status=400)

            for info in infos:
                member_name = normalize_archive_member_name(info.filename)
                if not member_name:
                    continue
                if selected_member_path:
                    if member_name != selected_member_path and not member_name.startswith(selected_prefix):
                        continue
                    extract_relative = member_name
                    if selected_parent and member_name.startswith(selected_parent + "/"):
                        extract_relative = member_name[len(selected_parent) + 1:]
                else:
                    extract_relative = member_name
                extract_relative = normalize_archive_member_name(extract_relative)
                if not extract_relative:
                    continue

                destination_path = destination_root / extract_relative
                destination_resolved = destination_path.resolve()
                if destination_resolved != destination_root_resolved and destination_root_resolved not in destination_resolved.parents:
                    return json_error("압축파일 안에 허용되지 않은 경로가 있습니다.", status=400)
                top_name = extract_relative.split("/", 1)[0]
                extracted_top_paths.add(relative_from_root(destination_root / top_name))

                if info.is_dir() or member_name.endswith("/"):
                    destination_path.mkdir(parents=True, exist_ok=True)
                    continue
                if info.file_size > _EXTRACT_MAX_SINGLE_BYTES:
                    return json_error(f"단일 파일 크기가 허용 한도(4GB)를 초과합니다: {extract_relative}", status=400)
                if destination_path.exists():
                    return json_error(f"같은 이름의 항목이 이미 존재합니다: {extract_relative}", status=409)
                destination_path.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(info, "r") as source, destination_path.open("wb") as target:
                    shutil.copyfileobj(source, target)
                extracted_count += 1
    except zipfile.BadZipFile:
        return json_error("압축파일을 읽을 수 없습니다.", status=400)
    except OSError as exc:
        return json_error(f"압축해제에 실패했습니다: {exc}", status=500)

    if extracted_count == 0:
        return json_error("압축해제할 파일이 없습니다.", status=400)

    extracted_paths = sorted(extracted_top_paths)
    response_path = extracted_paths[0] if extracted_paths else relative_from_root(destination_root)
    return JsonResponse(
        {
            "ok": True,
            "path": response_path,
            "paths": extracted_paths,
            "target_dir": target_dir_relative,
            "destination_dir": relative_from_root(destination_root),
        }
    )


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_archive_create(request):
    """폴더를 같은 상위 폴더에 ZIP 파일로 압축한다."""
    try:
        payload = parse_json_body(request)
        source_path_value = normalize_relative_path(payload.get("source_path"), allow_empty=False)
        source_path, source_relative = resolve_path(source_path_value, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if not source_path.is_dir():
        return json_error("폴더만 압축할 수 있습니다.", status=400)
    if not has_handrive_read_access(request, source_relative):
        return json_error("파일을 볼 권한이 없습니다.", status=403)

    parent_dir = source_path.parent
    parent_relative = relative_from_root(parent_dir)
    if not has_handrive_directory_write_access(request, parent_relative):
        return json_error("폴더에 쓸 권한이 없습니다.", status=403)

    try:
        destination_path = build_available_archive_file_path(parent_dir, source_path.name)
        destination_resolved = destination_path.resolve()
        root_resolved = handrive_root_dir().resolve()
        if destination_resolved != root_resolved and root_resolved not in destination_resolved.parents:
            return json_error("압축파일 생성 위치가 올바르지 않습니다.", status=400)

        file_count = 0
        with zipfile.ZipFile(destination_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            root_arcname = source_path.name.rstrip("/") + "/"
            archive.writestr(root_arcname, b"")
            for child in sorted(source_path.rglob("*"), key=lambda p: p.relative_to(source_path).as_posix().lower()):
                if child == destination_path:
                    continue
                try:
                    relative_child = child.relative_to(source_path).as_posix()
                except ValueError:
                    continue
                arcname = f"{source_path.name}/{relative_child}"
                if child.is_dir():
                    archive.writestr(arcname.rstrip("/") + "/", b"")
                    continue
                if not child.is_file():
                    continue
                archive.write(child, arcname)
                file_count += 1
    except OSError as exc:
        return json_error(f"압축파일 생성에 실패했습니다: {exc}", status=500)
    except zipfile.BadZipFile:
        return json_error("압축파일 생성에 실패했습니다.", status=500)

    destination_relative = relative_from_root(destination_path)
    response = {
        "ok": True,
        "path": destination_relative,
        "paths": [destination_relative],
        "file_count": file_count,
        "type": "file",
        "slug_path": destination_relative,
    }
    return JsonResponse(response)


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_mkdir(request):
    """새 폴더 생성 API."""
    try:
        payload = parse_json_body(request)
        parent_dir = normalize_relative_path(payload.get("parent_dir"), allow_empty=True)
        folder_name = validate_name(payload.get("folder_name"), for_file=False)
        commit_message = str(payload.get("commit_message") or "").strip()
        git_virtual_parent = _get_git_virtual_context(request, parent_dir)
        if git_virtual_parent is None:
            parent_path, _ = resolve_path(parent_dir, must_exist=True)
            enforce_handrive_scoped_quota(request, quota_path=parent_dir, extra_entries=1)
        else:
            parent_path = None
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if git_virtual_parent is None and not parent_path.is_dir():
        return json_error("폴더 생성 위치가 올바르지 않습니다.", status=400)
    if not has_handrive_directory_write_access(request, parent_dir):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)
    if git_virtual_parent is not None:
        if git_virtual_parent["kind"] != "branch_dir":
            return json_error("폴더 생성 위치가 올바르지 않습니다.", status=400)
        repo_relative_path = (
            f"{git_virtual_parent['repo_relative_path']}/{folder_name}"
            if git_virtual_parent["repo_relative_path"]
            else folder_name
        )
        if _git_repo_path_exists(git_virtual_parent["repo"], git_virtual_parent["branch_name"], repo_relative_path):
            return json_error("같은 이름의 폴더가 이미 존재합니다.", status=409)

        def _mutate(worktree_dir: Path) -> None:
            target_path = _resolve_git_worktree_path(worktree_dir, repo_relative_path)
            target_path.mkdir(parents=True, exist_ok=False)
            (target_path / ".gitkeep").write_text("", encoding="utf-8")

        try:
            _commit_git_branch_mutation(git_virtual_parent["repo"], git_virtual_parent["branch_name"], commit_message, request.user, _mutate)
        except ValueError as exc:
            return json_error(str(exc), status=400)
        return JsonResponse({"ok": True, "path": f"{git_virtual_parent['repo_root']}/{git_virtual_parent['branch_segment']}/{repo_relative_path}"})

    target_path = parent_path / folder_name
    if target_path.exists():
        return json_error("같은 이름의 폴더가 이미 존재합니다.", status=409)

    target_path.mkdir(parents=False, exist_ok=False)
    return JsonResponse({"ok": True, "path": relative_from_root(target_path)})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_move(request):
    """파일/폴더 이동 API.

    일반 경로 이동과 repo branch 이동을 둘 다 지원하며,
    repo branch 대상 이동은 Git commit/push 로 변환된다.
    """
    try:
        payload = parse_json_body(request)
        source_path_value = normalize_relative_path(payload.get("source_path"), allow_empty=False)
        target_dir_value = normalize_relative_path(payload.get("target_dir"), allow_empty=True)
        commit_message = str(payload.get("commit_message") or "").strip()
        git_virtual_source = _get_git_virtual_context(request, source_path_value)
        git_virtual_target = _get_git_virtual_context(request, target_dir_value)
        if git_virtual_source is None:
            source_path, source_relative = resolve_path(source_path_value, must_exist=True)
        else:
            source_path = None
            source_relative = source_path_value
        if git_virtual_target is None:
            target_dir_path, target_dir_relative = resolve_path(target_dir_value, must_exist=True)
        else:
            target_dir_path = None
            target_dir_relative = target_dir_value
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if source_relative == "":
        return json_error("루트 폴더는 이동할 수 없습니다.", status=400)
    if git_virtual_source is not None or git_virtual_target is not None:
        if git_virtual_source is None and git_virtual_target is not None:
            if not target_dir_relative:
                return json_error("이동 대상 경로가 올바르지 않습니다.", status=400)
            if not target_dir_relative or git_virtual_target["kind"] != "branch_dir":
                return json_error("이동 대상 경로가 폴더가 아닙니다.", status=400)
            if not has_handrive_write_access(request, source_relative):
                return json_error("파일을 수정할 권한이 없습니다.", status=403)
            if source_path.is_file() and is_handrive_public_write_enabled(request, source_relative):
                return json_error("전체 허용 파일은 이동할 수 없습니다.", status=403)
            source_was_dir = source_path.is_dir()
            source_name = source_path.name
            target_repo_relative = (
                f"{git_virtual_target['repo_relative_path']}/{source_name}"
                if git_virtual_target["repo_relative_path"]
                else source_name
            )
            if _git_repo_path_exists(git_virtual_target["repo"], git_virtual_target["branch_name"], target_repo_relative):
                return json_error("같은 이름의 항목이 이미 존재합니다.", status=409)

            def _mutate(worktree_dir: Path) -> None:
                destination_target = _resolve_git_worktree_path(worktree_dir, target_repo_relative)
                destination_target.parent.mkdir(parents=True, exist_ok=True)
                _remove_gitkeep_placeholder(destination_target.parent)
                _copy_local_item_to_git_worktree(source_path, destination_target)

            try:
                _commit_git_branch_mutation(git_virtual_target["repo"], git_virtual_target["branch_name"], commit_message, request.user, _mutate)
            except ValueError as exc:
                return json_error(str(exc), status=400)

            if source_path.is_dir():
                if source_path.is_symlink():
                    source_path.unlink()
                else:
                    shutil.rmtree(source_path)
            else:
                source_path.unlink()
            delete_handrive_acl_rules_for_path(source_relative)
            delete_handrive_shared_links_for_path(source_relative)
            delete_handrive_sync_excluded_paths_for_path(source_relative)

            destination_relative = f"{git_virtual_target['repo_root']}/{git_virtual_target['branch_segment']}/{target_repo_relative}"
            response = {
                "ok": True,
                "path": destination_relative,
                "type": "dir" if source_was_dir else "file",
            }
            if not source_was_dir:
                response["slug_path"] = destination_relative
            return JsonResponse(response)
        if git_virtual_source is None or git_virtual_target is None:
            return json_error("Repo 브랜치 항목은 같은 브랜치 안에서만 이동할 수 있습니다.", status=400)
        if git_virtual_source["repo"].id != git_virtual_target["repo"].id or git_virtual_source["branch_name"] != git_virtual_target["branch_name"]:
            return json_error("Repo 브랜치 항목은 같은 브랜치 안에서만 이동할 수 있습니다.", status=400)
        if git_virtual_source["kind"] == "repo_root" or (git_virtual_source["kind"] == "branch_dir" and not git_virtual_source["repo_relative_path"]):
            return json_error("브랜치 루트는 이동할 수 없습니다.", status=400)
        if git_virtual_target["kind"] != "branch_dir":
            return json_error("이동 대상 경로가 폴더가 아닙니다.", status=400)
        source_repo_relative = normalize_relative_path(git_virtual_source["repo_relative_path"], allow_empty=False)
        target_repo_relative = (
            f"{git_virtual_target['repo_relative_path']}/{Path(source_repo_relative).name}"
            if git_virtual_target["repo_relative_path"]
            else Path(source_repo_relative).name
        )
        source_parent_relative = normalize_relative_path(str(Path(source_repo_relative).parent).replace("\\", "/"), allow_empty=True)
        if source_parent_relative == ".":
            source_parent_relative = ""
        if source_parent_relative == git_virtual_target["repo_relative_path"]:
            response = {
                "ok": True,
                "path": source_relative,
                "type": "dir" if git_virtual_source["kind"] == "branch_dir" else "file",
            }
            if git_virtual_source["kind"] == "branch_file":
                response["slug_path"] = source_relative
            return JsonResponse(response)
        if _git_repo_path_exists(git_virtual_source["repo"], git_virtual_source["branch_name"], target_repo_relative):
            return json_error("같은 이름의 항목이 이미 존재합니다.", status=409)

        def _mutate(worktree_dir: Path) -> None:
            source_target = _resolve_git_worktree_path(worktree_dir, source_repo_relative)
            destination_target = _resolve_git_worktree_path(worktree_dir, target_repo_relative)
            source_parent = source_target.parent
            if source_target.is_dir():
                resolved_source = source_target.resolve()
                resolved_destination_parent = destination_target.parent.resolve()
                if resolved_destination_parent == resolved_source or resolved_source in resolved_destination_parent.parents:
                    raise ValueError("폴더를 자기 자신 또는 하위 폴더로 이동할 수 없습니다.")
            destination_target.parent.mkdir(parents=True, exist_ok=True)
            _remove_gitkeep_placeholder(destination_target.parent)
            source_target.rename(destination_target)
            _ensure_gitkeep_if_empty(source_parent, worktree_dir)

        try:
            _commit_git_branch_mutation(git_virtual_source["repo"], git_virtual_source["branch_name"], commit_message, request.user, _mutate)
        except ValueError as exc:
            return json_error(str(exc), status=400)
        destination_relative = f"{git_virtual_source['repo_root']}/{git_virtual_source['branch_segment']}/{target_repo_relative}"
        response = {
            "ok": True,
            "path": destination_relative,
            "type": "dir" if git_virtual_source["kind"] == "branch_dir" else "file",
        }
        if git_virtual_source["kind"] == "branch_file":
            response["slug_path"] = destination_relative
        return JsonResponse(response)
    if not target_dir_path.is_dir():
        return json_error("이동 대상 경로가 폴더가 아닙니다.", status=400)
    if not has_handrive_write_access(request, source_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)
    if source_path.is_file() and is_handrive_public_write_enabled(request, source_relative):
        return json_error("전체 허용 파일은 이동할 수 없습니다.", status=403)
    if not has_handrive_directory_write_access(request, target_dir_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)

    source_parent_relative = normalize_relative_path(
        str(Path(source_relative).parent).replace("\\", "/"),
        allow_empty=True,
    )
    if source_parent_relative == ".":
        source_parent_relative = ""
    if source_parent_relative == target_dir_relative:
        response = {
            "ok": True,
            "path": source_relative,
            "type": "dir" if source_path.is_dir() else "file",
        }
        if source_path.is_file():
            response["slug_path"] = markdown_slug_from_relative(source_relative)
        return JsonResponse(response)

    destination_path = target_dir_path / source_path.name
    if destination_path.exists():
        return json_error("같은 이름의 항목이 이미 존재합니다.", status=409)

    if source_path.is_dir():
        source_resolved = source_path.resolve()
        target_resolved = target_dir_path.resolve()
        if target_resolved == source_resolved or source_resolved in target_resolved.parents:
            return json_error("폴더를 자기 자신 또는 하위 폴더로 이동할 수 없습니다.", status=400)

    source_path.rename(destination_path)
    destination_relative = relative_from_root(destination_path)
    move_handrive_acl_rules(source_relative, destination_relative)
    move_handrive_shared_links(source_relative, destination_relative)
    move_handrive_sync_excluded_paths(source_relative, destination_relative)

    response = {
        "ok": True,
        "path": destination_relative,
        "type": "dir" if destination_path.is_dir() else "file",
    }
    if destination_path.is_file():
        response["slug_path"] = markdown_slug_from_relative(destination_relative)
    return JsonResponse(response)


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_upload(request):
    """파일 업로드 API.

    일반 폴더 업로드, 청크 업로드, repo branch 업로드를 모두 처리한다.
    """
    try:
        target_dir_value = normalize_relative_path(request.POST.get("dir"), allow_empty=True)
        git_virtual_target = _get_git_virtual_context(request, target_dir_value)
        if git_virtual_target is None:
            target_dir_path, target_dir_relative = resolve_path(target_dir_value, must_exist=True)
        else:
            target_dir_path = None
            target_dir_relative = target_dir_value
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if git_virtual_target is None and not target_dir_path.is_dir():
        return json_error("업로드 위치가 폴더가 아닙니다.", status=400)
    if not has_handrive_directory_write_access(request, target_dir_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)
    commit_message = str(request.POST.get("commit_message") or "").strip()

    upload_id = str(request.POST.get("upload_id") or "").strip()
    chunk_index_value = request.POST.get("chunk_index")
    total_chunks_value = request.POST.get("total_chunks")
    chunk_file = request.FILES.get("chunk")

    if upload_id and chunk_index_value is not None and total_chunks_value is not None and chunk_file is not None:
        try:
            chunk_index = int(chunk_index_value)
            total_chunks = int(total_chunks_value)
        except (TypeError, ValueError):
            return json_error("업로드 청크 정보가 올바르지 않습니다.", status=400)
        if chunk_index < 0 or total_chunks <= 0 or chunk_index >= total_chunks:
            return json_error("업로드 청크 순서가 올바르지 않습니다.", status=400)

        original_name = str(request.POST.get("file_name") or chunk_file.name or "").strip()
        if not original_name:
            return json_error("업로드할 파일 이름이 올바르지 않습니다.", status=400)

        tmp_dir = get_handrive_upload_tmp_dir()
        session_dir = tmp_dir / upload_id
        session_dir.mkdir(parents=True, exist_ok=True)
        chunk_path = session_dir / f"{chunk_index:06d}.part"
        meta_path = session_dir / "meta.json"

        with chunk_path.open("wb") as destination_handle:
            for chunk in chunk_file.chunks():
                destination_handle.write(chunk)

        meta_path.write_text(
            json.dumps(
                {
                    "file_name": original_name,
                    "total_chunks": total_chunks,
                    "target_dir": target_dir_relative,
                    "uploaded_at": int(time.time()),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        is_final_chunk = chunk_index == total_chunks - 1
        if not is_final_chunk:
            return JsonResponse(
                {
                    "ok": True,
                    "uploading": True,
                    "upload_id": upload_id,
                    "chunk_index": chunk_index,
                    "total_chunks": total_chunks,
                }
            )

        missing_chunks = [
            index
            for index in range(total_chunks)
            if not (session_dir / f"{index:06d}.part").exists()
        ]
        if missing_chunks:
            return json_error("업로드 청크가 누락되었습니다.", status=400)

        try:
            upload_size = sum(
                (session_dir / f"{index:06d}.part").stat().st_size
                for index in range(total_chunks)
            )
            if git_virtual_target is None:
                destination_path = build_available_upload_path(target_dir_path, original_name)
                enforce_handrive_scoped_quota(
                    request,
                    quota_path=target_dir_relative,
                    extra_bytes=upload_size,
                    extra_entries=1,
                )
            else:
                if git_virtual_target["kind"] != "branch_dir":
                    return json_error("업로드 위치가 폴더가 아닙니다.", status=400)
                destination_name = _build_available_git_repo_filename(
                    git_virtual_target["repo"],
                    git_virtual_target["branch_name"],
                    git_virtual_target["repo_relative_path"],
                    original_name,
                )
        except ValueError as exc:
            return json_error(str(exc), status=400)

        content_bytes = bytearray()
        for index in range(total_chunks):
            part_path = session_dir / f"{index:06d}.part"
            content_bytes.extend(part_path.read_bytes())
        shutil.rmtree(session_dir, ignore_errors=True)
        if git_virtual_target is None:
            with destination_path.open("wb") as destination_handle:
                destination_handle.write(bytes(content_bytes))
            uploaded_entry = build_entry(destination_path)
        else:
            repo_relative_path = (
                f"{git_virtual_target['repo_relative_path']}/{destination_name}"
                if git_virtual_target["repo_relative_path"]
                else destination_name
            )
            _commit_git_branch_changes(
                git_virtual_target["repo"],
                git_virtual_target["branch_name"],
                commit_message,
                {repo_relative_path: bytes(content_bytes)},
                request.user,
            )
            uploaded_entry = {
                "name": destination_name,
                "path": f"{git_virtual_target['repo_root']}/{git_virtual_target['branch_segment']}/{repo_relative_path}",
                "type": "file",
                "slug_path": f"{git_virtual_target['repo_root']}/{git_virtual_target['branch_segment']}/{repo_relative_path}",
                "size_display": format_handrive_bytes_display(len(content_bytes)),
            }
        return JsonResponse(
            {
                "ok": True,
                "path": target_dir_relative,
                "entries": [uploaded_entry],
            }
        )

    uploaded_files = request.FILES.getlist("files")
    if not uploaded_files:
        return json_error("업로드할 파일이 없습니다.", status=400)

    uploaded_entries = []
    upload_total_size = 0
    upload_total_entries = 0
    for uploaded_file in uploaded_files:
        try:
            if git_virtual_target is None:
                build_available_upload_path(target_dir_path, uploaded_file.name)
            else:
                if git_virtual_target["kind"] != "branch_dir":
                    return json_error("업로드 위치가 폴더가 아닙니다.", status=400)
                _build_available_git_repo_filename(
                    git_virtual_target["repo"],
                    git_virtual_target["branch_name"],
                    git_virtual_target["repo_relative_path"],
                    uploaded_file.name,
                )
        except ValueError as exc:
            return json_error(str(exc), status=400)
        upload_total_size += uploaded_file.size or 0
        upload_total_entries += 1

    if git_virtual_target is None:
        try:
            enforce_handrive_scoped_quota(
                request,
                quota_path=target_dir_relative,
                extra_bytes=upload_total_size,
                extra_entries=upload_total_entries,
            )
        except ValueError as exc:
            return json_error(str(exc), status=400)

        for uploaded_file in uploaded_files:
            destination_path = build_available_upload_path(target_dir_path, uploaded_file.name)
            with destination_path.open("wb") as destination_handle:
                for chunk in uploaded_file.chunks():
                    destination_handle.write(chunk)

            uploaded_entries.append(build_entry(destination_path))
    else:
        file_updates = {}
        for uploaded_file in uploaded_files:
            destination_name = _build_available_git_repo_filename(
                git_virtual_target["repo"],
                git_virtual_target["branch_name"],
                git_virtual_target["repo_relative_path"],
                uploaded_file.name,
            )
            repo_relative_path = (
                f"{git_virtual_target['repo_relative_path']}/{destination_name}"
                if git_virtual_target["repo_relative_path"]
                else destination_name
            )
            file_updates[repo_relative_path] = uploaded_file.read()
            uploaded_entries.append(
                {
                    "name": destination_name,
                    "path": f"{git_virtual_target['repo_root']}/{git_virtual_target['branch_segment']}/{repo_relative_path}",
                    "type": "file",
                    "slug_path": f"{git_virtual_target['repo_root']}/{git_virtual_target['branch_segment']}/{repo_relative_path}",
                    "size_display": format_handrive_bytes_display(len(file_updates[repo_relative_path])),
                }
            )
        _commit_git_branch_changes(
            git_virtual_target["repo"],
            git_virtual_target["branch_name"],
            commit_message,
            file_updates,
            request.user,
        )

    return JsonResponse(
        {
            "ok": True,
            "path": target_dir_relative,
            "entries": uploaded_entries,
        }
    )


@require_http_methods(["POST"])
@csrf_protect
def handrive_api_upload_cancel(request):
    upload_id = str(request.POST.get("upload_id") or "").strip()
    if not upload_id:
        return json_error("취소할 업로드가 없습니다.", status=400)

    session_dir = get_handrive_upload_tmp_dir() / upload_id
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)

    return JsonResponse({"ok": True, "upload_id": upload_id, "cancelled": True})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_preview(request):
    """목록 우측 미리보기 패널에서 사용할 HTML 조각을 반환한다."""
    shared_context = get_handrive_shared_access_context(request)
    try:
        payload = parse_json_body(request)
        preview_relative_path = normalize_relative_path(payload.get("path"), allow_empty=True)
        preview_target_dir = normalize_relative_path(payload.get("target_dir"), allow_empty=True)
        if preview_relative_path:
            git_virtual = _get_git_virtual_context(request, preview_relative_path)
            if git_virtual is None:
                file_path, relative_file_path = normalize_handrive_relative_path(
                    preview_relative_path, must_exist=True
                )
            else:
                if git_virtual["kind"] != "branch_file":
                    return json_error("파일을 찾을 수 없습니다.", status=404)
                file_path = None
                relative_file_path = preview_relative_path
            if not has_handrive_read_access(request, relative_file_path):
                return json_error("파일을 볼 권한이 없습니다.", status=403)
            if git_virtual is None:
                file_extension = file_path.suffix.lower()
                render_mode = resolve_handrive_render_profile(file_extension).get("mode")
                if render_mode in (DOCS_RENDER_MODE_OFFICE, DOCS_RENDER_MODE_PDF):
                    content = ""
                    rendered_html, render_profile = render_handrive_content(
                        content,
                        file_extension,
                        source_path=file_path,
                        relative_path=relative_file_path,
                        request=request,
                        share_owner=shared_context["owner_username"] if shared_context else "",
                        share_slug=shared_context["share_slug"] if shared_context else "",
                    )
                else:
                    try:
                        content = load_handrive_source_content(file_path, request=request, relative_path=relative_file_path)
                        rendered_html, render_profile = render_handrive_content(
                            content,
                            file_extension,
                            source_path=file_path,
                            relative_path=relative_file_path,
                            request=request,
                            share_owner=shared_context["owner_username"] if shared_context else "",
                            share_slug=shared_context["share_slug"] if shared_context else "",
                        )
                    except Http404:
                        rendered_html = render_handrive_unsupported_safely(
                            file_path.name,
                            file_extension,
                            message=get_handrive_text(resolve_ui_lang(request)).get("list_preview_unsupported", "미리보기 미지원"),
                        )
                        render_profile = DOCS_UNSUPPORTED_RENDER_PROFILE
                title = file_path.name
            else:
                title = Path(git_virtual["repo_relative_path"]).name
                file_extension = Path(title).suffix.lower()
                if (
                    is_handrive_non_editable_media_extension(file_extension)
                    and resolve_handrive_render_profile(file_extension).get("mode") != DOCS_RENDER_MODE_OFFICE
                ):
                    content = ""
                    rendered_html, render_profile = render_handrive_content(
                        content,
                        file_extension,
                        source_path=Path(title),
                        relative_path=relative_file_path,
                        request=request,
                        share_owner=shared_context["owner_username"] if shared_context else "",
                        share_slug=shared_context["share_slug"] if shared_context else "",
                    )
                else:
                    repo_file_bytes = _git_repo_read_file_bytes(
                        git_virtual["repo"],
                        git_virtual["branch_name"],
                        git_virtual["repo_relative_path"],
                    )
                    try:
                        content = ""
                        if resolve_handrive_render_profile(file_extension).get("mode") != DOCS_RENDER_MODE_OFFICE:
                            content = decode_handrive_text_bytes(
                                repo_file_bytes,
                                request=request,
                                relative_path=relative_file_path,
                            )
                        companion_css, companion_js = load_git_repo_html_companion_assets(
                            request,
                            git_virtual["repo"],
                            git_virtual["branch_name"],
                            git_virtual["repo_relative_path"],
                        )
                        rendered_html, render_profile = render_handrive_content(
                            content,
                            file_extension,
                            source_bytes=repo_file_bytes,
                            companion_css=companion_css,
                            companion_js=companion_js,
                            relative_path=relative_file_path,
                            request=request,
                            share_owner=shared_context["owner_username"] if shared_context else "",
                            share_slug=shared_context["share_slug"] if shared_context else "",
                        )
                    except Http404:
                        rendered_html = render_handrive_unsupported_safely(
                            title,
                            file_extension,
                            message=get_handrive_text(resolve_ui_lang(request)).get("list_preview_unsupported", "미리보기 미지원"),
                        )
                        render_profile = DOCS_UNSUPPORTED_RENDER_PROFILE
            return JsonResponse(
                {
                    "ok": True,
                    "html": rendered_html,
                    "path": relative_file_path,
                    "slug_path": relative_file_path if git_virtual is not None else markdown_slug_from_relative(relative_file_path),
                    "title": title,
                    "render_mode": render_profile["mode"],
                    "render_class": render_profile["css_class"],
                }
            )

        original_relative_path = normalize_relative_path(payload.get("original_path"), allow_empty=True)
        preview_extension = normalize_file_extension(payload.get("extension"), allow_empty=True)
        content = payload.get("content", "")
        if not isinstance(content, str):
            raise ValueError("내용 형식이 올바르지 않습니다.")
    except ValueError as exc:
        return json_error(str(exc), status=400)

    source_extension = preview_extension or DOCS_FILE_EXTENSION
    source_path = None
    git_virtual = None
    if original_relative_path:
        git_virtual = _get_git_virtual_context(request, original_relative_path)
        if git_virtual is None:
            try:
                source_path, source_relative = normalize_handrive_relative_path(
                    original_relative_path, must_exist=True
                )
            except (ValueError, FileNotFoundError) as exc:
                return json_error(str(exc), status=400)
            source_extension = source_path.suffix.lower() if source_path.suffix else DOCS_FILE_EXTENSION
        else:
            source_relative = original_relative_path
            source_extension = Path(git_virtual["repo_relative_path"]).suffix.lower() or DOCS_FILE_EXTENSION
        if not has_handrive_write_access(request, source_relative):
            return json_error("파일을 수정할 권한이 없습니다.", status=403)
    else:
        if not has_handrive_directory_write_access(request, preview_target_dir):
            return json_error("파일을 수정할 권한이 없습니다.", status=403)

    companion_css = ""
    companion_js = ""
    source_bytes = None
    if original_relative_path and git_virtual is not None:
        companion_css, companion_js = load_git_repo_html_companion_assets(
            request,
            git_virtual["repo"],
            git_virtual["branch_name"],
            git_virtual["repo_relative_path"],
        )
        source_bytes = _git_repo_read_file_bytes(
            git_virtual["repo"],
            git_virtual["branch_name"],
            git_virtual["repo_relative_path"],
        )
    elif source_path is not None and resolve_handrive_render_profile(source_extension).get("mode") == DOCS_RENDER_MODE_OFFICE:
        try:
            source_bytes = source_path.read_bytes()
        except OSError:
            source_bytes = b""

    rendered_html, render_profile = render_handrive_content(
        content,
        source_extension,
        source_path=source_path,
        source_bytes=source_bytes,
        companion_css=companion_css,
        companion_js=companion_js,
        request=request,
    )
    return JsonResponse(
        {
            "ok": True,
            "html": rendered_html,
            "render_mode": render_profile["mode"],
            "render_class": render_profile["css_class"],
        }
    )


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_save(request):
    """에디터 저장 API.

    목록 인라인 에디터와 쓰기 페이지가 같은 저장 포맷을 사용한다.
    repo branch 파일은 commit message 검증이 함께 들어간다.
    """
    try:
        payload = parse_json_body(request)
        original_relative_path = normalize_relative_path(payload.get("original_path"), allow_empty=True)
        target_dir = normalize_relative_path(payload.get("target_dir"), allow_empty=True)
        requested_extension = normalize_file_extension(payload.get("extension"), allow_empty=True)
        content = payload.get("content", "")
        commit_message = str(payload.get("commit_message") or "").strip()
        if not isinstance(content, str):
            raise ValueError("내용 형식이 올바르지 않습니다.")

        git_virtual_target = _get_git_virtual_context(request, target_dir)
        if git_virtual_target is None:
            target_dir_path, target_dir_rel = resolve_path(target_dir, must_exist=True)
            if not target_dir_path.is_dir():
                raise ValueError("저장 위치가 폴더가 아닙니다.")
        else:
            if git_virtual_target["kind"] != "branch_dir":
                raise ValueError("저장 위치가 폴더가 아닙니다.")
            target_dir_path = None
            target_dir_rel = target_dir
        source_path = None
        source_relative = ""
        source_is_public_write = False
        source_extension = DOCS_FILE_EXTENSION
        git_virtual_source = None
        if original_relative_path:
            git_virtual_source = _get_git_virtual_context(request, original_relative_path)
            if git_virtual_source is None:
                source_path, source_relative = normalize_markdown_relative_path(
                    original_relative_path, must_exist=True
                )
                source_extension = source_path.suffix.lower() if source_path.suffix else DOCS_FILE_EXTENSION
            else:
                source_relative = original_relative_path
                source_extension = Path(git_virtual_source["repo_relative_path"]).suffix.lower() or DOCS_FILE_EXTENSION
            if not has_handrive_write_access(request, source_relative):
                return json_error("파일을 수정할 권한이 없습니다.", status=403)
            source_is_public_write = is_handrive_public_write_enabled(request, source_relative)

        target_extension = requested_extension or source_extension or DOCS_FILE_EXTENSION
        if source_is_public_write:
            target_extension = source_extension

        filename, resolved_extension = resolve_file_name_and_extension(
            payload.get("filename"),
            fallback_extension=target_extension,
        )
        target_extension = resolved_extension
        if git_virtual_target is not None:
            destination_repo_relative = (
                f"{git_virtual_target['repo_relative_path']}/{filename}{target_extension}"
                if git_virtual_target["repo_relative_path"]
                else f"{filename}{target_extension}"
            )
            if git_virtual_source is not None:
                if git_virtual_source["kind"] != "branch_file":
                    return json_error("Repo 브랜치 파일만 저장할 수 있습니다.", status=400)
                if git_virtual_source["repo"].id != git_virtual_target["repo"].id or git_virtual_source["branch_name"] != git_virtual_target["branch_name"]:
                    return json_error("Repo 브랜치 파일은 같은 브랜치 안에서만 저장할 수 있습니다.", status=400)
                expected_relative = f"{git_virtual_target['repo_root']}/{git_virtual_target['branch_segment']}/{destination_repo_relative}"
                if normalize_relative_path(expected_relative, allow_empty=False) != original_relative_path:
                    return json_error("Repo 브랜치 파일은 이름이나 위치를 바꿀 수 없습니다.", status=400)
                commit_updates = {git_virtual_source["repo_relative_path"]: content.encode("utf-8")}
            else:
                if _git_repo_path_exists(git_virtual_target["repo"], git_virtual_target["branch_name"], destination_repo_relative):
                    return json_error("같은 이름의 파일이 이미 존재합니다.", status=409)
                commit_updates = {destination_repo_relative: content.encode("utf-8")}
                original_relative_path = f"{git_virtual_target['repo_root']}/{git_virtual_target['branch_segment']}/{destination_repo_relative}"
            _commit_git_branch_changes(
                git_virtual_target["repo"],
                git_virtual_target["branch_name"],
                commit_message,
                commit_updates,
                request.user,
            )
            return JsonResponse(
                {
                    "ok": True,
                    "path": original_relative_path,
                    "slug_path": original_relative_path,
                }
            )
        destination = target_dir_path / f"{filename}{target_extension}"
        destination_exists = destination.exists()
        is_same_as_source = bool(
            source_path is not None and destination_exists and destination.resolve() == source_path.resolve()
        )

        if source_is_public_write and not is_same_as_source:
            return json_error("전체 허용 파일은 위치나 이름을 바꿀 수 없습니다.", status=403)

        if source_path is None or not is_same_as_source:
            if not has_handrive_directory_write_access(request, target_dir_rel):
                return json_error("파일을 수정할 권한이 없습니다.", status=403)

        if destination.exists():
            if source_path is None or destination.resolve() != source_path.resolve():
                return json_error("같은 이름의 파일이 이미 존재합니다.", status=409)

        destination_relative = relative_from_root(destination)
        destination_in_scope = get_handrive_scoped_quota_root(request, destination_relative) is not None
        source_in_scope = bool(source_relative) and get_handrive_scoped_quota_root(request, source_relative) is not None
        source_size = source_path.stat().st_size if source_path is not None and source_path.exists() else 0
        destination_size = destination.stat().st_size if destination_exists else 0
        new_size = len(content.encode("utf-8"))
        quota_extra_bytes = 0
        quota_extra_entries = 0

        if destination_in_scope:
            if source_path is None:
                quota_extra_bytes = new_size
                quota_extra_entries = 1
            elif is_same_as_source:
                quota_extra_bytes = new_size - source_size
            elif source_in_scope:
                quota_extra_bytes = new_size - source_size
            else:
                quota_extra_bytes = new_size - destination_size
                quota_extra_entries = 0 if destination_exists else 1

        enforce_handrive_scoped_quota(
            request,
            quota_path=destination_relative,
            extra_bytes=quota_extra_bytes,
            extra_entries=quota_extra_entries,
        )

    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    destination.write_text(content, encoding="utf-8")

    if source_path is not None and destination.resolve() != source_path.resolve():
        move_handrive_acl_rules(source_relative, relative_from_root(destination))
        move_handrive_shared_links(source_relative, relative_from_root(destination))
        source_path.unlink(missing_ok=True)

    destination_relative = relative_from_root(destination)
    destination_slug = markdown_slug_from_relative(destination_relative)
    parent_dir = str(Path(destination_relative).parent).replace("\\", "/")
    if parent_dir == ".":
        parent_dir = ""

    if parent_dir:
        list_url = reverse("main:handrive_list", kwargs={"folder_path": parent_dir})
    else:
        list_url = reverse("main:handrive_root")

    view_url = reverse("main:handrive_view", kwargs={"doc_path": destination_slug})

    return JsonResponse(
        {
            "ok": True,
            "path": destination_relative,
            "slug_path": destination_slug,
            "view_url": view_url,
            "list_url": list_url,
        }
    )


@require_http_methods(["GET"])
@with_request_handrive_root
def handrive_api_download(request):
    """일반 파일과 repo virtual file을 공통 다운로드 엔드포인트로 제공한다."""
    try:
        rel_path = normalize_relative_path(request.GET.get("path"), allow_empty=False)
    except ValueError:
        raise Http404("다운로드할 파일을 찾을 수 없습니다.")
    git_virtual = _get_git_virtual_context(request, rel_path)
    if git_virtual is None:
        try:
            file_path, rel_path = normalize_handrive_relative_path(request.GET.get("path"), must_exist=True)
        except (ValueError, FileNotFoundError):
            raise Http404("다운로드할 파일을 찾을 수 없습니다.")
        filename = file_path.name
        file_handle = file_path.open("rb")
    else:
        if git_virtual["kind"] != "branch_file":
            raise Http404("다운로드할 파일을 찾을 수 없습니다.")
        filename = Path(git_virtual["repo_relative_path"]).name
        file_handle = io.BytesIO(
            _git_repo_read_file_bytes(
                git_virtual["repo"],
                git_virtual["branch_name"],
                git_virtual["repo_relative_path"],
            )
        )

    if not has_handrive_read_access(request, rel_path):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")

    return FileResponse(file_handle, as_attachment=True, filename=filename)


@require_http_methods(["GET"])
@xframe_options_sameorigin
@with_request_handrive_root
def handrive_api_pdf_preview(request):
    """PDF 파일을 inline으로 제공해 브라우저에서 바로 표시할 수 있게 한다."""
    try:
        rel_path = normalize_relative_path(request.GET.get("path"), allow_empty=False)
    except ValueError:
        raise Http404("파일을 찾을 수 없습니다.")
    try:
        file_path, rel_path = normalize_handrive_relative_path(request.GET.get("path"), must_exist=True)
    except (ValueError, FileNotFoundError):
        raise Http404("파일을 찾을 수 없습니다.")
    if file_path.suffix.lower() != ".pdf":
        raise Http404("PDF 파일이 아닙니다.")
    if not has_handrive_read_access(request, rel_path):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")
    response = FileResponse(file_path.open("rb"), content_type="application/pdf")
    response["Content-Disposition"] = f"inline; filename*=UTF-8''{quote(file_path.name)}"
    return response


# ---------------------------------------------------------------------------
# 지도 (Map) API
# ---------------------------------------------------------------------------

@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_map_create(request):
    """이미지 파일을 지도 폴더로 변환한다.

    요청: {"image_path": "경로/이미지.png", "map_name": "지도명"}
    - 같은 경로에 map_name 폴더를 생성한다.
    - _map_meta.json 을 폴더 안에 기록한다.
    - 이미지 파일을 폴더 안으로 이동한다.
    응답: {"ok": true, "map_path": "경로/지도명", "base_image": "이미지.png"}
    """
    try:
        payload = parse_json_body(request)
        image_path_value = normalize_relative_path(payload.get("image_path"), allow_empty=False)
        map_name = validate_name(payload.get("map_name"), for_file=False)
    except ValueError as exc:
        return json_error(str(exc), status=400)

    try:
        image_path, image_relative = resolve_path(image_path_value, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=404)

    if not image_path.is_file():
        return json_error("이미지 파일이 아닙니다.", status=400)
    if image_path.suffix.lower() not in MAP_IMAGE_EXTENSIONS:
        return json_error("지원하지 않는 이미지 형식입니다.", status=400)
    if not has_handrive_write_access(request, image_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)

    parent_dir = image_path.parent
    parent_relative = relative_from_root(parent_dir)
    if not has_handrive_directory_write_access(request, parent_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)

    map_folder = parent_dir / map_name
    if map_folder.exists():
        return json_error("같은 이름의 폴더가 이미 존재합니다.", status=409)

    map_folder.mkdir(parents=False, exist_ok=False)
    meta = {
        "type": "map",
        "base_image": image_path.name,
        "created_at": timezone.now().isoformat(),
    }
    (map_folder / MAP_META_FILENAME).write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    new_image_path = map_folder / image_path.name
    image_path.rename(new_image_path)

    map_folder_relative = relative_from_root(map_folder)
    return JsonResponse({"ok": True, "map_path": map_folder_relative, "base_image": image_path.name})


@require_http_methods(["GET"])
@with_request_handrive_root
def handrive_api_map_data(request):
    """지도 GeoJSON 데이터를 반환한다. GET: 읽기."""
    try:
        map_path_value = normalize_relative_path(request.GET.get("path"), allow_empty=False)
    except ValueError as exc:
        return json_error(str(exc), status=400)

    try:
        map_folder, map_relative = resolve_path(map_path_value, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=404)

    if not (map_folder / MAP_META_FILENAME).is_file():
        return json_error("지도 폴더를 찾을 수 없습니다.", status=404)
    if not has_handrive_read_access(request, map_relative):
        return json_error("파일을 볼 권한이 없습니다.", status=403)

    geojson_file = map_folder / MAP_DATA_FILENAME
    if geojson_file.is_file():
        try:
            geojson_data = json.loads(geojson_file.read_text(encoding="utf-8"))
        except Exception:
            geojson_data = {"type": "FeatureCollection", "features": []}
    else:
        geojson_data = {"type": "FeatureCollection", "features": []}

    return JsonResponse({"ok": True, "geojson": geojson_data})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_map_data_save(request):
    """지도 GeoJSON 데이터를 저장한다. POST: 쓰기."""
    try:
        payload = parse_json_body(request)
        map_path_value = normalize_relative_path(payload.get("path"), allow_empty=False)
        geojson_data = payload.get("geojson")
        if not isinstance(geojson_data, dict):
            raise ValueError("GeoJSON 형식이 올바르지 않습니다.")
    except ValueError as exc:
        return json_error(str(exc), status=400)

    try:
        map_folder, map_relative = resolve_path(map_path_value, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=404)

    if not (map_folder / MAP_META_FILENAME).is_file():
        return json_error("지도 폴더를 찾을 수 없습니다.", status=404)
    if not has_handrive_write_access(request, map_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)

    geojson_file = map_folder / MAP_DATA_FILENAME
    previous_geojson: dict = {}
    if geojson_file.is_file():
        try:
            previous_geojson = json.loads(geojson_file.read_text(encoding="utf-8"))
        except Exception:
            previous_geojson = {}

    previous_media_paths = _collect_map_image_relative_paths(previous_geojson)
    next_media_paths = _collect_map_image_relative_paths(geojson_data)
    removable_media_paths = {
        path for path in previous_media_paths - next_media_paths
        if path.startswith(f"{map_relative}/") and f"/{MAP_IMAGE_ATTACHMENTS_DIR}/" in f"/{path}/"
    }

    try:
        geojson_file.write_text(json.dumps(geojson_data, ensure_ascii=False, indent=2), encoding="utf-8")
    except (OSError, PermissionError) as exc:
        return _storage_unavailable_response(request, exc)

    deleted_paths = []
    for relative_path in sorted(removable_media_paths):
        try:
            image_path, _ = resolve_path(relative_path, must_exist=True)
        except (ValueError, FileNotFoundError):
            continue
        if not image_path.is_file():
            continue
        try:
            image_path.unlink()
            deleted_paths.append(relative_path)
            _prune_empty_parent_dirs(image_path, map_folder)
        except (OSError, PermissionError) as exc:
            logger.warning("HanDrive map media cleanup failed path=%s error=%s", relative_path, exc)

    return JsonResponse({"ok": True, "deleted_images": deleted_paths})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_map_icon_upload(request):
    """지도 폴더에 커스텀 아이콘 이미지를 업로드한다."""
    map_path_value = request.POST.get("path", "").strip()
    icon_file = request.FILES.get("icon")
    if not icon_file:
        return json_error("파일이 없습니다.", status=400)

    try:
        map_path_normalized = normalize_relative_path(map_path_value, allow_empty=False)
        map_folder, map_relative = resolve_path(map_path_normalized, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if not (map_folder / MAP_META_FILENAME).is_file():
        return json_error("지도 폴더를 찾을 수 없습니다.", status=404)
    if not has_handrive_write_access(request, map_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)

    suffix = Path(icon_file.name).suffix.lower()
    if suffix not in MAP_IMAGE_EXTENSIONS:
        return json_error("지원하지 않는 이미지 형식입니다.", status=400)

    icons_dir = map_folder / MAP_ICONS_DIR
    icons_dir.mkdir(exist_ok=True)

    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", Path(icon_file.name).stem)
    target = icons_dir / f"{safe_name}{suffix}"
    # 중복 방지
    counter = 1
    while target.exists():
        target = icons_dir / f"{safe_name}_{counter}{suffix}"
        counter += 1

    try:
        with target.open("wb") as f:
            for chunk in icon_file.chunks():
                f.write(chunk)
    except (OSError, PermissionError) as exc:
        return _storage_unavailable_response(request, exc)

    icon_path_relative = relative_from_root(target)
    icon_api_url = f"/handrive/api/map-image/?path={quote(icon_path_relative)}"
    return JsonResponse({"ok": True, "icon_path": icon_path_relative, "icon_url": icon_api_url})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_map_attachment_upload(request):
    """지도 폴더의 구역/아이콘 첨부 미디어를 이름 폴더에 업로드한다."""
    map_path_value = request.POST.get("path", "").strip()
    folder_name_value = request.POST.get("folder_name", "").strip()
    image_file = request.FILES.get("image")
    if not image_file:
        return json_error("파일이 없습니다.", status=400)

    try:
        map_path_normalized = normalize_relative_path(map_path_value, allow_empty=False)
        map_folder, map_relative = resolve_path(map_path_normalized, must_exist=True)
        folder_name = _map_attachment_folder_name(folder_name_value)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)

    if not (map_folder / MAP_META_FILENAME).is_file():
        return json_error("지도 폴더를 찾을 수 없습니다.", status=404)
    if not has_handrive_write_access(request, map_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)

    attachment_dir = map_folder / MAP_IMAGE_ATTACHMENTS_DIR / folder_name
    attachment_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(image_file.name).suffix.lower()
    if suffix not in MAP_MEDIA_EXTENSIONS:
        return json_error("지원하지 않는 이미지/영상 형식입니다.", status=400)

    target = build_available_upload_path(attachment_dir, image_file.name)
    try:
        with target.open("wb") as f:
            for chunk in image_file.chunks():
                f.write(chunk)
    except (OSError, PermissionError) as exc:
        return _storage_unavailable_response(request, exc)

    media_path_relative = relative_from_root(target)
    media_api_url = f"/handrive/api/map-image/?path={quote(media_path_relative)}"
    media_kind = "video" if suffix in MAP_VIDEO_EXTENSIONS else "image"
    payload = {
        "ok": True,
        "media_path": media_path_relative,
        "media_url": media_api_url,
        "media_kind": media_kind,
    }
    if media_kind == "image":
        payload["image_path"] = media_path_relative
        payload["image_url"] = media_api_url
    else:
        payload["video_path"] = media_path_relative
        payload["video_url"] = media_api_url
    return JsonResponse(payload)


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_map_icon_delete(request):
    """지도 폴더의 커스텀 아이콘 파일을 삭제한다."""
    icon_path_value = request.POST.get("icon_path", "").strip()
    if not icon_path_value:
        return json_error("icon_path가 필요합니다.", status=400)

    try:
        icon_file, icon_relative = resolve_path(icon_path_value, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=404)

    if not icon_file.is_file():
        return json_error("파일이 아닙니다.", status=400)

    # 반드시 MAP_ICONS_DIR 내 파일이어야 함
    if icon_file.parent.name != MAP_ICONS_DIR:
        return json_error("아이콘 파일이 아닙니다.", status=400)

    if icon_file.suffix.lower() not in MAP_IMAGE_EXTENSIONS:
        return json_error("아이콘 파일이 아닙니다.", status=400)

    if not has_handrive_write_access(request, icon_relative):
        return json_error("파일을 삭제할 권한이 없습니다.", status=403)

    try:
        icon_file.unlink()
    except (OSError, PermissionError) as exc:
        return _storage_unavailable_response(request, exc)
    return JsonResponse({"ok": True})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_folder_icon_upload(request):
    """폴더 커스텀 아이콘을 업로드한다."""
    folder_path_value = request.POST.get("path", "").strip()
    icon_file = request.FILES.get("icon")
    if not icon_file:
        return json_error("파일이 없습니다.", status=400)
    try:
        folder_path_normalized = normalize_relative_path(folder_path_value, allow_empty=False)
        folder, folder_relative = resolve_path(folder_path_normalized, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)
    if not folder.is_dir():
        return json_error("폴더를 찾을 수 없습니다.", status=404)
    if not has_handrive_write_access(request, folder_relative):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)
    suffix = Path(icon_file.name).suffix.lower()
    if suffix not in FOLDER_ICON_EXTENSIONS:
        return json_error("지원하지 않는 이미지 형식입니다.", status=400)
    owner_key = get_folder_icon_owner_key_for_user(request.user)
    icons_dir = Path(settings.MEDIA_ROOT) / build_user_folder_icon_dir(owner_key)
    icons_dir.mkdir(parents=True, exist_ok=True)
    folder_stem = sanitize_upload_segment(folder.name) or "folder"
    # 기존 아이콘 삭제
    for old in icons_dir.glob(f"{folder_stem}.*"):
        if old.suffix.lower() in FOLDER_ICON_EXTENSIONS:
            try:
                old.unlink()
            except OSError:
                pass
    target = icons_dir / f"{folder_stem}{suffix}"
    try:
        with target.open("wb") as f:
            for chunk in icon_file.chunks():
                f.write(chunk)
    except (OSError, PermissionError) as exc:
        return _storage_unavailable_response(request, exc)
    icon_url = f"/handrive/api/folder-icon?owner_key={quote(owner_key)}&folder_stem={quote(folder_stem)}"
    return JsonResponse({"ok": True, "icon_url": icon_url})


@require_http_methods(["POST"])
@csrf_protect
@with_request_handrive_root
def handrive_api_folder_icon_delete(request):
    """폴더 커스텀 아이콘을 삭제한다."""
    folder_path_value = extract_folder_icon_path_value(request)
    if not folder_path_value:
        return json_error("path가 필요합니다.", status=400)
    try:
        folder_path_normalized = normalize_relative_path(folder_path_value, allow_empty=False)
        folder, folder_relative = resolve_path(folder_path_normalized, must_exist=True)
    except (ValueError, FileNotFoundError) as exc:
        return json_error(str(exc), status=400)
    if not folder.is_dir():
        return json_error("폴더를 찾을 수 없습니다.", status=404)
    if not has_handrive_write_access(request, folder_relative):
        return json_error("파일을 삭제할 권한이 없습니다.", status=403)
    owner_key = get_folder_icon_owner_key_for_user(request.user)
    icons_dir = Path(settings.MEDIA_ROOT) / build_user_folder_icon_dir(owner_key)
    folder_stem = sanitize_upload_segment(folder.name) or "folder"
    deleted = False
    for old_icon in icons_dir.glob(f"{folder_stem}.*"):
        if old_icon.suffix.lower() in FOLDER_ICON_EXTENSIONS:
            try:
                old_icon.unlink()
                deleted = True
            except (OSError, PermissionError) as exc:
                return _storage_unavailable_response(request, exc)
    if not deleted:
        return json_error("아이콘 파일을 찾을 수 없습니다.", status=404)
    return JsonResponse({"ok": True})


@require_http_methods(["GET"])
def handrive_api_folder_icon_serve(request):
    """폴더 커스텀 아이콘을 인라인으로 서빙한다."""
    owner_key = request.GET.get("owner_key", "").strip()
    folder_stem = request.GET.get("folder_stem", "").strip()
    if not owner_key or not folder_stem:
        raise Http404
    # Path traversal 방지
    if not re.fullmatch(r"[a-zA-Z0-9._-]+", owner_key):
        raise Http404
    if not re.fullmatch(r"[a-zA-Z0-9._-]+", folder_stem):
        raise Http404
    # IDOR 방어: 요청자 본인의 owner_key 만 허용
    expected_owner_key = get_folder_icon_owner_key_for_user(getattr(request, "user", None))
    if owner_key != expected_owner_key:
        raise Http404
    icons_dir = Path(settings.MEDIA_ROOT) / build_user_folder_icon_dir(owner_key)
    icon_path = None
    for candidate in icons_dir.glob(f"{folder_stem}.*"):
        if candidate.suffix.lower() in FOLDER_ICON_EXTENSIONS and candidate.is_file():
            icon_path = candidate
            break
    if icon_path is None:
        raise Http404
    suffix = icon_path.suffix.lower()
    content_type = MAP_IMAGE_MIME_TYPES.get(suffix, "application/octet-stream")
    try:
        response = FileResponse(icon_path.open("rb"), content_type=content_type)
    except (OSError, PermissionError):
        raise Http404
    response["Cache-Control"] = "private, max-age=300"
    return response


@require_http_methods(["GET"])
@with_request_handrive_root
def handrive_api_map_image(request):
    """지도 이미지를 인라인으로 서빙한다 (배경 이미지 및 아이콘용)."""
    try:
        normalized = normalize_relative_path(request.GET.get("path"), allow_empty=False)
    except ValueError:
        raise Http404

    if not has_handrive_read_access(request, normalized):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")

    try:
        file_path, _ = resolve_path(normalized, must_exist=True)
    except (ValueError, FileNotFoundError):
        raise Http404

    if not file_path.is_file():
        raise Http404

    suffix = file_path.suffix.lower()
    if suffix not in MAP_MEDIA_EXTENSIONS:
        raise Http404

    content_type = MAP_IMAGE_MIME_TYPES.get(suffix) or MAP_VIDEO_MIME_TYPES.get(suffix, "application/octet-stream")
    try:
        response = FileResponse(file_path.open("rb"), content_type=content_type)
    except (OSError, PermissionError) as exc:
        return _storage_unavailable_response(request, exc)
    response["Cache-Control"] = "private, max-age=3600"
    return response


@with_request_handrive_root
def handrive_map_editor(request, map_path, ui_lang=None):
    """맵 에디터 페이지를 렌더한다."""
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)

    try:
        normalized = normalize_relative_path(map_path, allow_empty=False)
        folder_path, _ = resolve_path(normalized, must_exist=True)
    except (ValueError, FileNotFoundError):
        raise Http404("지도 폴더를 찾을 수 없습니다.")

    if not folder_path.is_dir():
        raise Http404("지도 폴더를 찾을 수 없습니다.")

    meta_file = folder_path / MAP_META_FILENAME
    if not meta_file.is_file():
        raise Http404("지도 폴더를 찾을 수 없습니다.")

    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except Exception:
        raise Http404("지도 메타 데이터를 읽을 수 없습니다.")

    if not has_handrive_read_access(request, normalized):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")

    base_image_name = meta.get("base_image", "")
    image_rel_path = f"{normalized}/{base_image_name}" if base_image_name else ""
    image_url = f"/handrive/api/map-image/?path={quote(image_rel_path)}" if image_rel_path else ""

    icons_rel = []
    icons_dir = folder_path / MAP_ICONS_DIR
    if icons_dir.is_dir():
        for icon_file in sorted(icons_dir.iterdir()):
            if icon_file.is_file() and icon_file.suffix.lower() in MAP_IMAGE_EXTENSIONS:
                icon_path_rel = relative_from_root(icon_file)
                icons_rel.append({
                    "name": icon_file.name,
                    "url": f"/handrive/api/map-image/?path={quote(icon_path_rel)}",
                    "path": icon_path_rel,
                })

    parent_path = str(Path(normalized).parent)
    if parent_path in (".", ""):
        parent_list_url = context["handrive_base_url"]
    else:
        parent_list_url = f"{context['handrive_base_url']}/{parent_path}/list"

    context.update({
        "map_path": normalized,
        "map_name": Path(normalized).name,
        "base_image_name": base_image_name,
        "image_url": image_url,
        "custom_icons": icons_rel,
        "can_edit": has_handrive_write_access(request, normalized),
        "handrive_api_map_image_upload_url": "/handrive/api/map/image-upload",
        "map_viewer_url": f"/handrive/map-viewer/{normalized}",
        "handrive_list_url": parent_list_url,
        "hide_global_nav": True,
    })
    return render(request, "handrive/map_editor.html", context)


@with_request_handrive_root
def handrive_api_image_editor_save(request):
    """이미지 에디터 저장 API.

    multipart/form-data 로 image_blob(file) + path(str) 을 받아 원본 파일을 덮어쓴다.
    """
    if request.method != "POST":
        return json_error("POST 요청만 허용됩니다.", status=405)

    raw_path = str(request.POST.get("path") or "").strip()
    try:
        normalized = normalize_relative_path(unquote(raw_path), allow_empty=False)
        file_path, normalized = resolve_path(normalized, must_exist=True)
    except FileNotFoundError:
        return json_error("파일을 찾을 수 없습니다.", status=404)
    except ValueError as exc:
        return json_error(str(exc), status=400)

    if not file_path.is_file():
        return json_error("파일을 찾을 수 없습니다.", status=404)

    if file_path.suffix.lower() not in IMAGE_EDITOR_EXTENSIONS:
        return json_error("이미지 편집기가 지원하지 않는 파일 형식입니다.", status=400)

    if not has_handrive_write_access(request, normalized):
        return json_error("파일을 수정할 권한이 없습니다.", status=403)

    image_blob = request.FILES.get("image_blob")
    if not image_blob:
        return json_error("이미지 데이터가 없습니다.", status=400)

    old_size = file_path.stat().st_size
    new_size = image_blob.size
    try:
        enforce_handrive_scoped_quota(
            request,
            quota_path=normalized,
            extra_bytes=max(0, new_size - old_size),
        )
    except ValueError as exc:
        return json_error(str(exc), status=400)

    try:
        with file_path.open("wb") as dst:
            for chunk in image_blob.chunks():
                dst.write(chunk)
    except (OSError, PermissionError) as exc:
        return _storage_unavailable_response(request, exc)

    return JsonResponse({"ok": True, "path": normalized})


@with_request_handrive_root
def handrive_map_viewer(request, map_path, ui_lang=None):
    """맵 뷰어 페이지를 렌더한다."""
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)

    try:
        normalized = normalize_relative_path(map_path, allow_empty=False)
        folder_path, _ = resolve_path(normalized, must_exist=True)
    except (ValueError, FileNotFoundError):
        raise Http404("지도 폴더를 찾을 수 없습니다.")

    if not folder_path.is_dir():
        raise Http404("지도 폴더를 찾을 수 없습니다.")

    meta_file = folder_path / MAP_META_FILENAME
    if not meta_file.is_file():
        raise Http404("지도 폴더를 찾을 수 없습니다.")

    try:
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    except Exception:
        raise Http404("지도 메타 데이터를 읽을 수 없습니다.")

    if not has_handrive_read_access(request, normalized):
        raise PermissionDenied("파일을 볼 권한이 없습니다.")

    base_image_name = meta.get("base_image", "")
    image_rel_path = f"{normalized}/{base_image_name}" if base_image_name else ""
    image_url = f"/handrive/api/map-image/?path={quote(image_rel_path)}" if image_rel_path else ""

    parent_path = str(Path(normalized).parent)
    if parent_path in (".", ""):
        parent_list_url = context["handrive_base_url"]
    else:
        parent_list_url = f"{context['handrive_base_url']}/{parent_path}/list"

    can_edit = has_handrive_write_access(request, normalized)
    map_is_url_only = is_handrive_url_only_enabled(request, normalized)
    map_share_url = build_handrive_existing_share_url(request, normalized)

    shared_context = get_handrive_shared_access_context(request)
    shared_owner = str(
        getattr(request, "_handrive_shared_owner_username", "")
        or (shared_context or {}).get("owner_username", "")
        or ""
    )
    shared_slug = str(
        getattr(request, "_handrive_shared_slug", "")
        or (shared_context or {}).get("share_slug", "")
        or ""
    )
    show_map_list_button = not bool(shared_owner)
    if shared_context and parent_path not in (".", ""):
        parent_share_info = build_handrive_existing_share_info(request, parent_path)
        parent_share_url = parent_share_info.get("share_url", "")
        if parent_share_url:
            parent_list_url = parent_share_url
            show_map_list_button = True

    context.update({
        "map_path": normalized,
        "map_name": Path(normalized).name,
        "base_image_name": base_image_name,
        "image_url": image_url,
        "can_edit": can_edit,
        "map_editor_url": f"/handrive/map-editor/{normalized}",
        "handrive_list_url": parent_list_url,
        "show_map_list_button": show_map_list_button,
        "map_data_api_url": reverse("main:handrive_api_map_data"),
        "map_icon_api_url": "/handrive/api/map-image/",
        "url_share_api_url": reverse("main:handrive_api_url_share") if can_edit else "",
        "map_is_url_only": map_is_url_only,
        "map_share_url": map_share_url,
        "shared_owner": shared_owner,
        "shared_slug": shared_slug,
        "hide_global_nav": True,
        "meta_title": "Hanplanet | Map Viewer" if resolved_lang == "en" else "Hanplanet | 맵 뷰어",
        "map_collab_auth_url": "/api/map-collab-auth-token/",
        "map_collab_enabled": request.user.is_authenticated or has_handrive_shared_read_access(request, normalized),
    })
    return render(request, "handrive/map_viewer.html", context)


# ── HanDrive 데스크톱 클라이언트 OAuth 브리지 ────────────────────────────────────

@require_http_methods(["GET", "POST"])
def handrive_login_bridge(request):
    """HanDrive 데스크톱 클라이언트 브라우저 OAuth 브리지.

    클라이언트가 브라우저를 통해 JWT 토큰을 받아가는 흐름:
      1. 클라이언트 → 브라우저로 이 URL 오픈
         /login/handrive?state=RANDOM[&client_name=앱이름]
      2. 미로그인 상태 → /login?next=현재경로 로 리다이렉트
      3. 로그인 완료 → 이 뷰 재진입 → 확인 페이지 표시
      4. 사용자가 "연결" 클릭(POST) → JWT 토큰 발급, 파일 캐시에 저장
      5. 클라이언트가 /api/sync/auth/handrive-callback?state=... 폴링으로 토큰 수령
    """
    from urllib.parse import urlencode

    ui_lang = resolve_ui_lang(request)
    is_english = (ui_lang == "en")
    state = request.GET.get("state", "").strip()
    client_name = request.GET.get("client_name", "Desktop App" if is_english else "데스크톱 앱").strip()

    # force_relogin=1: 현재 세션 로그아웃 후 로그인 페이지로
    if request.GET.get("force_relogin") == "1":
        if request.user.is_authenticated:
            from django.contrib.auth import logout as _logout
            _logout(request)
        params = {k: v for k, v in request.GET.items() if k != "force_relogin"}
        target = request.path + ("?" + urlencode(params) if params else "")
        return redirect("/login?" + urlencode({"next": target}))

    if not request.user.is_authenticated:
        return redirect("/login?" + urlencode({"next": request.get_full_path()}))

    if request.method == "POST":
        action = request.POST.get("action", "")
        st = request.POST.get("state", "").strip()
        if st and len(st) <= 128:
            from django.core.cache import caches
            if action == "allow":
                from .sync_auth import issue_token_pair
                tokens = issue_token_pair(request.user)
                caches["rate_limit"].set(f"handrive_oauth_{st}", tokens, timeout=300)
            else:
                caches["rate_limit"].set(f"handrive_oauth_{st}", {"cancelled": True}, timeout=300)
        return render(request, "handrive/login_bridge.html", {
            "user": request.user,
            "connected": True,
            "cancelled": action != "allow",
            "ui_lang": ui_lang,
        })

    if state:
        # GET → 연결 확인 페이지
        return render(request, "handrive/login_bridge.html", {
            "user": request.user,
            "client_name": client_name,
            "state": state,
            "ui_lang": ui_lang,
        })

    # state 없이 직접 접근: 안내 페이지
    return render(request, "handrive/login_bridge.html", {"user": request.user, "ui_lang": ui_lang})


def handrive_callback_poll(request):
    """HanDrive OAuth 토큰 폴링 엔드포인트.

    클라이언트가 /login/handrive?state=STATE 로 브라우저를 열고,
    사용자가 연결 버튼을 클릭한 뒤 발급된 JWT 토큰을 여기서 가져간다.
    토큰은 1회 수령 즉시 캐시에서 삭제된다.
    """
    state = request.GET.get("state", "").strip()
    if not state or len(state) > 128:
        from django.http import HttpResponseBadRequest
        return HttpResponseBadRequest("missing state")

    from django.core.cache import caches
    from django.http import JsonResponse
    tokens = caches["rate_limit"].get(f"handrive_oauth_{state}")
    if tokens is None:
        return JsonResponse({"status": "pending"}, status=202)

    caches["rate_limit"].delete(f"handrive_oauth_{state}")
    if tokens.get("cancelled"):
        return JsonResponse({"status": "cancelled"})
    return JsonResponse(tokens)
