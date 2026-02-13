#!/usr/bin/env bash
set -euo pipefail

RELEASE_URL="${RELEASE_URL:-https://github.com/soundstarrain/Murasaki-Translator/releases/latest/download/murasaki-server-linux-x64.tar.gz}"
MODEL_PATH="${MODEL_PATH:-${1:-}}"
API_KEY="${API_KEY:-${2:-}}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
OPENAI_PORT="${OPENAI_PORT:-8001}"
INSTALL_DIR="${INSTALL_DIR:-murasaki-server}"

if [[ -z "${MODEL_PATH}" ]]; then
  echo "Usage:"
  echo "  MODEL_PATH=/path/to/model.gguf API_KEY=your-key bash install-linux-server.sh"
  echo "  # or"
  echo "  bash install-linux-server.sh /path/to/model.gguf your-key"
  exit 1
fi

if [[ -z "${API_KEY}" ]]; then
  API_KEY="$(
    python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(24))
PY
  )"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "[INFO] Downloading ${RELEASE_URL}"
curl -fsSL "${RELEASE_URL}" | tar -xz -C "${tmp_dir}"

rm -rf "${INSTALL_DIR}"
mv "${tmp_dir}/murasaki-server" "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

echo "[INFO] Starting server in background..."
nohup ./start.sh \
  --host "${HOST}" \
  --port "${PORT}" \
  --model "${MODEL_PATH}" \
  --api-key "${API_KEY}" \
  --enable-openai-proxy \
  --openai-port "${OPENAI_PORT}" \
  > server.log 2>&1 &

echo "[OK] Started. PID: $!"
echo "[OK] GUI URL: http://<server-ip>:${PORT}"
echo "[OK] OpenAI URL: http://<server-ip>:${OPENAI_PORT}/v1"
echo "[OK] API_KEY: ${API_KEY}"
echo "[OK] Logs: ${INSTALL_DIR}/server.log"
