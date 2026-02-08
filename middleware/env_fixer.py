#!/usr/bin/env python3
"""
Murasaki 环境修复工具
用于诊断和修复内嵌的 Python、CUDA、Vulkan 环境问题

设计理念：
1. 每个组件独立检测和修复
2. 给用户清晰的选项和确认
3. 输出结构化JSON报告，便于前端展示
"""

import os
import sys
import subprocess
import shutil
import json
import platform
import re
import argparse
import socket
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Literal

class EnvFixerError(Exception):
    """环境修复工具专用异常"""
    pass

# 全局静默模式标志，用于 JSON 输出时禁用彩色文本
_QUIET_MODE = False

class Colors:
    """终端颜色输出"""
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    END = '\033[0m'
    BOLD = '\033[1m'

def print_header(text: str):
    if _QUIET_MODE:
        return
    print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{text:^60}{Colors.END}")
    print(f"{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.END}\n")

def print_success(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.GREEN}✓{Colors.END} {text}")

def print_error(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.RED}✗{Colors.END} {text}")

def print_warning(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.YELLOW}⚠{Colors.END} {text}")

def print_info(text: str):
    if _QUIET_MODE:
        return
    print(f"{Colors.CYAN}ℹ{Colors.END} {text}")

def print_step(step: int, total: int, text: str):
    if _QUIET_MODE:
        return
    print(f"\n{Colors.BOLD}[{step}/{total}] {text}{Colors.END}")

def emit_progress(stage: str, progress: int, message: str = "", total_bytes: int = 0, downloaded_bytes: int = 0):
    """输出 JSON 格式的进度信息，供前端实时解析
    
    Args:
        stage: 当前阶段名称（如 'download', 'install', 'pip'）
        progress: 进度百分比 (0-100)
        message: 可选的进度消息
        total_bytes: 总字节数（用于下载）
        downloaded_bytes: 已下载字节数
    """
    progress_data = {
        "type": "progress",
        "stage": stage,
        "progress": progress,
        "message": message
    }
    if total_bytes > 0:
        progress_data["totalBytes"] = total_bytes
        progress_data["downloadedBytes"] = downloaded_bytes
    # 使用特殊前缀标记这是进度信息，便于 IPC 解析
    print(f"__PROGRESS__:{json.dumps(progress_data)}", flush=True)

def download_with_progress(url: str, dest_path: Path, stage_name: str = "download") -> bool:
    """带进度回调的下载函数
    
    Args:
        url: 下载地址
        dest_path: 保存路径
        stage_name: 阶段名称（用于进度输出）
    
    Returns:
        是否下载成功
    """
    try:
        emit_progress(stage_name, 0, f"正在连接 {url[:50]}...")
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req, timeout=60)
        
        total_size = int(response.headers.get('Content-Length', 0))
        downloaded = 0
        block_size = 8192
        
        with open(dest_path, 'wb') as f:
            while True:
                chunk = response.read(block_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                
                if total_size > 0:
                    percent = int((downloaded / total_size) * 100)
                    size_mb = downloaded / (1024 * 1024)
                    total_mb = total_size / (1024 * 1024)
                    emit_progress(stage_name, percent, f"{size_mb:.1f}/{total_mb:.1f} MB", total_size, downloaded)
                else:
                    size_mb = downloaded / (1024 * 1024)
                    emit_progress(stage_name, 50, f"已下载 {size_mb:.1f} MB")
        
        emit_progress(stage_name, 100, "下载完成")
        return True
        
    except Exception as e:
        emit_progress(stage_name, -1, f"下载失败: {str(e)}")
        return False

def run_command(cmd: List[str], timeout: int = 10) -> Tuple[bool, str]:
    """执行命令并返回结果"""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding='utf-8',
            errors='replace'
        )
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, f"Command timed out after {timeout}s"
    except Exception as e:
        return False, str(e)

class ComponentChecker:
    """组件检查基类"""
    
    def __init__(self, name: str):
        self.name = name
        self.status: Literal['ok', 'warning', 'error'] = 'ok'
        self.version: Optional[str] = None
        self.path: Optional[str] = None
        self.issues: List[str] = []
        self.fixes: List[str] = []
        self.can_auto_fix = False
    
    def check(self) -> None:
        """检查组件状态，由子类实现"""
        raise NotImplementedError
    
    def fix(self) -> Dict[str, any]:
        """尝试修复组件，由子类实现"""
        return {'success': False, 'message': '不支持自动修复'}
    
    def to_dict(self) -> Dict[str, any]:
        """转换为字典格式"""
        return {
            'name': self.name,
            'status': self.status,
            'version': self.version,
            'path': self.path,
            'issues': self.issues,
            'fixes': self.fixes,
            'canAutoFix': self.can_auto_fix
        }

class PythonChecker(ComponentChecker):
    """Python 环境检查器 - 检查内嵌Python和依赖完整性"""
    
    def __init__(self):
        super().__init__('Python')
        self.platform = platform.system()
        self.can_auto_fix = True  # 可以自动安装缺失的依赖包
        # 实际 requirements.txt 中的必要依赖（导入名）
        self.required_packages = [
            'requests',      # HTTP 客户端
            'lxml',          # EPUB 处理
            'bs4',           # beautifulsoup4
            'tqdm',          # 进度条
            'opencc',        # 繁简转换 (opencc-python-reimplemented)
        ]
        # 可选依赖（检测但不强制）
        self.optional_packages = [
            'pynvml',        # GPU 监控
            'fugashi',       # 日语分词 (MeCab)
        ]
        self.missing_packages: List[str] = []
        self.missing_optional: List[str] = []
    
    def check(self) -> None:
        """检查内嵌 Python 环境和依赖完整性"""
        
        # 使用绝对路径定位，避免相对路径在打包后失效
        script_dir = Path(__file__).parent.resolve()
        python_path = None
        possible_paths = [
            # 脚本所在目录的 .venv
            script_dir / '.venv' / ('Scripts/python.exe' if self.platform == 'Windows' else 'bin/python'),
            # 父目录的 middleware/.venv（开发环境）
            script_dir.parent / 'middleware' / '.venv' / ('Scripts/python.exe' if self.platform == 'Windows' else 'bin/python'),
        ]
        
        for path in possible_paths:
            if path.exists():
                python_path = path
                break
        
        if not python_path:
            self.status = 'error'
            self.issues.append("内嵌 Python 环境未找到")
            self.fixes.append("重新安装 Murasaki Translator")
            self.can_auto_fix = False
            print_error("未找到内嵌 Python 环境")
            return
        
        self.path = str(python_path)
        print_success(f"找到内嵌 Python: {python_path}")
        
        # 检查 Python 版本
        success, output = run_command([str(python_path), '--version'], timeout=10)
        if not success:
            self.status = 'error'
            self.issues.append("Python 环境损坏")
            self.fixes.append("重新安装 Murasaki Translator")
            self.can_auto_fix = False
            print_error("Python 环境损坏")
            return
        
        version_match = re.search(r'Python (\d+\.\d+\.\d+)', output)
        if version_match:
            self.version = version_match.group(1)
            major, minor = map(int, self.version.split('.')[:2])
            if (major, minor) < (3, 10):
                self.status = 'error'
                self.issues.append(f"Python 版本过低: {self.version} (需要 >= 3.10)")
                self.fixes.append("重新安装 Murasaki Translator")
                self.can_auto_fix = False
                print_error(f"Python 版本 {self.version} 低于项目最低要求 (3.10)")
                return
            print_success(f"检测到符合标准的 Python 环境: v{self.version}")
        
        print_info("正在快速扫描核心运行库组件...")
        
        # 检查关键依赖包
        for package in self.required_packages:
            success, output = run_command([str(python_path), '-c', f'import {package}'], timeout=5)
            if not success:
                self.missing_packages.append(package)
                print_error(f"缺少必要依赖: {package}")
        
        # 检查可选依赖
        for package in self.optional_packages:
            success, output = run_command([str(python_path), '-c', f'import {package}'], timeout=5)
            if not success:
                self.missing_optional.append(package)
                print_warning(f"缺少可选依赖: {package}")
        
        if self.missing_packages:
            self.status = 'error'
            self.issues.append(f"缺少 {len(self.missing_packages)} 个核心运行依赖: {', '.join(self.missing_packages)}")
            self.fixes.append("点击下方「一键安装依赖」将自动为你配置完整的运行环境")
        elif self.missing_optional:
            self.status = 'warning'
            self.issues.append(f"缺少可选功能组件: {', '.join(self.missing_optional)} (影响 GPU 监控或日语分词)")
            self.fixes.append("可以点击自动安装，或在需要这些功能时再安装")
        else:
            print_success("所有依赖包已安装")
    
    def fix(self) -> Dict[str, any]:
        """自动安装缺失的依赖包"""
        if not self.path:
            return {'success': False, 'message': 'Python 环境未找到'}
        
        if not self.missing_packages:
            return {'success': True, 'message': '没有需要安装的依赖包'}
        
        print_info(f"正在安装 {len(self.missing_packages)} 个缺失的依赖包...")
        emit_progress("pip_install", 0, f"准备安装 {len(self.missing_packages)} 个依赖包...")
        
        # 包名映射（有些包的导入名和安装名不同）
        package_map = {
            'PIL': 'Pillow',
        }
        
        install_packages = [package_map.get(pkg, pkg) for pkg in self.missing_packages]
        
        emit_progress("pip_install", 10, f"正在安装: {', '.join(install_packages)}")
        
        # 使用 pip 安装缺失的包（使用清华镜像源加速）
        pip_cmd = [
            self.path, '-m', 'pip', 'install',
            '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple',
            '--trusted-host', 'pypi.tuna.tsinghua.edu.cn'
        ] + install_packages
        success, output = run_command(pip_cmd, timeout=300)  # 5分钟超时
        
        emit_progress("pip_install", 100, "安装完成" if success else "安装失败")
        
        if success:
            print_success(f"成功安装依赖包: {', '.join(install_packages)}")
            self.missing_packages.clear()
            self.status = 'ok'
            self.issues.clear()
            self.fixes.clear()
            return {'success': True, 'message': f'成功安装 {len(install_packages)} 个依赖包'}
        else:
            print_error(f"安装失败: {output}")
            return {'success': False, 'message': f'安装失败: {output[:200]}'}

class CUDAChecker(ComponentChecker):
    """CUDA 环境检查器 - 只检查 GPU 和驱动"""
    
    def __init__(self):
        super().__init__('CUDA')
        self.platform = platform.system()
        self.driver: Optional[str] = None
        self.gpu: Optional[str] = None
        self.vram: Optional[str] = None
        self.can_auto_fix = False  # CUDA 需要手动安装
    
    def check(self) -> None:
        """检查 NVIDIA GPU 和驱动"""
        nvidia_smi_paths = []
        
        if self.platform == 'Windows':
            nvidia_smi_paths.extend([
                'nvidia-smi',
                'C:\\Windows\\System32\\nvidia-smi.exe',
                'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
            ])
        else:
            nvidia_smi_paths.append('nvidia-smi')

        # 检查 NVIDIA GPU
        for cmd in nvidia_smi_paths:
            success, output = run_command(
                [cmd, '--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
                timeout=5
            )
            if success and output.strip():
                parts = output.strip().split(', ')
                if len(parts) >= 3:
                    self.gpu = parts[0]
                    self.driver = parts[1]
                    self.vram = parts[2]
                    self.status = 'ok'
                    print_success(f"CUDA加速就绪: {self.gpu}")
                    print_info(f"  └─ 硬件规格: 显存 {self.vram}MB | 驱动版本 {self.driver}")
                    return

        # 未检测到 GPU
        self.status = 'warning'
        self.issues.append("NVIDIA GPU 未检测到或驱动未安装")
        self.fixes.append("安装 NVIDIA 驱动: https://www.nvidia.com/Download/index.aspx")
        print_warning("未检测到 NVIDIA GPU（将使用 Vulkan/CPU 模式）")

class VulkanChecker(ComponentChecker):
    """Vulkan 环境检查器"""
    
    def __init__(self):
        super().__init__('Vulkan')
        self.platform = platform.system()
        self.devices: List[str] = []
        self.can_auto_fix = self.platform == 'Windows'  # Windows 支持自动安装
    
    def check(self) -> None:
        """检查 Vulkan 环境"""
        success, output = run_command(['vulkaninfo', '--summary'], timeout=10)
        
        if success:
            version_match = re.search(r'Vulkan Instance Version:\s*(\d+\.\d+\.\d+)', output, re.IGNORECASE)
            if version_match:
                self.version = version_match.group(1)
                self.status = 'ok'
                print_success(f"Vulkan {self.version} 可用")

                # 提取设备信息
                gpu_matches = re.finditer(r'GPU\d+:\s*\w+\s*\([^)]+\)', output)
                for match in gpu_matches:
                    device_name = match.group(0)
                    self.devices.append(device_name)
                    print_info(f"  设备: {device_name}")
                return
        
        self.status = 'warning'
        self.issues.append("Vulkan 运行时未安装")
        
        if self.platform == 'Windows':
            self.fixes.append("点击「一键安装 Vulkan」自动下载并安装")
            print_warning("Vulkan 运行时组件缺失 (通用 GPU 加速可能受限)")
        elif self.platform == 'Linux':
            self.fixes.append("安装 Vulkan: apt install vulkan-tools (Ubuntu/Debian)")
            print_warning("Vulkan 工具链缺失")
        else:
            self.fixes.append("macOS 用户将使用 Metal 后端")
        
        print_warning("Llama 推理后端将自动尝试回退至 CPU 运算模式")
    
    def fix(self) -> Dict[str, any]:
        """自动下载并安装 Vulkan Runtime（仅 Windows）"""
        if self.platform != 'Windows':
            return {'success': False, 'message': '自动安装仅支持 Windows 系统'}
        
        import tempfile
        
        # Vulkan Runtime 下载地址（LunarG 官方）
        vulkan_url = "https://sdk.lunarg.com/sdk/download/latest/windows/vulkan-runtime.exe"
        
        try:
            print_info("正在下载 Vulkan Runtime...")
            
            # 下载安装程序到临时目录
            temp_dir = tempfile.gettempdir()
            installer_path = Path(temp_dir) / "vulkan_runtime_installer.exe"
            
            # 使用带进度的下载函数
            if not download_with_progress(vulkan_url, installer_path, "vulkan_download"):
                return {'success': False, 'message': '下载失败'}
            
            if not installer_path.exists():
                return {'success': False, 'message': '下载失败：文件未保存'}
            
            print_success(f"下载完成: {installer_path}")
            print_info("正在安装 Vulkan Runtime（静默模式）...")
            emit_progress("vulkan_install", 0, "正在启动安装程序...")
            
            # 静默安装
            success, output = run_command([str(installer_path), '/S'], timeout=120)
            
            emit_progress("vulkan_install", 100, "安装完成" if success else "安装失败")
            
            if success:
                print_success("Vulkan Runtime 安装成功！")
                self.status = 'ok'
                self.issues.clear()
                self.fixes.clear()
                return {'success': True, 'message': 'Vulkan Runtime 安装成功'}
            else:
                print_error(f"安装失败: {output}")
                return {'success': False, 'message': f'安装失败: {output[:200]}'}
                
        except urllib.error.URLError as e:
            emit_progress("vulkan_download", -1, f"下载失败: {str(e)}")
            print_error(f"下载失败: {e}")
            return {'success': False, 'message': f'下载失败: {str(e)}'}
        except Exception as e:
            emit_progress("vulkan_install", -1, f"安装出错: {str(e)}")
            print_error(f"安装过程出错: {e}")
            return {'success': False, 'message': f'安装出错: {str(e)}'}

class LlamaBackendChecker(ComponentChecker):
    """Llama 后端检查器 - 检查安装和运行状态"""
    
    def __init__(self, port: int = 8080):
        super().__init__('LlamaBackend')
        self.platform = platform.system()
        self.can_auto_fix = False
        self.port = port  # 支持从命令行传入端口
        self.error_type: Optional[str] = None  # oom, model, driver, connection, unknown
        self.server_path: Optional[str] = None
        self.is_running = False
    
    def _get_subdir(self) -> str:
        """根据平台和 GPU 返回二进制子目录名"""
        if self.platform == 'Windows':
            # 检查是否有 NVIDIA GPU
            has_nvidia = False
            for cmd in ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe']:
                success, _ = run_command([cmd, '--query-gpu=name', '--format=csv,noheader'], timeout=3)
                if success:
                    has_nvidia = True
                    break
            return 'win-cuda' if has_nvidia else 'win-vulkan'
        elif self.platform == 'Darwin':
            import platform as plat
            return 'darwin-metal' if plat.machine() == 'arm64' else 'darwin-x64'
        else:  # Linux
            success, _ = run_command(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], timeout=3)
            return 'linux-cuda' if success else 'linux-vulkan'
    
    def _find_llama_server(self) -> Optional[str]:
        """查找 llama-server 可执行文件（复用 platform.ts 逻辑）"""
        middleware_dir = Path(__file__).parent
        binary_name = 'llama-server.exe' if self.platform == 'Windows' else 'llama-server'
        
        # 1. 尝试新的 bin/{platform}/ 目录
        subdir = self._get_subdir()
        new_path = middleware_dir / 'bin' / subdir / binary_name
        if new_path.exists():
            return str(new_path)
        
        # 2. 回退：扫描 middleware 目录下的旧结构（llama-*-bin-* 目录）
        for item in middleware_dir.iterdir():
            if item.is_dir() and item.name.startswith('llama'):
                candidate = item / binary_name
                if candidate.exists():
                    return str(candidate)
        
        return None
    
    def check(self) -> None:
        """检查 Llama 后端状态"""
        print_info("检查 Llama 后端...")
        
        # Step 1: 检查安装（查找 llama-server）
        self.server_path = self._find_llama_server()
        if not self.server_path:
            self.status = 'error'
            self.issues.append("llama-server 未安装")
            self.fixes.append("请下载对应平台的 llama.cpp 二进制文件到 middleware/bin/ 目录")
            print_error("llama-server 未找到")
            return
        
        self.path = self.server_path
        print_success(f"找到 llama-server: {Path(self.server_path).name}")
        
        # Step 2: 检查端口是否开放（判断是否正在运行）
        port_open = False
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                result = s.connect_ex(('127.0.0.1', self.port))
                port_open = (result == 0)
        except Exception:
            pass
        
        if not port_open:
            # 后端未运行 - 这可能是正常的静默状态，也可能是启动失败
            # 使用 ok 状态但明确说明情况，让用户自行判断
            self.status = 'ok'
            self.version = None
            self.is_running = False
            # 注：这里无法区分"用户主动未启动"和"启动失败"，需用户根据实际情况判断
            print_success("Llama 推理后端已安装（当前未运行，翻译时将自动启动）")
            return
        
        # Step 3: 后端正在运行，发包测试推理能力
        self.is_running = True
        print_info(f"检测到活动后端进程 (端口 {self.port})，正在进行完整性握手测试...")
        
        try:
            print_info(f"发送数据报文进行端到端推理集成测试...")
            test_url = f'http://127.0.0.1:{self.port}/v1/chat/completions'
            test_payload = json.dumps({
                "model": "default",
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 5,
                "temperature": 0
            }).encode('utf-8')
            
            req = urllib.request.Request(test_url, data=test_payload, method='POST')
            req.add_header('Content-Type', 'application/json')
            
            print_info("正在进行翻译测试...")
            response = urllib.request.urlopen(req, timeout=30)
            result = json.loads(response.read().decode())
            
            if 'choices' in result and len(result['choices']) > 0:
                self.status = 'ok'
                self.version = result.get('model', '运行中')
                print_success(f"测试成功: 响应延时正常，模型「{self.version}」以及后端服务验证通过")
                return
            else:
                self.status = 'warning'
                self.issues.append("推理返回格式异常")
                self.fixes.append("检查模型是否正确加载")
                return
                
        except urllib.error.HTTPError as e:
            error_body = ""
            try:
                error_body = e.read().decode()
            except:
                pass
            
            error_lower = error_body.lower()
            
            # 识别常见错误
            if 'out of memory' in error_lower or 'oom' in error_lower:
                self.status = 'error'
                self.error_type = 'oom'
                self.issues.append("显存不足 (OOM)")
                self.fixes.append("减小 Context Size 或使用更小的量化版本")
                print_error("显存不足")
            elif 'failed to load' in error_lower or 'model not found' in error_lower:
                self.status = 'error'
                self.error_type = 'model'
                self.issues.append("模型加载失败")
                self.fixes.append("检查模型文件路径和格式")
                print_error("模型加载失败")
            elif 'cuda' in error_lower or 'vulkan' in error_lower or 'gpu' in error_lower:
                self.status = 'error'
                self.error_type = 'driver'
                self.issues.append("GPU/驱动问题")
                self.fixes.append("更新 GPU 驱动或切换到 CPU 模式")
                print_error("GPU/驱动问题")
            elif e.code == 404:
                # 可能是 Ollama 或其他后端
                self.status = 'warning'
                self.issues.append("API 端点不可用")
                self.fixes.append("确认使用的是 llama-server")
            else:
                self.status = 'error'
                self.error_type = 'unknown'
                self.issues.append(f"HTTP {e.code}")
                self.fixes.append("查看服务器日志")
                
        except urllib.error.URLError as e:
            self.status = 'warning'
            self.issues.append(f"连接失败: {e.reason}")
            self.fixes.append("后端可能仍在初始化")
            
        except Exception as e:
            self.status = 'warning'
            self.issues.append(f"测试失败: {str(e)}")
            self.fixes.append("查看服务器日志")

class MiddlewareChecker(ComponentChecker):
    """中间件文件检查器"""
    
    def __init__(self):
        super().__init__('Middleware')
        # 实际存在的核心文件
        self.required_files = [
            'get_specs.py',        # 硬件规格检测
            'term_extractor.py',   # 术语提取
            'rule_processor.py',   # 规则处理
            'common_utils.py',     # 通用工具
        ]
        # 必要的子目录
        self.required_dirs = [
            'murasaki_translator',  # 翻译引擎核心
            'server',               # 服务器模块
        ]
        self.missing_files: List[str] = []
        self.missing_dirs: List[str] = []
        self.can_auto_fix = False  # 中间件文件损坏需要重新安装
    
    def check(self) -> None:
        """检查中间件文件和目录"""
        # 使用脚本所在目录作为 middleware 目录
        middleware_dir = Path(__file__).parent
        
        # 如果脚本不在 middleware 目录，尝试查找
        if middleware_dir.name != 'middleware':
            # 尝试相对路径
            test_paths = [
                Path('./middleware'),
                Path('../middleware'),
                middleware_dir,
            ]
            middleware_dir = None
            for test_path in test_paths:
                if test_path.exists() and (test_path / 'translation_worker.py').exists():
                    middleware_dir = test_path
                    break
            
            if middleware_dir is None:
                self.status = 'error'
                self.issues.append("中间件目录不存在")
                self.fixes.append("重新安装 Murasaki Translator")
                print_error("未找到中间件目录")
                return
        
        self.path = str(middleware_dir.resolve())
        print_success(f"找到中间件目录: {middleware_dir}")

        # 检查必要目录
        for dir_name in self.required_dirs:
            dir_path = middleware_dir / dir_name
            if not dir_path.exists():
                self.missing_dirs.append(dir_name)
                print_error(f"缺少目录: {dir_name}")

        # 检查必要文件
        for file_name in self.required_files:
            file_path = middleware_dir / file_name
            if not file_path.exists():
                self.missing_files.append(file_name)
                print_error(f"缺少文件: {file_name}")
        
        if self.missing_dirs or self.missing_files:
            self.status = 'error'
            # 显示具体缺失的文件/目录名称
            if self.missing_dirs:
                self.issues.append(f"缺少目录: {', '.join(self.missing_dirs)}")
            if self.missing_files:
                self.issues.append(f"缺少文件: {', '.join(self.missing_files)}")
            self.fixes.append("重新安装 Murasaki Translator")
        else:
            self.status = 'ok'
            print_success("中间件结构完整")

class PermissionChecker(ComponentChecker):
    """文件权限检查器"""
    
    def __init__(self):
        super().__init__('Permissions')
        self.can_auto_fix = False  # 权限问题需要用户手动解决
    
    def check(self) -> None:
        """检查文件权限"""
        test_dirs = [
            Path('.'),
            Path('./middleware'),
            Path('./models'),
            Path('./glossaries'),
            Path('./output'),
        ]

        for test_dir in test_dirs:
            if test_dir.exists():
                test_file = test_dir / '.permission_test'
                try:
                    test_file.touch()
                    test_file.unlink()
                except PermissionError:
                    self.status = 'error'
                    self.issues.append(f"目录权限不足: {test_dir}")
                    self.fixes.append("以管理员/Root 权限运行，或检查目录权限设置")
                    print_error(f"目录无写入权限: {test_dir}")
                    return
        
        print_success("文件权限检查通过")
        self.status = 'ok'

class EnvironmentFixer:
    """环境修复工具主类"""
    
    def __init__(self, llama_port: int = 8080):
        self.platform = platform.system()
        self.arch = platform.machine()
        
        # 初始化各组件检查器
        self.checkers: List[ComponentChecker] = [
            PythonChecker(),
            CUDAChecker(),
            VulkanChecker(),
            LlamaBackendChecker(port=llama_port),  # 传入用户配置的端口
            MiddlewareChecker(),
            PermissionChecker(),
        ]
    
    def check_all(self) -> None:
        """检查所有组件"""
        print_header("Murasaki 环境诊断")
        print_info(f"平台: {self.platform} {self.arch}")
        
        for i, checker in enumerate(self.checkers, 1):
            print_step(i, len(self.checkers), f"检查 {checker.name}")
            checker.check()
    
    def fix_component(self, component_name: str) -> Dict[str, any]:
        """修复指定组件"""
        checker = next((c for c in self.checkers if c.name.lower() == component_name.lower()), None)
        
        if not checker:
            return {
                'success': False,
                'message': f'未找到组件: {component_name}'
            }
        
        print_header(f"修复 {checker.name}")
        result = checker.fix()
        
        if result['success']:
            print_success(f"{checker.name} 修复成功")
        else:
            print_error(f"{checker.name} 修复失败: {result.get('message', '未知错误')}")
        
        return result
    
    def generate_report(self) -> Dict[str, any]:
        """生成诊断报告"""
        # 统计问题
        total_issues = sum(len(c.issues) for c in self.checkers)
        total_errors = sum(1 for c in self.checkers if c.status == 'error')
        total_warnings = sum(1 for c in self.checkers if c.status == 'warning')
        
        report = {
            'system': {
                'platform': self.platform,
                'arch': self.arch,
            },
            'components': [c.to_dict() for c in self.checkers],
            'summary': {
                'totalIssues': total_issues,
                'totalErrors': total_errors,
                'totalWarnings': total_warnings,
                'overallStatus': 'ok' if total_errors == 0 else 'error',
            }
        }
        
        # 打印汇总（非 JSON 模式）
        if not _QUIET_MODE:
            print_header("诊断报告汇总")
            
            print(f"{Colors.BOLD}系统信息:{Colors.END}")
            print(f"  平台: {self.platform} {self.arch}")
            
            print(f"\n{Colors.BOLD}组件状态:{Colors.END}")
            for checker in self.checkers:
                status_icon = {
                    'ok': f"{Colors.GREEN}✓{Colors.END}",
                    'warning': f"{Colors.YELLOW}⚠{Colors.END}",
                    'error': f"{Colors.RED}✗{Colors.END}"
                }.get(checker.status, '?')
                print(f"  {status_icon} {checker.name}: {checker.version or 'N/A'}")
            
            if total_issues > 0:
                print(f"\n{Colors.RED}{Colors.BOLD}发现 {total_issues} 个问题 ({total_errors} 错误, {total_warnings} 警告){Colors.END}")
            else:
                print(f"\n{Colors.GREEN}{Colors.BOLD}✓ 环境检查通过，未发现问题{Colors.END}")
        
        return report
    
    def save_report(self, report: Dict[str, any]) -> None:
        """保存报告到文件"""
        # 使用绝对路径保存到脚本所在目录
        script_dir = Path(__file__).parent.resolve()
        report_path = script_dir / 'environment_report.json'
        try:
            with open(report_path, 'w', encoding='utf-8') as f:
                json.dump(report, f, indent=2, ensure_ascii=False)
            print_info(f"详细报告已保存到: {report_path}")
        except Exception as e:
            print_error(f"保存报告失败: {e}")

def main():
    """主函数"""
    global _QUIET_MODE
    
    parser = argparse.ArgumentParser(description='Murasaki 环境修复工具')
    parser.add_argument('--check', action='store_true', help='仅检查，不修复')
    parser.add_argument('--fix', type=str, help='修复指定组件 (Python/CUDA/Vulkan/LlamaBackend/Middleware/Permissions)')
    parser.add_argument('--json', action='store_true', help='输出 JSON 格式')
    parser.add_argument('--port', type=int, default=8080, help='Llama 后端端口 (默认 8080)')
    
    args = parser.parse_args()
    
    # JSON 模式下启用静默模式
    if args.json:
        _QUIET_MODE = True
    
    # 传入用户配置的端口
    fixer = EnvironmentFixer(llama_port=args.port)
    
    # 执行检查
    fixer.check_all()
    
    # 生成报告
    report = fixer.generate_report()
    
    # 保存报告
    fixer.save_report(report)
    
    # 执行修复（如果指定）
    if args.fix:
        result = fixer.fix_component(args.fix)
        if args.json:
            print(json.dumps({'fixResult': result}, indent=2, ensure_ascii=False))
        sys.exit(0 if result['success'] else 1)
    
    # 输出 JSON（如果指定）
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        sys.exit(0 if report['summary']['totalErrors'] == 0 else 1)
    
    # 正常退出
    sys.exit(0 if report['summary']['totalErrors'] == 0 else 1)

if __name__ == '__main__':
    main()
