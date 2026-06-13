from django import forms
from django.contrib import admin

from .models import (
    BYTES_PER_MB,
    MailAccount,
    MailAlias,
    MailAppPassword,
    MailDailySendCounter,
    MailMessageIndex,
    MailSitePolicy,
)


def _bytes_to_mb(value):
    if value in (None, ""):
        return None
    return round(int(value) / BYTES_PER_MB, 4)


def _mb_to_bytes(value):
    if value in (None, ""):
        return None
    return int(float(value) * BYTES_PER_MB)


class MailSitePolicyForm(forms.ModelForm):
    default_attachment_limit_mb = forms.FloatField(
        label="기본 첨부파일 제한(MB)",
        min_value=0.01,
        help_text="예: 25 = 25MB",
    )

    class Meta:
        model = MailSitePolicy
        fields = ["default_attachment_limit_mb", "default_daily_send_limit", "max_recipients_per_message"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk:
            self.fields["default_attachment_limit_mb"].initial = _bytes_to_mb(
                self.instance.default_attachment_limit_bytes
            )

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.default_attachment_limit_bytes = _mb_to_bytes(self.cleaned_data["default_attachment_limit_mb"])
        if commit:
            instance.save()
        return instance


@admin.register(MailSitePolicy)
class MailSitePolicyAdmin(admin.ModelAdmin):
    form = MailSitePolicyForm
    list_display = ["__str__", "attachment_limit_display", "default_daily_send_limit", "max_recipients_per_message", "updated_at"]

    def has_add_permission(self, request):
        return not MailSitePolicy.objects.exists()

    @admin.display(description="기본 첨부 제한")
    def attachment_limit_display(self, obj):
        return f"{_bytes_to_mb(obj.default_attachment_limit_bytes):g} MB"


class MailAccountForm(forms.ModelForm):
    attachment_limit_mb = forms.FloatField(
        label="사용자별 첨부파일 제한(MB)",
        min_value=0.01,
        required=False,
        help_text="비워두면 HPmail 기본 정책을 사용합니다.",
    )

    class Meta:
        model = MailAccount
        fields = [
            "user",
            "local_part",
            "domain",
            "is_enabled",
            "external_clients_enabled",
            "attachment_limit_mb",
            "daily_send_limit",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and self.instance.pk and self.instance.attachment_limit_bytes:
            self.fields["attachment_limit_mb"].initial = _bytes_to_mb(self.instance.attachment_limit_bytes)

    def save(self, commit=True):
        instance = super().save(commit=False)
        instance.attachment_limit_bytes = _mb_to_bytes(self.cleaned_data.get("attachment_limit_mb"))
        if commit:
            instance.save()
            self.save_m2m()
        return instance


@admin.register(MailAccount)
class MailAccountAdmin(admin.ModelAdmin):
    form = MailAccountForm
    list_display = [
        "email_address",
        "user",
        "is_enabled",
        "external_clients_enabled",
        "effective_attachment_limit_display",
        "effective_daily_send_limit_display",
        "updated_at",
    ]
    list_filter = ["is_enabled", "external_clients_enabled", "domain"]
    search_fields = ["local_part", "domain", "user__username", "user__email"]
    readonly_fields = ["email_address", "created_at", "updated_at"]
    ordering = ["domain", "local_part"]

    @admin.display(description="이메일 주소")
    def email_address(self, obj):
        return obj.email_address

    @admin.display(description="적용 첨부 제한")
    def effective_attachment_limit_display(self, obj):
        source = "custom" if obj.attachment_limit_bytes else "default"
        return f"{_bytes_to_mb(obj.effective_attachment_limit_bytes()):g} MB ({source})"

    @admin.display(description="적용 일일 발송 제한")
    def effective_daily_send_limit_display(self, obj):
        source = "custom" if obj.daily_send_limit else "default"
        return f"{obj.effective_daily_send_limit():,}건 ({source})"


@admin.register(MailAlias)
class MailAliasAdmin(admin.ModelAdmin):
    list_display = ["email_address", "target_account", "is_enabled", "updated_at"]
    list_filter = ["is_enabled", "domain"]
    search_fields = ["local_part", "domain", "target_account__local_part", "target_account__user__username"]
    ordering = ["domain", "local_part"]

    @admin.display(description="별칭 주소")
    def email_address(self, obj):
        return obj.email_address


@admin.register(MailAppPassword)
class MailAppPasswordAdmin(admin.ModelAdmin):
    list_display = ["account", "name", "token_prefix", "is_active", "last_used_at", "created_at", "revoked_at"]
    list_filter = ["is_active", "created_at"]
    search_fields = ["account__local_part", "account__user__username", "name", "token_prefix"]
    readonly_fields = ["token_prefix", "token_hash", "last_used_at", "created_at", "revoked_at"]
    ordering = ["-created_at"]


@admin.register(MailDailySendCounter)
class MailDailySendCounterAdmin(admin.ModelAdmin):
    list_display = ["account", "date", "sent_count", "updated_at"]
    list_filter = ["date"]
    search_fields = ["account__local_part", "account__user__username"]
    readonly_fields = ["created_at", "updated_at"]
    ordering = ["-date", "account__local_part"]


@admin.register(MailMessageIndex)
class MailMessageIndexAdmin(admin.ModelAdmin):
    list_display = ["account", "mailbox", "uid", "subject", "sender", "received_at", "size_bytes", "has_attachments"]
    list_filter = ["mailbox", "has_attachments", "received_at"]
    search_fields = ["account__local_part", "message_id", "subject", "sender"]
    readonly_fields = ["indexed_at"]
    ordering = ["account__local_part", "mailbox", "-received_at"]
