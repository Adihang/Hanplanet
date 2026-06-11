from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlencode

import httpx
from django.conf import settings
from django.utils import timezone

from git.models import GoogleAccountMapping


@dataclass
class GoogleTokenData:
    access_token: str
    token_type: str = ""
    scope: str = ""
    expires_at: object | None = None
    refresh_token: str = ""
    refresh_token_expires_at: object | None = None


@dataclass
class GoogleIdentity:
    google_user_id: str
    email: str
    name: str = ""
    avatar_url: str = ""
    email_verified: bool = False


class GoogleAuthError(Exception):
    pass


GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
GOOGLE_BASE_AUTH_SCOPE = "openid email profile"


def is_google_auth_configured() -> bool:
    return bool(
        str(getattr(settings, "GOOGLE_AUTH_CLIENT_ID", "") or "").strip()
        and str(getattr(settings, "GOOGLE_AUTH_CLIENT_SECRET", "") or "").strip()
    )


def get_google_auth_scope() -> str:
    return str(getattr(settings, "GOOGLE_AUTH_SCOPE", "openid email profile") or "").strip()


def get_google_base_auth_scope() -> str:
    return str(getattr(settings, "GOOGLE_AUTH_BASE_SCOPE", GOOGLE_BASE_AUTH_SCOPE) or "").strip()


def get_google_drive_file_scope() -> str:
    return str(getattr(settings, "GOOGLE_AUTH_DRIVE_FILE_SCOPE", GOOGLE_DRIVE_FILE_SCOPE) or "").strip()


def merge_google_scope_values(*scope_values: str | None) -> str:
    seen: set[str] = set()
    scopes: list[str] = []
    for scope_value in scope_values:
        for item in str(scope_value or "").replace(",", " ").split():
            scope = item.strip()
            if not scope or scope in seen:
                continue
            seen.add(scope)
            scopes.append(scope)
    return " ".join(scopes)


def google_token_has_drive_scope(scope: str | None) -> bool:
    scopes = {
        item.strip()
        for item in str(scope or "").replace(",", " ").split()
        if item.strip()
    }
    return GOOGLE_DRIVE_SCOPE in scopes or GOOGLE_DRIVE_FILE_SCOPE in scopes


def build_google_authorize_url(
    callback_url: str,
    state: str,
    *,
    scope: str | None = None,
    login_hint: str | None = None,
) -> str:
    client_id = str(getattr(settings, "GOOGLE_AUTH_CLIENT_ID", "") or "").strip()
    if not client_id:
        raise GoogleAuthError("Google client id is not configured")
    params = {
        "client_id": client_id,
        "redirect_uri": callback_url,
        "response_type": "code",
        "scope": str(scope or get_google_auth_scope() or "").strip(),
        "state": state,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
    }
    normalized_login_hint = str(login_hint or "").strip()
    if normalized_login_hint:
        params["login_hint"] = normalized_login_hint
    base_url = str(
        getattr(settings, "GOOGLE_AUTH_AUTHORIZE_URL", "https://accounts.google.com/o/oauth2/v2/auth") or ""
    ).strip()
    return f"{base_url}?{urlencode(params)}"


def _expiry_from_seconds(seconds_value):
    try:
        seconds = int(seconds_value)
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    return timezone.now() + timedelta(seconds=seconds)


def exchange_google_code(code: str, callback_url: str) -> GoogleTokenData:
    if not is_google_auth_configured():
        raise GoogleAuthError("Google auth is not configured")
    token_url = str(getattr(settings, "GOOGLE_AUTH_TOKEN_URL", "https://oauth2.googleapis.com/token") or "").strip()
    try:
        response = httpx.post(
            token_url,
            data={
                "client_id": str(getattr(settings, "GOOGLE_AUTH_CLIENT_ID", "") or "").strip(),
                "client_secret": str(getattr(settings, "GOOGLE_AUTH_CLIENT_SECRET", "") or "").strip(),
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": callback_url,
            },
            headers={"Accept": "application/json"},
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleAuthError("Google token request failed") from exc

    if payload.get("error"):
        description = payload.get("error_description") or payload.get("error") or "Google token request failed"
        raise GoogleAuthError(str(description))

    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise GoogleAuthError("Google access token missing")

    return GoogleTokenData(
        access_token=access_token,
        token_type=str(payload.get("token_type") or "").strip(),
        scope=str(payload.get("scope") or "").strip(),
        expires_at=_expiry_from_seconds(payload.get("expires_in")),
        refresh_token=str(payload.get("refresh_token") or "").strip(),
        refresh_token_expires_at=_expiry_from_seconds(payload.get("refresh_token_expires_in")),
    )


def refresh_google_access_token(mapping: GoogleAccountMapping) -> GoogleTokenData:
    if not is_google_auth_configured():
        raise GoogleAuthError("Google auth is not configured")
    refresh_token = str(getattr(mapping, "user_refresh_token", "") or "").strip()
    if not refresh_token:
        raise GoogleAuthError("Google refresh token missing")

    token_url = str(getattr(settings, "GOOGLE_AUTH_TOKEN_URL", "https://oauth2.googleapis.com/token") or "").strip()
    try:
        response = httpx.post(
            token_url,
            data={
                "client_id": str(getattr(settings, "GOOGLE_AUTH_CLIENT_ID", "") or "").strip(),
                "client_secret": str(getattr(settings, "GOOGLE_AUTH_CLIENT_SECRET", "") or "").strip(),
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            headers={"Accept": "application/json"},
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleAuthError("Google token refresh failed") from exc

    if payload.get("error"):
        description = payload.get("error_description") or payload.get("error") or "Google token refresh failed"
        raise GoogleAuthError(str(description))

    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise GoogleAuthError("Google access token missing")

    token_data = GoogleTokenData(
        access_token=access_token,
        token_type=str(payload.get("token_type") or getattr(mapping, "token_type", "") or "").strip(),
        scope=str(payload.get("scope") or getattr(mapping, "token_scope", "") or "").strip(),
        expires_at=_expiry_from_seconds(payload.get("expires_in")),
        refresh_token=refresh_token,
        refresh_token_expires_at=getattr(mapping, "user_refresh_token_expires_at", None),
    )

    mapping.user_access_token = token_data.access_token
    mapping.user_access_token_expires_at = token_data.expires_at
    mapping.token_scope = token_data.scope
    mapping.token_type = token_data.token_type
    mapping.save(update_fields=[
        "user_access_token",
        "user_access_token_expires_at",
        "token_scope",
        "token_type",
        "updated_at",
    ])
    return token_data


def _google_headers(access_token: str) -> dict:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {access_token}",
    }


def fetch_google_identity(access_token: str) -> GoogleIdentity:
    userinfo_url = str(
        getattr(settings, "GOOGLE_AUTH_USERINFO_URL", "https://www.googleapis.com/oauth2/v3/userinfo") or ""
    ).strip()
    try:
        response = httpx.get(
            userinfo_url,
            headers=_google_headers(access_token),
            timeout=10.0,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleAuthError("Google user request failed") from exc

    google_user_id = str(payload.get("sub") or "").strip()
    if not google_user_id:
        raise GoogleAuthError("Google user id missing")

    email = str(payload.get("email") or "").strip()
    email_verified = bool(payload.get("email_verified"))
    if not email or not email_verified:
        raise GoogleAuthError("Google verified email missing")

    return GoogleIdentity(
        google_user_id=google_user_id,
        email=email,
        name=str(payload.get("name") or "").strip(),
        avatar_url=str(payload.get("picture") or "").strip(),
        email_verified=email_verified,
    )


def save_google_mapping(user, identity: GoogleIdentity, token_data: GoogleTokenData) -> GoogleAccountMapping:
    GoogleAccountMapping.objects.filter(user=user).exclude(google_user_id=identity.google_user_id).delete()
    existing_mapping = GoogleAccountMapping.objects.filter(google_user_id=identity.google_user_id).first()
    refresh_token = token_data.refresh_token or str(getattr(existing_mapping, "user_refresh_token", "") or "")
    refresh_token_expires_at = token_data.refresh_token_expires_at or getattr(existing_mapping, "user_refresh_token_expires_at", None)
    token_scope = merge_google_scope_values(getattr(existing_mapping, "token_scope", ""), token_data.scope)
    mapping, _ = GoogleAccountMapping.objects.update_or_create(
        google_user_id=identity.google_user_id,
        defaults={
            "user": user,
            "google_email": identity.email,
            "google_name": identity.name,
            "google_avatar_url": identity.avatar_url,
            "google_profile_synced_at": timezone.now(),
            "user_access_token": token_data.access_token,
            "user_access_token_expires_at": token_data.expires_at,
            "user_refresh_token": refresh_token,
            "user_refresh_token_expires_at": refresh_token_expires_at,
            "token_scope": token_scope,
            "token_type": token_data.token_type,
        },
    )
    return mapping
