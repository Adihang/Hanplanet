from .models import OnscripterAccessUser


def is_onscripter_user_allowed(user) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True
    return OnscripterAccessUser.objects.filter(user=user).exists()
