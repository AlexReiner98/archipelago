#!/usr/bin/env bash
# A push to live with nobody dropped: the idle colour is built from a commit that passed CI, migrated and started
# beside the live one; once its /health names the commit, Caddy is reloaded to send new requests to it (a reload
# keeps the connections it has), and the old colour is drained and stopped. Anything that fails before the switch
# leaves the live colour as it was.
#
#   deploy/deploy.sh [ref]     ref defaults to the newest commit the hook queued, else origin/$DEPLOY_BRANCH (main)
#
# Run on the host from the checkout (/home/ubuntu/archipelago), by hand or by archipelago-deploy.service when the
# hook (hook/hook.ts) has queued a commit that passed CI. By hand, nothing checks the ref was tested. Which colour
# is live is caddy/live/upstream.caddy, which Caddy imports; the Caddyfile is read again on each deploy.
#
# Both colours run against the same database for a moment: a migration must leave the schema readable by the
# commit before it.
set -euo pipefail

# In one block, so bash has read all of it before the checkout below puts a new deploy.sh in its place.
{

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

branch="${DEPLOY_BRANCH:-main}"
drain="${DEPLOY_DRAIN_SECONDS:-20}"
wait_for="${DEPLOY_HEALTH_SECONDS:-180}"

say() { printf '%s deploy: %s\n' "$(date -u +%H:%M:%S)" "$*"; }

exec 9>"$here/.deploy.lock"
flock -n 9 || { say "another deploy is running"; exit 0; }

# Every request queued so far is answered by this deploy: it takes the newest.
mkdir -p queue caddy/live
queued="$(find queue -maxdepth 1 -type f ! -name '.*' | sort | tail -1)"
if [[ -n ${1:-} ]]; then ref="$1"; elif [[ -n $queued ]]; then ref="$(cat "$queued")"; else ref="origin/$branch"; fi
find queue -maxdepth 1 -type f ! -name '.*' -delete

# The live colour: the file Caddy imports, or, before the first deploy, what .env said (else blue).
live_colour() {
  if [[ -f caddy/live/upstream.caddy ]]; then
    grep -o 'app-[a-z]*' caddy/live/upstream.caddy | head -1 | sed 's/app-//'
  else
    local given
    given="$(grep -s '^PELAGO_UPSTREAM=' .env | cut -d= -f2 || true)"
    case "$given" in app-green*) echo green ;; *) echo blue ;; esac
  fi
}

point_caddy_at() {
  printf '# Written by deploy.sh: the colour Caddy sends requests to.\nto app-%s:3100\n' "$1" > caddy/live/upstream.caddy.new
  mv caddy/live/upstream.caddy.new caddy/live/upstream.caddy
}

# The commit a colour's /health names, asked from inside Caddy's container (the colours publish no port).
health_commit() {
  docker compose exec -T caddy wget -qO- -T 5 "http://app-$1:3100/health" 2>/dev/null \
    | grep -o '"commit":"[0-9a-f]*"' | cut -d'"' -f4 || true
}

# Tell the map which colour is live: the new one up, the old one planned (stopped, so a monitor leaves it alone).
# Only after a switch, and only when deploy/.env names the map, a token and both items; a map that does not answer
# is logged and the deploy still counts. The token is sent in a header and never written to the log.
# A setting from the environment, else from .env (which this script does not source as a whole).
from_env() { if [[ -n ${!1:-} ]]; then printf '%s' "${!1}"; else grep -s "^$1=" .env | head -1 | cut -d= -f2- || true; fi; }

tell_map() {
  local url token blue green
  url="$(from_env DEPLOY_MAP_URL)"; url="${url:-https://app.archipelago.tools}"
  token="$(from_env DEPLOY_MAP_TOKEN)" blue="$(from_env DEPLOY_MAP_BLUE)" green="$(from_env DEPLOY_MAP_GREEN)"
  if [[ -z $token || -z $blue || -z $green ]]; then say "map not told (DEPLOY_MAP_TOKEN, _BLUE, _GREEN unset)"; return; fi
  if [[ ! $blue =~ ^e_[a-z0-9]+$ || ! $green =~ ^e_[a-z0-9]+$ ]]; then say "map not told: DEPLOY_MAP_BLUE/_GREEN are not item ids"; return; fi
  local up down
  if [[ $1 == blue ]]; then up="$blue"; down="$green"; else up="$green"; down="$blue"; fi
  local body
  body="$(printf '{"actor":"deploy:archipelago-1","reason":"Deployed %s: %s is live, %s stopped","authority":{"of":"agent","basis":"deploy.sh switched Caddy to app-%s and its /health named %s"},"ops":[{"op":"update","id":"%s","status":"up"},{"op":"update","id":"%s","status":"planned"}]}'     "${2:0:7}" "$1" "$3" "$1" "${2:0:7}" "$up" "$down")"
  local answer
  if answer="$(curl -fsS -m 20 -X POST "$url/agent/change" -H "authorization: Bearer $token" -H 'content-type: application/json' --data-binary "$body" 2>&1)"; then
    say "map told: $1 up, $3 planned ($(grep -o '"status":"[a-z_]*"' <<<"$answer" | head -1 || true))"
  else
    say "map not told: ${answer:0:200}"
  fi
}

live="$(live_colour)"
idle="$([[ $live == blue ]] && echo green || echo blue)"
[[ -f caddy/live/upstream.caddy ]] || point_caddy_at "$live"

git -C .. fetch --quiet origin
git -C .. checkout --quiet --detach "$ref"
commit="$(git -C .. rev-parse HEAD)"
export PELAGO_COMMIT="$commit"
say "$(git -C .. log -1 --format='%h %s') : $live is live, $idle goes up"

if [[ "$(health_commit "$live")" == "$commit" ]]; then
  say "$live already runs $commit"
  exit 0
fi

compose=(docker compose --profile green)

say "building"
"${compose[@]}" build --quiet "app-$idle"

say "migrating"
"${compose[@]}" run --rm --no-deps "app-$idle" node src/deploy.ts

say "starting $idle"
"${compose[@]}" up -d --no-deps --force-recreate "app-$idle"

waited=0
until [[ "$(health_commit "$idle")" == "$commit" ]]; do
  if (( waited >= wait_for )); then
    say "$idle did not answer with $commit in ${wait_for}s; $live stays live"
    "${compose[@]}" logs --tail 40 "app-$idle" || true
    "${compose[@]}" stop "app-$idle"
    exit 1
  fi
  sleep 2
  waited=$((waited + 2))
done

say "switching Caddy to $idle"
point_caddy_at "$idle"
if ! docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
  say "Caddy refused the reload; $live stays live"
  point_caddy_at "$live"
  "${compose[@]}" stop "app-$idle"
  exit 1
fi

# What is set in .env is what a later `docker compose up -d` builds and starts.
if grep -q '^PELAGO_COMMIT=' .env 2>/dev/null; then
  sed -i "s/^PELAGO_COMMIT=.*/PELAGO_COMMIT=$commit/" .env
fi

say "draining $live for ${drain}s"
sleep "$drain"
"${compose[@]}" stop -t 30 "app-$live"
# The last three builds are kept, to go back to by hand: deploy/deploy.sh <commit>.
docker images archipelago-app --format '{{.Repository}}:{{.Tag}}' | tail -n +4 | xargs -r docker rmi > /dev/null 2>&1 || true
say "live: $idle at $commit"
tell_map "$idle" "$commit" "$live"
exit
}
