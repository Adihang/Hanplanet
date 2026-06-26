from pathlib import Path

from django import template
from django.conf import settings
from django.templatetags.static import static

register = template.Library()


def _find_static_file(relative_path):
    normalized_path = str(relative_path).lstrip("/")
    candidates = []

    static_root = getattr(settings, "STATIC_ROOT", "")
    if static_root:
        candidates.append(Path(static_root) / normalized_path)

    for static_dir in getattr(settings, "STATICFILES_DIRS", []):
        candidates.append(Path(static_dir) / normalized_path)

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate

    return None


@register.simple_tag
def static_v(path):
    base_url = static(path)
    static_file = _find_static_file(path)

    if static_file is None:
        return base_url

    version = int(static_file.stat().st_mtime)
    separator = "&" if "?" in base_url else "?"
    return f"{base_url}{separator}v={version}"


@register.simple_tag
def static_mtime(path):
    static_file = _find_static_file(path)

    if static_file is None:
        return ""

    return int(static_file.stat().st_mtime)
