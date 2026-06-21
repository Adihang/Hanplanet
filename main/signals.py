"""
Hanplanet 신호 처리

- PortfolioProfile 저장 시 Forgejo 아바타 동기화
- GitUserMapping 생성 시 Forgejo 아바타 동기화
- 로그인 시 Forgejo 아바타 동기화 재시도
- User 삭제 커밋 후 계정별 media 폴더 정리
"""
import logging
import shutil
from pathlib import Path
from typing import Optional

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.signals import user_logged_in
from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from config.utils import sanitize_upload_segment

logger = logging.getLogger(__name__)


def _is_within_path(path_obj: Path, parent_obj: Path) -> bool:
    try:
        resolved_path = path_obj.resolve(strict=False)
        resolved_parent = parent_obj.resolve(strict=False)
    except OSError:
        return False
    return resolved_path != resolved_parent and resolved_parent in resolved_path.parents


def _remove_media_path(path_obj: Path, media_root: Path, *, label: str, username: str) -> bool:
    if not path_obj.exists() and not path_obj.is_symlink():
        return False
    if not _is_within_path(path_obj, media_root):
        logger.warning(
            "cleanup_deleted_user_media: refused to remove path outside media root username=%s label=%s path=%s",
            username,
            label,
            path_obj,
        )
        return False
    try:
        if path_obj.is_symlink() or path_obj.is_file():
            path_obj.unlink()
        else:
            shutil.rmtree(path_obj)
    except OSError as exc:
        logger.warning(
            "cleanup_deleted_user_media: failed to remove username=%s label=%s path=%s: %s",
            username,
            label,
            path_obj,
            exc,
        )
        return False
    logger.info(
        "cleanup_deleted_user_media: removed username=%s label=%s path=%s",
        username,
        label,
        path_obj,
    )
    return True


def _upload_segment_is_still_used(user_id: Optional[int], upload_segment: str) -> bool:
    if not upload_segment:
        return False
    user_qs = get_user_model().objects.only("id", "username")
    if user_id is not None:
        user_qs = user_qs.exclude(id=user_id)
    for user in user_qs.iterator():
        if sanitize_upload_segment(user.get_username()) == upload_segment:
            return True
    return False


def cleanup_deleted_user_media(username: str, user_id: Optional[int]) -> list:
    """삭제된 계정의 media 하위 전용 폴더를 정리한다."""
    username = str(username or "").strip()
    if not username:
        return []

    media_root = Path(settings.MEDIA_ROOT).resolve(strict=False)
    removed_labels = []

    cleanup_targets = [
        ("handrive_home", media_root / "HanDrive" / "users" / username),
    ]

    upload_segment = sanitize_upload_segment(username)
    if upload_segment:
        if _upload_segment_is_still_used(user_id, upload_segment):
            logger.info(
                "cleanup_deleted_user_media: kept shared upload segment username=%s upload_segment=%s",
                username,
                upload_segment,
            )
        else:
            cleanup_targets.append(("uploads", media_root / "uploads" / upload_segment))

    if user_id is not None:
        cleanup_targets.append(("sync_blobs", media_root / "_sync_blobs" / str(user_id)))

    for label, path_obj in cleanup_targets:
        if _remove_media_path(path_obj, media_root, label=label, username=username):
            removed_labels.append(label)

    return removed_labels


@receiver(post_delete, sender=settings.AUTH_USER_MODEL)
def on_user_deleted_cleanup_media(sender, instance, **kwargs):
    """User 삭제가 커밋되면 계정별 media 폴더를 삭제한다."""
    username = instance.get_username()
    user_id = instance.pk
    transaction.on_commit(lambda: cleanup_deleted_user_media(username, user_id))


@receiver(post_save, sender="portfolio.PortfolioProfile")
def on_portfolio_profile_saved(sender, instance, **kwargs):
    """프로필 사진이 변경/저장될 때마다 Forgejo 아바타 동기화."""
    from .git_tasks import sync_gitea_avatar_task

    try:
        sync_gitea_avatar_task.delay(instance.user_id)
    except Exception as exc:
        logger.warning(
            "on_portfolio_profile_saved: failed to queue avatar sync for user_id=%s: %s",
            instance.user_id,
            exc,
        )


@receiver(post_save, sender="git.GitUserMapping")
def on_git_user_mapping_saved(sender, instance, created, **kwargs):
    """GitUserMapping 생성 또는 토큰 준비 시 현재 프로필 사진을 Forgejo에 동기화."""
    if not created and not instance.forgejo_token:
        return

    from .git_tasks import sync_gitea_avatar_task

    try:
        sync_gitea_avatar_task.delay(instance.user_id)
    except Exception as exc:
        logger.warning(
            "on_git_user_mapping_saved: failed to queue avatar sync for user_id=%s: %s",
            instance.user_id,
            exc,
        )


@receiver(user_logged_in)
def on_user_logged_in(sender, request, user, **kwargs):
    """로그인 성공 시 Forgejo 아바타 동기화를 한 번 더 시도."""
    from .git_tasks import sync_gitea_avatar_task

    try:
        sync_gitea_avatar_task.delay(user.id)
    except Exception as exc:
        logger.warning(
            "on_user_logged_in: failed to queue avatar sync for user_id=%s: %s",
            user.id,
            exc,
        )
