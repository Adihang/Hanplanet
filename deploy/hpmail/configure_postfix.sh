#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="/Users/imhanbyeol/Development/Hanplanet"
MAP_DIR="$PROJECT_ROOT/deploy/hpmail/generated"
BACKUP_DIR="$PROJECT_ROOT/deploy/hpmail/backups/postfix-$(date +%Y%m%d%H%M%S)"

if [[ "$(id -u)" != "0" ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp /etc/postfix/main.cf "$BACKUP_DIR/main.cf"
cp /etc/postfix/master.cf "$BACKUP_DIR/master.cf"

/usr/sbin/postconf -e "myhostname = mail.hanplanet.com"
/usr/sbin/postconf -e "mydomain = hanplanet.com"
/usr/sbin/postconf -e 'myorigin = $mydomain'
/usr/sbin/postconf -e "inet_interfaces = all"
/usr/sbin/postconf -e "inet_protocols = ipv4"
/usr/sbin/postconf -e "mynetworks = 127.0.0.0/8, [::1]/128"
/usr/sbin/postconf -e "smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination"
/usr/sbin/postconf -e "smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination"
/usr/sbin/postconf -e "virtual_mailbox_domains = hanplanet.com"
/usr/sbin/postconf -e "virtual_mailbox_base = /Volumes/HANPLANET_HDD/Hanplanet/mail"
/usr/sbin/postconf -e "virtual_mailbox_maps = hash:$MAP_DIR/virtual_mailbox_maps"
/usr/sbin/postconf -e "virtual_alias_maps = hash:$MAP_DIR/virtual_alias_maps"
/usr/sbin/postconf -e "relay_recipient_maps = hash:$MAP_DIR/relay_recipient_maps"
/usr/sbin/postconf -e "virtual_transport = lmtp:inet:127.0.0.1:2424"
/usr/sbin/postconf -e "message_size_limit = 36700160"
/usr/sbin/postconf -e "mailbox_size_limit = 0"

# Webmail is Browser -> Django API -> IMAP. Do not expose unauthenticated SMTP
# submission until Dovecot SASL and mail TLS certificates are configured.
/usr/sbin/postconf -M# submission/inet >/dev/null 2>&1 || true

/usr/sbin/postmap "$MAP_DIR/virtual_mailbox_maps"
/usr/sbin/postmap "$MAP_DIR/virtual_alias_maps"
/usr/sbin/postmap "$MAP_DIR/relay_recipient_maps"
/usr/sbin/postfix check
/usr/sbin/postfix reload >/dev/null 2>&1 || /usr/sbin/postfix start

echo "Postfix configured. Backups: $BACKUP_DIR"
