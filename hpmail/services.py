from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from .models import MailAccount, MailDailySendCounter, MailSitePolicy, normalize_local_part, validate_local_part


class HPmailPolicyError(ValueError):
    def __init__(self, message: str, *, code: str = "policy_error"):
        super().__init__(message)
        self.code = code


def format_bytes(byte_count: int) -> str:
    gb = 1024 ** 3
    mb = 1024 ** 2
    kb = 1024
    if byte_count >= gb:
        return f"{byte_count / gb:g} GB" if byte_count % gb == 0 else f"{round(byte_count / gb, 1):g} GB"
    if byte_count >= mb:
        return f"{byte_count / mb:g} MB" if byte_count % mb == 0 else f"{round(byte_count / mb, 1):g} MB"
    if byte_count >= kb:
        return f"{byte_count / kb:g} KB" if byte_count % kb == 0 else f"{round(byte_count / kb, 1):g} KB"
    return f"{byte_count} B"


def get_storage_root() -> Path:
    configured = str(getattr(settings, "HPMAIL_STORAGE_ROOT", "") or "").strip()
    if configured:
        return Path(configured)
    return Path(settings.MEDIA_ROOT).resolve().parent / "mail"


def get_account_storage_path(account: MailAccount) -> Path:
    return get_storage_root() / account.domain / account.local_part


def ensure_account_maildir(account: MailAccount) -> Path:
    maildir_path = get_account_storage_path(account) / "Maildir"
    for mailbox_path in (
        maildir_path,
        maildir_path / ".Drafts",
        maildir_path / ".Sent",
        maildir_path / ".Trash",
        maildir_path / ".Junk",
    ):
        for child_name in ("cur", "new", "tmp"):
            (mailbox_path / child_name).mkdir(parents=True, exist_ok=True)
    return maildir_path


def calculate_path_usage(root_path: Path) -> tuple[int, int]:
    total_bytes = 0
    total_entries = 0
    if not root_path.exists():
        return total_bytes, total_entries
    for current_root, dir_names, file_names in os.walk(root_path):
        total_entries += len(dir_names) + len(file_names)
        for filename in file_names:
            try:
                total_bytes += (Path(current_root) / filename).stat().st_size
            except OSError:
                continue
    return total_bytes, total_entries


def calculate_account_mail_usage(account: MailAccount) -> tuple[int, int]:
    return calculate_path_usage(get_account_storage_path(account))


def calculate_user_mail_usage(user) -> tuple[int, int]:
    try:
        account = user.hpmail_account
    except Exception:
        return 0, 0
    return calculate_account_mail_usage(account)


def ensure_mail_account_for_user(user) -> MailAccount:
    if not (user and user.is_authenticated):
        raise ValidationError("로그인이 필요합니다.")
    try:
        account = user.hpmail_account
    except MailAccount.DoesNotExist:
        local_part = validate_local_part(normalize_local_part(user.get_username()), allow_reserved=False)
        account = MailAccount.objects.create(user=user, local_part=local_part)
    ensure_account_maildir(account)
    return account


def get_today_send_count(account: MailAccount) -> int:
    counter = MailDailySendCounter.objects.filter(account=account, date=timezone.localdate()).first()
    return int(counter.sent_count) if counter else 0


def assert_account_can_send(
    account: MailAccount,
    *,
    attachment_sizes: Iterable[int] = (),
    recipient_count: int = 1,
    message_count: int = 1,
) -> None:
    if not account.is_enabled:
        raise HPmailPolicyError("메일 계정이 비활성화되어 있습니다.", code="account_disabled")

    policy = MailSitePolicy.get_solo()
    if recipient_count < 1:
        raise HPmailPolicyError("수신자를 입력해주세요.", code="missing_recipients")
    if recipient_count > policy.max_recipients_per_message:
        raise HPmailPolicyError(
            f"메일당 수신자는 최대 {policy.max_recipients_per_message:,}명까지 가능합니다.",
            code="too_many_recipients",
        )

    attachment_total = sum(max(0, int(size or 0)) for size in attachment_sizes)
    attachment_limit = account.effective_attachment_limit_bytes()
    if attachment_total > attachment_limit:
        raise HPmailPolicyError(
            f"첨부파일 총량은 최대 {format_bytes(attachment_limit)}까지 가능합니다.",
            code="attachment_limit_exceeded",
        )

    daily_limit = account.effective_daily_send_limit()
    current_count = get_today_send_count(account)
    if current_count + message_count > daily_limit:
        raise HPmailPolicyError(
            f"일일 발송 제한 {daily_limit:,}건을 초과했습니다.",
            code="daily_send_limit_exceeded",
        )


def record_sent_messages(account: MailAccount, *, message_count: int = 1) -> MailDailySendCounter:
    with transaction.atomic():
        counter, _ = MailDailySendCounter.objects.select_for_update().get_or_create(
            account=account,
            date=timezone.localdate(),
            defaults={"sent_count": 0},
        )
        counter.sent_count += max(1, int(message_count))
        counter.save(update_fields=["sent_count", "updated_at"])
        return counter
