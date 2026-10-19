#!/usr/bin/env bash
# The map's backups, by pgBackRest in the postgres container: a full backup of the whole cluster (every workspace's
# database) to each repository, the WAL between them archived as it is written, so any minute can be put back.
# repo1 is the pgbackrest-repo volume on this host; repo2, when PGBACKREST_REPO2_S3_BUCKET is set in .env, is OVH
# Object Storage, encrypted with PGBACKREST_REPO2_CIPHER_PASS before it leaves (lose that and repo2 is unreadable).
#
#   deploy/backup.sh init     once per repository: make the stanza and check that WAL reaches it
#   deploy/backup.sh full     a full backup to each repository (archipelago-backup.timer runs it nightly, then try)
#   deploy/backup.sh info     what each repository holds
#   deploy/backup.sh try [n]  restore the newest backup of repo n (default each) into a spare Postgres, replay the
#                             WAL to the end and compare every table's rows with live; the spare is removed after
#
# Run on the host from the checkout, by hand or by deploy/systemd/archipelago-backup.service.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

say() { printf '%s backup: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
from_env() { grep -s "^$1=" .env | head -1 | cut -d= -f2- || true; }

repos=(1)
[[ -n "$(from_env PGBACKREST_REPO2_S3_BUCKET)" ]] && repos+=(2)

pgbr() { docker compose exec -T -u postgres postgres pgbackrest "$@"; }
psql_live() { docker compose exec -T -u postgres postgres psql -U pelago -v ON_ERROR_STOP=1 -qtAX "$@"; }

exec 9>"$here/.backup.lock"
flock -n 9 || { say "another backup is running"; exit 0; }

# Every user table of every database, with its rows: "database table rows", sorted. Postgres runs as a superuser
# here, so row level security does not hide anything from the count.
count_rows() {
  local run=("$@") db sql
  for db in $("${run[@]}" -d postgres -c "select datname from pg_database where not datistemplate and datallowconn order by 1"); do
    sql="$("${run[@]}" -d "$db" -c "select string_agg(format('select %L, %L, count(*) from %I.%I', current_database(), schemaname || '.' || tablename, schemaname, tablename), ' union all ') from pg_tables where schemaname not in ('pg_catalog', 'information_schema')")"
    [[ -z $sql ]] || "${run[@]}" -d "$db" -F ' ' -c "$sql"
  done | sort
}

# The spare's container and volume, and the file of settings handed to it (it holds repo2's keys).
spare_gone() {
  docker rm -f "archipelago-restore-try-$1" >/dev/null 2>&1 || true
  docker volume rm "archipelago-restore-try-$1" >/dev/null 2>&1 || true
  rm -f "$here/.restore-try.env"
}

try_restore() {
  local repo="$1" image volume name env_file="$here/.restore-try.env"
  image="$(docker compose images -q postgres | head -1)"
  [[ -n $image ]] || { say "no postgres image: is the stack up?"; return 1; }
  volume="archipelago-restore-try-$repo"; name="archipelago-restore-try-$repo"
  spare_gone "$repo"
  trap 'spare_gone "'"$repo"'"' EXIT

  # What live holds now, then a WAL switch that pgBackRest confirms is archived: the spare must hold at least this.
  say "repo$repo: counting live, then closing the WAL segment"
  local before; before="$(count_rows psql_live)"
  pgbr check >/dev/null

  (umask 077; docker compose exec -T postgres env | grep '^PGBACKREST_' > "$env_file" || true)
  docker volume create "$volume" >/dev/null
  docker run --rm -v "$volume:/restore" "$image" sh -c 'chown postgres:postgres /restore && chmod 700 /restore'

  say "repo$repo: restoring the newest backup"
  local started=$SECONDS
  docker run --rm --env-file "$env_file" -u postgres -v "$volume:/restore" \
    -v archipelago_pgbackrest-repo:/var/lib/pgbackrest:ro \
    "$image" pgbackrest --repo="$repo" --pg1-path=/restore --log-level-console=warn restore

  # The spare replays the archived WAL and opens. It archives nothing (archive_mode off on the command line beats
  # what the restore wrote), listens on no address, and is on no network of the stack's.
  docker run -d --name "$name" --env-file "$env_file" -u postgres -v "$volume:/restore" \
    -v archipelago_pgbackrest-repo:/var/lib/pgbackrest:ro \
    "$image" postgres -D /restore -c archive_mode=off -c listen_addresses= -c shared_buffers=64MB >/dev/null
  local waited=0
  until [[ "$(docker exec "$name" psql -U pelago -d postgres -qtAX -c 'select not pg_is_in_recovery()' 2>/dev/null)" == t ]]; do
    if (( waited >= 300 )); then say "repo$repo: the spare did not open in 300 s"; docker logs --tail 30 "$name"; return 1; fi
    sleep 2; waited=$((waited + 2))
  done
  say "repo$repo: the spare is open after $((SECONDS - started)) s"

  local after; after="$(count_rows docker exec "$name" psql -U pelago -v ON_ERROR_STOP=1 -qtAX)"
  # Live may have moved on since it was counted; the spare may hold more, never less, and nothing may be missing.
  local short
  short="$(awk 'NR == FNR { got[$1 " " $2] = $3; next }
                !(($1 " " $2) in got) { print "  " $1 " " $2 ": live " $3 ", restored none"; next }
                got[$1 " " $2] < $3 { print "  " $1 " " $2 ": live " $3 ", restored " got[$1 " " $2] }'            <(printf '%s
' "$after") <(printf '%s
' "$before"))"
  if [[ -n $short ]]; then
    say "repo$repo: the restore is short:"; printf '%s
' "$short"; return 1
  fi
  say "repo$repo: restore good: $(wc -l <<<"$after") tables in $(cut -d' ' -f1 <<<"$after" | sort -u | wc -l) databases, none short"
  spare_gone "$repo"
}

case "${1:-}" in
  init)
    for r in "${repos[@]}"; do
      say "repo$r: making the stanza"
      pgbr --repo="$r" stanza-create
    done
    pgbr check
    say "WAL reaches every repository"
    ;;
  full)
    for r in "${repos[@]}"; do
      say "repo$r: full backup"
      pgbr --repo="$r" backup --type=full
    done
    pgbr info
    ;;
  info)
    pgbr info
    ;;
  try)
    failed=0
    for r in ${2:-"${repos[@]}"}; do try_restore "$r" || failed=1; done
    exit "$failed"
    ;;
  *)
    sed -n '2,13p' "$0"; exit 2 ;;
esac
