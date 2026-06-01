from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from git.models import GitHubAccountMapping


@dataclass
class GitHubTokenData:
    access_token: str
    token_type: str = ""
    scope: str = ""
    expires_at: object | None = None
    refresh_token: str = ""
    refresh_token_expires_at: object | None = None


@dataclass
class GitHubIdentity:
    github_user_id: int
    login: str
    name: str = ""
    email: str = ""
    avatar_url: str = ""
    email_verified: bool = False


class GitHubAuthError(Exception):
    pass


def is_github_auth_configured() -> bool:
    return bool(
        str(getattr(settings, "GITHUB_APP_CLIENT_ID", "") or "").strip()
        and str(getattr(settings, "GITHUB_APP_CLIENT_SECRET", "") or "").strip()
    )


def build_github_authorize_url(callback_url: str, state: str) -> str:
    client_id = str(getattr(settings, "GITHUB_APP_CLIENT_ID", "") or "").strip()
    if not client_id:
        raise GitHubAuthError("GitHub client id is not configured")
    params = {
        "client_id": client_id,
        "redirect_uri": callback_url,
        "state": state,
    }
    base_url = str(getattr(settings, "GITHUB_AUTH_AUTHORIZE_URL", "https://github.com/login/oauth/authorize") or "").strip()
    return f"{base_url}?{urlencode(params)}"


def _expiry_from_seconds(seconds_value):
    try:
        seconds = int(seconds_value)
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    return timezone.now() + timedelta(seconds=seconds)


def exchange_github_code(code: str, callback_url: str) -> GitHubTokenData:
    if not is_github_auth_configured():
        raise GitHubAuthError("GitHub auth is not configured")
    token_url = str(getattr(settings, "GITHUB_AUTH_TOKEN_URL", "https://github.com/login/oauth/access_token") or "").strip()
    try:
        response = httpx.post(
            token_url,
            data={
                "client_id": str(getattr(settings, "GITHUB_APP_CLIENT_ID", "") or "").strip(),
                "client_secret": str(getattr(settings, "GITHUB_APP_CLIENT_SECRET", "") or "").strip(),
                "code": code,
                "redirect_uri": callback_url,
            },
            headers={"Accept": "application/json"},
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GitHubAuthError("GitHub token request failed") from exc

    if payload.get("error"):
        description = payload.get("error_description") or payload.get("error") or "GitHub token request failed"
        raise GitHubAuthError(str(description))

    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise GitHubAuthError("GitHub access token missing")

    return GitHubTokenData(
        access_token=access_token,
        token_type=str(payload.get("token_type") or "").strip(),
        scope=str(payload.get("scope") or "").strip(),
        expires_at=_expiry_from_seconds(payload.get("expires_in")),
        refresh_token=str(payload.get("refresh_token") or "").strip(),
        refresh_token_expires_at=_expiry_from_seconds(payload.get("refresh_token_expires_in")),
    )


def _github_headers(access_token: str) -> dict:
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {access_token}",
    }
    api_version = str(getattr(settings, "GITHUB_API_VERSION", "") or "").strip()
    if api_version:
        headers["X-GitHub-Api-Version"] = api_version
    return headers


def _github_api_url(path: str) -> str:
    base_url = str(getattr(settings, "GITHUB_API_BASE_URL", "https://api.github.com") or "").strip().rstrip("/")
    return f"{base_url}/{path.lstrip('/')}"


def _fetch_primary_email(access_token: str) -> tuple[str, bool]:
    try:
        response = httpx.get(
            _github_api_url("/user/emails"),
            headers=_github_headers(access_token),
            timeout=10.0,
        )
        if response.status_code in {403, 404}:
            return "", False
        response.raise_for_status()
        emails = response.json()
    except (httpx.HTTPError, ValueError):
        return "", False

    if not isinstance(emails, list):
        return "", False
    primary_verified = [
        item for item in emails
        if item.get("primary") and item.get("verified") and item.get("email")
    ]
    verified = [
        item for item in emails
        if item.get("verified") and item.get("email")
    ]
    selected = (primary_verified or verified or [])
    if not selected:
        return "", False
    return str(selected[0].get("email") or "").strip(), True


def fetch_github_identity(access_token: str) -> GitHubIdentity:
    try:
        response = httpx.get(
            _github_api_url("/user"),
            headers=_github_headers(access_token),
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GitHubAuthError("GitHub user request failed") from exc

    try:
        github_user_id = int(payload.get("id"))
    except (TypeError, ValueError) as exc:
        raise GitHubAuthError("GitHub user id missing") from exc

    login = str(payload.get("login") or "").strip()
    if not login:
        raise GitHubAuthError("GitHub login missing")

    email, email_verified = _fetch_primary_email(access_token)
    if not email:
        email = str(payload.get("email") or "").strip()
        email_verified = False

    return GitHubIdentity(
        github_user_id=github_user_id,
        login=login,
        name=str(payload.get("name") or "").strip(),
        email=email,
        avatar_url=str(payload.get("avatar_url") or "").strip(),
        email_verified=email_verified,
    )


def build_unique_github_username(identity: GitHubIdentity) -> str:
    UserModel = get_user_model()
    base = re.sub(r"[^A-Za-z0-9_.-]+", "-", identity.login).strip(".-_")
    if not base:
        base = f"github-{identity.github_user_id}"
    base = base[:120]
    if not UserModel.objects.filter(username=base).exists():
        return base

    suffix = f"-gh{identity.github_user_id}"
    candidate = f"{base[:150 - len(suffix)]}{suffix}"
    if not UserModel.objects.filter(username=candidate).exists():
        return candidate

    counter = 2
    while True:
        suffix = f"-gh{identity.github_user_id}-{counter}"
        candidate = f"{base[:150 - len(suffix)]}{suffix}"
        if not UserModel.objects.filter(username=candidate).exists():
            return candidate
        counter += 1


def resolve_github_user(identity: GitHubIdentity, *, mode: str, current_user=None):
    mapping = GitHubAccountMapping.objects.filter(github_user_id=identity.github_user_id).select_related("user").first()
    if mapping is not None:
        return mapping.user, False

    if current_user is not None and getattr(current_user, "is_authenticated", False):
        return current_user, False

    if identity.email and identity.email_verified:
        UserModel = get_user_model()
        existing = UserModel.objects.filter(email__iexact=identity.email).order_by("id").first()
        if existing is not None:
            return existing, False

    if mode != "signup":
        return None, False

    UserModel = get_user_model()
    username = build_unique_github_username(identity)
    user = UserModel.objects.create_user(
        username=username,
        email=identity.email if identity.email_verified else "",
        password=None,
    )
    if identity.name:
        user.first_name = identity.name[:150]
        user.save(update_fields=["first_name"])
    return user, True


def save_github_mapping(user, identity: GitHubIdentity, token_data: GitHubTokenData) -> GitHubAccountMapping:
    GitHubAccountMapping.objects.filter(user=user).exclude(github_user_id=identity.github_user_id).delete()
    mapping, _ = GitHubAccountMapping.objects.update_or_create(
        github_user_id=identity.github_user_id,
        defaults={
            "user": user,
            "github_login": identity.login,
            "github_name": identity.name,
            "github_email": identity.email if identity.email_verified else "",
            "github_avatar_url": identity.avatar_url,
            "user_access_token": token_data.access_token,
            "user_access_token_expires_at": token_data.expires_at,
            "user_refresh_token": token_data.refresh_token,
            "user_refresh_token_expires_at": token_data.refresh_token_expires_at,
            "token_scope": token_data.scope,
            "token_type": token_data.token_type,
        },
    )
    return mapping
