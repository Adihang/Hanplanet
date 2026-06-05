"""
Hanplanet 신호 처리

- PortfolioProfile 저장 시 Forgejo 아바타 동기화
- GitUserMapping 생성 시 Forgejo 아바타 동기화
- 로그인 시 Forgejo 아바타 동기화 재시도
"""
import logging

from django.contrib.auth.signals import user_logged_in
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


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
