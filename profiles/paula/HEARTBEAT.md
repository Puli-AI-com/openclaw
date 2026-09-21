# HEARTBEAT — disabled

Health checks are now handled by an automated Python cron job running inside
the CM container (`skills/puli_health_check/scripts/health_check.py`).

The agent heartbeat is disabled (`agents.defaults.heartbeat.every: "0m"` in
`default-config/openclaw.json`). This file is kept as a reference only and is
no longer sent to the LLM.
