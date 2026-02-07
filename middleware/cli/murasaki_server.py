#!/usr/bin/env python3
"""
Murasaki Translator CLI Server
一体化服务器：同时运行 llama-server 和 OpenAI 兼容代理

用法:
  python murasaki_server.py --model /path/to/model.gguf --port 8000
  
API 端点:
  POST /v1/chat/completions  - OpenAI 兼容翻译接口
  GET  /v1/models            - 模型列表
  GET  /health               - 健康检查
"""

import argparse
import subprocess
import os
import sys
import signal
import time
import atexit
from pathlib import Path

# 添加父目录到 path
sys.path.insert(0, str(Path(__file__).parent.parent))


def find_llama_server():
    """查找 llama-server 二进制"""
    import subprocess
    middleware_dir = Path(__file__).parent.parent  # middleware/ 目录（bin/ 在此下）
    
    # 跨平台检测 NVIDIA GPU（支持 Windows 多路径）
    def has_nvidia_gpu() -> bool:
        import shutil
        # Windows 上 nvidia-smi 可能不在 PATH 中
        nvidia_smi_paths = ['nvidia-smi']
        if sys.platform == 'win32':
            nvidia_smi_paths.extend([
                r'C:\Windows\System32\nvidia-smi.exe',
                r'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe'
            ])
        
        for nvidia_smi in nvidia_smi_paths:
            try:
                if not os.path.isabs(nvidia_smi) and not shutil.which(nvidia_smi):
                    continue
                if os.path.isabs(nvidia_smi) and not os.path.exists(nvidia_smi):
                    continue
                
                result = subprocess.run(
                    [nvidia_smi, '--query-gpu=name', '--format=csv,noheader'],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0 and result.stdout.strip():
                    print(f"[INFO] NVIDIA GPU detected: {result.stdout.strip()}")
                    return True
            except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
                continue
        return False
    
    if sys.platform == 'linux':
        # Linux: 有 NVIDIA GPU 则用 CUDA，否则 Vulkan
        if has_nvidia_gpu():
            candidate = middleware_dir / 'bin' / 'linux-cuda' / 'llama-server'
            if not candidate.exists():
                candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'
        else:
            candidate = middleware_dir / 'bin' / 'linux-vulkan' / 'llama-server'
    elif sys.platform == 'darwin':
        import platform
        if 'arm' in platform.machine().lower():
            candidate = middleware_dir / 'bin' / 'darwin-metal' / 'llama-server'
        else:
            candidate = middleware_dir / 'bin' / 'darwin-x64' / 'llama-server'
    else:
        # Windows - 不推荐使用 CLI 模式
        if has_nvidia_gpu():
            candidate = middleware_dir / 'bin' / 'win-cuda' / 'llama-server.exe'
        else:
            candidate = middleware_dir / 'bin' / 'win-vulkan' / 'llama-server.exe'
    
    # 回退：检查旧目录结构
    if not candidate.exists():
        for subdir in middleware_dir.iterdir():
            if subdir.is_dir():
                binary_name = 'llama-server.exe' if sys.platform == 'win32' else 'llama-server'
                legacy_path = subdir / binary_name
                if legacy_path.exists():
                    print(f"[INFO] Using legacy binary path: {legacy_path}")
                    return str(legacy_path)
    
    if not candidate.exists():
        raise FileNotFoundError(f"llama-server not found: {candidate}")
    
    # 确保可执行权限 (Unix)
    if sys.platform != 'win32':
        os.chmod(candidate, 0o755)
    
    return str(candidate)


class MurasakiServer:
    def __init__(self, args):
        self.args = args
        self.llama_process = None
        self.proxy_process = None
        
    def start_llama_server(self):
        """启动 llama-server"""
        server_path = find_llama_server()
        
        cmd = [
            server_path,
            '-m', self.args.model,
            '--port', str(self.args.llama_port),
            '-c', str(self.args.ctx),
            '-ngl', str(self.args.gpu_layers),
            '--host', '127.0.0.1'
        ]
        
        if self.args.parallel > 1:
            cmd.extend(['--parallel', str(self.args.parallel)])
            cmd.extend(['-np', str(self.args.parallel)])
        
        print(f"[llama-server] Starting: {' '.join(cmd)}")
        self.llama_process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT
        )
        
        # 等待服务器就绪
        print("[llama-server] Waiting for server to be ready...")
        time.sleep(5)
        
        if self.llama_process.poll() is not None:
            # 读取错误输出
            output = self.llama_process.stdout.read().decode('utf-8', errors='ignore')
            raise RuntimeError(f"llama-server failed to start:\n{output}")
        
        print(f"[llama-server] Running on http://127.0.0.1:{self.args.llama_port}")
    
    def start_openai_proxy(self):
        """启动 OpenAI 代理"""
        proxy_dir = Path(__file__).parent / 'openai_proxy'
        
        env = os.environ.copy()
        env['LLAMA_SERVER_URL'] = f"http://127.0.0.1:{self.args.llama_port}"
        
        cmd = [
            sys.executable, '-m', 'uvicorn',
            'server:app',
            '--host', self.args.host,
            '--port', str(self.args.port)
        ]
        
        print(f"[openai-proxy] Starting on http://{self.args.host}:{self.args.port}")
        self.proxy_process = subprocess.Popen(
            cmd,
            cwd=str(proxy_dir),
            env=env
        )
        
        time.sleep(2)
        if self.proxy_process.poll() is not None:
            raise RuntimeError("OpenAI proxy failed to start")
    
    def stop(self):
        """停止所有服务"""
        print("\n[shutdown] Stopping services...")
        
        if self.proxy_process:
            try:
                self.proxy_process.terminate()
                self.proxy_process.wait(timeout=5)
            except Exception:
                self.proxy_process.kill()
        
        if self.llama_process:
            try:
                self.llama_process.terminate()
                self.llama_process.wait(timeout=10)
            except Exception:
                self.llama_process.kill()
        
        print("[shutdown] All services stopped.")
    
    def run(self):
        """运行服务器"""
        # 注册清理函数
        atexit.register(self.stop)
        signal.signal(signal.SIGINT, lambda s, f: sys.exit(0))
        signal.signal(signal.SIGTERM, lambda s, f: sys.exit(0))
        
        try:
            self.start_llama_server()
            self.start_openai_proxy()
            
            print("\n" + "=" * 60)
            print("  Murasaki Translator Server is running!")
            print(f"  OpenAI API: http://{self.args.host}:{self.args.port}/v1/chat/completions")
            print(f"  Models:     http://{self.args.host}:{self.args.port}/v1/models")
            print(f"  Health:     http://{self.args.host}:{self.args.port}/health")
            print("=" * 60 + "\n")
            print("Press Ctrl+C to stop.\n")
            
            # 保持运行
            while True:
                time.sleep(1)
                
                # 检查进程状态
                if self.llama_process.poll() is not None:
                    print("[ERROR] llama-server crashed!")
                    break
                if self.proxy_process.poll() is not None:
                    print("[ERROR] openai-proxy crashed!")
                    break
                    
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()


def main():
    parser = argparse.ArgumentParser(
        description="Murasaki Translator CLI Server - OpenAI Compatible Translation API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 基础启动
  python murasaki_server.py --model ./models/Murasaki-8B.gguf
  
  # 指定端口和并行数
  python murasaki_server.py --model ./models/model.gguf --port 8000 --parallel 4
  
  # 使用 CURL 测试
  curl http://localhost:8000/v1/chat/completions \\
    -H "Content-Type: application/json" \\
    -d '{"model":"local","messages":[{"role":"user","content":"翻译：こんにちは"}]}'

Linux 部署:
  # 1. 安装依赖
  pip install -r requirements.txt
  pip install fastapi uvicorn httpx
  
  # 2. 后台运行
  nohup python murasaki_server.py --model /path/to/model.gguf > server.log 2>&1 &
  
  # 3. 或使用 systemd (参考 openai_proxy/openai_proxy.service)
"""
    )
    
    parser.add_argument('--model', required=True, help='GGUF 模型路径')
    parser.add_argument('--port', type=int, default=8000, help='OpenAI API 端口 (默认 8000)')
    parser.add_argument('--host', default='0.0.0.0', help='监听地址 (默认 0.0.0.0)')
    parser.add_argument('--llama-port', type=int, default=8080, help='llama-server 内部端口 (默认 8080)')
    parser.add_argument('--ctx', type=int, default=8192, help='上下文长度 (默认 8192)')
    parser.add_argument('--gpu-layers', type=int, default=-1, help='GPU 层数 (默认 -1, 全部)')
    parser.add_argument('--parallel', type=int, default=1, help='并行槽位数 (默认 1)')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.model):
        print(f"Error: Model not found: {args.model}")
        sys.exit(1)
    
    server = MurasakiServer(args)
    server.run()


if __name__ == '__main__':
    main()
