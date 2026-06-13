from __future__ import annotations

import json
from urllib.parse import quote

from django.conf import settings
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.urls import reverse
from django.views.decorators.http import require_GET, require_POST

from main.views import apply_ui_context, get_account_display_name, resolve_ui_lang
from portfolio.models import PortfolioProfile

from .imap_client import (
    HPmailImapClient,
    HPmailImapError,
    HPmailNotConfigured,
    canonical_mailbox_name,
    is_system_mailbox,
    validate_custom_mailbox_name,
)
from .models import MailSitePolicy
from .services import (
    HPmailPolicyError,
    calculate_user_mail_usage,
    ensure_mail_account_for_user,
    format_bytes,
    get_today_send_count,
)
from .smtp_client import HPmailSmtpError, parse_recipient_list, send_user_message


def _login_redirect(request, ui_lang: str):
    next_path = quote(request.get_full_path() or f"/{ui_lang}/Email", safe="/:?=&")
    return redirect(f"{reverse('main:handrive_login_lang', kwargs={'ui_lang': ui_lang})}?next={next_path}")


def _api_error(message: str, *, status=400, code="error"):
    return JsonResponse({"ok": False, "error": {"code": code, "message": message}}, status=status)


def _api_unavailable(message: str, *, code="imap_unavailable"):
    return JsonResponse({"ok": False, "error": {"code": code, "message": message}}, status=200)


def _json_body(request) -> dict:
    if request.content_type and "application/json" in request.content_type:
        try:
            return json.loads(request.body.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}
    return request.POST


def _get_account_or_response(request):
    if not request.user.is_authenticated:
        return None, _api_error("로그인이 필요합니다.", status=403, code="login_required")
    try:
        return ensure_mail_account_for_user(request.user), None
    except ValidationError as exc:
        return None, _api_error("; ".join(exc.messages), status=400, code="account_invalid")


def email_redirect(request):
    ui_lang = resolve_ui_lang(request)
    return redirect(reverse("hpmail:email_page_lang", kwargs={"ui_lang": ui_lang}))


def email_lower_redirect(request, ui_lang=None):
    resolved_lang = resolve_ui_lang(request, ui_lang)
    return redirect(reverse("hpmail:email_page_lang", kwargs={"ui_lang": resolved_lang}))


def email_page(request, ui_lang=None):
    resolved_lang = resolve_ui_lang(request, ui_lang)
    if not request.user.is_authenticated:
        return _login_redirect(request, resolved_lang)

    account_error = ""
    try:
        account = ensure_mail_account_for_user(request.user)
    except ValidationError as exc:
        account = None
        account_error = "; ".join(exc.messages)
    mail_used_bytes, mail_entry_count = calculate_user_mail_usage(request.user)
    policy = MailSitePolicy.get_solo()
    context = {
        "meta_title": "HPmail",
        "meta_og_title": "HPmail",
        "meta_description": "Hanplanet webmail",
        "meta_og_description": "Hanplanet webmail",
        "hpmail_account": account,
        "hpmail_account_error": account_error,
        "hpmail_email_address": account.email_address if account else "HPmail",
        "hpmail_attachment_limit_display": format_bytes(account.effective_attachment_limit_bytes() if account else policy.default_attachment_limit_bytes),
        "hpmail_daily_send_limit": account.effective_daily_send_limit() if account else policy.default_daily_send_limit,
        "hpmail_today_send_count": get_today_send_count(account) if account else 0,
        "hpmail_mail_used_display": format_bytes(mail_used_bytes),
        "hpmail_mail_entry_count": mail_entry_count,
        "hpmail_imap_configured": bool(
            str(getattr(settings, "HPMAIL_IMAP_MASTER_USER", "") or "").strip()
            and str(getattr(settings, "HPMAIL_IMAP_MASTER_PASSWORD", "") or "").strip()
        ),
        "hpmail_api_mailboxes_url": reverse("hpmail:api_mailboxes"),
        "hpmail_api_mailbox_create_url": reverse("hpmail:api_mailbox_create"),
        "hpmail_api_mailbox_rename_url": reverse("hpmail:api_mailbox_rename"),
        "hpmail_api_mailbox_delete_url": reverse("hpmail:api_mailbox_delete"),
        "hpmail_api_messages_url": reverse("hpmail:api_messages"),
        "hpmail_api_message_detail_url": reverse("hpmail:api_message_detail"),
        "hpmail_api_send_url": reverse("hpmail:api_send"),
        "hpmail_api_flags_url": reverse("hpmail:api_message_flags"),
        "hpmail_api_move_url": reverse("hpmail:api_message_move"),
        "hpmail_api_delete_url": reverse("hpmail:api_message_delete"),
        "hpmail_api_quota_url": reverse("hpmail:api_quota"),
    }
    apply_ui_context(request, context, resolved_lang)
    if request.user.is_authenticated:
        portfolio_profile = PortfolioProfile.objects.filter(user=request.user).only("profile_img").first()
        context["account_display_name"] = get_account_display_name(request.user)
        context["account_profile_image_url"] = (
            portfolio_profile.profile_img.url if portfolio_profile and portfolio_profile.profile_img else ""
        )
        context["account_email"] = str(request.user.email or "").strip()
        context["account_profile_upload_url"] = reverse(
            "main:account_profile_image_upload_lang",
            kwargs={"ui_lang": resolved_lang},
        )
        context["account_my_portfolio_url"] = reverse(
            "main:portfolio_user_lang",
            kwargs={"ui_lang": resolved_lang, "user_id": request.user.username},
        )
        context["account_logout_form_id"] = "auth-logout-form-hpmail"
        context["account_logout_next"] = request.get_full_path() or reverse(
            "hpmail:email_page_lang", kwargs={"ui_lang": resolved_lang}
        )
        context["account_logout_url"] = reverse("main:handrive_logout_lang", kwargs={"ui_lang": resolved_lang})
    return render(request, "hpmail/email.html", context)


@require_GET
def api_mailboxes(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    try:
        with HPmailImapClient(account) as imap:
            return JsonResponse({"ok": True, "mailboxes": imap.list_mailboxes()})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_POST
def api_mailbox_create(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    data = _json_body(request)
    try:
        mailbox_name = validate_custom_mailbox_name(data.get("name") or "")
    except ValidationError as exc:
        return _api_error("; ".join(exc.messages), code="invalid_mailbox_name")
    try:
        with HPmailImapClient(account) as imap:
            mailbox = imap.create_mailbox(mailbox_name)
        return JsonResponse({"ok": True, "mailbox": mailbox})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_POST
def api_mailbox_rename(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    data = _json_body(request)
    mailbox = str(data.get("mailbox") or "").strip()
    if not mailbox:
        return _api_error("변경할 메일함이 필요합니다.", code="missing_mailbox")
    if is_system_mailbox(mailbox):
        return _api_error("기본 메일함은 이름을 변경할 수 없습니다.", code="system_mailbox")
    try:
        new_name = validate_custom_mailbox_name(data.get("name") or "")
    except ValidationError as exc:
        return _api_error("; ".join(exc.messages), code="invalid_mailbox_name")
    try:
        with HPmailImapClient(account) as imap:
            renamed_mailbox = imap.rename_mailbox(mailbox, new_name)
        return JsonResponse({"ok": True, "old_mailbox": mailbox, "mailbox": renamed_mailbox})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_POST
def api_mailbox_delete(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    data = _json_body(request)
    mailbox = str(data.get("mailbox") or "").strip()
    if not mailbox:
        return _api_error("삭제할 메일함이 필요합니다.", code="missing_mailbox")
    if is_system_mailbox(mailbox):
        return _api_error("기본 메일함은 삭제할 수 없습니다.", code="system_mailbox")
    try:
        with HPmailImapClient(account) as imap:
            result = imap.delete_custom_mailbox(mailbox, "Drafts")
        return JsonResponse({"ok": True, **result})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_GET
def api_messages(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    mailbox = request.GET.get("mailbox") or "INBOX"
    try:
        limit = min(100, max(1, int(request.GET.get("limit", "50"))))
        offset = max(0, int(request.GET.get("offset", "0")))
    except ValueError:
        return _api_error("잘못된 페이징 값입니다.", code="invalid_pagination")
    try:
        with HPmailImapClient(account) as imap:
            payload = imap.list_messages(mailbox, limit=limit, offset=offset)
            return JsonResponse({"ok": True, **payload})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_GET
def api_message_detail(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    mailbox = request.GET.get("mailbox") or "INBOX"
    uid = str(request.GET.get("uid") or "").strip()
    if not uid:
        return _api_error("메시지 UID가 필요합니다.", code="missing_uid")
    try:
        with HPmailImapClient(account) as imap:
            return JsonResponse({"ok": True, "message": imap.get_message(mailbox, uid)})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_POST
def api_send(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    data = request.POST
    to = parse_recipient_list(data.get("to", ""))
    cc = parse_recipient_list(data.get("cc", ""))
    bcc = parse_recipient_list(data.get("bcc", ""))
    try:
        result = send_user_message(
            account,
            to=to,
            cc=cc,
            bcc=bcc,
            subject=str(data.get("subject", "") or ""),
            body_text=str(data.get("body_text", "") or ""),
            body_html=str(data.get("body_html", "") or ""),
            attachments=request.FILES.getlist("attachments"),
        )
        return JsonResponse({"ok": True, **result, "today_send_count": get_today_send_count(account)})
    except HPmailPolicyError as exc:
        return _api_error(str(exc), status=400, code=exc.code)
    except HPmailSmtpError as exc:
        return _api_error(str(exc), status=502, code="smtp_error")


@require_POST
def api_message_flags(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    data = _json_body(request)
    mailbox = data.get("mailbox") or "INBOX"
    uid = str(data.get("uid") or "").strip()
    if not uid:
        return _api_error("메시지 UID가 필요합니다.", code="missing_uid")
    try:
        with HPmailImapClient(account) as imap:
            imap.set_seen(mailbox, uid, bool(data.get("seen", True)))
        return JsonResponse({"ok": True})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_POST
def api_message_move(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    data = _json_body(request)
    mailbox = data.get("mailbox") or "INBOX"
    destination = str(data.get("destination") or "").strip()
    uid = str(data.get("uid") or "").strip()
    if not uid or not destination:
        return _api_error("메시지 UID와 이동 대상 메일함이 필요합니다.", code="missing_move_target")
    source_kind = canonical_mailbox_name(mailbox)
    destination_kind = canonical_mailbox_name(destination)
    if source_kind == "SENT" and destination_kind == "INBOX":
        return _api_error("보낸 메일은 받은 메일함으로 이동할 수 없습니다.", code="invalid_message_move")
    if source_kind == "INBOX" and destination_kind == "SENT":
        return _api_error("받은 메일은 보낸 메일함으로 이동할 수 없습니다.", code="invalid_message_move")
    try:
        with HPmailImapClient(account) as imap:
            imap.move_message(mailbox, uid, destination)
        return JsonResponse({"ok": True})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_POST
def api_message_delete(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    data = _json_body(request)
    mailbox = data.get("mailbox") or "INBOX"
    uid = str(data.get("uid") or "").strip()
    if not uid:
        return _api_error("메시지 UID가 필요합니다.", code="missing_uid")
    try:
        with HPmailImapClient(account) as imap:
            imap.delete_message(mailbox, uid)
        return JsonResponse({"ok": True})
    except HPmailNotConfigured as exc:
        return _api_unavailable(str(exc), code="imap_not_configured")
    except HPmailImapError as exc:
        return _api_unavailable(str(exc), code="imap_error")


@require_GET
def api_quota(request):
    account, error = _get_account_or_response(request)
    if error:
        return error
    mail_used_bytes, mail_entry_count = calculate_user_mail_usage(request.user)
    try:
        from main.handrive_views import get_user_handrive_quota_bytes
        quota_bytes = get_user_handrive_quota_bytes(request.user)
    except Exception:
        quota_bytes = None
    return JsonResponse({
        "ok": True,
        "email_address": account.email_address,
        "mail_used_bytes": mail_used_bytes,
        "mail_used_display": format_bytes(mail_used_bytes),
        "mail_entry_count": mail_entry_count,
        "shared_quota_bytes": quota_bytes,
        "shared_quota_display": format_bytes(quota_bytes) if quota_bytes is not None else "",
        "attachment_limit_bytes": account.effective_attachment_limit_bytes(),
        "attachment_limit_display": format_bytes(account.effective_attachment_limit_bytes()),
        "daily_send_limit": account.effective_daily_send_limit(),
        "today_send_count": get_today_send_count(account),
    })
