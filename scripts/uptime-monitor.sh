#!/bin/bash
# voyonder.com uptime monitor — runs every minute via cron
# Checks /api/health/live and logs failures, alerts only on transition to failure
# Install: copy to /opt/scripts/ on vps-1 and add root cron job

set -euo pipefail

URL="https://voyonder.com/api/health/live"
STATE_FILE="/var/run/voyonder-uptime-state"
LOG_FILE="/var/log/voyonder-uptime.log"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Do the check
HTTP_CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$URL" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    # Site is up — log success only if previous state was down
    if [ -f "$STATE_FILE" ]; then
        PREV=$(cat "$STATE_FILE")
        if [ "$PREV" != "up" ]; then
            echo "[$NOW] RECOVERED — $URL returned $HTTP_CODE" >> "$LOG_FILE"
        fi
    fi
    echo "up" > "$STATE_FILE"
    exit 0
else
    # Site is down — log failure
    echo "[$NOW] FAILURE — $URL returned $HTTP_CODE" >> "$LOG_FILE"
    echo "down" > "$STATE_FILE"
    # Alert: this will be visible in cron output (check cronjob list for history)
    exit 1
fi