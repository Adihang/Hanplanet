from __future__ import annotations

import subprocess
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from hpmail.models import MailAccount, MailAlias, get_default_domain


def _write_text_atomic(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(content, encoding="utf-8")
    temp_path.replace(path)


class Command(BaseCommand):
    help = "Export HPmail virtual mailbox and alias maps for Postfix."

    def add_arguments(self, parser):
        parser.add_argument(
            "--output-dir",
            default=str(Path(settings.BASE_DIR) / "deploy" / "hpmail" / "generated"),
            help="Directory where map source files will be written.",
        )
        parser.add_argument(
            "--domain",
            default=get_default_domain(),
            help="Mail domain to export.",
        )
        parser.add_argument(
            "--postmap",
            action="store_true",
            help="Run postmap on generated files after writing them.",
        )

    def handle(self, *args, **options):
        output_dir = Path(options["output_dir"]).expanduser().resolve()
        domain = str(options["domain"]).strip().lower()
        mailbox_rows = []
        recipient_rows = []

        accounts = (
            MailAccount.objects
            .filter(is_enabled=True, domain__iexact=domain)
            .select_related("user")
            .order_by("local_part")
        )
        for account in accounts:
            address = account.email_address.lower()
            relative_maildir = f"{account.domain}/{account.local_part}/Maildir/"
            mailbox_rows.append(f"{address}\t{relative_maildir}")
            recipient_rows.append(f"{address}\tOK")

        alias_rows = []
        aliases = (
            MailAlias.objects
            .filter(is_enabled=True, domain__iexact=domain, target_account__is_enabled=True)
            .select_related("target_account")
            .order_by("local_part")
        )
        for alias in aliases:
            alias_rows.append(f"{alias.email_address.lower()}\t{alias.target_account.email_address.lower()}")
            recipient_rows.append(f"{alias.email_address.lower()}\tOK")

        mailbox_path = output_dir / "virtual_mailbox_maps"
        alias_path = output_dir / "virtual_alias_maps"
        recipient_path = output_dir / "relay_recipient_maps"
        _write_text_atomic(mailbox_path, "\n".join(mailbox_rows) + ("\n" if mailbox_rows else ""))
        _write_text_atomic(alias_path, "\n".join(alias_rows) + ("\n" if alias_rows else ""))
        _write_text_atomic(recipient_path, "\n".join(recipient_rows) + ("\n" if recipient_rows else ""))

        if options["postmap"]:
            for path in (mailbox_path, alias_path, recipient_path):
                subprocess.run(["postmap", str(path)], check=True)

        self.stdout.write(self.style.SUCCESS(f"Exported {len(mailbox_rows)} mailboxes and {len(alias_rows)} aliases to {output_dir}"))
        missing_operational = []
        exported_alias_addresses = {row.split("\t", 1)[0] for row in alias_rows}
        exported_mailbox_addresses = {row.split("\t", 1)[0] for row in mailbox_rows}
        for local_part in ("postmaster", "abuse"):
            address = f"{local_part}@{domain}"
            if address not in exported_alias_addresses and address not in exported_mailbox_addresses:
                missing_operational.append(address)
        if missing_operational:
            self.stdout.write(self.style.WARNING("Missing operational mailbox/alias: " + ", ".join(missing_operational)))
