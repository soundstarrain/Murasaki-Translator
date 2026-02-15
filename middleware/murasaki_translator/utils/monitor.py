"""
跨平台硬件监控模块
支持 NVIDIA (pynvml), macOS (ioreg), AMD (amd-smi)
"""
import sys
import subprocess
import time


class HardwareMonitor:
    """跨平台 GPU 监控器"""
    
    def __init__(self, gpu_index=0):
        self.gpu_index = gpu_index
        self.enabled = False
        self.backend = None  # 'nvidia', 'macos', 'amd', None
        self.name = "Unknown GPU"
        self._pynvml = None
        self._handle = None

        self._init_backend()
    
    def _init_backend(self):
        """根据平台初始化后端"""
        if sys.platform == 'darwin':
            self._init_macos()
        else:
            # Windows/Linux: 优先尝试 NVIDIA，回退 AMD
            if not self._init_nvidia():
                self._init_amd()
    
    def _init_nvidia(self) -> bool:
        """初始化 NVIDIA 后端 (pynvml)"""
        try:
            import warnings
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=FutureWarning)
                import pynvml
                self._pynvml = pynvml
            
            self._pynvml.nvmlInit()
            self._handle = self._pynvml.nvmlDeviceGetHandleByIndex(self.gpu_index)
            name = self._pynvml.nvmlDeviceGetName(self._handle)
            if isinstance(name, bytes):
                name = name.decode('utf-8')
            self.name = name
            self.backend = 'nvidia'
            self.enabled = True
            return True
        except ImportError:
            pass
        except Exception as e:
            print(f"[HardwareMonitor] NVIDIA init failed: {e}")
        return False
    
    def _init_macos(self):
        """初始化 macOS 后端"""
        try:
            result = subprocess.run(
                ['system_profiler', 'SPDisplaysDataType', '-json'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                import json
                data = json.loads(result.stdout)
                displays = data.get('SPDisplaysDataType', [])
                if displays:
                    self.name = displays[0].get('sppci_model', 'Apple GPU')
                    self.backend = 'macos'
                    self.enabled = True
        except Exception as e:
            print(f"[HardwareMonitor] macOS init failed: {e}")
    
    def _init_amd(self):
        """初始化 AMD 后端 (amd-smi)"""
        try:
            result = subprocess.run(
                ['amd-smi', 'static', '--json'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                import json
                data = json.loads(result.stdout)
                if data:
                    self.name = data[0].get('asic', {}).get('name', 'AMD GPU')
                    self.backend = 'amd'
                    self.enabled = True
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"[HardwareMonitor] AMD init failed: {e}")
    
    def get_status(self):
        """获取 GPU 状态"""
        if not self.enabled:
            return None
        
        if self.backend == 'nvidia':
            return self._get_nvidia_status()
        elif self.backend == 'macos':
            return self._get_macos_status()
        elif self.backend == 'amd':
            return self._get_amd_status()
        
        return None
    
    def _get_nvidia_status(self):
        """获取 NVIDIA GPU 状态"""
        try:
            mem_info = self._pynvml.nvmlDeviceGetMemoryInfo(self._handle)
            util = self._pynvml.nvmlDeviceGetUtilizationRates(self._handle)
            
            return {
                "name": self.name,
                "vram_used_gb": round(mem_info.used / 1024**3, 2),
                "vram_total_gb": round(mem_info.total / 1024**3, 2),
                "vram_percent": round(mem_info.used / mem_info.total * 100, 1),
                "gpu_util": util.gpu,
                "mem_util": util.memory
            }
        except Exception:
            return None
    
    def _get_macos_status(self):
        """
        获取 macOS GPU 状态
        - 使用 vm_stat 获取系统内存使用情况（统一内存）
        - 使用 powermetrics 获取 GPU 使用率（需要 sudo）

        注意：Apple Silicon 使用统一内存架构，CPU 和 GPU 共享内存
        """
        # 尝试使用 powermetrics 获取 GPU 使用率
        gpu_util = self._get_gpu_util_powermetrics()

        # 使用 vm_stat 获取内存使用情况
        try:
            result = subprocess.run(
                ['vm_stat'],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0:
                lines = result.stdout.split('\n')
                page_size = 16384

                free_pages = 0
                active_pages = 0
                wired_pages = 0

                for line in lines:
                    if 'Pages free' in line:
                        free_pages = int(line.split(':')[1].strip().rstrip('.'))
                    elif 'Pages active' in line:
                        active_pages = int(line.split(':')[1].strip().rstrip('.'))
                    elif 'Pages wired' in line:
                        wired_pages = int(line.split(':')[1].strip().rstrip('.'))

                used_gb = (active_pages + wired_pages) * page_size / (1024**3)
                total_gb = self._get_macos_total_ram()

                return {
                    "name": self.name,
                    "vram_used_gb": round(used_gb, 2),
                    "vram_total_gb": round(total_gb, 2),
                    "vram_percent": round(used_gb / total_gb * 100, 1) if total_gb > 0 else 0,
                    "gpu_util": gpu_util,  # 有 sudo: 真实值；无 sudo: -1
                    "mem_util": round(used_gb / total_gb * 100, 1) if total_gb > 0 else 0
                }
        except Exception:
            pass

        # 如果 vm_stat 失败，返回基础信息
        total_gb = self._get_macos_total_ram()
        return {
            "name": self.name,
            "vram_used_gb": 0,
            "vram_total_gb": round(total_gb, 2),
            "vram_percent": 0,
            "gpu_util": gpu_util,
            "mem_util": 0
        }

    def _get_gpu_util_powermetrics(self):
        """
        尝试通过 powermetrics 获取 GPU 使用率（需要 sudo）
        使用 plist 格式输出，解析更可靠

        Returns:
            float: GPU 使用率百分比 (0-100)，失败或无权限返回 -1
        """
        try:
            # 测试是否有 powermetrics 的免密 sudo 权限
            test = subprocess.run(
                ['sudo', '-n', 'powermetrics', '--help'],
                capture_output=True,
                timeout=2
            )
            if test.returncode != 0:
                return -1  # 无 sudo 权限

            # 运行 powermetrics，使用 plist 格式输出
            result = subprocess.run(
                ['sudo', '-n', 'powermetrics', '--samplers', 'gpu_power', '-i', '500', '-n', '1', '-f', 'plist'],
                capture_output=True,
                text=True,
                timeout=5
            )

            if result.returncode == 0:
                import plistlib
                data = plistlib.loads(result.stdout.encode('utf-8'))
                gpu = data.get('gpu', {})
                idle_ratio = gpu.get('idle_ratio', 1.0)
                active_percent = (1.0 - idle_ratio) * 100
                return round(active_percent, 1)
        except Exception:
            pass

        return -1
    
    def _get_macos_total_ram(self):
        """获取 macOS 总内存"""
        try:
            result = subprocess.run(
                ['sysctl', '-n', 'hw.memsize'],
                capture_output=True,
                text=True,
                timeout=2
            )
            if result.returncode == 0:
                return int(result.stdout.strip()) / (1024**3)
        except Exception:
            pass
        return 8.0
    
    def _get_amd_status(self):
        """获取 AMD GPU 状态"""
        try:
            result = subprocess.run(
                ['amd-smi', 'monitor', '--json'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                import json
                data = json.loads(result.stdout)
                if data:
                    gpu = data[0]
                    vram_used = gpu.get('vram', {}).get('used', 0)
                    vram_total = gpu.get('vram', {}).get('total', 0)
                    gpu_util = gpu.get('gpu', {}).get('utilization', 0)
                    
                    return {
                        "name": self.name,
                        "vram_used_gb": round(vram_used / 1024, 2),
                        "vram_total_gb": round(vram_total / 1024, 2),
                        "vram_percent": round(vram_used / vram_total * 100, 1) if vram_total > 0 else 0,
                        "gpu_util": gpu_util,
                        "mem_util": round(vram_used / vram_total * 100, 1) if vram_total > 0 else 0
                    }
        except Exception:
            pass
        return None
    
    def close(self):
        """关闭监控器"""
        if self.backend == 'nvidia' and self._pynvml:
            try:
                self._pynvml.nvmlShutdown()
            except Exception:
                pass
