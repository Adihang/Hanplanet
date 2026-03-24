from django.conf import settings
from django.contrib.auth.models import Group
from django.db import models


class OrderField(models.PositiveIntegerField):
    """기존 migrations 호환용 — 실제 사용은 portfolio/stratagem 앱에서."""
    def __init__(self, *args, **kwargs):
        kwargs["blank"] = True
        kwargs["null"] = True
        super().__init__(*args, **kwargs)


# 기존 migrations 호환용 upload 함수들
def upload_to_project(instance, filename):
    from portfolio.models import upload_to_project as _f
    return _f(instance, filename)

def upload_to_portfolio_profile(instance, filename):
    from portfolio.models import upload_to_portfolio_profile as _f
    return _f(instance, filename)

def upload_to_portfolio_project(instance, filename):
    from portfolio.models import upload_to_portfolio_project as _f
    return _f(instance, filename)

def upload_stratagem(instance, filename):
    from stratagem.models import upload_stratagem as _f
    return _f(instance, filename)

def upload_Disciple_icon(instance, filename):
    from stratagem.models import upload_disciple_icon as _f
    return _f(instance, filename)


class NavLink(models.Model):
    order = models.IntegerField("순서", default=0)
    name = models.CharField("표시이름", max_length=100)
    url = models.CharField("이동 경로", max_length=500)

    class Meta:
        ordering = ["order", "id"]
        permissions = [
            ("can_edit_docs", "Can edit HanDrive content"),
        ]

    def __str__(self):
        return f"{self.order}. {self.name}"


class HandriveAccessRule(models.Model):
    path = models.CharField(
        "경로",
        max_length=1024,
        unique=True,
        blank=True,
        default="",
        help_text="/handrive 기준 상대 경로. 비우면 /handrive 루트",
    )
    read_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="HandriveAccessRuleReadUser",
        verbose_name="읽기 허용 사용자",
        blank=True,
        related_name="handrive_read_access_rules",
    )
    read_groups = models.ManyToManyField(
        Group,
        through="HandriveAccessRuleReadGroup",
        verbose_name="읽기 허용 그룹",
        blank=True,
        related_name="handrive_read_access_rules",
    )
    write_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="HandriveAccessRuleWriteUser",
        verbose_name="쓰기 허용 사용자",
        blank=True,
        related_name="handrive_write_access_rules",
    )
    write_groups = models.ManyToManyField(
        Group,
        through="HandriveAccessRuleWriteGroup",
        verbose_name="쓰기 허용 그룹",
        blank=True,
        related_name="handrive_write_access_rules",
    )
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        ordering = ["path"]
        db_table = "main_docsaccessrule"
        verbose_name = "HanDrive 접근 규칙"
        verbose_name_plural = "HanDrive 접근 규칙"

    def __str__(self):
        return self.path or "/handrive"


class HandriveAccessRuleReadUser(models.Model):
    handrive_access_rule = models.ForeignKey(
        HandriveAccessRule,
        on_delete=models.CASCADE,
        db_column="docsaccessrule_id",
    )
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        db_table = "main_docsaccessrule_read_users"
        managed = False


class HandriveAccessRuleReadGroup(models.Model):
    handrive_access_rule = models.ForeignKey(
        HandriveAccessRule,
        on_delete=models.CASCADE,
        db_column="docsaccessrule_id",
    )
    group = models.ForeignKey(Group, on_delete=models.CASCADE)

    class Meta:
        db_table = "main_docsaccessrule_read_groups"
        managed = False


class HandriveAccessRuleWriteUser(models.Model):
    handrive_access_rule = models.ForeignKey(
        HandriveAccessRule,
        on_delete=models.CASCADE,
        db_column="docsaccessrule_id",
    )
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    class Meta:
        db_table = "main_docsaccessrule_write_users"
        managed = False


class HandriveAccessRuleWriteGroup(models.Model):
    handrive_access_rule = models.ForeignKey(
        HandriveAccessRule,
        on_delete=models.CASCADE,
        db_column="docsaccessrule_id",
    )
    group = models.ForeignKey(Group, on_delete=models.CASCADE)

    class Meta:
        db_table = "main_docsaccessrule_write_groups"
        managed = False


class HandriveSharedLink(models.Model):
    path = models.CharField(
        "문서 경로",
        max_length=1024,
        unique=True,
        help_text="/handrive 기준 상대 파일 경로",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="handrive_shared_links",
        verbose_name="공유 생성 사용자",
    )
    share_slug = models.CharField("공유 슬러그", max_length=255)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        ordering = ["owner__username", "share_slug"]
        verbose_name = "문서 공유 링크"
        verbose_name_plural = "문서 공유 링크"
        db_table = "main_docssharedlink"
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "share_slug"],
                name="unique_docs_shared_link_owner_slug",
            )
        ]

    def __str__(self):
        return f"{self.owner.username}/{self.share_slug}"


class HandriveLoginAttemptGuard(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="handrive_login_attempt_guard",
        verbose_name="사용자",
    )
    failed_attempts = models.PositiveIntegerField("연속 로그인 실패 횟수", default=0)
    captcha_required = models.BooleanField("캡챠 필요 여부", default=False)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        db_table = "main_docsloginattemptguard"
        verbose_name = "HanDrive 로그인 보호 상태"
        verbose_name_plural = "HanDrive 로그인 보호 상태"


class HandriveUserQuota(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="handrive_quota",
        verbose_name="사용자",
    )
    quota_bytes = models.BigIntegerField(
        "저장 용량 (bytes)",
        help_text="사용자별 최대 저장 용량. 예: 1GB = 1073741824, 5GB = 5368709120",
    )

    class Meta:
        verbose_name = "HanDrive 사용자 저장 용량"
        verbose_name_plural = "HanDrive 사용자 저장 용량"

    def __str__(self):
        gb = self.quota_bytes / (1024 ** 3)
        return f"{self.user.username} — {gb:.2f} GB ({self.quota_bytes:,} bytes)"


class QuickLink(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="quick_links",
        verbose_name="사용자",
    )
    name = models.CharField("이름", max_length=80)
    url = models.URLField("URL", max_length=500)
    icon_url = models.URLField("아이콘 URL", max_length=500, blank=True, default="")
    display_order = models.PositiveIntegerField("표시 순서", default=0)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        ordering = ["display_order", "id"]
        verbose_name = "루트 바로가기"
        verbose_name_plural = "루트 바로가기"

    def __str__(self):
        return f"{self.user}: {self.name}"


class UserProfile(models.Model):
    THEME_LIGHT = "light"
    THEME_DARK = "dark"
    THEME_MODE_CHOICES = [
        (THEME_LIGHT, "라이트"),
        (THEME_DARK, "다크"),
    ]
    UI_LANG_CHOICES = [
        ("ko", "한국어"),
        ("en", "English"),
    ]
    ROOT_SEARCH_ENGINE_CHOICES = [
        ("google", "Google"),
        ("youtube", "YouTube"),
        ("duckduckgo", "DuckDuckGo"),
        ("bing", "Bing"),
        ("naver", "Naver"),
        ("gpt", "GPT"),
        ("claude", "Claude"),
        ("gemini", "Gemini"),
    ]

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
        verbose_name="사용자",
    )
    theme_mode = models.CharField(
        "테마 모드",
        max_length=5,
        choices=THEME_MODE_CHOICES,
        blank=True,
        default="",
    )
    preferred_ui_lang = models.CharField(
        "선호 언어",
        max_length=2,
        choices=UI_LANG_CHOICES,
        blank=True,
        default="",
    )
    preferred_root_search_engine = models.CharField(
        "루트 검색 엔진",
        max_length=12,
        choices=ROOT_SEARCH_ENGINE_CHOICES,
        blank=True,
        default="",
    )
    bumpercar_spiky_stats = models.JSONField(
        "범퍼카 스핔이 전적",
        default=dict,
        blank=True,
    )
    privacy_policy_agreed_at = models.DateTimeField(
        "개인정보 처리방침 동의 시각",
        null=True,
        blank=True,
    )
    terms_of_service_agreed_at = models.DateTimeField(
        "이용약관 동의 시각",
        null=True,
        blank=True,
    )
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "사용자 프로필"
        verbose_name_plural = "사용자 프로필"

    def __str__(self):
        mode = self.theme_mode or "auto"
        return f"{self.user} ({mode})"
