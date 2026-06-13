from __future__ import annotations

import mimetypes
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import getaddresses, make_msgid

from django.conf import settings
from django.utils import timezone

from .imap_client import HPmailImapClient, HPmailImapError, HPmailNotConfigured
from .models import MailAccount
from .services import assert_account_can_send, record_sent_messages


class HPmailSmtpError(RuntimeError):
    pass


def parse_recipient_list(raw_value: str | list[str]) -> list[str]:
    if isinstance(raw_value, list):
        raw_items = raw_value
    else:
        raw_items = [str(raw_value or "")]
    addresses = []
    for _, address in getaddresses(raw_items):
        address = address.strip()
        if address:
            addresses.append(address)
    return addresses


def build_outbound_message(
    account: MailAccount,
    *,
    to: list[str],
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    subject: str = "",
    body_text: str = "",
    body_html: str = "",
    attachments=(),
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = account.email_address
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Subject"] = subject.strip() or "(no subject)"
    message["Date"] = timezone.now().strftime("%a, %d %b %Y %H:%M:%S %z")
    message["Message-ID"] = make_msgid(domain=account.domain)

    if body_html:
        message.set_content(body_text or "")
        message.add_alternative(body_html, subtype="html")
    else:
        message.set_content(body_text or "")

    for upload in attachments:
        filename = getattr(upload, "name", "attachment")
        content_type, _ = mimetypes.guess_type(filename)
        maintype, subtype = (content_type or "application/octet-stream").split("/", 1)
        data = upload.read()
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=filename)
    return message


def send_user_message(
    account: MailAccount,
    *,
    to: list[str],
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    subject: str = "",
    body_text: str = "",
    body_html: str = "",
    attachments=(),
) -> dict:
    cc = cc or []
    bcc = bcc or []
    recipients = list(to) + list(cc) + list(bcc)
    attachment_sizes = [getattr(upload, "size", 0) for upload in attachments]
    assert_account_can_send(account, attachment_sizes=attachment_sizes, recipient_count=len(recipients))
    message = build_outbound_message(
        account,
        to=to,
        cc=cc,
        bcc=bcc,
        subject=subject,
        body_text=body_text,
        body_html=body_html,
        attachments=attachments,
    )

    host = str(getattr(settings, "HPMAIL_SMTP_HOST", "127.0.0.1") or "127.0.0.1")
    port = int(getattr(settings, "HPMAIL_SMTP_PORT", 25))
    timeout = int(getattr(settings, "HPMAIL_SMTP_TIMEOUT", 10))
    use_tls = bool(getattr(settings, "HPMAIL_SMTP_USE_TLS", False))
    username = str(getattr(settings, "HPMAIL_SMTP_USERNAME", "") or "").strip()
    password = str(getattr(settings, "HPMAIL_SMTP_PASSWORD", "") or "").strip()

    try:
        with smtplib.SMTP(host, port, timeout=timeout) as smtp:
            if use_tls:
                smtp.starttls(context=ssl.create_default_context())
            if username or password:
                smtp.login(username, password)
            smtp.send_message(message, from_addr=account.email_address, to_addrs=recipients)
    except (OSError, smtplib.SMTPException) as exc:
        raise HPmailSmtpError(f"SMTP 발송에 실패했습니다: {exc}") from exc

    record_sent_messages(account)
    try:
        with HPmailImapClient(account) as imap:
            imap.append_message("Sent", message.as_bytes())
    except (HPmailNotConfigured, HPmailImapError):
        pass
    return {"message_id": message["Message-ID"], "recipient_count": len(recipients)}
