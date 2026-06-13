from __future__ import annotations

import re
import secrets

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


BYTES_PER_MB = 1024 * 1024
DEFAULT_ATTACHMENT_LIMIT_BYTES = 25 * BYTES_PER_MB
DEFAULT_DAILY_SEND_LIMIT = 100
LOCAL_PART_PATTERN = re.compile(r"^(?=.{1,64}$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$")
RESERVED_LOCAL_PARTS = {
    "abuse",
    "dmarc",
    "hostmaster",
    "mailer-daemon",
    "noreply",
    "postmaster",
    "root",
    "security",
    "support",
    "tlsrpt",
    "webmaster",
}


def get_default_domain() -> str:
    return str(getattr(settings, "HPMAIL_DOMAIN", "hanplanet.com") or "hanplanet.com").strip().lower()


def get_default_attachment_limit_bytes() -> int:
    return int(getattr(settings, "HPMAIL_DEFAULT_ATTACHMENT_LIMIT_BYTES", DEFAULT_ATTACHMENT_LIMIT_BYTES))


def get_default_daily_send_limit() -> int:
    return int(getattr(settings, "HPMAIL_DEFAULT_DAILY_SEND_LIMIT", DEFAULT_DAILY_SEND_LIMIT))


def normalize_local_part(value: str) -> str:
    return str(value or "").strip().lower()


def validate_local_part(value: str, *, allow_reserved: bool = False) -> str:
    local_part = normalize_local_part(value)
    if not local_part:
        raise ValidationError("메일 주소 ID를 입력해주세요.")
    if ".." in local_part:
        raise ValidationError("메일 주소 ID에는 연속된 점을 사용할 수 없습니다.")
    if not LOCAL_PART_PATTERN.match(local_part):
        raise ValidationError("메일 주소 ID는 영문 소문자, 숫자, 점, 하이픈, 밑줄만 사용할 수 있습니다.")
    if not allow_reserved and local_part in RESERVED_LOCAL_PARTS:
        raise ValidationError("시스템 예약 메일 주소는 사용자 계정으로 사용할 수 없습니다.")
    return local_part


class MailSitePolicy(models.Model):
    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True, editable=False)
    default_attachment_limit_bytes = models.BigIntegerField(
        "기본 첨부파일 제한(bytes)",
        default=get_default_attachment_limit_bytes,
        validators=[MinValueValidator(1)],
        help_text="사용자별 override가 없을 때 적용되는 첨부파일 총량 제한입니다.",
    )
    default_daily_send_limit = models.PositiveIntegerField(
        "기본 일일 발송 제한",
        default=get_default_daily_send_limit,
        validators=[MinValueValidator(1)],
        help_text="사용자별 override가 없을 때 적용되는 하루 발송 건수 제한입니다.",
    )
    max_recipients_per_message = models.PositiveIntegerField(
        "메일당 최대 수신자 수",
        default=50,
        validators=[MinValueValidator(1)],
    )
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "HPmail 기본 정책"
        verbose_name_plural = "HPmail 기본 정책"

    def save(self, *args, **kwargs):
        self.singleton_key = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls) -> "MailSitePolicy":
        policy, _ = cls.objects.get_or_create(singleton_key=1)
        return policy

    def __str__(self):
        return "HPmail 기본 정책"


class MailAccount(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="hpmail_account",
        verbose_name="사용자",
    )
    local_part = models.CharField("메일 주소 ID", max_length=64)
    domain = models.CharField("도메인", max_length=255, default=get_default_domain)
    is_enabled = models.BooleanField("사용 가능", default=True)
    external_clients_enabled = models.BooleanField(
        "외부 IMAP/SMTP 클라이언트 허용",
        default=False,
        help_text="웹메일 외부의 메일 클라이언트 접속 허용 여부입니다. 앱 비밀번호와 함께 사용합니다.",
    )
    attachment_limit_bytes = models.BigIntegerField(
        "사용자별 첨부파일 제한(bytes)",
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
        help_text="비워두면 HPmail 기본 정책을 따릅니다.",
    )
    daily_send_limit = models.PositiveIntegerField(
        "사용자별 일일 발송 제한",
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
        help_text="비워두면 HPmail 기본 정책을 따릅니다.",
    )
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "HPmail 계정"
        verbose_name_plural = "HPmail 계정"
        constraints = [
            models.UniqueConstraint(Lower("local_part"), Lower("domain"), name="unique_hpmail_account_address_ci"),
        ]
        indexes = [
            models.Index(fields=["user"]),
            models.Index(fields=["local_part", "domain"]),
        ]

    def clean(self):
        self.local_part = validate_local_part(self.local_part, allow_reserved=False)
        self.domain = str(self.domain or get_default_domain()).strip().lower()
        if not self.domain or "." not in self.domain:
            raise ValidationError({"domain": "올바른 메일 도메인을 입력해주세요."})
        if MailAlias.objects.filter(local_part__iexact=self.local_part, domain__iexact=self.domain).exists():
            raise ValidationError({"local_part": "이미 HPmail 별칭으로 사용 중인 주소입니다."})

    def save(self, *args, **kwargs):
        self.local_part = normalize_local_part(self.local_part)
        self.domain = str(self.domain or get_default_domain()).strip().lower()
        super().save(*args, **kwargs)

    @property
    def email_address(self) -> str:
        return f"{self.local_part}@{self.domain}"

    @property
    def storage_key(self) -> str:
        return f"{self.domain}/{self.local_part}"

    def effective_attachment_limit_bytes(self) -> int:
        if self.attachment_limit_bytes:
            return int(self.attachment_limit_bytes)
        return int(MailSitePolicy.get_solo().default_attachment_limit_bytes)

    def effective_daily_send_limit(self) -> int:
        if self.daily_send_limit:
            return int(self.daily_send_limit)
        return int(MailSitePolicy.get_solo().default_daily_send_limit)

    def __str__(self):
        return self.email_address


class MailAlias(models.Model):
    local_part = models.CharField("별칭 주소 ID", max_length=64)
    domain = models.CharField("도메인", max_length=255, default=get_default_domain)
    target_account = models.ForeignKey(
        MailAccount,
        on_delete=models.CASCADE,
        related_name="aliases",
        verbose_name="전달 대상 계정",
    )
    is_enabled = models.BooleanField("사용 가능", default=True)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "HPmail 별칭"
        verbose_name_plural = "HPmail 별칭"
        constraints = [
            models.UniqueConstraint(Lower("local_part"), Lower("domain"), name="unique_hpmail_alias_address_ci"),
        ]
        indexes = [models.Index(fields=["local_part", "domain"])]

    def clean(self):
        self.local_part = validate_local_part(self.local_part, allow_reserved=True)
        self.domain = str(self.domain or get_default_domain()).strip().lower()
        if MailAccount.objects.filter(local_part__iexact=self.local_part, domain__iexact=self.domain).exists():
            raise ValidationError({"local_part": "이미 HPmail 계정으로 사용 중인 주소입니다."})
        if self.target_account and self.target_account.local_part == self.local_part and self.target_account.domain == self.domain:
            raise ValidationError("자기 자신과 같은 주소는 별칭으로 만들 수 없습니다.")

    def save(self, *args, **kwargs):
        self.local_part = normalize_local_part(self.local_part)
        self.domain = str(self.domain or get_default_domain()).strip().lower()
        super().save(*args, **kwargs)

    @property
    def email_address(self) -> str:
        return f"{self.local_part}@{self.domain}"

    def __str__(self):
        return f"{self.email_address} -> {self.target_account.email_address}"


class MailAppPassword(models.Model):
    account = models.ForeignKey(
        MailAccount,
        on_delete=models.CASCADE,
        related_name="app_passwords",
        verbose_name="메일 계정",
    )
    name = models.CharField("이름", max_length=80)
    token_prefix = models.CharField("토큰 앞부분", max_length=12, db_index=True)
    token_hash = models.CharField("토큰 해시", max_length=255)
    is_active = models.BooleanField("사용 가능", default=True)
    last_used_at = models.DateTimeField("마지막 사용일", null=True, blank=True)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    revoked_at = models.DateTimeField("폐기일", null=True, blank=True)

    class Meta:
        verbose_name = "HPmail 앱 비밀번호"
        verbose_name_plural = "HPmail 앱 비밀번호"
        indexes = [models.Index(fields=["account", "is_active"])]

    @classmethod
    def issue(cls, account: MailAccount, name: str) -> tuple["MailAppPassword", str]:
        raw_token = "hp_" + secrets.token_urlsafe(30)
        obj = cls.objects.create(
            account=account,
            name=name,
            token_prefix=raw_token[:10],
            token_hash=make_password(raw_token),
        )
        return obj, raw_token

    def verify(self, raw_token: str) -> bool:
        if not self.is_active:
            return False
        return check_password(raw_token, self.token_hash)

    def mark_used(self):
        self.last_used_at = timezone.now()
        self.save(update_fields=["last_used_at"])

    def revoke(self):
        self.is_active = False
        self.revoked_at = timezone.now()
        self.save(update_fields=["is_active", "revoked_at"])

    def __str__(self):
        return f"{self.account.email_address} / {self.name}"


class MailDailySendCounter(models.Model):
    account = models.ForeignKey(
        MailAccount,
        on_delete=models.CASCADE,
        related_name="daily_send_counters",
        verbose_name="메일 계정",
    )
    date = models.DateField("날짜")
    sent_count = models.PositiveIntegerField("발송 건수", default=0)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "HPmail 일일 발송량"
        verbose_name_plural = "HPmail 일일 발송량"
        constraints = [
            models.UniqueConstraint(fields=["account", "date"], name="unique_hpmail_daily_send_counter"),
        ]
        indexes = [models.Index(fields=["date"])]

    def __str__(self):
        return f"{self.account.email_address} {self.date}: {self.sent_count}"


class MailMessageIndex(models.Model):
    account = models.ForeignKey(
        MailAccount,
        on_delete=models.CASCADE,
        related_name="message_indexes",
        verbose_name="메일 계정",
    )
    mailbox = models.CharField("메일함", max_length=255, default="INBOX")
    uid = models.CharField("IMAP UID", max_length=64)
    message_id = models.CharField("Message-ID", max_length=255, blank=True, default="")
    subject = models.CharField("제목", max_length=500, blank=True, default="")
    sender = models.CharField("보낸 사람", max_length=500, blank=True, default="")
    recipients = models.JSONField("받는 사람", default=list, blank=True)
    sent_at = models.DateTimeField("발송 시각", null=True, blank=True)
    received_at = models.DateTimeField("수신 시각", null=True, blank=True)
    size_bytes = models.BigIntegerField("크기(bytes)", default=0)
    has_attachments = models.BooleanField("첨부 있음", default=False)
    flags = models.JSONField("IMAP 플래그", default=list, blank=True)
    indexed_at = models.DateTimeField("색인일", auto_now=True)

    class Meta:
        verbose_name = "HPmail 메시지 색인"
        verbose_name_plural = "HPmail 메시지 색인"
        constraints = [
            models.UniqueConstraint(fields=["account", "mailbox", "uid"], name="unique_hpmail_message_uid"),
        ]
        indexes = [
            models.Index(fields=["account", "mailbox", "received_at"]),
            models.Index(fields=["message_id"]),
        ]

    def __str__(self):
        return f"{self.account.email_address}/{self.mailbox}/{self.uid}"
