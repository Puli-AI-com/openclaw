#!/bin/sh
# Keeps the jobs-manager service up (PUL-458): its API on JOBS_MANAGER_PORT and the loop that runs every
# live test cycle from the cycle run table. When it exits it is started again after
# JOBS_MANAGER_RESTART_SECONDS (default 5); a restart picks up the cycles it held. Logs to stdout.
# A tenant with no cycle run table yet (CYCLE_RUNS_TABLE unset) is skipped: Paula keeps the folder jobs.
RAMPUP_HOME="${RAMPUP_HOME:-/app/envoy-tools/skills}"
PROJECT="${JOBS_MANAGER_PROJECT:-$RAMPUP_HOME/jobs-manager}"
UV_PROJECT="$RAMPUP_HOME/test-cycle/scripts/uv_project.sh"
DELAY="${JOBS_MANAGER_RESTART_SECONDS:-5}"

if [ -z "${CYCLE_RUNS_TABLE:-}" ]; then
    echo "jobs-manager: skipped, CYCLE_RUNS_TABLE is not set"
    exit 0
fi
if [ ! -f "$PROJECT/pyproject.toml" ] || [ ! -f "$UV_PROJECT" ]; then
    echo "jobs-manager: skipped, project not found: $PROJECT"
    exit 0
fi

while true; do
    sh "$UV_PROJECT" "$PROJECT" python -m jobs_manager serve 2>&1
    echo "jobs-manager: exited with code $?, starting again in ${DELAY}s"
    sleep "$DELAY"
done
