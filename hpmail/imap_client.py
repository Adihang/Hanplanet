from __future__ import annotations

import base64
import imaplib
import re
from email import policy
from email.parser import BytesParser
from email.utils import parsedate_to_datetime

from django.conf import settings
from django.core.exceptions import ValidationError
from django.utils import timezone

from .models import MailAccount


class HPmailNotConfigured(RuntimeError):
    pass


class HPmailImapError(RuntimeError):
    pass


REMOTE_IMAGE_SRC_RE = re.compile(r"\s(src)\s*=\s*([\"'])(https?://.*?)(\2)", re.IGNORECASE | re.DOTALL)
SCRIPT_BLOCK_RE = re.compile(r"<\s*(script|style)\b.*?>.*?<\s*/\s*\1\s*>", re.IGNORECASE | re.DOTALL)
EVENT_HANDLER_RE = re.compile(r"\son[a-z]+\s*=\s*([\"']).*?\1", re.IGNORECASE | re.DOTALL)
MAILBOX_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
SYSTEM_MAILBOX_ORDER = ("INBOX", "SENT", "DRAFTS", "TRASH", "SPAM")
MAX_CUSTOM_MAILBOX_NAME_LENGTH = 80


def _decode_header_value(message, key: str) -> str:
    value = message.get(key, "")
    return str(value or "").strip()


def _parse_message_date(value: str):
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed.astimezone(timezone.get_current_timezone())


def _sanitize_html_for_preview(html: str) -> str:
    cleaned = SCRIPT_BLOCK_RE.sub("", html or "")
    cleaned = EVENT_HANDLER_RE.sub("", cleaned)
    cleaned = REMOTE_IMAGE_SRC_RE.sub(r" data-hpmail-remote-src=\2\3\4", cleaned)
    return cleaned


def _encode_modified_utf7(value: str) -> str:
    result = []
    buffer = []

    def flush_buffer():
        if not buffer:
            return
        raw_bytes = "".join(buffer).encode("utf-16-be")
        encoded = base64.b64encode(raw_bytes).decode("ascii").rstrip("=").replace("/", ",")
        result.append(f"&{encoded}-")
        buffer.clear()

    for char in str(value or ""):
        codepoint = ord(char)
        if 0x20 <= codepoint <= 0x7E:
            flush_buffer()
            result.append("&-" if char == "&" else char)
        else:
            buffer.append(char)
    flush_buffer()
    return "".join(result)


def _decode_modified_utf7(value: str) -> str:
    text = str(value or "")
    result = []
    index = 0
    while index < len(text):
        char = text[index]
        if char != "&":
            result.append(char)
            index += 1
            continue
        end_index = text.find("-", index)
        if end_index == -1:
            result.append(char)
            index += 1
            continue
        token = text[index + 1:end_index]
        if not token:
            result.append("&")
        else:
            padded = token.replace(",", "/")
            padded += "=" * ((4 - len(padded) % 4) % 4)
            try:
                result.append(base64.b64decode(padded).decode("utf-16-be"))
            except (ValueError, UnicodeDecodeError):
                result.append(text[index:end_index + 1])
        index = end_index + 1
    return "".join(result)


def _unquote_mailbox_token(value: str) -> str:
    token = str(value or "").strip()
    if len(token) >= 2 and token[0] == '"' and token[-1] == '"':
        token = token[1:-1]
        token = token.replace(r"\\", "\\").replace(r"\"", '"')
    return token


def _mailbox_argument(value: str) -> str:
    encoded = _encode_modified_utf7(str(value or "").strip() or "INBOX")
    if encoded.upper() == "INBOX":
        return "INBOX"
    escaped = encoded.replace("\\", "\\\\").replace('"', r"\"")
    return f'"{escaped}"'


def canonical_mailbox_name(name: str) -> str:
    raw_name = str(name or "").strip()
    path_leaf = next((part for part in reversed(re.split(r"[\\/]", raw_name)) if part), raw_name)
    folder_name = path_leaf.lstrip(".")
    dotted_parts = [part for part in folder_name.split(".") if part]
    leaf_name = dotted_parts[-1] if len(dotted_parts) > 1 and dotted_parts[0].upper() == "INBOX" else folder_name
    normalized = re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", leaf_name)).strip().upper()
    if normalized in {"INBOX", "받은 메일함", "받은메일함", "받은편지함"}:
        return "INBOX"
    if normalized in {"SENT", "SENT MAIL", "SENT MESSAGES", "SENT ITEMS", "보낸 메일함", "보낸메일함"}:
        return "SENT"
    if normalized in {"DRAFT", "DRAFTS", "임시 보관함", "임시보관함"}:
        return "DRAFTS"
    if normalized in {"TRASH", "BIN", "DELETED", "DELETED ITEMS", "DELETED MESSAGES", "휴지통"}:
        return "TRASH"
    if normalized in {"JUNK", "JUNK EMAIL", "JUNK E MAIL", "SPAM", "스팸"}:
        return "SPAM"
    return normalized


def is_system_mailbox(name: str) -> bool:
    return canonical_mailbox_name(name) in SYSTEM_MAILBOX_ORDER


def validate_custom_mailbox_name(value: str) -> str:
    name = str(value or "").strip()
    if not name:
        raise ValidationError("메일함 이름을 입력해주세요.")
    if len(name) > MAX_CUSTOM_MAILBOX_NAME_LENGTH:
        raise ValidationError(f"메일함 이름은 {MAX_CUSTOM_MAILBOX_NAME_LENGTH}자 이내로 입력해주세요.")
    if MAILBOX_CONTROL_RE.search(name) or any(char in name for char in ['"', "\\", "/"]):
        raise ValidationError('메일함 이름에는 따옴표, 역슬래시, 슬래시를 사용할 수 없습니다.')
    if name in {".", ".."} or name.startswith("."):
        raise ValidationError("점으로 시작하는 메일함 이름은 사용할 수 없습니다.")
    if is_system_mailbox(name):
        raise ValidationError("기본 메일함 이름은 사용할 수 없습니다.")
    return name


def _mailbox_payload(name: str, flags: list[str] | None = None) -> dict:
    canonical_name = canonical_mailbox_name(name)
    is_system = canonical_name in SYSTEM_MAILBOX_ORDER
    return {
        "name": name,
        "flags": flags or [],
        "canonical": canonical_name,
        "is_system": is_system,
        "can_modify": not is_system,
    }


def _decode_part_payload(part) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        return ""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _extract_bodies(message) -> tuple[str, str]:
    text_body = ""
    html_body = ""
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_disposition() == "attachment":
                continue
            content_type = part.get_content_type()
            if content_type == "text/plain" and not text_body:
                text_body = _decode_part_payload(part)
            elif content_type == "text/html" and not html_body:
                html_body = _sanitize_html_for_preview(_decode_part_payload(part))
    else:
        if message.get_content_type() == "text/html":
            html_body = _sanitize_html_for_preview(_decode_part_payload(message))
        else:
            text_body = _decode_part_payload(message)
    return text_body, html_body


def _extract_attachments(message) -> list[dict]:
    attachments = []
    for part in message.walk() if message.is_multipart() else []:
        if part.get_content_disposition() != "attachment":
            continue
        filename = part.get_filename() or "attachment"
        payload = part.get_payload(decode=True) or b""
        attachments.append({
            "filename": filename,
            "content_type": part.get_content_type(),
            "size_bytes": len(payload),
        })
    return attachments


class HPmailImapClient:
    def __init__(self, account: MailAccount):
        self.account = account
        self.conn = None

    def __enter__(self):
        self.conn = self._connect()
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.conn is not None:
            try:
                self.conn.logout()
            except imaplib.IMAP4.error:
                pass
        self.conn = None

    def _connect(self):
        master_user = str(getattr(settings, "HPMAIL_IMAP_MASTER_USER", "") or "").strip()
        master_password = str(getattr(settings, "HPMAIL_IMAP_MASTER_PASSWORD", "") or "").strip()
        if not master_user or not master_password:
            raise HPmailNotConfigured("HPmail IMAP master user is not configured.")

        host = str(getattr(settings, "HPMAIL_IMAP_HOST", "127.0.0.1") or "127.0.0.1")
        port = int(getattr(settings, "HPMAIL_IMAP_PORT", 143))
        timeout = int(getattr(settings, "HPMAIL_IMAP_TIMEOUT", 10))
        use_tls = bool(getattr(settings, "HPMAIL_IMAP_USE_TLS", False))
        login_format = str(
            getattr(settings, "HPMAIL_IMAP_MASTER_LOGIN_FORMAT", "{email}*{master_user}")
            or "{email}*{master_user}"
        )
        login_user = login_format.format(
            email=self.account.email_address,
            local_part=self.account.local_part,
            domain=self.account.domain,
            master_user=master_user,
        )
        try:
            conn = imaplib.IMAP4_SSL(host, port, timeout=timeout) if use_tls else imaplib.IMAP4(host, port, timeout=timeout)
            conn.login(login_user, master_password)
            return conn
        except OSError as exc:
            raise HPmailImapError(f"IMAP 서버에 연결할 수 없습니다: {exc}") from exc
        except imaplib.IMAP4.error as exc:
            raise HPmailImapError(f"IMAP 인증에 실패했습니다: {exc}") from exc

    def list_mailboxes(self) -> list[dict]:
        status, data = self.conn.list()
        if status != "OK":
            raise HPmailImapError("메일함 목록을 불러오지 못했습니다.")
        mailboxes = []
        for raw_line in data or []:
            line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else str(raw_line)
            match = re.match(r"^\((?P<flags>.*?)\)\s+\"(?P<sep>.*?)\"\s+(?P<name>.*)$", line)
            if not match:
                continue
            name = _decode_modified_utf7(_unquote_mailbox_token(match.group("name")))
            flags = [flag for flag in match.group("flags").split() if flag]
            mailboxes.append(_mailbox_payload(name, flags))
        if not mailboxes:
            mailboxes.append(_mailbox_payload("INBOX", []))
        return mailboxes

    def create_mailbox(self, name: str) -> dict:
        mailbox_name = validate_custom_mailbox_name(name)
        status, _ = self.conn.create(_mailbox_argument(mailbox_name))
        if status != "OK":
            raise HPmailImapError("메일함을 만들지 못했습니다.")
        return _mailbox_payload(mailbox_name, [])

    def rename_mailbox(self, mailbox: str, new_name: str) -> dict:
        mailbox_name = str(mailbox or "").strip()
        if not mailbox_name:
            raise HPmailImapError("변경할 메일함이 필요합니다.")
        if is_system_mailbox(mailbox_name):
            raise HPmailImapError("기본 메일함은 이름을 변경할 수 없습니다.")
        new_mailbox_name = validate_custom_mailbox_name(new_name)
        status, _ = self.conn.rename(_mailbox_argument(mailbox_name), _mailbox_argument(new_mailbox_name))
        if status != "OK":
            raise HPmailImapError("메일함 이름을 변경하지 못했습니다.")
        return _mailbox_payload(new_mailbox_name, [])

    def ensure_mailbox(self, mailbox: str):
        status, _ = self.conn.create(_mailbox_argument(mailbox))
        if status not in {"OK", "NO"}:
            raise HPmailImapError("필수 메일함을 준비하지 못했습니다.")

    def delete_custom_mailbox(self, mailbox: str, destination: str = "Drafts") -> dict:
        mailbox_name = str(mailbox or "").strip()
        if not mailbox_name:
            raise HPmailImapError("삭제할 메일함이 필요합니다.")
        if is_system_mailbox(mailbox_name):
            raise HPmailImapError("기본 메일함은 삭제할 수 없습니다.")

        destination_name = str(destination or "Drafts").strip() or "Drafts"
        self.ensure_mailbox(destination_name)
        status, _ = self.conn.select(_mailbox_argument(mailbox_name))
        if status != "OK":
            raise HPmailImapError("삭제할 메일함을 열지 못했습니다.")
        status, data = self.conn.uid("search", None, "ALL")
        if status != "OK":
            raise HPmailImapError("삭제할 메일함의 메시지를 확인하지 못했습니다.")
        moved_count = len((data[0] or b"").split()) if data else 0
        if moved_count:
            status, _ = self.conn.uid("move", "1:*", _mailbox_argument(destination_name))
            if status != "OK":
                raise HPmailImapError("메일함의 메시지를 임시 보관함으로 이동하지 못했습니다.")
        try:
            self.conn.close()
        except imaplib.IMAP4.error:
            pass
        status, _ = self.conn.delete(_mailbox_argument(mailbox_name))
        if status != "OK":
            raise HPmailImapError("메일함을 삭제하지 못했습니다.")
        return {"mailbox": mailbox_name, "destination": destination_name, "moved_count": moved_count}

    def list_messages(self, mailbox: str = "INBOX", *, limit: int = 50, offset: int = 0) -> dict:
        mailbox = mailbox or "INBOX"
        self.conn.select(_mailbox_argument(mailbox), readonly=True)
        status, data = self.conn.uid("search", None, "ALL")
        if status != "OK":
            raise HPmailImapError("메시지 목록을 불러오지 못했습니다.")
        all_uids = (data[0] or b"").split()
        total = len(all_uids)
        selected_uids = list(reversed(all_uids))[offset:offset + limit]
        messages = [self._fetch_message_summary(uid.decode("ascii")) for uid in selected_uids]
        return {"mailbox": mailbox, "total": total, "messages": messages}

    def _fetch_message_summary(self, uid: str) -> dict:
        fetch_args = "(FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)])"
        status, data = self.conn.uid("fetch", uid, fetch_args)
        if status != "OK":
            raise HPmailImapError(f"메시지를 불러오지 못했습니다: {uid}")
        header_bytes = b""
        meta_text = ""
        for item in data or []:
            if isinstance(item, tuple):
                meta_text = item[0].decode("utf-8", errors="replace")
                header_bytes = item[1] or b""
                break
        message = BytesParser(policy=policy.default).parsebytes(header_bytes)
        flags_match = re.search(r"FLAGS\s+\((.*?)\)", meta_text)
        size_match = re.search(r"RFC822\.SIZE\s+(\d+)", meta_text)
        return {
            "uid": uid,
            "subject": _decode_header_value(message, "Subject"),
            "from": _decode_header_value(message, "From"),
            "to": _decode_header_value(message, "To"),
            "date": _decode_header_value(message, "Date"),
            "message_id": _decode_header_value(message, "Message-ID"),
            "received_at": (_parse_message_date(_decode_header_value(message, "Date")) or timezone.now()).isoformat(),
            "size_bytes": int(size_match.group(1)) if size_match else 0,
            "flags": flags_match.group(1).split() if flags_match else [],
        }

    def get_message(self, mailbox: str, uid: str) -> dict:
        mailbox = mailbox or "INBOX"
        self.conn.select(_mailbox_argument(mailbox), readonly=True)
        status, data = self.conn.uid("fetch", str(uid), "(FLAGS RFC822)")
        if status != "OK":
            raise HPmailImapError("메시지를 불러오지 못했습니다.")
        raw_message = b""
        meta_text = ""
        for item in data or []:
            if isinstance(item, tuple):
                meta_text = item[0].decode("utf-8", errors="replace")
                raw_message = item[1] or b""
                break
        message = BytesParser(policy=policy.default).parsebytes(raw_message)
        text_body, html_body = _extract_bodies(message)
        flags_match = re.search(r"FLAGS\s+\((.*?)\)", meta_text)
        return {
            "uid": str(uid),
            "mailbox": mailbox,
            "subject": _decode_header_value(message, "Subject"),
            "from": _decode_header_value(message, "From"),
            "to": _decode_header_value(message, "To"),
            "cc": _decode_header_value(message, "Cc"),
            "date": _decode_header_value(message, "Date"),
            "message_id": _decode_header_value(message, "Message-ID"),
            "body_text": text_body,
            "body_html": html_body,
            "attachments": _extract_attachments(message),
            "flags": flags_match.group(1).split() if flags_match else [],
        }

    def set_seen(self, mailbox: str, uid: str, seen: bool):
        self.conn.select(_mailbox_argument(mailbox or "INBOX"))
        operation = "+FLAGS" if seen else "-FLAGS"
        status, _ = self.conn.uid("store", str(uid), operation, r"(\Seen)")
        if status != "OK":
            raise HPmailImapError("읽음 상태를 변경하지 못했습니다.")

    def move_message(self, mailbox: str, uid: str, destination: str):
        self.conn.select(_mailbox_argument(mailbox or "INBOX"))
        status, _ = self.conn.uid("move", str(uid), _mailbox_argument(destination))
        if status != "OK":
            raise HPmailImapError("메시지를 이동하지 못했습니다.")

    def delete_message(self, mailbox: str, uid: str):
        self.conn.select(_mailbox_argument(mailbox or "INBOX"))
        status, _ = self.conn.uid("store", str(uid), "+FLAGS", r"(\Deleted)")
        if status != "OK":
            raise HPmailImapError("메시지를 삭제 표시하지 못했습니다.")
        self.conn.expunge()

    def append_message(self, mailbox: str, raw_message: bytes):
        status, _ = self.conn.append(_mailbox_argument(mailbox), None, None, raw_message)
        if status != "OK":
            raise HPmailImapError("보낸 메일함에 메시지를 저장하지 못했습니다.")
