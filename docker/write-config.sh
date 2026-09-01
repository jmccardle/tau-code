#!/bin/sh
# Write ~/.tau/config.json from the container's environment.
#
# tau ships a first-run config template pointing at localhost:8000. Inside a
# container that address is wrong, and wrong quietly: the server starts, the
# browser connects, and the first turn fails against a port nothing is listening
# on. So this refuses to guess. No TAU_MODEL_BASE_URL and no mounted config is a
# startup failure, not a default.
#
# An existing ~/.tau/config.json -- a mounted one, say -- is left alone.
set -eu

CONFIG_DIR="${HOME}/.tau"
CONFIG="${CONFIG_DIR}/config.json"

[ -f "$CONFIG" ] && exit 0

if [ -z "${TAU_MODEL_BASE_URL:-}" ]; then
    echo "tau-code: TAU_MODEL_BASE_URL is not set and ${CONFIG} does not exist." >&2
    echo "  Set TAU_MODEL_BASE_URL (and TAU_MODEL_NAME), or mount a config.json at ${CONFIG}." >&2
    exit 78   # EX_CONFIG
fi

mkdir -p "$CONFIG_DIR"
cat > "$CONFIG" <<EOF
{
    "models": {
        "container-llm": {
            "backend": "openai",
            "model": "${TAU_MODEL_NAME:-stub}",
            "base_url": "${TAU_MODEL_BASE_URL}",
            "api_key": "${TAU_API_KEY:-not-needed}"
        }
    },
    "default_model": "container-llm",
    "system_prompt": "${TAU_SYSTEM_PROMPT:-You are a helpful assistant. Be concise and clear.}"
}
EOF
echo "tau-code: wrote ${CONFIG} -> ${TAU_MODEL_BASE_URL}" >&2
