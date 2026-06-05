"""Handrive Sync Client JWT 인증 유틸리티.

access token  — 단기 (기본 1시간). API 요청마다 사용.
refresh token — 장기 (기본 30일). access 갱신에만 사용.
클라이언트는 refresh token만 디스크에 저장 (비밀번호 저장 금지).
"""
import time
from typing import Optional

import jwt
from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import User

from .auth_safety import contains_forbidden_auth_char


_ALGORITHM = "HS256"
_ACCESS_TYPE = "access"
_REFRESH_TYPE = "refresh"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _issue_token(user: User, token_type: str, exp_seconds: int) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "type": token_type,
        "iat": now,
        "exp": now + exp_seconds,
    }
    return jwt.encode(payload, settings.SYNC_JWT_SECRET, algorithm=_ALGORITHM)


def issue_token_pair(user: User) -> dict:
    """access + refresh 토큰 쌍을 발급해 반환."""
    return {
        "access_token": _issue_token(user, _ACCESS_TYPE, settings.SYNC_JWT_ACCESS_EXP_SECONDS),
        "refresh_token": _issue_token(user, _REFRESH_TYPE, settings.SYNC_JWT_REFRESH_EXP_SECONDS),
        "access_expires_in": settings.SYNC_JWT_ACCESS_EXP_SECONDS,
    }


def verify_access_token(token: str) -> Optional[User]:
    """access token 검증 후 User 반환. 유효하지 않으면 None."""
    try:
        payload = jwt.decode(token, settings.SYNC_JWT_SECRET, algorithms=[_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != _ACCESS_TYPE:
        return None
    try:
        return User.objects.get(id=int(payload["sub"]))
    except (User.DoesNotExist, KeyError, ValueError):
        return None


def refresh_access_token(refresh_token: str) -> Optional[str]:
    """refresh token으로 새 access token 발급. 유효하지 않으면 None."""
    try:
        payload = jwt.decode(refresh_token, settings.SYNC_JWT_SECRET, algorithms=[_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != _REFRESH_TYPE:
        return None
    try:
        user = User.objects.get(id=int(payload["sub"]))
    except (User.DoesNotExist, KeyError, ValueError):
        return None
    return _issue_token(user, _ACCESS_TYPE, settings.SYNC_JWT_ACCESS_EXP_SECONDS)


def login_and_issue_tokens(username: str, password: str) -> Optional[dict]:
    """username/password 검증 후 토큰 쌍 발급. 실패 시 None."""
    if contains_forbidden_auth_char(username) or contains_forbidden_auth_char(password):
        return None
    user = authenticate(username=username, password=password)
    if user is None or not user.is_active:
        return None
    return issue_token_pair(user)


def require_sync_auth(request) -> Optional[User]:
    """뷰에서 사용: Authorization 헤더에서 Bearer 토큰을 추출해 User 반환.

    인증 실패 시 None.
    """
    auth_header = request.META.get("HTTP_AUTHORIZATION", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[len("Bearer "):]
    return verify_access_token(token)
