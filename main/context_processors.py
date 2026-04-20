from __future__ import annotations


def site_meta_defaults(request):
    ui_lang = "ko"
    if request is not None:
        path = str(getattr(request, "path", "") or "")
        if path.startswith("/en/") or path == "/en":
            ui_lang = "en"
        elif path.startswith("/ko/") or path == "/ko":
            ui_lang = "ko"
        else:
            try:
                session_lang = request.session.get("portfolio_ui_lang")
            except Exception:
                session_lang = None
            if session_lang in {"ko", "en"}:
                ui_lang = session_lang

    canonical_url = ""
    if request is not None:
        try:
            canonical_url = request.build_absolute_uri(request.get_full_path())
        except Exception:
            canonical_url = ""

    return {
        "ui_lang": ui_lang,
        "meta_canonical_url": canonical_url,
        "meta_og_url": canonical_url,
        "meta_og_image": "https://www.hanplanet.com/static/media/icons/hanplanet-og-1200.png",
        "meta_twitter_image": "https://www.hanplanet.com/static/media/icons/hanplanet-og-1200.png",
        "meta_title": "Hanplanet",
        "meta_description": "Django로 작성한 포트폴리오 입니다.",
        "meta_author": "Hanplanet",
        "meta_robots": "index,follow",
        "meta_og_title": "Hanplanet",
        "meta_site_name": "Hanplanet",
        "meta_og_description": "Django로 작성한 포트폴리오 입니다.",
    }
