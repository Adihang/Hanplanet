from __future__ import annotations

"""HanDrive HTML companion asset helper.

HTML 미리보기/읽기에서는 HTML 파일이 있는 폴더를 작은 정적 사이트 루트로 본다.
``index.html`` 은 ``css/index.css`` 와 ``js/index.js`` 를 자동 적용하고,
``css/globals.css``, ``css/styleguide.css``, ``js/common.js`` 는 공통 asset 으로
항상 먼저 적용한다.
"""

from pathlib import Path
from typing import Callable

HTML_COMMON_CSS_PATHS = (
    Path("css/globals.css"),
    Path("css/styleguide.css"),
    Path("css/common.css"),
)
HTML_COMMON_JS_PATHS = (
    Path("js/common.js"),
)


def _read_text_file(path_obj: Path) -> str:
    """Read UTF-8 text defensively so preview helpers can treat decode failure as 'asset absent'."""
    try:
        return path_obj.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _build_companion_asset_paths(base_path: Path) -> tuple[list[Path], list[Path]]:
    """Return ordered CSS/JS paths used by HTML live preview injection."""
    stem = base_path.stem
    parent = base_path.parent
    css_paths = [parent / relative for relative in HTML_COMMON_CSS_PATHS]
    css_paths.append(parent / "css" / f"{stem}.css")
    js_paths = [parent / relative for relative in HTML_COMMON_JS_PATHS]
    js_paths.append(parent / "js" / f"{stem}.js")
    return css_paths, js_paths


def _join_asset_text(parts: list[tuple[str, str]], *, comment_prefix: str, comment_suffix: str = "") -> str:
    blocks: list[str] = []
    for label, text in parts:
        normalized_text = str(text or "").strip()
        if not normalized_text:
            continue
        if comment_suffix:
            blocks.append(f"{comment_prefix} {label} {comment_suffix}\n{normalized_text}")
        else:
            blocks.append(f"{comment_prefix} {label}\n{normalized_text}")
    return "\n\n".join(blocks)


def load_local_html_companion_assets(
    source_path: Path,
    *,
    can_read_path: Callable[[Path], bool] | None = None,
) -> tuple[str, str]:
    """실제 파일 시스템의 HTML companion asset 을 읽는다."""
    if source_path.suffix.lower() != ".html":
        return "", ""

    companion_css_paths, companion_js_paths = _build_companion_asset_paths(source_path)

    def _load(path_obj: Path) -> str:
        if not path_obj.exists() or not path_obj.is_file():
            return ""
        if can_read_path is not None and not can_read_path(path_obj):
            return ""
        return _read_text_file(path_obj)

    css_parts = [
        (path_obj.relative_to(source_path.parent).as_posix(), _load(path_obj))
        for path_obj in companion_css_paths
    ]
    js_parts = [
        (path_obj.relative_to(source_path.parent).as_posix(), _load(path_obj))
        for path_obj in companion_js_paths
    ]
    return (
        _join_asset_text(css_parts, comment_prefix="/*", comment_suffix="*/"),
        _join_asset_text(js_parts, comment_prefix="//"),
    )


def load_repo_html_companion_assets(
    repo_relative_path: str,
    *,
    path_exists: Callable[[str], bool],
    read_text_file: Callable[[str], str],
) -> tuple[str, str]:
    """repo branch 내부 가상 경로의 HTML companion asset 을 읽는다."""
    target_path = Path(str(repo_relative_path or ""))
    if target_path.suffix.lower() != ".html":
        return "", ""

    companion_css_paths, companion_js_paths = _build_companion_asset_paths(target_path)

    def _load(path_obj: Path) -> str:
        relative_path = path_obj.as_posix()
        if not path_exists(relative_path):
            return ""
        try:
            return read_text_file(relative_path)
        except (OSError, UnicodeDecodeError):
            return ""

    css_parts = [(path_obj.as_posix(), _load(path_obj)) for path_obj in companion_css_paths]
    js_parts = [(path_obj.as_posix(), _load(path_obj)) for path_obj in companion_js_paths]
    return (
        _join_asset_text(css_parts, comment_prefix="/*", comment_suffix="*/"),
        _join_asset_text(js_parts, comment_prefix="//"),
    )
