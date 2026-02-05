"""
Common Utilities - 跨模块共享的工具函数

解决：
1. PyInstaller 打包后路径检测问题
2. DRY 原则 - 统一路径查找逻辑
"""

import sys
import os
from pathlib import Path
from typing import Optional


def get_middleware_dir() -> Path:
    """
    获取 middleware 目录路径
    
    处理两种情况：
    1. 普通脚本模式：使用 __file__ 向上查找
    2. PyInstaller 打包模式：使用 sys.executable 的位置
    """
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包模式
        # sys.executable 是打包后的可执行文件路径
        # 根据打包结构向上查找 middleware 目录
        executable_dir = Path(sys.executable).parent
        
        # 尝试多种可能的目录结构
        candidates = [
            executable_dir,                      # 可执行文件同级
            executable_dir.parent,               # 上一级
            executable_dir.parent / "middleware",  # resources/middleware
            executable_dir / "middleware",       # 子目录
        ]
        
        for candidate in candidates:
            # 检查是否存在 bin 目录或 murasaki_translator 目录
            if (candidate / "bin").exists() or (candidate / "murasaki_translator").exists():
                return candidate
        
        # 回退到可执行文件目录
        return executable_dir
    else:
        # 普通脚本模式：当前文件向上两级
        return Path(__file__).parent


def get_llama_server_path() -> Optional[str]:
    """
    跨平台查找 llama-server 二进制路径
    
    搜索顺序：
    1. middleware/bin/{platform}/ 目录
    2. middleware/ 根目录下的任意子目录
    """
    import subprocess
    
    middleware_dir = get_middleware_dir()
    
    # 确定平台和二进制名称
    if sys.platform == 'win32':
        binary_name = 'llama-server.exe'
        has_nvidia = _check_nvidia_gpu()
        platform_dir = 'win-cuda' if has_nvidia else 'win-vulkan'
    elif sys.platform == 'darwin':
        binary_name = 'llama-server'
        import platform as plat
        platform_dir = 'darwin-metal' if 'arm' in plat.machine().lower() else 'darwin-x64'
    else:  # Linux
        binary_name = 'llama-server'
        has_nvidia = _check_nvidia_gpu()
        platform_dir = 'linux-cuda' if has_nvidia else 'linux-vulkan'
    
    # 优先查找 bin/{platform}/ 目录
    primary_path = middleware_dir / 'bin' / platform_dir / binary_name
    if primary_path.exists():
        # 确保有执行权限
        if sys.platform != 'win32':
            os.chmod(str(primary_path), 0o755)
        return str(primary_path)
    
    # 回退：查找任意子目录
    for subdir in middleware_dir.iterdir():
        if subdir.is_dir():
            fallback_path = subdir / binary_name
            if fallback_path.exists():
                if sys.platform != 'win32':
                    os.chmod(str(fallback_path), 0o755)
                return str(fallback_path)
    
    return None


def _check_nvidia_gpu() -> bool:
    """检测是否有 NVIDIA GPU"""
    import subprocess
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
            capture_output=True,
            text=True,
            timeout=5
        )
        return result.returncode == 0 and bool(result.stdout.strip())
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def get_user_data_dir() -> Path:
    """
    获取用户数据目录（用于存放 uploads, outputs, logs）
    
    解决：
    - AppImage/macOS .app 打包后程序目录只读的问题
    """
    if getattr(sys, 'frozen', False):
        # 打包模式：使用用户目录
        if sys.platform == 'win32':
            base = Path(os.environ.get('LOCALAPPDATA', os.path.expanduser('~')))
        elif sys.platform == 'darwin':
            base = Path.home() / 'Library' / 'Application Support'
        else:
            base = Path.home() / '.local' / 'share'
        
        data_dir = base / 'MurasakiTranslator'
        data_dir.mkdir(parents=True, exist_ok=True)
        return data_dir
    else:
        # 开发模式：使用 middleware 目录
        return get_middleware_dir()
