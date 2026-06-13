# HPmail Deployment Notes

Generate Postfix maps from Django:

```bash
.venv/bin/python manage.py export_hpmail_maps --postmap
```

Apply system Postfix config:

```bash
sudo /Users/imhanbyeol/Development/Hanplanet/deploy/hpmail/configure_postfix.sh
```

The script backs up `/etc/postfix/main.cf` and `/etc/postfix/master.cf`, enables
SMTP on port 25, routes `hanplanet.com` virtual mailboxes to local Dovecot LMTP
on `127.0.0.1:2424`, and keeps submission/587 disabled until SASL and TLS are
configured.

Configure Cloudflare DDNS for the dynamic public IP:

1. Create a Cloudflare API token for the `hanplanet.com` zone with:
   - Zone: Read
   - DNS: Edit
2. Add these keys to `config/secrets.json`:

   ```json
   {
     "CLOUDFLARE_API_TOKEN": "replace-with-token",
     "CLOUDFLARE_ZONE_NAME": "hanplanet.com",
     "CLOUDFLARE_DDNS_RECORD_NAME": "mail.hanplanet.com",
     "CLOUDFLARE_DDNS_TTL": 300
   }
   ```

3. Test once:

   ```bash
   .venv/bin/python scripts/update_cloudflare_ddns.py --dry-run
   .venv/bin/python scripts/update_cloudflare_ddns.py
   ```

4. Install the 5-minute launchd updater:

   ```bash
   cp deploy/launchd/com.hanplanet.hpmail-ddns.plist ~/Library/LaunchAgents/
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hanplanet.hpmail-ddns.plist
   launchctl kickstart -k gui/$(id -u)/com.hanplanet.hpmail-ddns
   ```

Create or rotate a Dovecot master-user password file:

```bash
doveadm pw -s BLF-CRYPT
# hpmail-master:{BLF-CRYPT}...
```

Store the raw master password in `config/secrets.json` as `HPMAIL_IMAP_MASTER_PASSWORD` so Django can read IMAP through Dovecot on behalf of the logged-in user.

Before opening public mail traffic, confirm:

- `mail.hanplanet.com` is an A record to the origin public IP and is DNS-only
  in Cloudflare.
- `hanplanet.com` has `MX 10 mail.hanplanet.com`.
- SPF exists, for example `v=spf1 mx include:_spf.google.com ~all` while HPmail
  outbound still uses the Gmail SMTP relay.
- `_dmarc.hanplanet.com` exists, for example
  `v=DMARC1; p=none; rua=mailto:postmaster@hanplanet.com`.
- TCP 25 is reachable from the internet. Keep 587 and 993 closed until external
  client auth and public TLS certificates are configured.
- PTR/rDNS points to `mail.hanplanet.com` before direct outbound delivery is
  enabled.
- DKIM TXT exists and signing is enabled before direct outbound delivery is
  enabled. Current HPmail outbound uses the configured SMTP relay.
- `postmaster@hanplanet.com` and `abuse@hanplanet.com` deliver to a monitored account.
