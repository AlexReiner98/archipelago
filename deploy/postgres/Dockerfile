# Postgres as the stack runs it: the Alpine image the volume was made with, and pgBackRest, which archives each WAL
# segment as Postgres closes it and takes the nightly backups (deploy/backup.sh). Its settings come from the
# environment (PGBACKREST_*, set in docker-compose.yml); the wrapper below lets compose leave a setting empty.
FROM postgres:17-alpine

RUN apk add --no-cache pgbackrest \
 && mkdir -p /var/lib/pgbackrest \
 && chown postgres:postgres /var/lib/pgbackrest \
 && chmod 750 /var/lib/pgbackrest

COPY --chmod=0755 pgbackrest.sh /usr/local/bin/pgbackrest
