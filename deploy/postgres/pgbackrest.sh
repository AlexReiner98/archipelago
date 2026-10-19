#!/bin/sh
# pgBackRest with every empty PGBACKREST_* setting dropped first: compose cannot leave a variable out, only empty, and
# pgBackRest refuses an option it is given with no value. The off-site repository (repo2) is set only when its bucket
# is, so with no bucket in .env all of repo2 falls away here.
for name in $(env | sed -n 's/^\(PGBACKREST_[A-Z0-9_]*\)=$/\1/p'); do
  unset "$name"
done
exec /usr/bin/pgbackrest "$@"
