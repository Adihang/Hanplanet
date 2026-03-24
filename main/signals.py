"""
Hanplanet 신호 처리

- PortfolioProfile 저장 시 Forgejo 아바타 동기화
- GitUserMapping 생성 시 Forgejo 아바타 동기화
"""
import logging

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
def on_git_user_mapping_created(sender, instance, created, **kwargs):
    """GitUserMapping이 새로 생성될 때 현재 프로필 사진을 Forgejo에 동기화."""
    if not created:
        return

    from .git_tasks import sync_gitea_avatar_task

    try:
        sync_gitea_avatar_task.delay(instance.user_id)
    except Exception as exc:
        logger.warning(
            "on_git_user_mapping_created: failed to queue avatar sync for user_id=%s: %s",
            instance.user_id,
            exc,
        )
