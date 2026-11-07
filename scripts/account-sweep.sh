#!/bin/sh
# Frees sign-in accounts that discoveries left held in the identity provider (PUL-255).
# Runs `run_account.py sweep --startup` once (a restart ended every running discovery), then
# `run_account.py sweep` every ACCOUNT_SWEEP_INTERVAL_SECONDS (default 60). Logs to stdout.
RAMPUP_HOME="${RAMPUP_HOME:-/app/envoy-tools/skills}"
DISCOVERY_PROJECT="${APPLICATION_DISCOVERY_PROJECT:-$RAMPUP_HOME/application-discovery}"
SWEEP_SCRIPT="$RAMPUP_HOME/application-discovery/scripts/run_account.py"
INTERVAL="${ACCOUNT_SWEEP_INTERVAL_SECONDS:-60}"

if [ ! -f "$SWEEP_SCRIPT" ]; then
    echo "account-sweep: skipped, script not found: $SWEEP_SCRIPT"
    exit 0
fi

uv run --project "$DISCOVERY_PROJECT" python "$SWEEP_SCRIPT" sweep --startup 2>&1 || true
while true; do
    sleep "$INTERVAL"
    uv run --project "$DISCOVERY_PROJECT" python "$SWEEP_SCRIPT" sweep 2>&1 || true
done
