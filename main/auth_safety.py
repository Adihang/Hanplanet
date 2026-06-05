from __future__ import annotations

import re

from django.core.exceptions import ValidationError


HANDRIVE_AUTH_FORBIDDEN_CHAR_PATTERN = re.compile(r"[\s\x00-\x1f\x7f'\"`/\\<>;|&“”‘’]")
HANDRIVE_AUTH_SAFE_INPUT_PATTERN = "^[^\\s'\\\"`/\\\\<>;|&“”‘’]+$"
HANDRIVE_AUTH_VALIDATION_ERROR_CODE = "forbidden_auth_char"


def contains_forbidden_auth_char(value: str | None) -> bool:
    return bool(HANDRIVE_AUTH_FORBIDDEN_CHAR_PATTERN.search(str(value or "")))


def get_auth_forbidden_char_message(field_name: str, handrive_text: dict | None = None) -> str:
    text = handrive_text or {}
    if field_name == "password":
        return text.get(
            "auth_password_forbidden_chars",
            "비밀번호에는 공백, 따옴표, 슬래시 등 보안상 위험한 문자를 사용할 수 없습니다.",
        )
    return text.get(
        "auth_username_forbidden_chars",
        "아이디에는 공백, 따옴표, 슬래시 등 보안상 위험한 문자를 사용할 수 없습니다.",
    )


def validate_auth_safe_value(value: str | None, field_name: str, handrive_text: dict | None = None) -> None:
    if contains_forbidden_auth_char(value):
        raise ValidationError(
            get_auth_forbidden_char_message(field_name, handrive_text),
            code=HANDRIVE_AUTH_VALIDATION_ERROR_CODE,
        )
