#!/bin/bash
# Murasaki Translation API Server startup script

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MODEL=""
PORT="8000"
HOST="0.0.0.0"
API_KEY=""
ENABLE_OPENAI_PROXY="0"
OPENAI_PORT="8001"
OPENAI_PROXY_LOG="${OPENAI_PROXY_LOG:-openai-proxy.log}"
OPENAI_PROXY_TIMEOUT="${OPENAI_PROXY_TIMEOUT:-30}"
VENV_DIR=".venv"
PYTHON_BIN="${MURASAKI_PYTHON_BIN:-python3}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)
      MODEL="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --api-key)
      API_KEY="$2"
      shift 2
      ;;
    --enable-openai-proxy)
      ENABLE_OPENAI_PROXY="1"
      shift
      ;;
    --openai-port)
      OPENAI_PORT="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ ! -x "${VENV_DIR}/bin/python3" ]]; then
  echo "[INFO] Creating virtual environment: ${VENV_DIR}"
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

PYTHON="${VENV_DIR}/bin/python3"

if ! "${PYTHON}" -c "import fastapi,uvicorn,httpx,requests" >/dev/null 2>&1; then
  echo "[INFO] Installing dependencies into ${VENV_DIR}..."
  "${PYTHON}" -m pip install --upgrade pip
  "${PYTHON}" -m pip install -r requirements.txt
  "${PYTHON}" -m pip install -r server/requirements.txt
  "${PYTHON}" -m pip install -r openai_proxy/requirements.txt
fi

if [[ -z "${API_KEY}" ]]; then
  if [[ -n "${MURASAKI_API_KEY:-}" ]]; then
    API_KEY="${MURASAKI_API_KEY}"
  else
    API_KEY="$("${PYTHON}" - <<'PY'
import secrets
print(secrets.token_urlsafe(24))
PY
)"
  fi
fi

export MURASAKI_API_KEY="${API_KEY}"

wait_for_openai_proxy() {
  local url="http://${HOST}:${OPENAI_PORT}/health"
  local deadline=$((SECONDS + OPENAI_PROXY_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    if "$PYTHON" - <<'PY' >/dev/null 2>&1; then
import os
import sys
import urllib.request
import urllib.error

url = os.environ.get("OPENAI_PROXY_HEALTH", "")
if not url:
    sys.exit(1)
try:
    with urllib.request.urlopen(url, timeout=1) as resp:
        sys.exit(0 if resp.status == 200 else 1)
except Exception:
    sys.exit(1)
PY
    then
      return 0
    fi

    if [[ -n "${OPENAI_PROXY_PID:-}" ]] && ! kill -0 "$OPENAI_PROXY_PID" 2>/dev/null; then
      return 1
    fi
    sleep 1
  done
  return 1
}

API_CMD=("${PYTHON}" server/api_server.py --host "$HOST" --port "$PORT" --api-key "$API_KEY")
if [[ -n "$MODEL" ]]; then
  API_CMD+=(--model "$MODEL")
fi

cleanup() {
  if [[ -n "${OPENAI_PROXY_PID:-}" ]]; then
    kill "$OPENAI_PROXY_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if [[ "$ENABLE_OPENAI_PROXY" == "1" ]]; then
  if [[ ! -f "openai_proxy/server.py" ]]; then
    echo "[ERROR] openai_proxy/server.py not found under ${ROOT_DIR}"
    exit 1
  fi
  echo "[INFO] Starting OpenAI proxy on ${HOST}:${OPENAI_PORT}"
  (
    cd openai_proxy
    LLAMA_SERVER_URL="http://127.0.0.1:8080" \
      "${PYTHON}" -m uvicorn server:app --host "$HOST" --port "$OPENAI_PORT"
  ) >> "${OPENAI_PROXY_LOG}" 2>&1 &
  OPENAI_PROXY_PID=$!

  export OPENAI_PROXY_HEALTH="http://${HOST}:${OPENAI_PORT}/health"
  if ! wait_for_openai_proxy; then
    echo "[ERROR] OpenAI proxy failed to start on ${HOST}:${OPENAI_PORT}"
    if [[ -f "${OPENAI_PROXY_LOG}" ]]; then
      echo "----- openai-proxy.log (tail) -----"
      tail -n 200 "${OPENAI_PROXY_LOG}" || true
      echo "-----------------------------------"
    fi
    exit 1
  fi
fi

if [[ "$ENABLE_OPENAI_PROXY" == "1" ]]; then
  export MURASAKI_ENABLE_OPENAI_PROXY="1"
else
  export MURASAKI_ENABLE_OPENAI_PROXY="0"
fi

echo "[INFO] Starting API server on ${HOST}:${PORT}"
if [[ ${#API_KEY} -le 8 ]]; then
  API_KEY_MASKED="********"
else
  API_KEY_MASKED="${API_KEY:0:4}...${API_KEY: -4}"
fi
echo "[INFO] API Key configured: ${API_KEY_MASKED}"
exec "${API_CMD[@]}"
