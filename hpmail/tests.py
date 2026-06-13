from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.exceptions import ValidationError

from .imap_client import _decode_modified_utf7, _encode_modified_utf7
from .models import MailAlias, MailAccount, MailSitePolicy
from .services import HPmailPolicyError, assert_account_can_send, ensure_mail_account_for_user, record_sent_messages


@override_settings(HPMAIL_DOMAIN="hanplanet.com")
class HPmailPolicyTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="alice", password="test-password")

    def test_ensure_account_uses_username_address(self):
        account = ensure_mail_account_for_user(self.user)
        self.assertEqual(account.email_address, "alice@hanplanet.com")

    def test_ensure_account_creates_maildir_structure(self):
        with TemporaryDirectory() as storage_root:
            with override_settings(HPMAIL_STORAGE_ROOT=storage_root):
                account = ensure_mail_account_for_user(self.user)
                maildir = account.domain + "/" + account.local_part + "/Maildir"
                for mailbox in ("", ".Drafts", ".Sent", ".Trash", ".Junk"):
                    for child_name in ("cur", "new", "tmp"):
                        self.assertTrue((Path(storage_root) / maildir / mailbox / child_name).is_dir())

    def test_site_policy_defaults_apply_to_account(self):
        MailSitePolicy.objects.create(
            default_attachment_limit_bytes=10 * 1024 * 1024,
            default_daily_send_limit=7,
        )
        account = ensure_mail_account_for_user(self.user)
        self.assertEqual(account.effective_attachment_limit_bytes(), 10 * 1024 * 1024)
        self.assertEqual(account.effective_daily_send_limit(), 7)

    def test_account_override_wins_over_site_policy(self):
        MailSitePolicy.objects.create(
            default_attachment_limit_bytes=10 * 1024 * 1024,
            default_daily_send_limit=7,
        )
        account = ensure_mail_account_for_user(self.user)
        account.attachment_limit_bytes = 2 * 1024 * 1024
        account.daily_send_limit = 3
        account.save()
        self.assertEqual(account.effective_attachment_limit_bytes(), 2 * 1024 * 1024)
        self.assertEqual(account.effective_daily_send_limit(), 3)

    def test_attachment_limit_is_enforced(self):
        account = ensure_mail_account_for_user(self.user)
        account.attachment_limit_bytes = 100
        account.save()
        with self.assertRaises(HPmailPolicyError) as ctx:
            assert_account_can_send(account, attachment_sizes=[101], recipient_count=1)
        self.assertEqual(ctx.exception.code, "attachment_limit_exceeded")

    def test_daily_limit_is_enforced(self):
        account = ensure_mail_account_for_user(self.user)
        account.daily_send_limit = 1
        account.save()
        record_sent_messages(account)
        with self.assertRaises(HPmailPolicyError) as ctx:
            assert_account_can_send(account, attachment_sizes=[], recipient_count=1)
        self.assertEqual(ctx.exception.code, "daily_send_limit_exceeded")

    def test_reserved_username_cannot_auto_create_mail_account(self):
        reserved = get_user_model().objects.create_user(username="postmaster", password="test-password")
        with self.assertRaises(Exception):
            ensure_mail_account_for_user(reserved)

    def test_admin_username_can_auto_create_mail_account(self):
        admin_user = get_user_model().objects.create_user(username="admin", password="test-password")
        account = ensure_mail_account_for_user(admin_user)
        self.assertEqual(account.email_address, "admin@hanplanet.com")

    def test_alias_cannot_reuse_account_address(self):
        account = ensure_mail_account_for_user(self.user)
        alias = MailAlias(local_part="alice", domain="hanplanet.com", target_account=account)
        with self.assertRaises(ValidationError):
            alias.clean()

    def test_account_cannot_reuse_alias_address(self):
        account = ensure_mail_account_for_user(self.user)
        other_user = get_user_model().objects.create_user(username="bob", password="test-password")
        MailAlias.objects.create(local_part="bob", domain="hanplanet.com", target_account=account)
        duplicate = MailAccount(user=other_user, local_part="bob", domain="hanplanet.com")
        with self.assertRaises(ValidationError):
            duplicate.clean()

    def test_email_page_requires_login(self):
        response = self.client.get("/ko/Email")
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "/ko/login?next=/ko/Email")

    def test_email_page_creates_account_for_authenticated_user(self):
        self.client.login(username="alice", password="test-password")
        response = self.client.get("/ko/Email")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "HPmail")
        self.assertTrue(MailAccount.objects.filter(user=self.user, local_part="alice").exists())

    def test_api_requires_login(self):
        response = self.client.get("/api/email/mailboxes")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "login_required")

    @override_settings(HPMAIL_IMAP_MASTER_USER="", HPMAIL_IMAP_MASTER_PASSWORD="")
    def test_imap_not_configured_returns_payload_without_http_error(self):
        self.client.login(username="alice", password="test-password")
        response = self.client.get("/api/email/mailboxes")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "imap_not_configured")

    def test_custom_mailbox_name_round_trips_imap_utf7(self):
        mailbox_name = "새 메일함 & Projects"
        self.assertEqual(_decode_modified_utf7(_encode_modified_utf7(mailbox_name)), mailbox_name)

    def test_mailbox_create_api_calls_imap(self):
        calls = []

        class FakeImap:
            def __init__(self, account):
                self.account = account

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return None

            def create_mailbox(self, name):
                calls.append(("create", name, self.account.email_address))
                return {"name": name, "flags": [], "canonical": name.upper(), "is_system": False, "can_modify": True}

        self.client.login(username="alice", password="test-password")
        with patch("hpmail.views.HPmailImapClient", FakeImap):
            response = self.client.post(
                "/api/email/mailboxes/create",
                data='{"name": "Projects"}',
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(calls, [("create", "Projects", "alice@hanplanet.com")])

    def test_mailbox_create_rejects_system_name(self):
        self.client.login(username="alice", password="test-password")
        response = self.client.post(
            "/api/email/mailboxes/create",
            data='{"name": "받은 메일함"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_mailbox_name")

    def test_mailbox_rename_api_calls_imap(self):
        calls = []

        class FakeImap:
            def __init__(self, account):
                self.account = account

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return None

            def rename_mailbox(self, mailbox, new_name):
                calls.append(("rename", mailbox, new_name))
                return {"name": new_name, "flags": [], "canonical": new_name.upper(), "is_system": False, "can_modify": True}

        self.client.login(username="alice", password="test-password")
        with patch("hpmail.views.HPmailImapClient", FakeImap):
            response = self.client.post(
                "/api/email/mailboxes/rename",
                data='{"mailbox": "Projects", "name": "Clients"}',
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(calls, [("rename", "Projects", "Clients")])

    def test_mailbox_rename_rejects_system_mailbox(self):
        self.client.login(username="alice", password="test-password")
        response = self.client.post(
            "/api/email/mailboxes/rename",
            data='{"mailbox": "INBOX", "name": "Archive"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "system_mailbox")

    def test_mailbox_delete_api_moves_to_drafts(self):
        calls = []

        class FakeImap:
            def __init__(self, account):
                self.account = account

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return None

            def delete_custom_mailbox(self, mailbox, destination):
                calls.append(("delete", mailbox, destination))
                return {"mailbox": mailbox, "destination": destination, "moved_count": 3}

        self.client.login(username="alice", password="test-password")
        with patch("hpmail.views.HPmailImapClient", FakeImap):
            response = self.client.post(
                "/api/email/mailboxes/delete",
                data='{"mailbox": "Projects"}',
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(response.json()["destination"], "Drafts")
        self.assertEqual(response.json()["moved_count"], 3)
        self.assertEqual(calls, [("delete", "Projects", "Drafts")])

    def test_mailbox_delete_rejects_system_mailbox(self):
        self.client.login(username="alice", password="test-password")
        response = self.client.post(
            "/api/email/mailboxes/delete",
            data='{"mailbox": "Drafts"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "system_mailbox")

    def test_message_move_api_calls_imap(self):
        calls = []

        class FakeImap:
            def __init__(self, account):
                self.account = account

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return None

            def move_message(self, mailbox, uid, destination):
                calls.append(("move", mailbox, uid, destination))

        self.client.login(username="alice", password="test-password")
        with patch("hpmail.views.HPmailImapClient", FakeImap):
            response = self.client.post(
                "/api/email/messages/move",
                data='{"mailbox": "INBOX", "uid": "42", "destination": "Archive"}',
                content_type="application/json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(calls, [("move", "INBOX", "42", "Archive")])

    def test_message_move_rejects_inbox_to_sent(self):
        self.client.login(username="alice", password="test-password")
        response = self.client.post(
            "/api/email/messages/move",
            data='{"mailbox": "INBOX", "uid": "42", "destination": "Sent"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_message_move")

    def test_message_move_rejects_sent_to_inbox(self):
        self.client.login(username="alice", password="test-password")
        response = self.client.post(
            "/api/email/messages/move",
            data='{"mailbox": "Sent", "uid": "42", "destination": "받은 메일함"}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_message_move")
