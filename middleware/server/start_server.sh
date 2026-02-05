#!/bin/bash
# Murasaki Translation API Server 启动脚本

set -e

cd "$(dirname "$0")/.."

# 检查依赖
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "[INFO] Installing server dependencies..."
    pip3 install -r server/requirements.txt
    pip3 install -r requirements.txt
fi

# 解析参数
MODEL=""
PORT="8000"
HOST="0.0.0.0"

while [[ $# -gt 0 ]]; do
    case $1 in
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
        *)
            shift
            ;;
    esac
done

# 启动服务器
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           Murasaki Translation API Server                    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

CMD="python3 server/api_server.py --host $HOST --port $PORT"
if [ -n "$MODEL" ]; then
    CMD="$CMD --model $MODEL"
fi

echo "[INFO] Starting: $CMD"
echo ""

exec $CMD
