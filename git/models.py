from django.conf import settings
from django.db import models


class GitUserMapping(models.Model):
    """Django User ↔ Forgejo 계정 매핑.
    forgejo_token: 해당 유저의 Gitea PAT — git clone/push 인증에 사용
    """
    user             = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    forgejo_user_id  = models.BigIntegerField()
    forgejo_username = models.CharField(max_length=255)
    forgejo_token    = models.CharField(max_length=512, blank=True, default="")

    class Meta:
        db_table = "main_gitusermapping"

    def __str__(self):
        return f"{self.user.username} → forgejo:{self.forgejo_username}"


class GitRepository(models.Model):
    """Handrive 폴더와 연결된 Git 저장소 (DB가 진실의 원천)"""
    STATUS_CHOICES = [
        ("pending_create", "생성 중"),
        ("pending_import", "이관 중"),
        ("active",         "활성"),
        ("failed",         "실패"),
        ("deleted",        "삭제됨"),
    ]

    owner                  = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    repo_name              = models.CharField(max_length=255)
    forgejo_repo_id        = models.BigIntegerField(null=True, blank=True)
    forgejo_owner          = models.CharField(max_length=255, blank=True)
    forgejo_repo_name      = models.CharField(max_length=255, blank=True)
    forgejo_clone_http_url = models.CharField(max_length=1024, blank=True)
    forgejo_clone_ssh_url  = models.CharField(max_length=1024, blank=True)
    handrive_path          = models.CharField(max_length=1024)
    status                 = models.CharField(max_length=50, choices=STATUS_CHOICES, default="pending_create")
    error_message          = models.TextField(null=True, blank=True)
    created_at             = models.DateTimeField(auto_now_add=True)
    updated_at             = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "main_gitrepository"
        unique_together = [
            ("handrive_path",),
            ("owner", "repo_name"),
        ]

    def __str__(self):
        return f"{self.owner.username}/{self.repo_name} [{self.status}]"


class GitCollaborator(models.Model):
    """저장소 협업자 권한"""
    repository = models.ForeignKey(GitRepository, on_delete=models.CASCADE, related_name="collaborators")
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    permission = models.CharField(max_length=50)  # read / write / admin

    class Meta:
        db_table = "main_gitcollaborator"
        unique_together = ("repository", "user")

    def __str__(self):
        return f"{self.user.username} → {self.repository} [{self.permission}]"


class GitDeviceCode(models.Model):
    """OAuth2 Device Flow — 터미널 git 인증을 위한 일회성 코드."""
    device_code = models.CharField(max_length=64, unique=True)
    user_code   = models.CharField(max_length=16, unique=True)
    user        = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL
    )
    expires_at  = models.DateTimeField()
    approved    = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "main_gitdevicecode"

    def __str__(self):
        return f"GitDeviceCode({self.user_code}, approved={self.approved})"
