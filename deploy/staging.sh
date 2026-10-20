#!/usr/bin/env bash
# Staging: a branch on a fresh copy of live, for the owner's laptop over WireGuard (https://10.66.0.1:3200, behind
# Caddy with a certificate of its own: a browser warns once). Each run copies every workspace's database (pelago,
# pelago_<id>) to pelago_staging, pelago_staging_<id> with pg_dump and pg_restore, pauses the copies' automations,
# builds the branch from a checkout of its own and starts it. Live is only read: deploy.sh's checkout is not this one.
#
#   deploy/staging.sh <branch>   a branch (or a commit) on a fresh copy of live
#   deploy/staging.sh stop       stop it; its databases stay until the next run
#
# It acts on nothing outside: it has no sealing key, so the GitHub App's and packs' secrets read as not set, and no
# model, backup upload or GitHub settings. A token that works on live works here, on the copy.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
say() { printf '%s staging: %s\n' "$(date -u +%H:%M:%S)" "$*"; }

compose=(docker compose --profile staging)
src="${STAGING_SOURCE:-$HOME/archipelago-staging}"
copy=pelago_staging

[[ -n ${1:-} ]] || { echo "usage: deploy/staging.sh <branch> | stop" >&2; exit 2; }
if [[ $1 == stop ]]; then "${compose[@]}" stop staging; exit; fi

exec 9>"$here/.staging.lock"
flock -n 9 || { say "another staging run is going"; exit 0; }

# The branch as it is on GitHub, else whatever git takes it for (a commit).
git -C .. fetch --quiet origin
ref="$1"
if git -C .. rev-parse --verify --quiet "origin/$ref^{commit}" > /dev/null; then ref="origin/$ref"; fi
commit="$(git -C .. rev-parse --verify "$ref^{commit}")"
if [[ -e $src/.git ]]; then git -C "$src" checkout --quiet --detach "$commit"; else git -C .. worktree add --quiet --detach "$src" "$commit"; fi
say "$(git -C "$src" log -1 --format='%h %s')"

say "building"
docker build --quiet -f "$src/deploy/Dockerfile" --build-arg PELAGO_COMMIT="$commit" -t archipelago-staging:latest "$src" > /dev/null

"${compose[@]}" stop staging > /dev/null 2>&1 || true
sql() { docker compose exec -T postgres psql -U pelago -v ON_ERROR_STOP=1 -qAt "$@"; }

# Every workspace's database, and what the last run copied.
live=$(sql -d postgres -c "select datname from pg_database where datname = 'pelago' or (datname like 'pelago\_%' and datname not like '${copy}%')")
for old in $(sql -d postgres -c "select datname from pg_database where datname like '${copy}%'"); do
  sql -d postgres -c "drop database \"$old\" with (force)"
done
for db in $live; do
  to="$copy${db#pelago}"
  say "copying $db to $to"
  sql -d postgres -c "create database \"$to\""
  docker compose exec -T postgres sh -c "pg_dump -U pelago -Fc '$db' | pg_restore -U pelago --exit-on-error -d '$to'"
  paused=$(sql -d "$to" -c "with p as (update entity set status = 'paused' where type = 'sys.automation' and status = 'enabled' returning 1) select count(*) from p")
  (( paused == 0 )) || say "$to: $paused automations paused"
done

say "migrating"
export STAGING_COMMIT="$commit"
"${compose[@]}" run --rm --no-deps staging node src/deploy.ts

say "starting"
"${compose[@]}" up -d --no-deps --force-recreate staging
waited=0
until [[ "$(docker compose exec -T caddy wget -qO- -T 5 http://staging:3100/health 2>/dev/null | grep -o '"commit":"[0-9a-f]*"' | cut -d'"' -f4)" == "$commit" ]]; do
  if (( waited >= 180 )); then say "staging did not answer with $commit in 180s"; "${compose[@]}" logs --tail 40 staging; exit 1; fi
  sleep 2
  waited=$((waited + 2))
done
say "up: $commit at https://10.66.0.1:3200"
