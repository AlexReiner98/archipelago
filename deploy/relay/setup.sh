#!/usr/bin/env bash
# Make a fresh Ubuntu server into Archipelago's mail relay. Run it on the relay, as a user with sudo:
#
#   sudo bash setup.sh <hub public key> [hub endpoint] [relay address]
#
# The hub is the app's server. Its public key comes from deploy/relay/hub.sh key, run there. The endpoint defaults to
# 148.113.137.251:51820 and the relay's address on the private network to 10.66.0.3.
#
# What it makes: a WireGuard peer of the hub that talks to the hub alone, and Postfix relaying mail from the hub, over
# that tunnel, to the recipients' own servers. From the internet it takes only mail for archipelago.tools's own few
# addresses (postmaster, abuse, dmarc for DMARC reports, signin for bounces), kept in ubuntu's mailbox, /var/mail/ubuntu:
# a domain that cannot be written back to looks like a spammer's. It relays nothing for anyone else. The app signs
# every message with DKIM before it gets here, and the relay leaves it as it is.
#
# It prints the relay's public key last: give it to deploy/relay/hub.sh add on the hub. Running it again is harmless.
set -euo pipefail

# Once SSH over the tunnel works (ssh ubuntu@10.66.0.3 from a machine on it), close SSH from the internet.
if [[ ${1:-} == lock-ssh ]]; then
  ufw delete allow 22/tcp
  exit
fi

hub_key=${1:?usage: sudo bash setup.sh <hub public key> [hub endpoint] [relay address]}
hub_endpoint=${2:-148.113.137.251:51820}
me=${3:-10.66.0.3}
hub=10.66.0.1
name=mail.archipelago.tools
say() { printf '\n== %s\n' "$*"; }

say "packages"
export DEBIAN_FRONTEND=noninteractive
debconf-set-selections <<<"postfix postfix/main_mailer_type select Internet Site"
debconf-set-selections <<<"postfix postfix/mailname string $name"
apt-get update -q
apt-get install -yq postfix wireguard ufw unattended-upgrades

say "name"
hostnamectl set-hostname "$name"
echo "$name" >/etc/mailname

say "SSH: keys only (OVH delivers a VPS with a password login)"
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' >/etc/ssh/sshd_config.d/10-keys-only.conf
sshd -t && systemctl reload ssh

say "WireGuard: a peer of the hub, and of nothing else"
umask 077
[[ -f /etc/wireguard/relay.key ]] || wg genkey >/etc/wireguard/relay.key
cat >/etc/wireguard/wg0.conf <<EOF
[Interface]
Address = $me/32
PostUp = wg set %i private-key /etc/wireguard/relay.key

[Peer]
PublicKey = $hub_key
Endpoint = $hub_endpoint
AllowedIPs = $hub/32
PersistentKeepalive = 25
EOF
umask 022
systemctl enable -q wg-quick@wg0
systemctl restart wg-quick@wg0

say "Postfix: relay for the hub; from anyone else, mail for archipelago.tools's own addresses only"
cat >/etc/aliases <<'EOF'
# archipelago.tools's own addresses (deploy/relay/setup.sh), all kept in ubuntu's mailbox, /var/mail/ubuntu.
# Any other address at the domain is refused while the sender is still connected.
postmaster: ubuntu
abuse: ubuntu
dmarc: ubuntu
signin: ubuntu
root: ubuntu
EOF
newaliases
postconf -e \
  "myhostname = $name" \
  "myorigin = archipelago.tools" \
  "mydestination = archipelago.tools, \$myhostname, localhost" \
  "local_transport = local:\$myhostname" \
  "alias_maps = hash:/etc/aliases" \
  "local_recipient_maps = \$alias_maps" \
  "inet_interfaces = all" \
  "inet_protocols = ipv4" \
  "mynetworks = 127.0.0.0/8, $hub/32" \
  "smtpd_helo_required = yes" \
  "smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination" \
  "smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination" \
  "smtpd_banner = \$myhostname ESMTP" \
  "disable_vrfy_command = yes" \
  "message_size_limit = 2097152" \
  "smtp_tls_security_level = may" \
  "smtp_tls_loglevel = 1" \
  "maximal_queue_lifetime = 1d" \
  "bounce_queue_lifetime = 1d"
# Postfix starts after the tunnel, so the hub can reach it as soon as it is up.
mkdir -p /etc/systemd/system/postfix.service.d
printf '[Unit]\nAfter=wg-quick@wg0.service\nWants=wg-quick@wg0.service\n' >/etc/systemd/system/postfix.service.d/after-wireguard.conf
systemctl daemon-reload
systemctl enable -q postfix
systemctl restart postfix

say "firewall: SSH, and mail (Postfix decides whose), nothing else"
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow 22/tcp comment 'ssh (until: setup.sh lock-ssh)' >/dev/null
ufw allow in on wg0 to any port 22 proto tcp comment 'ssh over wireguard' >/dev/null
ufw allow in on wg0 from "$hub" to any port 25 proto tcp comment 'mail from the hub' >/dev/null
ufw allow 25/tcp comment 'mail for archipelago.tools' >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,20p'

say "checks"
timeout 8 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' && echo "port 25 out: open" || echo "port 25 out: BLOCKED (this host cannot be the relay)"
ping -c1 -W3 "$hub" >/dev/null && echo "tunnel to the hub: up" || echo "tunnel to the hub: not yet (add this relay on the hub: deploy/relay/hub.sh add)"
# Not an open relay: asked from the public address (an outsider, to Postfix), mail for another domain is refused, and
# mail for postmaster@archipelago.tools is taken.
public=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
python3 - "$public" <<'EOF'
import smtplib, sys
s = smtplib.SMTP(sys.argv[1], 25, timeout=10)
s.ehlo('check.example.org')
s.mail('check@example.org')
other, _ = s.rcpt('someone@example.com')
s.rset()
s.mail('check@example.org')
ours, _ = s.rcpt('postmaster@archipelago.tools')
s.quit()
print('open relay: no' if other >= 500 else 'open relay: YES, fix this before anything else')
print('postmaster@archipelago.tools taken: yes' if ours < 300 else f'postmaster@archipelago.tools taken: no ({ours})')
EOF

say "relay public key (for deploy/relay/hub.sh add on the hub)"
wg pubkey </etc/wireguard/relay.key
