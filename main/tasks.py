from config.celery import app


@app.task(name="main.tasks.clear_expired_sessions")
def clear_expired_sessions():
    """만료된 Django 세션을 DB에서 일괄 삭제한다."""
    from django.contrib.sessions.models import Session
    from django.utils import timezone
    deleted, _ = Session.objects.filter(expire_date__lte=timezone.now()).delete()
    return {"deleted": deleted}
