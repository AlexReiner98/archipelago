#!/usr/bin/env bash
# Make a fresh Ubuntu server into Archipelago's mail relay. Run it on the relay, as a user with sudo:
#
#   sudo bash setup.sh <hub public key> [hub endpoint] [relay address]
#
# The hub is the app's server. Its public key comes from deploy/relay/hub.sh key, run there. The endpoint defaults to
# 148.113.137.251:51820 and the relay's address on the private network to 10.66.0.3.
#
# What it makes: a WireGuard peer of the hub that talks to the hub alone, and Postfix taking mail on port 25 only from
# the hub, over that tunnel, and delivering it to the recipients' own servers. It takes no mail from the internet and
# delivers none locally. The app signs every message with DKIM before it gets here, and the relay leaves it as it is.
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

say "Postfix: relay for the hub, deliver to the world, keep nothing"
postconf -e \
  "myhostname = $name" \
  "myorigin = archipelago.tools" \
  "mydestination =" \
  "local_transport = error:this server delivers nothing locally" \
  "inet_interfaces = all" \
  "inet_protocols = ipv4" \
  "mynetworks = 127.0.0.0/8, $hub/32" \
  "smtpd_relay_restrictions = permit_mynetworks, reject" \
  "smtpd_recipient_restrictions = permit_mynetworks, reject" \
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

say "firewall: SSH, and mail from the hub over the tunnel, nothing else"
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow 22/tcp comment 'ssh (until: setup.sh lock-ssh)' >/dev/null
ufw allow in on wg0 to any port 22 proto tcp comment 'ssh over wireguard' >/dev/null
ufw allow in on wg0 from "$hub" to any port 25 proto tcp comment 'mail from the hub' >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,20p'

say "checks"
timeout 8 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' && echo "port 25 out: open" || echo "port 25 out: BLOCKED (this host cannot be the relay)"
ping -c1 -W3 "$hub" >/dev/null && echo "tunnel to the hub: up" || echo "tunnel to the hub: not yet (add this relay on the hub: deploy/relay/hub.sh add)"

say "relay public key (for deploy/relay/hub.sh add on the hub)"
wg pubkey </etc/wireguard/relay.key
