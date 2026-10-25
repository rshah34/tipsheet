#!/usr/bin/env bash
#
# Run whichever of the day's jobs is due. A scheduler (launchd/cron) calls this
# every hour; it does nothing unless a job's time has passed since it last ran.
#
# The times are Pacific whatever timezone the Mac is in, because they follow the
# tip-offs, not the laptop: travel east and the runs still land ~90 min before the
# first game. Built for a laptop that is often asleep, so a job missed while it slept
# runs on the next wake (the daily run first), it waits for the network, starts
# Docker/Postgres if they aren't up, and keeps the Mac awake until the run is done.
# With no internet it doesn't run at all, so the job stays due for the next hour
# (a run that can't reach nba.com would fail every step and still count as done).
set -euo pipefail

export TZ=America/Los_Angeles   # the clock both the schedule and the pipeline run on
# Job, the tipsheet command, and its times. Order matters: the daily run comes first.
JOBS=(
  "daily|daily|14:30"              # settle -> injuries + news -> predict -> odds -> picks -> text
  "close|daily-close|15:30 18:30"  # rosters + injuries recheck -> the closing prices CLV uses
)

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
# Common install locations for uv and docker; launchd starts with a bare PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
mkdir -p logs

TODAY="$(date +%Y-%m-%d)"
NOW="$(date +%s)"
epoch() { date -j -f "%Y-%m-%d %H:%M:%S" "$TODAY $1:00" +%s 2>/dev/null || date -d "$TODAY $1" +%s; }

# A job is due when one of today's times has passed since its last run.
due() {
  local times="$1" last="$2" slot t
  for t in $times; do
    slot="$(epoch "$t")"
    [ "$slot" -le "$NOW" ] && [ "$last" -lt "$slot" ] && return 0
  done
  return 1
}

online() {
  curl -s --max-time 5 -o /dev/null https://stats.nba.com &&
    curl -s --max-time 5 -o /dev/null https://site.api.espn.com
}

prepared=0
prepare() {
  [ "$prepared" = 1 ] && return
  # Wi-Fi takes a little while to come back after a wake or on a new network.
  for _ in $(seq 1 30); do
    online && break
    sleep 5
  done
  if ! online; then
    echo "$(date '+%H:%M:%S') no internet (nba.com or ESPN unreachable); trying again next hour" >> "$LOG"
    return 1
  fi
  prepared=1
  # Postgres lives in Docker, which may not be running after a restart.
  db_ready() { docker compose exec -T db sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; }
  if ! db_ready; then
    echo "$(date '+%H:%M:%S') database not up; starting Docker" >> "$LOG"
    docker info >/dev/null 2>&1 || open -ga Docker
    for _ in $(seq 1 60); do
      docker info >/dev/null 2>&1 && break
      sleep 5
    done
    docker compose up -d >> "$LOG" 2>&1 || true
    for _ in $(seq 1 24); do
      db_ready && break
      sleep 5
    done
    db_ready || echo "database still not reachable; running anyway so the failure is logged" >> "$LOG"
  fi
}

for job in "${JOBS[@]}"; do
  IFS='|' read -r name cmd times <<< "$job"
  marker="logs/.last-$name"
  last="$(cat "$marker" 2>/dev/null || echo 0)"
  due "$times" "$last" || continue

  LOG="logs/${name}-${TODAY}.log"
  prepare || exit 0
  echo "===== $(date '+%Y-%m-%d %H:%M:%S %Z') : ${name} (tipsheet ${cmd}) =====" >> "$LOG"
  # caffeinate holds off idle sleep until the run is done. A run that crashes
  # leaves no marker, so the next hourly call tries it again.
  if caffeinate -i uv run tipsheet "$cmd" >> "$LOG" 2>&1; then
    date +%s > "$marker"
  fi
  echo >> "$LOG"
done
