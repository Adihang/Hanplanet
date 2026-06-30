from __future__ import annotations

import json
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DISC = "hdd"
TEMPORARY_ROOT = Path("/Users/imhanbyeol/temporary/hanplanet-ssd")
HDD_MEDIA_ROOT = Path("/Volumes/HANPLANET_HDD/Hanplanet/media")
HDD_FORGEJO_REPOS_ROOT = Path("/Volumes/HANPLANET_HDD/Hanplanet/forgejo-repos")
HDD_GITHUB_REPO_CACHE_ROOT = Path("/Volumes/HANPLANET_HDD/Hanplanet/github-repo-cache")


def _load_secrets() -> dict:
    secrets_path = BASE_DIR / "config" / "secrets.json"
    if not secrets_path.exists():
        return {}
    try:
        return json.loads(secrets_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _env_path(name: str) -> Path | None:
    value = str(os.environ.get(name) or "").strip()
    if not value:
        return None
    return Path(value).expanduser()


def get_disc_mode(default: str = DEFAULT_DISC) -> str:
    env_value = str(os.environ.get("DISC") or os.environ.get("HANPLANET_DISC") or "").strip().lower()
    if env_value in {"ssd", "hdd"}:
        return env_value

    secret_value = str(_load_secrets().get("DISC") or "").strip().lower()
    if secret_value in {"ssd", "hdd"}:
        return secret_value

    return default


def get_media_root(disc_mode: str | None = None) -> Path:
    override = _env_path("HANPLANET_MEDIA_ROOT")
    if override is not None:
        return override

    mode = (disc_mode or get_disc_mode()).strip().lower()
    if mode == "ssd":
        return TEMPORARY_ROOT / "media"
    return HDD_MEDIA_ROOT


def get_forgejo_repos_root(disc_mode: str | None = None) -> Path:
    override = _env_path("HANPLANET_FORGEJO_REPOS_ROOT")
    if override is not None:
        return override

    mode = (disc_mode or get_disc_mode()).strip().lower()
    if mode == "ssd":
        return TEMPORARY_ROOT / "forgejo-repos"
    return HDD_FORGEJO_REPOS_ROOT


def get_github_repo_cache_root(disc_mode: str | None = None) -> Path:
    override = _env_path("HANPLANET_GITHUB_REPO_CACHE_ROOT")
    if override is not None:
        return override

    mode = (disc_mode or get_disc_mode()).strip().lower()
    if mode == "ssd":
        return TEMPORARY_ROOT / "github-repo-cache"
    return HDD_GITHUB_REPO_CACHE_ROOT


def get_required_storage_paths(disc_mode: str | None = None) -> list[Path]:
    mode = (disc_mode or get_disc_mode()).strip().lower()
    media_root = get_media_root(mode)
    repos_root = get_forgejo_repos_root(mode)
    if mode == "ssd":
        return []
    return [
        media_root / "HanDrive",
        media_root / "uploads",
        repos_root,
    ]
