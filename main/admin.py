import gzip
import json
import re
import secrets
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path

import httpx
from django.conf import settings
from django.contrib import admin
from django.contrib.admin.forms import AdminAuthenticationForm
from django.core.paginator import Paginator
from django import forms
from django.http import FileResponse, Http404, HttpResponse, StreamingHttpResponse
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils import timezone
from django.core.exceptions import ValidationError

from .access_log_summary import BOT_UA_PATTERN, resolve_summary_dir, summary_markdown
from .models import (
    EmailTwoFactorBypassUser,
    HandriveAccessRule,
    HandriveUserQuota,
    NavLink,
    QuickLink,
    UserProfile,
)


ADMIN_LOGIN_CAPTCHA_QUESTION_SESSION_KEY = "admin_login_captcha_question"
ADMIN_LOGIN_CAPTCHA_ANSWER_SESSION_KEY = "admin_login_captcha_answer"


def _build_admin_login_captcha(request, refresh=False):
    if request is None:
        return ""
    session = getattr(request, "session", None)
    if session is None:
        return ""

    question = session.get(ADMIN_LOGIN_CAPTCHA_QUESTION_SESSION_KEY, "")
    answer = session.get(ADMIN_LOGIN_CAPTCHA_ANSWER_SESSION_KEY, "")
    if not refresh and question and answer:
        return question

    left = secrets.randbelow(9) + 1
    right = secrets.randbelow(9) + 1
    session[ADMIN_LOGIN_CAPTCHA_QUESTION_SESSION_KEY] = f"{left} + {right} = ?"
    session[ADMIN_LOGIN_CAPTCHA_ANSWER_SESSION_KEY] = str(left + right)
    session.modified = True
    return session[ADMIN_LOGIN_CAPTCHA_QUESTION_SESSION_KEY]


def _verify_admin_turnstile_token(token, remote_ip):
    site_key = str(getattr(settings, "TURNSTILE_SITE_KEY", "") or "").strip()
    secret_key = str(getattr(settings, "TURNSTILE_SECRET_KEY", "") or "").strip()
    if not site_key or not secret_key:
        return False
    if not token:
        return False

    payload = {"secret": secret_key, "response": token}
    if remote_ip:
        payload["remoteip"] = remote_ip

    try:
        response = httpx.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data=payload,
            timeout=5.0,
        )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError):
        return False
    return bool(result.get("success"))


class AdminCaptchaAuthenticationForm(AdminAuthenticationForm):
    captcha_answer = forms.CharField(label="Captcha", required=True)

    def __init__(self, request=None, *args, **kwargs):
        super().__init__(request, *args, **kwargs)
        self._request = request
        self.turnstile_site_key = str(getattr(settings, "TURNSTILE_SITE_KEY", "") or "").strip()
        self.fields["captcha_answer"].widget.attrs["autocomplete"] = "off"
        self.fields["captcha_answer"].widget.attrs["autocapitalize"] = "off"
        self.fields["captcha_answer"].widget.attrs["spellcheck"] = "false"
        self.captcha_question = _build_admin_login_captcha(request, refresh=False)

    def clean(self):
        if not self.turnstile_site_key:
            raise ValidationError("Captcha is not configured. Please contact the administrator.")

        expected = ""
        session = getattr(self._request, "session", None)
        if session is not None:
            expected = str(session.get(ADMIN_LOGIN_CAPTCHA_ANSWER_SESSION_KEY, "") or "").strip()
        provided = str(self.cleaned_data.get("captcha_answer", "") or "").strip()
        if not expected or provided != expected:
            _build_admin_login_captcha(self._request, refresh=True)
            raise ValidationError("Captcha verification failed. Please try again.")

        token = ""
        remote_ip = ""
        if self._request is not None:
            token = self._request.POST.get("cf-turnstile-response", "")
            remote_ip = (self._request.META.get("HTTP_CF_CONNECTING_IP") or self._request.META.get("REMOTE_ADDR") or "").strip()
        if not _verify_admin_turnstile_token(token, remote_ip):
            _build_admin_login_captcha(self._request, refresh=True)
            raise ValidationError("Captcha verification failed. Please try again.")

        cleaned = super().clean()
        _build_admin_login_captcha(self._request, refresh=True)
        return cleaned


admin.site.login_form = AdminCaptchaAuthenticationForm

@admin.register(NavLink)
class NavLinkAdmin(admin.ModelAdmin):
    list_display = ["order", "name", "url"]
    list_editable = ["name", "url"]
    ordering = ["order", "id"]


@admin.register(QuickLink)
class QuickLinkAdmin(admin.ModelAdmin):
    list_display = ["user", "display_order", "name", "url", "updated_at"]
    list_filter = ["user"]
    search_fields = ["name", "url", "user__username"]
    ordering = ["user__username", "display_order", "id"]


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "theme_mode", "preferred_ui_lang", "preferred_root_search_engine", "updated_at"]
    list_filter = ["theme_mode", "preferred_ui_lang", "preferred_root_search_engine"]
    search_fields = ["user__username"]
    ordering = ["user__username"]


@admin.register(EmailTwoFactorBypassUser)
class EmailTwoFactorBypassUserAdmin(admin.ModelAdmin):
    list_display = ["user", "user_email", "created_at", "updated_at"]
    search_fields = ["user__username", "user__email"]
    autocomplete_fields = ["user"]
    ordering = ["user__username"]

    @admin.display(description="이메일")
    def user_email(self, obj):
        return obj.user.email


@admin.register(HandriveAccessRule)
class HandriveAccessRuleAdmin(admin.ModelAdmin):
    list_display = ["path", "updated_at", "read_subject_count", "write_subject_count"]
    search_fields = [
        "path",
        "read_users__username",
        "read_groups__name",
        "write_users__username",
        "write_groups__name",
    ]
    filter_horizontal = ["read_users", "read_groups", "write_users", "write_groups"]
    ordering = ["path"]

    @admin.display(description="읽기 주체 수")
    def read_subject_count(self, obj):
        return obj.read_users.count() + obj.read_groups.count()

    @admin.display(description="쓰기 주체 수")
    def write_subject_count(self, obj):
        return obj.write_users.count() + obj.write_groups.count()

class HandriveUserQuotaForm(forms.ModelForm):
    quota_gb = forms.FloatField(
        label="저장 용량 (GB)",
        min_value=0.01,
        help_text="기가바이트 단위로 입력. 예: 1 = 1GB, 0.5 = 512MB",
    )

    class Meta:
        model = HandriveUserQuota
        fields = ["user", "quota_gb", "hanharness_enabled", "hanharness_token_limit_5h", "scoped_entry_limit"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields["quota_gb"].initial = round(self.instance.quota_bytes / (1024 ** 3), 4)

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.quota_bytes = int(self.cleaned_data["quota_gb"] * (1024 ** 3))
        if commit:
            instance.save()
        return instance


@admin.register(HandriveUserQuota)
class HandriveUserQuotaAdmin(admin.ModelAdmin):
    form = HandriveUserQuotaForm
    list_display = ["user", "quota_display", "entry_limit_display", "hanharness_enabled", "token_limit_display"]
    search_fields = ["user__username", "user__email"]
    ordering = ["user__username"]

    @admin.display(description="저장 용량")
    def quota_display(self, obj):
        gb = obj.quota_bytes / (1024 ** 3)
        return f"{gb:.2f} GB"

    @admin.display(description="파일/폴더 개수 제한")
    def entry_limit_display(self, obj):
        if obj.scoped_entry_limit == 0:
            return "무제한"
        return f"{obj.scoped_entry_limit:,}개"

    @admin.display(description="5시간 토큰 한도")
    def token_limit_display(self, obj):
        if obj.hanharness_token_limit_5h == 0:
            return "무제한"
        return f"{obj.hanharness_token_limit_5h:,}"


LOG_DAYS_DEFAULT = 30
LOG_PER_PAGE_DEFAULT = 100
LOG_PER_PAGE_MAX = 500
LOG_SCAN_ROWS_MAX = 5000
SUMMARY_PER_PAGE_DEFAULT = 30
SUMMARY_PER_PAGE_MAX = 200
BOT_PATH_HINTS = (
    ".php",
    "/wp-",
    "/wordpress",
    "/xmlrpc.php",
    "/geoserver/",
    "/device.rsp",
    "/cgi-bin/",
    "/boaform/",
    "/actuator/",
    "/manager/html",
)


def _parse_iso_date(value):
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _parse_int(value, default, min_value, max_value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(min_value, min(parsed, max_value))


def _parse_bool(value, default=False):
    if value is None:
        return default
    normalized = str(value).strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def _parse_logged_at(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed.astimezone(timezone.get_current_timezone())


def _collect_log_files(log_dir):
    if not log_dir.exists():
        return []

    candidates = {}
    for pattern in ("access_json.log", "access_json_*.log", "access_json_*.log.gz"):
        for file_path in log_dir.glob(pattern):
            candidates[str(file_path)] = file_path

    def sort_key(file_path):
        try:
            return file_path.stat().st_mtime
        except OSError:
            return 0

    return sorted(candidates.values(), key=sort_key)


def _open_log_file(file_path):
    if file_path.suffix == ".gz":
        return gzip.open(file_path, mode="rt", encoding="utf-8", errors="replace")
    return file_path.open(mode="r", encoding="utf-8", errors="replace")


def _is_suspected_bot_request(payload):
    user_agent = str(payload.get("user_agent", "")).strip()
    path = str(payload.get("path", "")).strip().lower()

    if user_agent and BOT_UA_PATTERN.search(user_agent):
        return True

    if path:
        for hint in BOT_PATH_HINTS:
            if hint in path:
                return True

    return False


def _load_file_log_rows(limit, days, exclude_suspected_bots=False):
    log_dir = Path(getattr(settings, "NGINX_LOG_DIR", "/opt/homebrew/var/log/nginx"))
    files = _collect_log_files(log_dir)
    cutoff = timezone.now() - timedelta(days=days)
    rows = deque(maxlen=limit)
    parse_errors = 0
    filtered_bot_rows = 0

    for file_path in files:
        try:
            with _open_log_file(file_path) as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        parse_errors += 1
                        continue

                    logged_at_raw = payload.get("logged_at", "")
                    logged_at = _parse_logged_at(logged_at_raw)
                    if logged_at and logged_at < cutoff:
                        continue
                    if exclude_suspected_bots and _is_suspected_bot_request(payload):
                        filtered_bot_rows += 1
                        continue

                    rows.append(
                        {
                            "logged_at": (
                                logged_at.strftime("%Y-%m-%d %H:%M:%S")
                                if logged_at
                                else logged_at_raw
                            ),
                            "status": payload.get("status", ""),
                            "method": payload.get("method", ""),
                            "host": payload.get("host", ""),
                            "path": payload.get("path", ""),
                            "request_time_s": payload.get("request_time_s", ""),
                            "client_ip": payload.get("client_ip", ""),
                            "user_agent": payload.get("user_agent", ""),
                        }
                    )
        except OSError:
            continue

    return list(reversed(rows)), len(files), parse_errors, filtered_bot_rows, log_dir


def access_log_file_view(request):
    days = _parse_int(request.GET.get("days"), LOG_DAYS_DEFAULT, 1, 30)
    per_page = _parse_int(request.GET.get("per_page"), LOG_PER_PAGE_DEFAULT, 20, LOG_PER_PAGE_MAX)
    page_number = _parse_int(request.GET.get("p"), 1, 1, 999999)
    exclude_bots = _parse_bool(request.GET.get("exclude_bots"), default=True)
    row_limit = min(max(page_number * per_page, per_page), LOG_SCAN_ROWS_MAX)

    rows, scanned_files, parse_errors, filtered_bot_rows, log_dir = _load_file_log_rows(
        limit=row_limit,
        days=days,
        exclude_suspected_bots=exclude_bots,
    )
    paginator = Paginator(rows, per_page)
    page_obj = paginator.get_page(page_number)

    query_params = request.GET.copy()
    query_params.pop("p", None)

    context = {
        **admin.site.each_context(request),
        "title": "접속 로그",
        "subtitle": None,
        "file_logs": page_obj.object_list,
        "page_obj": page_obj,
        "paginator": paginator,
        "is_paginated": page_obj.has_other_pages(),
        "days": days,
        "per_page": per_page,
        "base_query": query_params.urlencode(),
        "parse_errors": parse_errors,
        "exclude_bots": exclude_bots,
        "filtered_bot_rows": filtered_bot_rows,
        "scanned_files": scanned_files,
        "log_dir": str(log_dir),
        "total_count": paginator.count,
    }
    return TemplateResponse(request, "admin/main/accesslog/file_logs.html", context)


def _iter_access_log_jsonl_for_date(target_date):
    log_dir = Path(getattr(settings, "NGINX_LOG_DIR", "/opt/homebrew/var/log/nginx"))
    files = _collect_log_files(log_dir)

    for file_path in files:
        try:
            with _open_log_file(file_path) as handle:
                for raw_line in handle:
                    line = raw_line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    logged_at_raw = payload.get("logged_at", "")
                    logged_at = _parse_logged_at(logged_at_raw)
                    if logged_at is not None:
                        if logged_at.date() != target_date:
                            continue
                    elif str(logged_at_raw)[:10] != target_date.isoformat():
                        continue

                    yield json.dumps(payload, ensure_ascii=False) + "\n"
        except OSError:
            continue


def access_log_download_view(request, log_date):
    selected_date = _parse_iso_date(log_date)
    if selected_date is None:
        raise Http404("유효하지 않은 날짜 형식입니다. YYYY-MM-DD 를 사용하세요.")

    response = StreamingHttpResponse(
        _iter_access_log_jsonl_for_date(selected_date),
        content_type="application/x-ndjson; charset=utf-8",
    )
    response["Content-Disposition"] = (
        f'attachment; filename="access_log_{selected_date.isoformat()}.jsonl"'
    )
    return response


def _extract_summary_date(file_path):
    stem = file_path.stem
    prefix = "access_summary_"
    if not stem.startswith(prefix):
        return None
    raw_date = stem[len(prefix):]
    try:
        return datetime.strptime(raw_date, "%Y-%m-%d").date()
    except ValueError:
        return None


def _collect_summary_files(summary_dir):
    if not summary_dir.exists():
        return []

    files = list(summary_dir.glob("access_summary_*.json"))

    def sort_key(file_path):
        summary_date = _extract_summary_date(file_path)
        if summary_date:
            return (1, summary_date)
        return (0, datetime.min.date())

    return sorted(files, key=sort_key, reverse=True)


def _load_summary_json(file_path):
    try:
        with file_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def access_log_summary_view(request, summary_date=""):
    per_page = _parse_int(request.GET.get("per_page"), SUMMARY_PER_PAGE_DEFAULT, 10, SUMMARY_PER_PAGE_MAX)
    page_number = _parse_int(request.GET.get("p"), 1, 1, 999999)
    selected_date = (summary_date or request.GET.get("date", "")).strip()
    auto_selected_date = False

    summary_dir = Path(resolve_summary_dir())
    summary_files = _collect_summary_files(summary_dir)
    rows = []

    for file_path in summary_files:
        payload = _load_summary_json(file_path)
        if payload is None:
            continue

        row_date = str(payload.get("date", "")).strip() or ""
        if not row_date:
            parsed = _extract_summary_date(file_path)
            row_date = parsed.isoformat() if parsed else file_path.stem

        rows.append(
            {
                "date": row_date,
                "total_requests": payload.get("total_requests", 0),
                "unique_ips": payload.get("unique_ips", 0),
                "error_rate_pct": payload.get("error_rate_pct", 0),
                "parse_errors": payload.get("parse_errors", 0),
                "generated_at": payload.get("generated_at", ""),
            }
        )

    if not selected_date and rows:
        selected_date = rows[0]["date"]
        auto_selected_date = True

    paginator = Paginator(rows, per_page)
    page_obj = paginator.get_page(page_number)

    query_params = request.GET.copy()
    query_params.pop("p", None)

    selected_summary = None
    selected_markdown = ""
    selected_missing = False
    if selected_date:
        selected_json_path = summary_dir / f"access_summary_{selected_date}.json"
        selected_summary = _load_summary_json(selected_json_path)
        if selected_summary is None:
            selected_missing = True
        else:
            selected_md_path = summary_dir / f"access_summary_{selected_date}.md"
            if selected_md_path.exists():
                try:
                    selected_markdown = selected_md_path.read_text(encoding="utf-8")
                except OSError:
                    selected_markdown = ""
            if not selected_markdown:
                selected_markdown = summary_markdown(selected_summary)

    context = {
        **admin.site.each_context(request),
        "title": "일일 요약",
        "subtitle": None,
        "summary_rows": page_obj.object_list,
        "page_obj": page_obj,
        "paginator": paginator,
        "is_paginated": page_obj.has_other_pages(),
        "per_page": per_page,
        "base_query": query_params.urlencode(),
        "summary_dir": str(summary_dir),
        "selected_date": selected_date,
        "selected_summary": selected_summary,
        "selected_markdown": selected_markdown,
        "selected_missing": selected_missing,
        "summary_count": paginator.count,
        "auto_selected_date": auto_selected_date,
    }
    return TemplateResponse(request, "admin/main/accesslog/summary_logs.html", context)


def access_log_summary_download_view(request, summary_date, file_type):
    selected_date = _parse_iso_date(summary_date)
    if selected_date is None:
        raise Http404("유효하지 않은 날짜 형식입니다. YYYY-MM-DD 를 사용하세요.")

    ext = (file_type or "").strip().lower()
    if ext not in {"json", "md"}:
        raise Http404("지원하지 않는 파일 형식입니다.")

    summary_dir = Path(resolve_summary_dir())
    date_str = selected_date.isoformat()
    json_path = summary_dir / f"access_summary_{date_str}.json"
    md_path = summary_dir / f"access_summary_{date_str}.md"

    if ext == "json":
        if not json_path.exists():
            raise Http404("요약 JSON 파일이 없습니다.")
        return FileResponse(
            json_path.open("rb"),
            as_attachment=True,
            filename=json_path.name,
            content_type="application/json",
        )

    if md_path.exists():
        return FileResponse(
            md_path.open("rb"),
            as_attachment=True,
            filename=md_path.name,
            content_type="text/markdown; charset=utf-8",
        )

    summary_payload = _load_summary_json(json_path)
    if summary_payload is None:
        raise Http404("요약 원본 파일이 없어 Markdown을 생성할 수 없습니다.")

    response = HttpResponse(
        summary_markdown(summary_payload),
        content_type="text/markdown; charset=utf-8",
    )
    response["Content-Disposition"] = f'attachment; filename="access_summary_{date_str}.md"'
    return response


def _is_blank(value):
    return not str(value or "").strip()


def translation_audit_view(request):
    missing_projects = []
    missing_careers = []

    for project in Project.objects.all().order_by("id"):
        missing_fields = []
        if _is_blank(project.title_en):
            missing_fields.append("title_en")
        if _is_blank(project.content_en):
            missing_fields.append("content_en")
        if missing_fields:
            missing_projects.append(
                {
                    "id": project.id,
                    "title": project.title,
                    "missing_fields": ", ".join(missing_fields),
                    "change_url": reverse("admin:main_project_change", args=[project.id]),
                }
            )

    for career in Career.objects.all().order_by("id"):
        missing_fields = []
        if _is_blank(career.company_en):
            missing_fields.append("company_en")
        if _is_blank(career.content_en):
            missing_fields.append("content_en")
        if missing_fields:
            missing_careers.append(
                {
                    "id": career.id,
                    "company": career.company,
                    "position": career.position,
                    "missing_fields": ", ".join(missing_fields),
                    "change_url": reverse("admin:main_career_change", args=[career.id]),
                }
            )

    context = {
        **admin.site.each_context(request),
        "title": "번역 누락 점검",
        "subtitle": None,
        "missing_projects": missing_projects,
        "missing_careers": missing_careers,
        "missing_project_count": len(missing_projects),
        "missing_career_count": len(missing_careers),
    }
    return TemplateResponse(request, "admin/main/translation_audit.html", context)


# ---------------------------------------------------------------------------
# AI API Usage Log
# ---------------------------------------------------------------------------

_AI_LOG_TS_RE = re.compile(
    r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (ai\.\w+)(?: (.*))?$'
)
_AI_LOG_NO_TS_RE = re.compile(
    r'^(ai\.\w+)(?: (.*))?$'
)
_KV_RE = re.compile(r'(\w+)=(\S*)')

_AI_EVENT_LABELS = {
    "ai.request": "요청",
    "ai.usage": "토큰 사용",
    "ai.stream_done": "스트림 완료",
    "ai.stream_error": "오류",
    "ai.models": "모델 목록",
}

AI_USAGE_PER_PAGE_DEFAULT = 50
AI_USAGE_PER_PAGE_MAX = 200
AI_USAGE_SCAN_MAX = 10_000


def _parse_ai_log_line(line):
    """Return (timestamp_str|None, event, params_dict) or None if not an ai.* line."""
    line = line.strip()
    m = _AI_LOG_TS_RE.match(line)
    if m:
        ts, event, rest = m.group(1), m.group(2), m.group(3) or ""
        return ts, event, dict(_KV_RE.findall(rest))
    m = _AI_LOG_NO_TS_RE.match(line)
    if m:
        event, rest = m.group(1), m.group(2) or ""
        return None, event, dict(_KV_RE.findall(rest))
    return None


def _load_ai_usage_rows(limit, days, user_filter=None, model_filter=None, event_filter=None):
    log_path = Path(settings.BASE_DIR) / "debug.log"
    if not log_path.exists():
        return [], set(), set()

    cutoff_str = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    raw = []
    try:
        with log_path.open(encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parsed = _parse_ai_log_line(line)
                if parsed:
                    raw.append(parsed)
    except OSError:
        return [], set(), set()

    all_users = set()
    all_models = set()
    rows = []

    for ts, event, params in reversed(raw):
        if ts and ts < cutoff_str:
            continue
        user = params.get("user", "-")
        model = params.get("model", "-")
        all_users.add(user)
        if model != "-":
            all_models.add(model)

        if user_filter and user != user_filter:
            continue
        if model_filter and model != model_filter:
            continue
        if event_filter and event != event_filter:
            continue

        # Build detail string per event type
        if event == "ai.request":
            detail = f"path={params.get('path', '-')}  stream={params.get('stream', '-')}"
        elif event == "ai.usage":
            detail = (
                f"입력 {params.get('prompt_tokens', '-')} 토큰 / "
                f"출력 {params.get('completion_tokens', '-')} 토큰 / "
                f"합계 {params.get('total_tokens', '-')} 토큰"
            )
        elif event == "ai.stream_done":
            detail = f"청크 {params.get('chunks', '-')}개"
        elif event == "ai.stream_error":
            detail = f"status={params.get('status', '-')}  body={params.get('body', '-')}"
        else:
            detail = ""

        rows.append({
            "ts": ts or "",
            "event": event,
            "event_label": _AI_EVENT_LABELS.get(event, event),
            "user": user,
            "model": model,
            "detail": detail,
        })

        if len(rows) >= limit:
            break

    return rows, all_users, all_models


def ai_usage_log_view(request):
    days = _parse_int(request.GET.get("days"), 7, 1, 90)
    per_page = _parse_int(request.GET.get("per_page"), AI_USAGE_PER_PAGE_DEFAULT, 10, AI_USAGE_PER_PAGE_MAX)
    page_number = _parse_int(request.GET.get("p"), 1, 1, 999999)
    user_filter = request.GET.get("user", "").strip() or None
    model_filter = request.GET.get("model", "").strip() or None
    event_filter = request.GET.get("event", "").strip() or None

    scan_limit = min(page_number * per_page, AI_USAGE_SCAN_MAX)
    rows, all_users, all_models = _load_ai_usage_rows(
        limit=scan_limit,
        days=days,
        user_filter=user_filter,
        model_filter=model_filter,
        event_filter=event_filter,
    )

    paginator = Paginator(rows, per_page)
    page_obj = paginator.get_page(page_number)

    query_params = request.GET.copy()
    query_params.pop("p", None)

    context = {
        **admin.site.each_context(request),
        "title": "AI API 사용 로그",
        "subtitle": None,
        "rows": page_obj.object_list,
        "page_obj": page_obj,
        "paginator": paginator,
        "is_paginated": page_obj.has_other_pages(),
        "days": days,
        "per_page": per_page,
        "base_query": query_params.urlencode(),
        "total_count": paginator.count,
        "all_users": sorted(all_users),
        "all_models": sorted(all_models),
        "all_events": sorted(_AI_EVENT_LABELS.keys()),
        "event_labels": _AI_EVENT_LABELS,
        "user_filter": user_filter or "",
        "model_filter": model_filter or "",
        "event_filter": event_filter or "",
    }
    return TemplateResponse(request, "admin/main/aiusage/ai_usage_log.html", context)


def _format_map_collab_timestamp(value):
    try:
        timestamp_ms = int(value)
    except (TypeError, ValueError):
        return ""
    if timestamp_ms <= 0:
        return ""
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.get_current_timezone())


def map_collab_sessions_view(request):
    admin_url = str(getattr(settings, "MAP_COLLAB_ADMIN_URL", "http://127.0.0.1:8084") or "http://127.0.0.1:8084").rstrip("/")
    rooms = []
    error_message = ""
    generated_at = None

    try:
        response = httpx.get(f"{admin_url}/rooms", timeout=2.0)
        response.raise_for_status()
        payload = response.json()
        generated_at = _format_map_collab_timestamp(payload.get("generated_at"))
        for room in payload.get("rooms") or []:
            clients = []
            for client in room.get("clients") or []:
                clients.append({
                    "user_id": str(client.get("userId") or ""),
                    "display_name": str(client.get("displayName") or ""),
                    "color": str(client.get("color") or ""),
                    "guest_num": client.get("guestNum"),
                    "joined_at": _format_map_collab_timestamp(client.get("joinedAt")),
                    "last_seen": _format_map_collab_timestamp(client.get("lastSeen")),
                    "connected_seconds": int(client.get("connectedSeconds") or 0),
                    "idle_seconds": int(client.get("idleSeconds") or 0),
                    "pending_draw_points": int(client.get("pendingDrawPoints") or 0),
                })
            rooms.append({
                "map_path": str(room.get("mapPath") or ""),
                "client_count": int(room.get("clientCount") or len(clients)),
                "stroke_count": int(room.get("strokeCount") or 0),
                "text_count": int(room.get("textCount") or 0),
                "last_active": _format_map_collab_timestamp(room.get("lastActive")),
                "idle_seconds": int(room.get("idleSeconds") or 0),
                "clients": clients,
            })
    except (httpx.HTTPError, ValueError) as exc:
        error_message = f"맵 협업 서버 상태를 불러오지 못했습니다: {exc}"

    total_clients = sum(room["client_count"] for room in rooms)
    context = {
        **admin.site.each_context(request),
        "title": "맵 협업 세션",
        "subtitle": None,
        "rooms": rooms,
        "room_count": len(rooms),
        "total_clients": total_clients,
        "generated_at": generated_at,
        "admin_url": admin_url,
        "error_message": error_message,
    }
    return TemplateResponse(request, "admin/main/map_collab/sessions.html", context)


# ---------------------------------------------------------------------------

_original_admin_get_urls = admin.site.get_urls


def _get_admin_urls():
    urls = _original_admin_get_urls()
    custom_urls = [
        path(
            "main/accesslog/",
            admin.site.admin_view(access_log_file_view),
            name="main_accesslog_changelist",
        ),
        path(
            "main/accesslog/download/<str:log_date>/",
            admin.site.admin_view(access_log_download_view),
            name="main_accesslog_download",
        ),
        path(
            "main/accesslog-summary/",
            admin.site.admin_view(access_log_summary_view),
            name="main_accesslog_summary_changelist",
        ),
        path(
            "main/accesslog-summary/download/<str:summary_date>/<str:file_type>/",
            admin.site.admin_view(access_log_summary_download_view),
            name="main_accesslog_summary_download",
        ),
        path(
            "main/accesslog-summary/<str:summary_date>/",
            admin.site.admin_view(access_log_summary_view),
            name="main_accesslog_summary_detail",
        ),
        path(
            "main/translation-audit/",
            admin.site.admin_view(translation_audit_view),
            name="main_translation_audit",
        ),
        path(
            "main/ai-usage/",
            admin.site.admin_view(ai_usage_log_view),
            name="main_ai_usage_changelist",
        ),
        path(
            "main/map-collab-sessions/",
            admin.site.admin_view(map_collab_sessions_view),
            name="main_map_collab_sessions",
        ),
    ]
    return custom_urls + urls


admin.site.get_urls = _get_admin_urls
