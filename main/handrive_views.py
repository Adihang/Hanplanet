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
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.utils import timezone
from django.utils.html import escape
from django.utils.http import url_has_allowed_host_and_scheme
from django.utils.safestring import mark_safe
from django.views.csrf import csrf_failure as default_csrf_failure
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from .views import (
    SUPPORTED_UI_LANGS,
    apply_ui_context,
    get_account_display_name,
    redirect_to_localized_route,
    render_markdown_safely,
    resolve_ui_lang,
)
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


def get_user_handrive_quota_bytes(user) -> int:
    """사용자별 저장 용량을 반환한다. 어드민에서 매핑이 없으면 기본값(1GB)."""
    try:
        return user.handrive_quota.quota_bytes
    except Exception:
        return DOCS_USER_SCOPED_QUOTA_BYTES
MAP_META_FILENAME = "_map_meta.json"
MAP_DATA_FILENAME = "map.geojson"
MAP_ICONS_DIR = "_icons"
MAP_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tiff", ".tif", ".avif"})
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
HANDRIVE_LOGIN_CAPTCHA_QUESTION_SESSION_KEY = "handrive_login_captcha_question"
HANDRIVE_LOGIN_CAPTCHA_ANSWER_SESSION_KEY = "handrive_login_captcha_answer"
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
DOCS_RENDER_MODE_UNSUPPORTED = "unsupported"
HANDRIVE_ACTIVE_ROOT_DIR: ContextVar[Path | None] = ContextVar("handrive_active_root_dir", default=None)
HANDRIVE_ACTIVE_REQUEST: ContextVar[object | None] = ContextVar("handrive_active_request", default=None)
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
        "menu_delete_repo": "Delete Repo",
        "menu_new_folder": "새 폴더",
        "menu_new_document": "새 파일",
        "rename_title": "이름 바꾸기",
        "commit_message_title": "커밋 메시지",
        "commit_message_label": "메시지",
        "commit_message_placeholder": "커밋 메시지를 입력해주세요.",
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
        "apply": "변경",
        "edit_button": "수정",
        "delete_button": "삭제",
        "delete_repo_button": "Delete Repo",
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
        "git_repo_name_placeholder": "my-repo (letters, numbers, ., -, _)",
        "map_name_placeholder": "이름을 입력하세요",
        "map_marker_name_placeholder": "마커 이름",
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
        "js_confirm_delete_entry": "정말 삭제할까요?\n{path}",
        "js_confirm_delete_entries": "선택한 {count}개 항목을 삭제할까요?",
        "js_confirm_delete_repo_entry": "이 Repo를 삭제하면 Forgejo 저장소가 삭제되고 폴더는 내 루트 폴더로 이동합니다.\n정말 삭제할까요?\n{path}",
        "js_confirm_delete_repo_entries": "선택한 {count}개 항목 중 Repo를 삭제하면 Forgejo 저장소가 삭제되고 폴더는 각 사용자 루트 폴더로 이동합니다.\n정말 삭제할까요?",
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
        "menu_delete_repo": "Delete Repo",
        "menu_new_folder": "New Folder",
        "menu_new_document": "New File",
        "rename_title": "Rename",
        "commit_message_title": "Commit Message",
        "commit_message_label": "Message",
        "commit_message_placeholder": "Enter a commit message.",
        "rename_new_name": "New name",
        "rename_new_name_placeholder": "New name",
        "cancel": "Cancel",
        "upload_cancel": "Cancel Upload",
        "apply": "Apply",
        "edit_button": "Edit",
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
        "git_repo_name_placeholder": "my-repo (letters, numbers, ., -, _)",
        "map_name_placeholder": "Enter a name",
        "map_marker_name_placeholder": "Marker name",
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
        "queue_status_delete_done": "Delete complete",
        "queue_status_move_queued": "Move queued",
        "queue_status_moving": "Moving",
        "queue_status_move_done": "Move complete",
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
        "js_confirm_delete_entry": "Delete this item?\n{path}",
        "js_confirm_delete_entries": "Delete {count} selected items?",
        "js_confirm_delete_repo_entry": "Deleting this Repo also deletes the Forgejo repository, then moves the folder back to your root folder.\nDelete it now?\n{path}",
        "js_confirm_delete_repo_entries": "Deleting Repo items among the selected {count} entries also deletes the Forgejo repositories, then moves each folder back to its user's root folder.\nDelete them now?",
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
        token = HANDRIVE_ACTIVE_ROOT_DIR.set(get_request_handrive_root_dir(request))
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


def render_plain_text_safely(text: str) -> str:
    """plain text 를 안전한 ``pre/code`` HTML 로 감싼다."""
    escaped_text = escape(text or "")
    return mark_safe(f"<pre><code>{escaped_text}</code></pre>")


_HANDRIVE_UNSUPPORTED_ICON_URLS: dict[str, str] = {
    ".exe": "/static/icons/handrive/exe.svg",
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
    if extension in {".mp4", ".webm", ".mov", ".m4v", ".ogv"}:
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
    _children = [directory / p.name for p in directory.resolve().iterdir()]
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
                entry["share_url"] = ""
                if entry["is_url_only"]:
                    _link = HandriveSharedLink.objects.select_related("owner").filter(path=entry["path"]).first()
                    if _link:
                        _ui_lang = resolve_ui_lang(request, getattr(getattr(request, "resolver_match", None), "kwargs", {}).get("ui_lang"))
                        entry["share_url"] = request.build_absolute_uri(
                            build_handrive_shared_view_url(_ui_lang, _link.owner.username, _link.share_slug)
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
                entry["share_url"] = ""
                if entry["is_url_only"]:
                    _link = HandriveSharedLink.objects.select_related("owner").filter(path=entry["path"]).first()
                    if _link:
                        _ui_lang = resolve_ui_lang(request, getattr(getattr(request, "resolver_match", None), "kwargs", {}).get("ui_lang"))
                        entry["share_url"] = request.build_absolute_uri(
                            build_handrive_shared_view_url(_ui_lang, _link.owner.username, _link.share_slug)
                        )
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
    for directory in sorted([p for p in root.rglob("*") if p.is_dir()], key=lambda p: p.as_posix().lower()):
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

    for path_obj in root_path.rglob("*"):
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
    if projected_entries > DOCS_USER_SCOPED_ENTRY_LIMIT:
        raise ValueError("개인 폴더의 하위 폴더/파일 수가 100개를 초과해 더 이상 업로드하거나 생성할 수 없습니다.")


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
        for path_obj in root_path.rglob("*"):
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
        for path_obj in repo_path.rglob("*"):
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
            "handrive_api_map_image_url": reverse("main:handrive_api_map_image"),
            "handrive_map_editor_base_url": "/handrive/map-editor/",
            "handrive_map_viewer_base_url": "/handrive/map-viewer/",
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


def _reset_handrive_login_guard(user):
    if user is None:
        return
    guard = HandriveLoginAttemptGuard.objects.filter(user=user).first()
    if guard is None:
        return
    guard.failed_attempts = 0
    guard.captcha_required = False
    guard.save(update_fields=["failed_attempts", "captcha_required", "updated_at"])


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

    landing_dir = get_handrive_initial_landing_dir(request)
    if user and user.is_authenticated and landing_dir:
        ensure_scoped_home_dir(landing_dir)
        if ui_lang in SUPPORTED_UI_LANGS:
            return reverse("main:handrive_list_lang", kwargs={"ui_lang": ui_lang, "folder_path": landing_dir})
        return reverse("main:handrive_list", kwargs={"folder_path": landing_dir})
    return lang_base


class HandriveSignupForm(UserCreationForm):
    first_name = forms.CharField(max_length=150, required=False)
    email = forms.EmailField(required=False)
    privacy_consent = forms.BooleanField(required=True)

    def __init__(self, *args, ui_lang: str | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        handrive_text = get_handrive_text(ui_lang)
        self.fields["first_name"].label = handrive_text.get("auth_name_label", "이름")
        self.fields["email"].label = handrive_text.get("auth_email_label", "이메일 주소")
        self.fields["privacy_consent"].label = handrive_text.get("auth_privacy_consent_label", "개인정보 처리방침 및 이용약관에 동의합니다.")
        self.fields["privacy_consent"].error_messages = {
            "required": handrive_text.get("auth_privacy_consent_error", "개인정보 처리방침 및 이용약관 동의가 필요합니다."),
        }
        self.fields["username"].widget.attrs.update({"autocomplete": "username", "placeholder": "아이디를 입력하세요"})
        self.fields["password1"].widget.attrs.update({"autocomplete": "new-password", "placeholder": "비밀번호 입력"})
        self.fields["password2"].widget.attrs.update({"autocomplete": "new-password", "placeholder": "비밀번호 다시 입력"})
        self.fields["first_name"].widget.attrs.update({"autocomplete": "name", "placeholder": "이름 입력"})
        self.fields["email"].widget.attrs.update({"autocomplete": "email", "placeholder": "example@email.com"})

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
    """Gitea가 시작한 OIDC authorize handoff 인지 확인한다."""
    parsed = urlparse(str(target_url or ""))
    if parsed.path != "/o/authorize/":
        return False

    query = parse_qs(parsed.query)
    return str(query.get("client_id", [""])[0]) == "gitea-hanplanet-sso"


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
        return _build_post_hanplanet_login_response(
            _resolve_handrive_post_login_url(request, resolved_lang, next_url, request.user),
            request.user,
        )

    form = AuthenticationForm(request, data=request.POST or None)
    login_error_message = ""
    login_error_popup_message = ""
    show_captcha = False
    captcha_question = ""
    
    # 디버그 모드에서는 Turnstile 비활성화
    if settings.DEBUG:
        turnstile_site_key = ""
        turnstile_secret_key = ""
    else:
        turnstile_site_key = str(getattr(settings, "TURNSTILE_SITE_KEY", "") or "").strip()
        turnstile_secret_key = str(getattr(settings, "TURNSTILE_SECRET_KEY", "") or "").strip()

    if request.method == "POST":
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
                _reset_handrive_login_guard(authed_user)
                _clear_handrive_login_captcha(request)
                auth_login(request, authed_user)
                if not requires_direct_attach:
                    return _build_post_hanplanet_login_response(target_url, authed_user)
                response = _build_forgejo_redirect_base(target_url)
                return _apply_forgejo_session_cookie(response, forgejo_session_key)
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
            _reset_handrive_login_guard(authed_user)
            _clear_handrive_login_captcha(request)
            auth_login(request, authed_user)
            if not requires_direct_attach:
                return _build_post_hanplanet_login_response(target_url, authed_user)
            response = _build_forgejo_redirect_base(target_url)
            return _apply_forgejo_session_cookie(response, forgejo_session_key)
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
            auth_login(request, authed_user)
            if not requires_direct_attach:
                return _build_post_hanplanet_login_response(target_url, authed_user)
            response = _build_forgejo_redirect_base(target_url)
            return _apply_forgejo_session_cookie(response, forgejo_session_key)
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


@require_http_methods(["POST"])
@csrf_protect
def handrive_logout(request, ui_lang=None):
    resolved_lang = resolve_ui_lang(request, ui_lang)
    context = handrive_common_context(request, resolved_lang)
    next_url = resolve_next_url(request, context["handrive_base_url"])
    forgejo_session_key = str(request.COOKIES.get("i_like_gitea", "") or "").strip()
    # Forgejo 세션/토큰 서버사이드 선제 삭제 (로그아웃 전에 user 정보 참조)
    _forgejo_server_logout(request.user, forgejo_session_key=forgejo_session_key)
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
    subprocess.Popen(
        [
            "/bin/zsh",
            "-lc",
            "sleep 1; launchctl kickstart -k gui/$(id -u)/com.hanplanet.gunicorn >/tmp/hanplanet-gunicorn-restart.log 2>&1",
        ],
        cwd=str(settings.BASE_DIR),
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
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

    breadcrumbs = _build_git_virtual_breadcrumbs(
        request,
        context["handrive_base_url"],
        current_dir,
        scoped_home_dir=scoped_home_dir,
        root_url=shared_root_url,
    )
    if shared_context:
        breadcrumbs = [
            {
                **crumb,
                "url": append_handrive_share_query(
                    crumb["url"],
                    shared_context["owner_username"],
                    shared_context["share_slug"],
                ),
            }
            for crumb in breadcrumbs
        ]

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
            "hide_global_nav": bool(shared_context),
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
    doc_share_url = ""
    if doc_is_url_only:
        _shared_link = HandriveSharedLink.objects.select_related("owner").filter(path=relative_file_path).first()
        if _shared_link:
            doc_share_url = request.build_absolute_uri(
                build_handrive_shared_view_url(resolved_lang, _shared_link.owner.username, _shared_link.share_slug)
            )

    shared_root_url = context["handrive_root_url"]
    if shared_context:
        shared_root_url = build_handrive_shared_view_url(
            resolved_lang,
            shared_context["owner_username"],
            shared_context["share_slug"],
        )

    view_breadcrumbs = _build_git_virtual_breadcrumbs(
        request,
        context["handrive_base_url"],
        parent_dir,
        scoped_home_dir=scoped_home_dir,
        root_url=shared_root_url,
    )
    if shared_context:
        view_breadcrumbs = [
            {
                **crumb,
                "url": append_handrive_share_query(
                    crumb["url"],
                    shared_context["owner_username"],
                    shared_context["share_slug"],
                ),
            }
            for crumb in view_breadcrumbs
        ]

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
            "doc_content_html": rendered_content_html,
            "doc_content_mode": render_profile["mode"],
            "doc_content_class": render_profile["css_class"],
            "view_breadcrumbs": view_breadcrumbs,
            "view_current_file_name": file_name,
            "view_current_file_size_display": file_size_display,
            "page_help_html": build_page_help_html(resolved_lang, "view", handrive_text),
            "hide_global_nav": bool(shared_context),
            "is_handrive_shared_view": bool(shared_context),
            "handrive_shared_owner_username": shared_context["owner_username"] if shared_context else "",
            "handrive_shared_slug": shared_context["share_slug"] if shared_context else "",
            "handrive_shared_root_path": shared_context["root_path"] if shared_context else "",
            "handrive_root_url": shared_root_url,
        }
    )
    return render(request, "handrive/view.html", context)


@with_request_handrive_root
def handrive_shared_view(request, owner_username, share_slug, ui_lang=None):
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

    if target_path.is_dir():
        return handrive_list(request, folder_path=relative_path, ui_lang=ui_lang)

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
            "hide_global_nav": True,
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
    if not request.user.is_authenticated:
        return JsonResponse({"ok": False, "error": "로그인이 필요합니다."}, status=401)

    try:
        payload = json.loads(request.body or "{}")
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": "잘못된 요청입니다."}, status=400)

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

    git_virtual = _get_git_virtual_context(request, normalized)
    if git_virtual is None:
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
        try:
            entries = _build_git_virtual_entries(request, git_virtual)
        except RuntimeError as exc:
            return json_error(str(exc), status=500)

    if not has_handrive_read_access(request, normalized):
        return json_error("파일을 볼 권한이 없습니다.", status=403)

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
                    }
                    matches.append(entry)

        # 파일 매칭
        for filename in filenames:
            if _name_matches(filename):
                file_path = current_dir_path / filename
                rel_file = (rel_current + "/" + filename) if rel_current != "." else filename
                if has_handrive_read_access(request, rel_file):
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
                        "share_url": "",
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
        candidate_name = validate_name(new_name, for_file=git_virtual_source["kind"] == "branch_file", file_extension=suffix if git_virtual_source["kind"] == "branch_file" else "")
        new_leaf_name = f"{candidate_name}{suffix}" if git_virtual_source["kind"] == "branch_file" else candidate_name
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
        candidate_name = validate_name(new_name, for_file=True, file_extension=source_extension)
        destination = parent / f"{candidate_name}{source_extension}"
    else:
        destination = parent / new_name

    if destination.exists() and destination.resolve() != source_path.resolve():
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
                if resolve_handrive_render_profile(file_extension).get("mode") == DOCS_RENDER_MODE_OFFICE:
                    content = ""
                    rendered_html, render_profile = render_handrive_content(
                        content,
                        file_extension,
                        source_path=file_path,
                        relative_path=relative_file_path,
                        request=request,
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

        filename = validate_name(
            payload.get("filename"),
            for_file=True,
            file_extension=target_extension,
        )
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
    geojson_file.write_text(json.dumps(geojson_data, ensure_ascii=False, indent=2), encoding="utf-8")
    return JsonResponse({"ok": True})


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

    with target.open("wb") as f:
        for chunk in icon_file.chunks():
            f.write(chunk)

    icon_path_relative = relative_from_root(target)
    icon_api_url = f"/handrive/api/map-image/?path={quote(icon_path_relative)}"
    return JsonResponse({"ok": True, "icon_path": icon_path_relative, "icon_url": icon_api_url})


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

    icon_file.unlink()
    return JsonResponse({"ok": True})


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
    if suffix not in MAP_IMAGE_EXTENSIONS:
        raise Http404

    content_type = MAP_IMAGE_MIME_TYPES.get(suffix, "application/octet-stream")
    response = FileResponse(file_path.open("rb"), content_type=content_type)
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
        "map_viewer_url": f"/handrive/map-viewer/{normalized}",
        "handrive_list_url": parent_list_url,
    })
    return render(request, "handrive/map_editor.html", context)


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

    context.update({
        "map_path": normalized,
        "map_name": Path(normalized).name,
        "base_image_name": base_image_name,
        "image_url": image_url,
        "can_edit": has_handrive_write_access(request, normalized),
        "map_editor_url": f"/handrive/map-editor/{normalized}",
        "handrive_list_url": parent_list_url,
        "map_data_api_url": reverse("main:handrive_api_map_data"),
        "map_icon_api_url": "/handrive/api/map-image/",
    })
    return render(request, "handrive/map_viewer.html", context)


# ── HanDrive 데스크톱 클라이언트 OAuth 브리지 ────────────────────────────────────

@require_http_methods(["GET"])
def handrive_login_bridge(request):
    """HanDrive 데스크톱 클라이언트 브라우저 OAuth 브리지.

    클라이언트가 브라우저를 통해 JWT 토큰을 받아가는 흐름:
      1. 클라이언트 → 브라우저로 이 URL 오픈
         /login/handrive?callback=http://127.0.0.1:PORT/auth&state=RANDOM
      2. 미로그인 상태 → /login?next=현재경로 로 리다이렉트
      3. 로그인 완료 → 이 뷰 재진입
      4. callback URL(localhost만 허용)로 토큰 전달
    """
    from urllib.parse import urlencode, urlparse

    callback = request.GET.get("callback", "").strip()
    state = request.GET.get("state", "").strip()

    # force_relogin=1: 현재 세션 로그아웃 후 로그인 페이지로
    if request.GET.get("force_relogin") == "1":
        if request.user.is_authenticated:
            from django.contrib.auth import logout as _logout
            _logout(request)
        # force_relogin 제거한 동일 경로로 리다이렉트 (이제 미인증 → 로그인 페이지로)
        params = {k: v for k, v in request.GET.items() if k != "force_relogin"}
        target = request.path + ("?" + urlencode(params) if params else "")
        return redirect("/login?" + urlencode({"next": target}))

    if not request.user.is_authenticated:
        return redirect("/login?" + urlencode({"next": request.get_full_path()}))

    if callback:
        parsed = urlparse(callback)
        if parsed.hostname not in ("127.0.0.1", "localhost") or parsed.scheme != "http":
            from django.http import HttpResponseBadRequest
            return HttpResponseBadRequest("invalid callback: localhost http only")

        from .sync_auth import issue_token_pair
        tokens = issue_token_pair(request.user)
        params = {
            "access_token": tokens["access_token"],
            "refresh_token": tokens["refresh_token"],
            "state": state,
        }
        redirect_url = callback + "?" + urlencode(params)
        return redirect(redirect_url)

    # callback 없이 직접 접근: 안내 페이지
    return render(request, "handrive/login_bridge.html", {"user": request.user})
