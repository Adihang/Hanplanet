# HPmail Development Plan

## Scope

HPmail provides Hanplanet webmail at:

- `https://www.hanplanet.com/ko/Email`
- `https://www.hanplanet.com/en/Email`

The browser never talks to IMAP directly. The request path is:

```text
Browser -> Django HPmail API -> Dovecot IMAP
```

SMTP submission is handled by Django for the webmail UI. Native external IMAP/SMTP clients remain disabled by default per user and should be enabled only after app-password and rate-limit policy are deployed.

## Implemented Django Surface

- App: `hpmail`
- Admin models:
  - `MailSitePolicy`: site defaults
  - `MailAccount`: per-user account and policy override
  - `MailAlias`: aliases such as `postmaster@hanplanet.com`
  - `MailDailySendCounter`: daily send counter
  - `MailAppPassword`: future external client password records
  - `MailMessageIndex`: optional message metadata cache
- Web route: `/<ko|en>/Email`
- API routes:
  - `GET /api/email/mailboxes`
  - `GET /api/email/messages`
  - `GET /api/email/messages/detail`
  - `POST /api/email/send`
  - `POST /api/email/messages/flags`
  - `POST /api/email/messages/move`
  - `POST /api/email/messages/delete`
  - `GET /api/email/quota`
- Map export:
  - `.venv/bin/python manage.py export_hpmail_maps`

## Default Policy

- Attachment limit: 25 MB
- Daily send limit: 100 messages
- Admin can override both values per user in `MailAccount`.
- `MailSitePolicy` controls global defaults.
- Mail storage usage is included in the existing HanDrive shared storage quota.

## Django Settings

Set these in `config/secrets.json` or launchd environment:

```json
{
  "HPMAIL_DOMAIN": "hanplanet.com",
  "HPMAIL_STORAGE_ROOT": "/Volumes/HANPLANET_HDD/Hanplanet/mail",
  "HPMAIL_IMAP_HOST": "127.0.0.1",
  "HPMAIL_IMAP_PORT": "143",
  "HPMAIL_IMAP_MASTER_USER": "hpmail-master",
  "HPMAIL_IMAP_MASTER_PASSWORD": "replace-with-secret",
  "HPMAIL_SMTP_HOST": "127.0.0.1",
  "HPMAIL_SMTP_PORT": "25"
}
```

For system emails such as 2FA and welcome mail, switch Django's normal email settings to the local submission service only after Postfix is ready:

```json
{
  "EMAIL_HOST": "127.0.0.1",
  "EMAIL_PORT": "587",
  "EMAIL_USE_TLS": "true",
  "DEFAULT_FROM_EMAIL": "noreply@hanplanet.com"
}
```

## DNS Gate

Do not open external sending before these are correct:

```dns
mail.hanplanet.com.        A      <mail-server-public-ip>
hanplanet.com.             MX 10  mail.hanplanet.com.
hanplanet.com.             TXT    "v=spf1 mx -all"
mail._domainkey.hanplanet.com. TXT "v=DKIM1; k=rsa; p=<public-key>"
_dmarc.hanplanet.com.      TXT    "v=DMARC1; p=none; rua=mailto:dmarc@hanplanet.com; adkim=s; aspf=s"
_smtp._tls.hanplanet.com.  TXT    "v=TLSRPTv1; rua=mailto:tlsrpt@hanplanet.com"
_mta-sts.hanplanet.com.    TXT    "v=STSv1; id=2026061101"
```

`mail.hanplanet.com`, `smtp.hanplanet.com`, and `imap.hanplanet.com` must be Cloudflare DNS-only, not proxied. PTR/rDNS must be configured by the IP provider to `mail.hanplanet.com`.

## Server Rollout

1. Install Postfix, Dovecot, and Rspamd.
2. Create the mail storage root and make it writable by the mail daemons.
3. Add `postmaster@hanplanet.com` and `abuse@hanplanet.com` as HPmail aliases in Django Admin.
4. Run:

   ```bash
   .venv/bin/python manage.py migrate
   .venv/bin/python manage.py export_hpmail_maps --postmap
   ```

5. Apply Postfix/Dovecot config from `deploy/hpmail/`.
6. Generate DKIM keys in Rspamd and publish the DNS TXT record.
7. Verify local delivery, IMAP read, webmail send, external receive, and external deliverability.

## Security Baseline

- TLS required for public IMAPS and submission.
- Open relay disabled.
- DKIM signing, SPF, DMARC, reverse DNS required before production sending.
- Remote images in HTML messages are blocked in the webmail preview.
- HTML mail is rendered in a sandboxed iframe.
- Attachments are limited by policy before SMTP send.
- Daily send counts are enforced by Django for webmail sends.
- External clients should require app passwords and separate rate limits before enabling.
