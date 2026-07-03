from config.celery import app


@app.task(name="main.tasks.clear_expired_sessions")
def clear_expired_sessions():
    """만료된 Django 세션을 DB에서 일괄 삭제한다."""
    from django.contrib.sessions.models import Session
    from django.utils import timezone
    deleted, _ = Session.objects.filter(expire_date__lte=timezone.now()).delete()
    return {"deleted": deleted}


@app.task(name="main.tasks.cleanup_stale_handrive_tutorial_workspaces")
def cleanup_stale_handrive_tutorial_workspaces(max_age_seconds=None):
    """완료/스킵 없이 남은 HanDrive 튜토리얼 임시 드라이브를 정리한다."""
    from main.handrive_views import (
        get_handrive_tutorial_workspace_max_age_seconds,
        prune_all_stale_handrive_tutorial_dirs,
    )

    max_age_seconds = get_handrive_tutorial_workspace_max_age_seconds(max_age_seconds)
    deleted_paths = prune_all_stale_handrive_tutorial_dirs(max_age_seconds=max_age_seconds)
    return {
        "deleted": len(deleted_paths),
        "deleted_paths": deleted_paths[:200],
        "max_age_seconds": max_age_seconds,
    }
