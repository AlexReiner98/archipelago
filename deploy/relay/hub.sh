#!/usr/bin/env bash
# The hub's side of the mail relay: run on the app's server, as a user with sudo.
#
#   sudo bash hub.sh key                          the hub's WireGuard public key, for the relay's setup.sh
#   sudo bash hub.sh add <relay key> [address]    take the relay on as a peer (address defaults to 10.66.0.3)
#   bash hub.sh check [address]                   can the host, and the app's container, hand the relay mail?
#
# The peer is added to /etc/wireguard/wg0.conf and to the running tunnel at once, so nothing restarts.
set -euo pipefail
conf=/etc/wireguard/wg0.conf

case ${1:-} in
key)
  wg pubkey </etc/wireguard/server.key
  ;;
add)
  key=${2:?usage: sudo bash hub.sh add <relay public key> [address]}
  address=${3:-10.66.0.3}
  if grep -q "AllowedIPs = $address/32" "$conf"; then
    echo "$address is a peer already: remove its [Peer] from $conf first to replace it." >&2
    exit 1
  fi
  cp -p "$conf" "$conf.before-relay"
  printf '\n# The mail relay (deploy/relay)\n[Peer]\nPublicKey = %s\nAllowedIPs = %s/32\n' "$key" "$address" >>"$conf"
  wg set wg0 peer "$key" allowed-ips "$address/32"
  echo "added: $address (the old file is $conf.before-relay)"
  ;;
check)
  address=${2:-10.66.0.3}
  ping -c1 -W3 "$address" >/dev/null && echo "tunnel: up" || echo "tunnel: DOWN (has the relay run setup.sh with this hub's key?)"
  timeout 5 bash -c "</dev/tcp/$address/25" 2>/dev/null && echo "relay port 25 from the host: open" || echo "relay port 25 from the host: closed"
  # The app runs in a container: the mail leaves from there, through the host.
  app=$(docker ps --format '{{.Names}}' | grep -m1 -- '-app-' || true)
  if [[ -n $app ]]; then
    docker exec "$app" node -e "const s=require('net').connect(25,'$address');s.setTimeout(5000,()=>{console.log('relay port 25 from $app: no answer');process.exit(1)});s.once('data',d=>{console.log('relay port 25 from $app: '+String(d).trim());process.exit(0)});s.once('error',e=>{console.log('relay port 25 from $app: '+e.message);process.exit(1)})"
  fi
  ;;
*)
  sed -n '2,8p' "$0"
  exit 1
  ;;
esac
