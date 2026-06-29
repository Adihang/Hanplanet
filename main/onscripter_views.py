from __future__ import annotations

import fnmatch
import hashlib
import hmac
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.templatetags.static import static
from django.urls import reverse
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_http_methods
from portfolio.models import PortfolioProfile

from .onscripter_access import is_onscripter_user_allowed
from .views import apply_ui_context, build_public_absolute_url, get_account_display_name, resolve_ui_lang


@dataclass(frozen=True)
class OnscripterGame:
    slug: str
    title: str
    folder_name: str
    asset_folder_name: str
    description_ko: str
    description_en: str
    thumbnail_path: str
    encoding_arg: str
    width: int
    height: int
    meta_title: str | None = None
    direct_voice_playback: bool = False


ONSCRIPTER_GAMES = {
    "haruuru": OnscripterGame(
        slug="haruuru",
        title="하루우루",
        folder_name=unicodedata.normalize("NFD", "하루우루"),
        asset_folder_name=unicodedata.normalize("NFD", "하루우루_web"),
        description_ko="아득히 우러러본, 아름다운",
        description_en="An ONScripter web port playable in the browser. Saves are stored per user.",
        thumbnail_path="IMAGE/HARUURU_META.webp",
        encoding_arg="--enc:utf8",
        width=800,
        height=600,
    ),
    "kanoina": OnscripterGame(
        slug="kanoina",
        title="Kanoina",
        folder_name="kanoina",
        asset_folder_name="kanoina_web",
        description_ko="×××인 그녀가 시골 생활을 만끽하는 비밀의 방법",
        description_en="An ONScripter web port playable in the browser. Saves are stored per user.",
        thumbnail_path="image/title.png",
        encoding_arg="--enc:utf8",
        width=800,
        height=600,
    ),
    "konosora": OnscripterGame(
        slug="konosora",
        title="KonoSora",
        folder_name="konosora",
        asset_folder_name="konosora_web",
        description_ko="이 넓은 하늘에, 날개를 펼치고",
        description_en="An ONScripter web port playable in the browser. Saves are stored per user.",
        thumbnail_path="image/title.png",
        encoding_arg="--enc:utf8",
        width=800,
        height=600,
    ),
    "hoshizora": OnscripterGame(
        slug="hoshizora",
        title="별하늘에 걸린 다리",
        folder_name=unicodedata.normalize("NFD", "별하늘에 걸린 다리"),
        asset_folder_name=unicodedata.normalize("NFD", "별하늘에 걸린 다리_web"),
        description_ko="별하늘에 걸린 다리",
        description_en="An ONScripter web port playable in the browser. Saves are stored per user.",
        thumbnail_path="image/menu.jpg",
        encoding_arg="--enc:utf8",
        width=800,
        height=600,
        meta_title="hoshizora",
    ),
    "grisaia-kajitsu": OnscripterGame(
        slug="grisaia-kajitsu",
        title="그리자이아의 과실",
        folder_name=unicodedata.normalize("NFD", "그리자이아의 과실"),
        asset_folder_name=unicodedata.normalize("NFD", "그리자이아의 과실_web"),
        description_ko="그리자이아의 과실",
        description_en="An ONScripter web port playable in the browser. Saves are stored per user.",
        thumbnail_path="title.png",
        encoding_arg="--enc:utf8",
        width=800,
        height=600,
    ),
}

EXCLUDED_GAME_FILE_PATTERNS = (
    ".DS_Store",
    "thumbs.db",
    "*.nsa",
    "*.ns2",
    "*.sar",
    "*.bak",
    "envdata",
    "gloval.sav",
    "global.sav",
    "kidoku.dat",
    "save*.dat",
    "*.pre-*-backup",
    "*.web-audio-backup",
    "*.web-encoding-backup",
    "*.web-spacing-backup",
)
MAX_SAVE_ARCHIVE_BYTES = 50 * 1024 * 1024
ONSCRIPTER_META_IMAGE_URL = build_public_absolute_url(static("media/icons/onscripter-og.png"))
ONSCRIPTER_META_IMAGE_ALT = "ONScripter preview image"


def _get_game_or_404(game_slug: str) -> OnscripterGame:
    game = ONSCRIPTER_GAMES.get(str(game_slug or "").strip().lower())
    if game is None:
        raise Http404("ONScripter game not found")
    return game


def _require_onscripter_access(request) -> None:
    if not is_onscripter_user_allowed(getattr(request, "user", None)):
        raise PermissionDenied("ONScripter access is restricted.")


def _onscripter_storage_root() -> Path:
    return Path(settings.MEDIA_ROOT) / "HanDrive" / "ONScripter"


def _game_root(game: OnscripterGame) -> Path:
    return _onscripter_storage_root() / game.asset_folder_name


def _runtime_file_path(relative_path: str) -> Path:
    return _onscripter_storage_root() / "_web_runtime" / relative_path


def _media_url_for_path(path: Path) -> str:
    relative = path.relative_to(settings.MEDIA_ROOT).as_posix()
    stat = path.stat()
    cache_key = f"{stat.st_mtime_ns}-{stat.st_size}"
    return f"{settings.MEDIA_URL.rstrip('/')}/{quote(relative, safe='/')}?v={cache_key}"


def _game_thumbnail_url(game: OnscripterGame) -> str:
    if not game.thumbnail_path:
        return ""

    thumbnail_path = _game_root(game) / game.thumbnail_path
    if not thumbnail_path.is_file():
        return ""
    return _media_url_for_path(thumbnail_path)


def _game_meta_title(game: OnscripterGame) -> str:
    return game.meta_title or f"{game.title} | Hanplanet ONScripter"


def _game_card_title(game: OnscripterGame) -> str:
    return game.meta_title or game.title


def _is_excluded_game_file(relative_path: str) -> bool:
    name = Path(relative_path).name
    lowered = name.lower()
    return any(fnmatch.fnmatch(lowered, pattern.lower()) for pattern in EXCLUDED_GAME_FILE_PATTERNS)


def _save_owner_key(request) -> str:
    user = getattr(request, "user", None)
    if getattr(user, "is_authenticated", False):
        raw_key = f"user:{user.pk}"
        key_prefix = "user"
    else:
        session = getattr(request, "session", None)
        if session is None:
            raw_key = f"anonymous:{request.META.get('REMOTE_ADDR', '')}"
            key_prefix = "anonymous"
        else:
            if not session.session_key:
                session.create()
            raw_key = f"session:{session.session_key}"
            key_prefix = "session"

    digest = hmac.new(
        str(settings.SECRET_KEY).encode("utf-8"),
        raw_key.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:24]
    return f"{key_prefix}-{digest}"


def _save_archive_path(game: OnscripterGame, owner_key: str) -> Path:
    return _onscripter_storage_root() / "_web_saves" / game.slug / owner_key / "save.zip"


def _build_onscripter_links(resolved_lang: str) -> list[dict[str, str]]:
    is_english = resolved_lang == "en"
    links = []

    for game in ONSCRIPTER_GAMES.values():
        links.append({
            "slug": game.slug,
            "url": reverse(
                "main:onscripter_player_lang",
                kwargs={"ui_lang": resolved_lang, "game_slug": game.slug},
            ),
            "title": _game_card_title(game),
            "site_name": "ONScripter",
            "description": game.description_en if is_english else game.description_ko,
            "image": _game_thumbnail_url(game),
            "category": "game",
        })

    return links


def _apply_onscripter_auth_context(request, context: dict, resolved_lang: str) -> None:
    if not request.user.is_authenticated:
        return

    portfolio_profile = PortfolioProfile.objects.filter(user=request.user).only("profile_img").first()
    context["handrive_my_portfolio_url"] = reverse(
        "main:portfolio_user_lang",
        kwargs={"ui_lang": resolved_lang, "user_id": request.user.username},
    )
    context["account_display_name"] = get_account_display_name(request.user)
    context["account_profile_image_url"] = (
        portfolio_profile.profile_img.url if portfolio_profile and portfolio_profile.profile_img else ""
    )
    context["account_email"] = str(request.user.email or "").strip()
    context["account_profile_upload_url"] = reverse(
        "main:account_profile_image_upload_lang",
        kwargs={"ui_lang": resolved_lang},
    )
    context["account_my_portfolio_url"] = context["handrive_my_portfolio_url"]
    context["account_logout_form_id"] = "auth-logout-form-onscripter"
    context["account_logout_next"] = request.get_full_path() or reverse(
        "main:onscripter_index_lang", kwargs={"ui_lang": resolved_lang}
    )
    context["account_logout_url"] = reverse("main:handrive_logout_lang", kwargs={"ui_lang": resolved_lang})


@require_GET
def onscripter_index(request, ui_lang=None):
    _require_onscripter_access(request)
    resolved_lang = resolve_ui_lang(request, ui_lang)
    is_english = resolved_lang == "en"
    links = _build_onscripter_links(resolved_lang)

    context = {
        "page_title": "ONScripter",
        "sub_links": links,
        "sub_link_groups": [{
            "slug": "game",
            "title": "Games" if is_english else "게임",
        }],
        "sub_home_label": "Hanplanet",
        "sub_breadcrumbs": [
            {"label": "Hanplanet", "url": "/"},
            {"label": "Sub", "url": reverse("main:sub_lang", kwargs={"ui_lang": resolved_lang})},
            {"label": "ONScripter"},
        ],
        "sub_page_modifier_class": "sub-page-single-group",
        "sub_category": "game",
        "handrive_login_url": reverse("main:handrive_login_lang", kwargs={"ui_lang": resolved_lang}),
        "handrive_signup_url": reverse("main:handrive_signup_lang", kwargs={"ui_lang": resolved_lang}),
        "meta_title": "ONScripter | Hanplanet",
        "meta_og_title": "ONScripter | Hanplanet",
        "meta_description": (
            "Choose an ONScripter game to play in the browser on Hanplanet."
            if is_english
            else "Hanplanet에서 브라우저로 실행할 ONScripter 게임을 선택하세요."
        ),
    }
    context["meta_og_description"] = context["meta_description"]
    context["meta_og_image"] = ONSCRIPTER_META_IMAGE_URL
    context["meta_twitter_image"] = ONSCRIPTER_META_IMAGE_URL
    context["meta_image_alt"] = ONSCRIPTER_META_IMAGE_ALT

    apply_ui_context(request, context, resolved_lang)
    _apply_onscripter_auth_context(request, context, resolved_lang)

    response = render(request, "fun/sub.html", context)
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response["Pragma"] = "no-cache"
    return response


def _build_game_index(request, game: OnscripterGame, ui_lang: str | None = None) -> dict:
    root = _game_root(game)
    if not root.is_dir():
        raise FileNotFoundError(str(root))

    save_owner_key = _save_owner_key(request)
    save_url = reverse(
        "main:onscripter_game_save_lang",
        kwargs={"ui_lang": ui_lang or "ko", "game_slug": game.slug},
    )

    dirs: set[str] = set()
    files: list[dict[str, object]] = []
    for file_path in sorted(path for path in root.rglob("*") if path.is_file()):
        relative_path = file_path.relative_to(root).as_posix()
        if _is_excluded_game_file(relative_path):
            continue

        parent = Path(relative_path).parent.as_posix()
        if parent != ".":
            parts = parent.split("/")
            for index in range(1, len(parts) + 1):
                dirs.add("/".join(parts[:index]))

        files.append({
            "path": relative_path,
            "url": _media_url_for_path(file_path),
            "lazyload": True,
        })

    return {
        "title": game.title,
        "gamedir": f"/onsyuri/{game.slug}",
        "savedir": f"/onsyuri_save/{game.slug}/{save_owner_key}",
        "save": {
            "loadUrl": save_url,
            "saveUrl": save_url,
            "csrfToken": get_token(request),
        },
        "args": [
            game.encoding_arg,
            "--width",
            str(game.width),
            "--height",
            str(game.height),
            "--window",
        ],
        "lazyload": True,
        "directVoicePlayback": game.direct_voice_playback,
        "dirs": sorted(dirs),
        "files": files,
    }


@ensure_csrf_cookie
@require_GET
def onscripter_player(request, ui_lang=None, game_slug="haruuru"):
    _require_onscripter_access(request)
    resolved_lang = resolve_ui_lang(request, ui_lang)
    game = _get_game_or_404(game_slug)
    if not _game_root(game).is_dir():
        return HttpResponse("ONScripter game files are unavailable.", status=503)

    engine_js_path = _runtime_file_path("onsyuri/0.7.7beta/onsyuri.js")
    engine_wasm_path = _runtime_file_path("onsyuri/0.7.7beta/onsyuri.wasm")
    jszip_path = _runtime_file_path("jszip/3.10.1/jszip.min.js")
    if not engine_js_path.is_file() or not engine_wasm_path.is_file() or not jszip_path.is_file():
        return HttpResponse("ONScripter web runtime files are unavailable.", status=503)

    index_url = reverse(
        "main:onscripter_game_index_lang",
        kwargs={"ui_lang": resolved_lang, "game_slug": game.slug},
    )
    context = {
        "page_title": game.title,
        "loading_label": "게임 리소스를 준비하고 있습니다...",
        "index_url": index_url,
        "engine_js_url": _media_url_for_path(engine_js_path),
        "engine_wasm_url": _media_url_for_path(engine_wasm_path),
        "jszip_url": _media_url_for_path(jszip_path),
        "meta_title": _game_meta_title(game),
        "meta_og_title": _game_meta_title(game),
        "meta_description": game.description_en if resolved_lang == "en" else game.description_ko,
        "sub_category": "game",
    }
    context["meta_og_description"] = context["meta_description"]
    thumbnail_url = _game_thumbnail_url(game)
    meta_image_url = build_public_absolute_url(thumbnail_url) if thumbnail_url else ONSCRIPTER_META_IMAGE_URL
    context["meta_og_image"] = meta_image_url
    context["meta_twitter_image"] = meta_image_url
    if not thumbnail_url:
        context["meta_image_alt"] = ONSCRIPTER_META_IMAGE_ALT
    apply_ui_context(request, context, resolved_lang)
    _apply_onscripter_auth_context(request, context, resolved_lang)
    response = render(request, "fun/onscripter_player.html", context)
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@require_GET
def onscripter_game_index(request, ui_lang=None, game_slug="haruuru"):
    _require_onscripter_access(request)
    game = _get_game_or_404(game_slug)
    try:
        payload = _build_game_index(request, game, ui_lang)
    except FileNotFoundError:
        return JsonResponse({"error": "game_files_unavailable"}, status=503)

    response = JsonResponse(payload, json_dumps_params={"ensure_ascii": False})
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


@csrf_protect
@require_http_methods(["GET", "POST"])
def onscripter_game_save(request, ui_lang=None, game_slug="haruuru"):
    _require_onscripter_access(request)
    game = _get_game_or_404(game_slug)
    owner_key = _save_owner_key(request)
    archive_path = _save_archive_path(game, owner_key)

    if request.method == "GET":
        if not archive_path.is_file():
            return HttpResponse(status=204)
        response = FileResponse(open(archive_path, "rb"), content_type="application/zip")
        response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response

    if len(request.body) > MAX_SAVE_ARCHIVE_BYTES:
        return JsonResponse({"error": "save_too_large"}, status=413)

    archive_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = archive_path.with_suffix(".zip.tmp")
    temp_path.write_bytes(request.body)
    temp_path.replace(archive_path)
    return JsonResponse({"ok": True, "size": archive_path.stat().st_size})
