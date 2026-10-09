#!/usr/bin/env bash
# A throwaway Postgres for the e2e and UI tests (they need a real database).
#
#   .claude/skills/streambird-test/local-postgres.sh start   # init if needed, start, create db; prints the URL
#   .claude/skills/streambird-test/local-postgres.sh stop
#   .claude/skills/streambird-test/local-postgres.sh url     # just print E2E_DATABASE_URL
#
# Then:  export E2E_DATABASE_URL="$(.claude/skills/streambird-test/local-postgres.sh url)"
# Needs PostgreSQL server binaries (apt install postgresql) or set PGBIN. Where Docker is available
# `docker run -p 5544:5432 -e POSTGRES_USER=streambird -e POSTGRES_PASSWORD=sb -e POSTGRES_DB=streambird_e2e postgres:16` is equivalent.
# Env: PGBIN, SB_PGDIR (default /tmp/streambird-pg), SB_PGPORT (default 5544).
set -euo pipefail

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DIR="${SB_PGDIR:-/tmp/streambird-pg}"
PORT="${SB_PGPORT:-5544}"
USER_NAME=streambird PASS=sb DB=streambird_e2e
URL="postgres://$USER_NAME:$PASS@localhost:$PORT/$DB"

# Postgres refuses to run as root: when we are root, run the server commands as the postgres user.
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }

case "${1:-}" in
  url) echo "$URL" ;;
  start)
    [ -x "$PGBIN/pg_ctl" ] || { echo "no PostgreSQL binaries found (set PGBIN)"; exit 1; }
    mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DIR"
    [ -f "$DIR/data/PG_VERSION" ] || as_pg "$PGBIN/initdb -D $DIR/data -A trust >/dev/null"
    # A leftover pid file from a killed container makes startup fail; drop it only if that pid is gone.
    if [ -f "$DIR/data/postmaster.pid" ] && ! kill -0 "$(head -1 "$DIR/data/postmaster.pid")" 2>/dev/null; then rm -f "$DIR/data/postmaster.pid"; fi
    as_pg "$PGBIN/pg_ctl -D $DIR/data -o '-p $PORT -k /tmp' -l $DIR/log -w start" >/dev/null || true
    as_pg "$PGBIN/psql -h /tmp -p $PORT -d postgres -tc \"SELECT 1 FROM pg_roles WHERE rolname='$USER_NAME'\" | grep -q 1 || $PGBIN/psql -h /tmp -p $PORT -d postgres -c \"CREATE ROLE $USER_NAME LOGIN SUPERUSER PASSWORD '$PASS'\"" >/dev/null
    as_pg "$PGBIN/psql -h /tmp -p $PORT -d postgres -tc \"SELECT 1 FROM pg_database WHERE datname='$DB'\" | grep -q 1 || $PGBIN/createdb -h /tmp -p $PORT -O $USER_NAME $DB"
    echo "$URL" ;;
  stop) as_pg "$PGBIN/pg_ctl -D $DIR/data -m fast stop" ;;
  *) echo "usage: $0 start|stop|url"; exit 2 ;;
esac
