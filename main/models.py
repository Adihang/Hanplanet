import uuid

from django.conf import settings
from django.contrib.auth.models import Group
from django.core.validators import MinValueValidator, RegexValidator
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
    allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="handrive_allowed_shared_links",
        verbose_name="공유 허용 사용자",
    )
    allowed_usernames = models.JSONField(
        "공유 허용 사용자명",
        default=list,
        blank=True,
    )
    can_edit = models.BooleanField("편집 권한 허용", default=False)
    share_slug = models.CharField("공유 슬러그", max_length=255)
    uses_opaque_tokens = models.BooleanField("난수 공유 경로 사용", default=False)
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


class HandriveSharedPathToken(models.Model):
    shared_link = models.ForeignKey(
        HandriveSharedLink,
        on_delete=models.CASCADE,
        related_name="path_tokens",
        verbose_name="공유 링크",
    )
    relative_path = models.CharField("공유 루트 기준 상대 경로", max_length=1024)
    token = models.CharField("난수 경로 토큰", max_length=255, unique=True)
    created_at = models.DateTimeField("생성일", auto_now_add=True)

    class Meta:
        ordering = ["shared_link_id", "relative_path"]
        verbose_name = "문서 공유 경로 토큰"
        verbose_name_plural = "문서 공유 경로 토큰"
        constraints = [
            models.UniqueConstraint(
                fields=["shared_link", "relative_path"],
                name="unique_handrive_shared_link_relative_path",
            )
        ]

    def __str__(self):
        return f"{self.shared_link_id}/{self.token}"


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


class EmailVerificationCode(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_verification_codes",
        verbose_name="사용자",
    )
    code = models.CharField("인증 코드", max_length=8)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    expires_at = models.DateTimeField("만료일")
    used = models.BooleanField("사용됨", default=False)

    class Meta:
        verbose_name = "이메일 인증 코드"
        verbose_name_plural = "이메일 인증 코드"
        indexes = [models.Index(fields=["user", "created_at"])]


class WargameSolve(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wargame_solves",
        verbose_name="사용자",
    )
    challenge_id = models.CharField("문제 ID", max_length=80)
    solved_at = models.DateTimeField("해결일", auto_now_add=True)

    class Meta:
        verbose_name = "워게임 해결 기록"
        verbose_name_plural = "워게임 해결 기록"
        constraints = [
            models.UniqueConstraint(fields=["user", "challenge_id"], name="unique_wargame_solve_user_challenge"),
        ]
        indexes = [models.Index(fields=["user", "challenge_id"])]

    def __str__(self):
        return f"{self.user_id}:{self.challenge_id}"


class TrustedDevice(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="trusted_devices",
        verbose_name="사용자",
    )
    device_token = models.CharField("디바이스 토큰", max_length=64, unique=True)
    last_seen_at = models.DateTimeField("마지막 확인일")
    created_at = models.DateTimeField("생성일", auto_now_add=True)

    class Meta:
        verbose_name = "신뢰된 기기"
        verbose_name_plural = "신뢰된 기기"
        indexes = [models.Index(fields=["user", "last_seen_at"])]

    def __str__(self):
        return f"{self.user.username} — {self.device_token[:8]}… (last={self.last_seen_at})"


class EmailTwoFactorBypassUser(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="email_2fa_bypass",
        verbose_name="사용자",
    )
    created_at = models.DateTimeField("등록일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        db_table = "main_emailtwofactorbypassuser"
        ordering = ["user__username"]
        verbose_name = "이메일 2차 인증 생략 사용자"
        verbose_name_plural = "이메일 2차 인증 생략 사용자"

    def __str__(self):
        return str(self.user.get_username())


class OnscripterAccessUser(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="onscripter_access",
        verbose_name="사용자",
    )
    created_at = models.DateTimeField("등록일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        db_table = "main_onscripteraccessuser"
        ordering = ["user__username"]
        verbose_name = "ONScripter 허용 사용자"
        verbose_name_plural = "ONScripter 허용 사용자"

    def __str__(self):
        return str(self.user.get_username())


DEFAULT_HANDRIVE_USER_QUOTA_BYTES = 50 * 1024 * 1024 * 1024


class HandriveSiteSettings(models.Model):
    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True, editable=False)
    default_quota_bytes = models.BigIntegerField(
        "기본 저장 용량 (bytes)",
        default=DEFAULT_HANDRIVE_USER_QUOTA_BYTES,
        validators=[MinValueValidator(1)],
        help_text="사용자별 저장 용량 설정이 없을 때 적용되는 기본 HanDrive 용량입니다.",
    )
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "HanDrive 기본 설정"
        verbose_name_plural = "HanDrive 기본 설정"

    def save(self, *args, **kwargs):
        self.singleton_key = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls) -> "HandriveSiteSettings":
        settings_obj, _ = cls.objects.get_or_create(singleton_key=1)
        return settings_obj

    def __str__(self):
        return "HanDrive 기본 설정"


class HandriveEditorCompletion(models.Model):
    extension = models.CharField(
        "파일 확장자",
        max_length=16,
        validators=[
            RegexValidator(
                regex=r"^\.[a-z0-9][a-z0-9_+-]*$",
                message="확장자는 .js처럼 점으로 시작하는 영문 소문자 형식이어야 합니다.",
            )
        ],
        help_text="예: .md, .py, .js",
    )
    trigger = models.CharField("트리거", max_length=80)
    insert_text = models.TextField("삽입 내용")
    label = models.CharField("표시명", max_length=200, blank=True, default="")
    description = models.CharField("설명", max_length=300, blank=True, default="")
    kind = models.CharField(
        "종류",
        max_length=24,
        blank=True,
        default="",
        help_text="비워 두면 삽입 내용에 따라 자동 판별합니다.",
    )
    cursor_back = models.PositiveIntegerField(
        "완료 후 커서 이동량",
        default=0,
        help_text="마지막 어절까지 적용한 뒤 커서를 뒤로 이동할 문자 수입니다.",
    )
    priority = models.IntegerField("우선순위", default=0)
    enabled = models.BooleanField("사용", default=True)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        ordering = ["extension", "-priority", "trigger", "id"]
        verbose_name = "HanDrive 코드 자동완성"
        verbose_name_plural = "HanDrive 코드 자동완성"
        constraints = [
            models.UniqueConstraint(
                fields=["extension", "trigger"],
                name="unique_handrive_editor_completion_trigger",
            )
        ]
        indexes = [
            models.Index(fields=["enabled", "extension", "priority"]),
        ]

    def save(self, *args, **kwargs):
        self.extension = str(self.extension or "").strip().lower()
        self.trigger = str(self.trigger or "").strip()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.extension} · {self.trigger}"


class OnscripterGameConfig(models.Model):
    slug = models.SlugField("슬러그", max_length=80, primary_key=True)
    title = models.CharField("게임 제목", max_length=160)
    folder_name = models.CharField("원본 폴더명", max_length=255)
    asset_folder_name = models.CharField("웹 자산 폴더명", max_length=255)
    description_ko = models.TextField("한국어 설명", blank=True, default="")
    description_en = models.TextField("영어 설명", blank=True, default="")
    thumbnail_path = models.CharField("대표 이미지 상대 경로", max_length=512, blank=True, default="")
    encoding_arg = models.CharField("엔진 인코딩 인자", max_length=40, default="--enc:utf8")
    width = models.PositiveIntegerField("화면 너비", default=800)
    height = models.PositiveIntegerField("화면 높이", default=600)
    meta_title = models.CharField("메타 제목", max_length=200, blank=True, default="")
    direct_voice_playback = models.BooleanField("직접 음성 재생", default=False)
    display_order = models.IntegerField("표시 순서", default=0)
    enabled = models.BooleanField("사용", default=True)
    asset_manifest = models.JSONField("자산 manifest", default=dict, blank=True)
    manifest_updated_at = models.DateTimeField("manifest 수정일", null=True, blank=True)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        ordering = ["display_order", "slug"]
        verbose_name = "ONScripter 게임"
        verbose_name_plural = "ONScripter 게임"

    def __str__(self):
        return self.title


class BumpercarSkin(models.Model):
    SKIN_TYPE_CHOICES = (
        ("classic", "Classic"),
        ("double", "Double"),
        ("many", "Many"),
        ("pumkin", "Pumkin"),
        ("evolution", "Evolution"),
    )

    name = models.SlugField("스킨 키", max_length=80, primary_key=True)
    asset_source_name = models.SlugField("자산 소스 키", max_length=80, blank=True, default="")
    fallback_sound_source_name = models.SlugField("대체 음원 소스 키", max_length=80, blank=True, default="")
    preview_icon_name = models.CharField("대표 아이콘 이름", max_length=80, default="main")
    skin_type = models.CharField("스킨 유형", max_length=16, choices=SKIN_TYPE_CHOICES, default="classic")
    display_name_ko = models.CharField("한국어 이름", max_length=120)
    display_name_en = models.CharField("영어 이름", max_length=120)
    unlock_condition_ko = models.CharField("한국어 해금 조건", max_length=200, blank=True, default="")
    unlock_condition_en = models.CharField("영어 해금 조건", max_length=200, blank=True, default="")
    description_ko = models.TextField("한국어 설명", blank=True, default="")
    description_en = models.TextField("영어 설명", blank=True, default="")
    unlock_stat_key = models.CharField("해금 전적 키", max_length=80, blank=True, default="")
    unlock_threshold = models.PositiveIntegerField("해금 기준값", default=0)
    admin_only = models.BooleanField("관리자 전용", default=False)
    disabled_game_slugs = models.JSONField("비활성 게임 슬러그", default=list, blank=True)
    visual_scale = models.FloatField("표시 배율", default=1.0)
    display_order = models.IntegerField("표시 순서", default=0)
    enabled = models.BooleanField("사용", default=True)
    asset_manifest = models.JSONField("자산 manifest", default=dict, blank=True)
    manifest_updated_at = models.DateTimeField("manifest 수정일", null=True, blank=True)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        ordering = ["display_order", "name"]
        verbose_name = "범퍼카 스킨"
        verbose_name_plural = "범퍼카 스킨"

    def save(self, *args, **kwargs):
        if not self.asset_source_name:
            self.asset_source_name = self.name
        super().save(*args, **kwargs)

    def __str__(self):
        return self.display_name_ko or self.name


class BumpercarGameplaySettings(models.Model):
    singleton_key = models.PositiveSmallIntegerField(default=1, unique=True, editable=False)
    payload = models.JSONField("게임 설정", default=dict, blank=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "범퍼카 게임 설정"
        verbose_name_plural = "범퍼카 게임 설정"

    def save(self, *args, **kwargs):
        self.singleton_key = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_solo(cls) -> "BumpercarGameplaySettings":
        settings_obj, _ = cls.objects.get_or_create(singleton_key=1)
        return settings_obj

    def __str__(self):
        return "범퍼카 게임 설정"


class HandriveUserQuota(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="handrive_quota",
        verbose_name="사용자",
    )
    quota_bytes = models.BigIntegerField(
        "저장 용량 (bytes)",
        default=DEFAULT_HANDRIVE_USER_QUOTA_BYTES,
        help_text="사용자별 최대 저장 용량. 예: 50GB = 53687091200",
    )
    hanharness_enabled = models.BooleanField(
        "HanHarness 사용 허용",
        default=False,
        help_text="활성화하면 이 사용자가 HanHarness를 통해 AI API를 사용할 수 있습니다.",
    )
    hanharness_token_limit_5h = models.PositiveIntegerField(
        "5시간 토큰 제한",
        default=0,
        help_text="최근 5시간 내 사용 가능한 최대 토큰 수. 0이면 무제한.",
    )
    scoped_entry_limit = models.PositiveIntegerField(
        "파일/폴더 개수 제한",
        default=0,
        help_text="개인 폴더에 허용되는 최대 파일/폴더 수. 0이면 무제한. 설정 없으면 기본값(100개) 적용.",
    )

    class Meta:
        verbose_name = "HanDrive 사용자 저장 용량/CLI 사용량"
        verbose_name_plural = "HanDrive 사용자 저장 용량/CLI 사용량"

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


class MinecraftAccountLink(models.Model):
    EDITION_JAVA = "java"
    EDITION_BEDROCK = "bedrock"
    EDITION_UNKNOWN = "unknown"
    EDITION_CHOICES = [
        (EDITION_JAVA, "Java Edition"),
        (EDITION_BEDROCK, "Bedrock Edition"),
        (EDITION_UNKNOWN, "Unknown"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="minecraft_account_links",
        verbose_name="사용자",
    )
    minecraft_uuid = models.CharField("Minecraft UUID", max_length=36, unique=True)
    minecraft_name = models.CharField("Minecraft 닉네임", max_length=32)
    edition = models.CharField("에디션", max_length=12, choices=EDITION_CHOICES, default=EDITION_UNKNOWN)
    floodgate_xuid = models.CharField("Floodgate XUID", max_length=32, blank=True, default="")
    first_linked_at = models.DateTimeField("최초 연동일", auto_now_add=True)
    last_linked_at = models.DateTimeField("최근 연동일", auto_now=True)
    last_seen_at = models.DateTimeField("마지막 확인일", null=True, blank=True)

    class Meta:
        db_table = "main_minecraftaccountlink"
        ordering = ["user__username", "minecraft_name"]
        verbose_name = "Minecraft 계정 연동"
        verbose_name_plural = "Minecraft 계정 연동"
        indexes = [
            models.Index(fields=["user", "edition"]),
            models.Index(fields=["minecraft_name"]),
            models.Index(fields=["floodgate_xuid"]),
        ]

    def __str__(self):
        return f"{self.user.username} — {self.minecraft_name} ({self.edition})"


class MinecraftTradeListing(models.Model):
    STATUS_OPEN = "open"
    STATUS_CANCELLED = "cancelled"
    STATUS_COMPLETED = "completed"
    STATUS_CLAIMED = "claimed"
    STATUS_CHOICES = [
        (STATUS_OPEN, "Open"),
        (STATUS_CANCELLED, "Cancelled"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CLAIMED, "Claimed"),
    ]

    seller = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="minecraft_trade_listings",
        verbose_name="판매자",
    )
    seller_minecraft_name = models.CharField("판매자 Minecraft 닉네임", max_length=32)
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="minecraft_trade_purchases",
        verbose_name="구매자",
    )
    buyer_minecraft_name = models.CharField("구매자 Minecraft 닉네임", max_length=32, blank=True, default="")
    sell_item = models.CharField("판매 아이템", max_length=64)
    sell_amount = models.PositiveIntegerField("판매 수량", validators=[MinValueValidator(1)])
    price_item = models.CharField("대가 아이템", max_length=64)
    price_amount = models.PositiveIntegerField("대가 수량", validators=[MinValueValidator(1)])
    allow_partial = models.BooleanField("부분 거래 허용", default=False)
    remaining_sell_amount = models.PositiveIntegerField("남은 판매 수량", default=0)
    remaining_price_amount = models.PositiveIntegerField("남은 대가 수량", default=0)
    unclaimed_price_amount = models.PositiveIntegerField("미수령 대가 수량", default=0)
    claimed_price_amount = models.PositiveIntegerField("수령한 대가 수량", default=0)
    status = models.CharField("상태", max_length=12, choices=STATUS_CHOICES, default=STATUS_OPEN)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    updated_at = models.DateTimeField("수정일", auto_now=True)
    completed_at = models.DateTimeField("거래 완료일", null=True, blank=True)
    cancelled_at = models.DateTimeField("취소일", null=True, blank=True)
    claimed_at = models.DateTimeField("수령일", null=True, blank=True)

    class Meta:
        db_table = "main_minecrafttradelisting"
        ordering = ["-created_at", "-id"]
        verbose_name = "Minecraft 거래글"
        verbose_name_plural = "Minecraft 거래글"
        indexes = [
            models.Index(fields=["status", "-created_at"]),
            models.Index(fields=["seller", "status"]),
            models.Index(fields=["buyer", "status"]),
        ]

    def __str__(self):
        return (
            f"{self.seller_minecraft_name}: {self.sell_item} x{self.sell_amount} "
            f"for {self.price_item} x{self.price_amount} ({self.status})"
        )

    def save(self, *args, **kwargs):
        """Give direct model creations the same escrow balances as the trade API."""
        if self._state.adding:
            if self.status == self.STATUS_OPEN:
                if not self.remaining_sell_amount:
                    self.remaining_sell_amount = self.sell_amount
                if not self.remaining_price_amount:
                    self.remaining_price_amount = self.price_amount
            elif self.status == self.STATUS_COMPLETED and not self.unclaimed_price_amount:
                self.unclaimed_price_amount = self.price_amount
        super().save(*args, **kwargs)


class MinecraftTradeFill(models.Model):
    """One completed quantity from a listing, including partial purchases."""
    listing = models.ForeignKey(
        MinecraftTradeListing,
        on_delete=models.CASCADE,
        related_name="fills",
        verbose_name="거래글",
    )
    buyer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="minecraft_trade_fill_purchases",
        verbose_name="구매자",
    )
    buyer_minecraft_name = models.CharField("구매자 Minecraft 닉네임", max_length=32)
    sell_amount = models.PositiveIntegerField("판매 수량", validators=[MinValueValidator(1)])
    price_amount = models.PositiveIntegerField("지불 수량", validators=[MinValueValidator(1)])
    created_at = models.DateTimeField("구매일", auto_now_add=True)

    class Meta:
        db_table = "main_minecrafttradefill"
        ordering = ["-created_at", "-id"]
        verbose_name = "Minecraft 거래 체결"
        verbose_name_plural = "Minecraft 거래 체결"
        indexes = [
            models.Index(fields=["listing", "-created_at"]),
            models.Index(fields=["buyer", "-created_at"]),
        ]

    def __str__(self):
        return f"#{self.listing_id}: {self.buyer_minecraft_name} x{self.sell_amount}"


class MinecraftLinkCode(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="minecraft_link_codes",
        verbose_name="사용자",
    )
    code_hash = models.CharField("코드 해시", max_length=64, unique=True)
    created_at = models.DateTimeField("생성일", auto_now_add=True)
    expires_at = models.DateTimeField("만료일")
    used = models.BooleanField("사용됨", default=False)
    used_at = models.DateTimeField("사용일", null=True, blank=True)

    class Meta:
        db_table = "main_minecraftlinkcode"
        ordering = ["-created_at"]
        verbose_name = "Minecraft 연동 코드"
        verbose_name_plural = "Minecraft 연동 코드"
        indexes = [
            models.Index(fields=["user", "expires_at"]),
            models.Index(fields=["used", "expires_at"]),
        ]

    def __str__(self):
        state = "used" if self.used else "pending"
        return f"{self.user.username} — {state} until {self.expires_at}"


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
    weather_country = models.CharField(
        "날씨 국가",
        max_length=80,
        blank=True,
        default="",
    )
    weather_city = models.CharField(
        "날씨 도시",
        max_length=120,
        blank=True,
        default="",
    )
    weather_location_label = models.CharField(
        "날씨 위치 표시명",
        max_length=180,
        blank=True,
        default="",
    )
    weather_latitude = models.FloatField(
        "날씨 위도",
        null=True,
        blank=True,
    )
    weather_longitude = models.FloatField(
        "날씨 경도",
        null=True,
        blank=True,
    )
    weather_location_source = models.CharField(
        "날씨 위치 출처",
        max_length=16,
        blank=True,
        default="",
    )
    bumpercar_spiky_stats = models.JSONField(
        "범퍼카 스핔이 전적",
        default=dict,
        blank=True,
    )
    sync_excluded_paths = models.JSONField(
        "HanDrive 동기화 제외 경로",
        default=list,
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
    # 로그인마다 새 토큰 발급, 로그아웃 시 초기화 → 기존 세션 일괄 무효화
    session_token = models.CharField(
        "세션 토큰",
        max_length=64,
        blank=True,
        default="",
    )
    force_password_change = models.BooleanField(
        "비밀번호 변경 필요",
        default=False,
    )
    updated_at = models.DateTimeField("수정일", auto_now=True)

    class Meta:
        verbose_name = "사용자 프로필"
        verbose_name_plural = "사용자 프로필"

    def __str__(self):
        mode = self.theme_mode or "auto"
        return f"{self.user} ({mode})"


# ── Handrive Sync 모델 ─────────────────────────────────────────────────────────

class SyncFile(models.Model):
    """클라우드 드라이브 파일 메타데이터.

    identity = id (UUID, 절대 변하지 않음)
    path     = 현재 위치 (rename 시 path만 변경)
    storage_key 형식: "{user_id}/{file_id}"
    """
    id                 = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user               = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_files")
    path               = models.TextField(help_text="사용자 기준 상대 경로 (예: /docs/a.txt)")
    size               = models.BigIntegerField()
    hash               = models.CharField(max_length=64, help_text="SHA-256 hex digest")
    version            = models.BigIntegerField(default=1, help_text="단조 증가 버전 (충돌 판단 기준)")
    storage_key        = models.TextField(help_text="MinIO 오브젝트 키: {user_id}/{file_id}")
    client_modified_at = models.BigIntegerField(help_text="클라이언트 제공 수정 시각 (ms, 참고용)")
    server_modified_at = models.BigIntegerField(help_text="서버 기준 수정 시각 (ms, sync 판단 기준)")
    deleted            = models.BooleanField(default=False)

    class Meta:
        unique_together = [("user", "path")]
        indexes = [models.Index(fields=["user", "hash"])]
        verbose_name = "Sync 파일"
        verbose_name_plural = "Sync 파일"

    def __str__(self):
        return f"{self.user.username}:{self.path} (v{self.version})"


class SyncChangeLog(models.Model):
    """파일 변경 이력. cursor = id (PK, autoincrement) 기반으로 sync."""

    TYPE_CREATE = "CREATE"
    TYPE_UPDATE = "UPDATE"
    TYPE_DELETE = "DELETE"
    TYPE_MOVE   = "MOVE"
    TYPE_CHOICES = [
        (TYPE_CREATE, "생성"),
        (TYPE_UPDATE, "수정"),
        (TYPE_DELETE, "삭제"),
        (TYPE_MOVE,   "이동/이름변경"),
    ]

    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_change_logs")
    file_id    = models.UUIDField(help_text="SyncFile.id (삭제 후에도 이력 유지를 위해 FK 미사용)")
    path       = models.TextField(help_text="변경 시점의 파일 경로")
    old_path   = models.TextField(null=True, blank=True, help_text="MOVE 시 이전 경로")
    type       = models.CharField(max_length=10, choices=TYPE_CHOICES)
    version    = models.BigIntegerField(help_text="변경 후 버전")
    created_at = models.BigIntegerField(help_text="서버 Unix timestamp (ms)")

    class Meta:
        indexes = [models.Index(fields=["user", "created_at"])]
        verbose_name = "Sync 변경 이력"
        verbose_name_plural = "Sync 변경 이력"

    def __str__(self):
        return f"{self.user.username} {self.type} {self.path} (id={self.id})"


class SyncUploadSession(models.Model):
    """진행 중인 업로드 세션. complete-upload 후 삭제."""

    upload_id   = models.CharField(max_length=100, primary_key=True)
    user        = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_upload_sessions")
    file_id     = models.UUIDField(help_text="업로드 대상 SyncFile.id")
    path        = models.TextField()
    size        = models.BigIntegerField()
    hash        = models.CharField(max_length=64)
    storage_key = models.TextField()
    created_at  = models.BigIntegerField(help_text="서버 Unix timestamp (ms)")

    class Meta:
        verbose_name = "Sync 업로드 세션"
        verbose_name_plural = "Sync 업로드 세션"

    def __str__(self):
        return f"{self.upload_id} ({self.user.username}:{self.path})"
