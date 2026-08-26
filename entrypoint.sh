#!/bin/sh
# Seed bot profile workspace files before starting the gateway.
#
# Reads BOT_PROFILE env var (defaults to "crowdtest") and copies the
# corresponding files from /app/profiles/$BOT_PROFILE/ into the openclaw
# workspace. Files are only overwritten when the profile .version changes,
# so a running deployment is not disrupted by unrelated restarts.
set -e

OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-/var/lib/puli/openclaw-state}"
OPENCLAW_PERSIST_CONFIG_PATH="${OPENCLAW_PERSIST_CONFIG_PATH:-${OPENCLAW_STATE_DIR}/tenant-overrides.json}"
OPENCLAW_LEGACY_CONFIG_PATH="${OPENCLAW_LEGACY_CONFIG_PATH:-${OPENCLAW_STATE_DIR}/openclaw.json}"
OPENCLAW_RUNTIME_CONFIG_PATH="${OPENCLAW_RUNTIME_CONFIG_PATH:-/tmp/puli-openclaw/openclaw.json}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_RUNTIME_CONFIG_PATH}"
OPENCLAW_PERSIST_CONFIG_UNSET_PATHS="${OPENCLAW_PERSIST_CONFIG_UNSET_PATHS:-hooks,agents.list,skills.load.extraDirs,gateway.heartbeat,gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback,gateway.http.endpoints.chatCompletions}"
if [ "${OPENCLAW_ENABLE_LEGACY_CONFIG_COMPAT:-0}" = "1" ]; then
    OPENCLAW_COMPAT_CONFIG_PATH="${OPENCLAW_COMPAT_CONFIG_PATH:-${OPENCLAW_LEGACY_CONFIG_PATH}}"
    export OPENCLAW_COMPAT_CONFIG_PATH
fi
export OPENCLAW_STATE_DIR OPENCLAW_PERSIST_CONFIG_PATH OPENCLAW_LEGACY_CONFIG_PATH
export OPENCLAW_RUNTIME_CONFIG_PATH OPENCLAW_CONFIG_PATH OPENCLAW_PERSIST_CONFIG_UNSET_PATHS

node /app/scripts/migrate-config-state-separation.mjs
node /app/scripts/reconcile-openclaw-config.mjs

WORKSPACE="${OPENCLAW_STATE_DIR}/workspace"
RAMPUP_DATA_DIR="${OPENCLAW_RAMPUP_DATA_DIR:-${WORKSPACE}/applications}"
export RAMPUP_DATA_DIR
PROFILE="${BOT_PROFILE:-paula}"
PROFILE_DIR="/app/profiles/${PROFILE}"

if [ -d "$PROFILE_DIR" ]; then
    CURRENT_VERSION=$(cat "$PROFILE_DIR/.version" 2>/dev/null || echo "v1")
    INSTALLED_VERSION=$(cat "$WORKSPACE/.profile_version" 2>/dev/null || echo "none")

    if [ "$CURRENT_VERSION" != "$INSTALLED_VERSION" ]; then
        mkdir -p "$WORKSPACE"
        for f in AGENTS.md SOUL.md IDENTITY.md USER.md TOOLS.md HEARTBEAT.md; do
            if [ -f "$PROFILE_DIR/$f" ]; then
                cp "$PROFILE_DIR/$f" "$WORKSPACE/$f"
            fi
        done
        echo "$CURRENT_VERSION" > "$WORKSPACE/.profile_version"
        echo "entrypoint: profile '$PROFILE' seeded (version $CURRENT_VERSION)"
    else
        echo "entrypoint: profile '$PROFILE' up to date (version $CURRENT_VERSION)"
    fi
else
    echo "entrypoint: warning — profile directory not found: $PROFILE_DIR"
fi

# Ensure uv is available in PATH for skill script execution.
# Installs to /usr/local/bin (system-wide) if not already present.
if ! command -v uv > /dev/null 2>&1; then
    echo "entrypoint: uv not found — installing to /usr/local/bin"
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
    [ -e /usr/local/bin/uvx ] || ln -sf /usr/local/bin/uv /usr/local/bin/uvx
    echo "entrypoint: uv installed ($(uv --version))"
fi

# Start the no-LLM health-check loop in the background.
# Replaces Paula's LLM-based HEARTBEAT.md with a lightweight Python script.
# Runs once at startup then every 30 minutes; logs to stdout (→ CloudWatch).
HEALTH_CHECK_SCRIPT="/app/envoy-tools/skills/puli_health_check/scripts/health_check.py"
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL_SECONDS:-1800}"
if [ -f "$HEALTH_CHECK_SCRIPT" ]; then
    (
        while true; do
            python3 "$HEALTH_CHECK_SCRIPT" 2>&1 || true
            sleep "$HEALTH_CHECK_INTERVAL"
        done
    ) &
    echo "entrypoint: health-check loop started (interval ${HEALTH_CHECK_INTERVAL}s, PID $!)"
else
    echo "entrypoint: warning — health-check script not found: $HEALTH_CHECK_SCRIPT"
fi

exec "$@"
