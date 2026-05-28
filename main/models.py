import uuid

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

    def __str__(self):
        return f"{self.user.username} — {self.code} (used={self.used})"


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
