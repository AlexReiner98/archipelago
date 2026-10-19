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

# Tell the map which colour is live: a report of what was measured, the new colour live at the commit and the old
# one stopped (it rests where a monitor leaves it alone). Each colour is named by the address its health is read
# from, as the map's components are watched, so only a token is needed: one that may only report, made on the
# environment's page. Only after a switch; a map that does not answer is logged and the deploy still counts. The
# token is sent in a header and never written to the log.
# A setting from the environment, else from .env (which this script does not source as a whole).
from_env() { if [[ -n ${!1:-} ]]; then printf '%s' "${!1}"; else grep -s "^$1=" .env | head -1 | cut -d= -f2- || true; fi; }

tell_map() {
  local url token
  url="$(from_env DEPLOY_MAP_URL)"; url="${url:-https://app.archipelago.tools}"
  token="$(from_env DEPLOY_MAP_TOKEN)"
  if [[ -z $token ]]; then say "map not told (DEPLOY_MAP_TOKEN unset)"; return; fi
  local body answer
  body="$(printf '{"actor":"deploy:archipelago-1","live":{"at":"http://app-%s:3100/health","commit":"%s"},"idle":["http://app-%s:3100/health"],"said":"deploy.sh switched Caddy to app-%s"}' "$1" "$2" "$3" "$1")"
  if answer="$(curl -sS --fail-with-body -m 20 -X POST "$url/agent/report" -H "authorization: Bearer $token" -H 'content-type: application/json' --data-binary "$body" 2>&1)"; then
    say "map told: $1 live, $3 stopped ($(grep -o '"to":"[a-z_]*"' <<<"$answer" | tr '\n' ' ' || true))"
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
