"""
跨平台硬件检测模块
支持 Windows (NVIDIA/AMD/Intel), macOS (Metal), Linux (NVIDIA/AMD/Intel)
"""
import json
import subprocess
import sys
import re


def get_gpu_info():
    """
    跨平台获取 GPU 信息
    返回: dict { "name": str, "vram_gb": float, "backend": str }
    """
    if sys.platform == 'darwin':
        return _get_macos_gpu_info()
    elif sys.platform == 'win32':
        return _get_windows_gpu_info()
    else:  # Linux
        return _get_linux_gpu_info()


def _get_macos_gpu_info():
    """macOS: 使用 system_profiler 获取 GPU 信息"""
    try:
        result = subprocess.run(
            ['system_profiler', 'SPDisplaysDataType', '-json'],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            displays = data.get('SPDisplaysDataType', [])
            
            for display in displays:
                name = display.get('sppci_model', 'Unknown GPU')
                
                # 获取显存 (macOS 格式: "8 GB" 或 "16384 MB")
                vram_str = display.get('spdisplays_vram', '') or display.get('sppci_vram', '')
                vram_gb = 0.0
                if vram_str:
                    match = re.search(r'(\d+)\s*(GB|MB)', vram_str, re.IGNORECASE)
                    if match:
                        value = int(match.group(1))
                        unit = match.group(2).upper()
                        vram_gb = value if unit == 'GB' else value / 1024
                
                # Apple Silicon 使用统一内存，显示为系统 RAM
                if 'Apple' in name or 'M1' in name or 'M2' in name or 'M3' in name or 'M4' in name:
                    # Apple Silicon 共享系统内存
                    ram_gb = _get_system_ram()
                    return {
                        "name": name,
                        "vram_gb": ram_gb,  # 共享内存
                        "backend": "metal",
                        "is_unified_memory": True
                    }
                
                return {
                    "name": name,
                    "vram_gb": vram_gb,
                    "backend": "metal" if 'Apple' in name else "cpu",
                    "is_unified_memory": False
                }
    except Exception as e:
        pass
    
    return {"name": "Unknown (macOS)", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False}


def _get_windows_gpu_info():
    """Windows: 优先 nvidia-smi，回退 wmic"""
    # 1. 尝试 NVIDIA GPU
    nvidia_info = _get_nvidia_gpu_info()
    if nvidia_info["vram_gb"] > 0:
        return nvidia_info
    
    # 2. 回退到 wmic 获取任意 GPU
    try:
        result = subprocess.run(
            ['wmic', 'path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv'],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
        )
        if result.returncode == 0:
            lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip() and 'Node' not in l]
            for line in lines:
                parts = line.split(',')
                if len(parts) >= 3:
                    adapter_ram = parts[1].strip()
                    name = parts[2].strip()
                    
                    # 跳过虚拟显卡
                    if 'Microsoft' in name or 'Basic' in name:
                        continue
                    
                    vram_gb = 0.0
                    if adapter_ram and adapter_ram.isdigit():
                        vram_gb = int(adapter_ram) / (1024**3)
                    
                    backend = "vulkan"
                    if 'NVIDIA' in name.upper():
                        backend = "cuda"
                    elif 'AMD' in name.upper() or 'RADEON' in name.upper():
                        backend = "vulkan"
                    elif 'INTEL' in name.upper():
                        backend = "vulkan"
                    
                    return {
                        "name": name,
                        "vram_gb": round(vram_gb, 1),
                        "backend": backend,
                        "is_unified_memory": False
                    }
    except Exception:
        pass
    
    return {"name": "Unknown (Windows)", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False}


def _get_linux_gpu_info():
    """Linux: 优先 nvidia-smi，回退 /sys/class/drm"""
    # 1. 尝试 NVIDIA GPU
    nvidia_info = _get_nvidia_gpu_info()
    if nvidia_info["vram_gb"] > 0:
        return nvidia_info
    
    # 2. 尝试 AMD GPU (amd-smi 或 /sys)
    amd_info = _get_amd_gpu_info()
    if amd_info["vram_gb"] > 0:
        return amd_info
    
    # 3. 回退到 lspci 检测
    try:
        result = subprocess.run(
            ['lspci'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            for line in result.stdout.split('\n'):
                if 'VGA' in line or '3D' in line:
                    if 'NVIDIA' in line.upper():
                        return {"name": line.split(':')[-1].strip(), "vram_gb": 0, "backend": "cuda", "is_unified_memory": False}
                    elif 'AMD' in line.upper() or 'ATI' in line.upper():
                        return {"name": line.split(':')[-1].strip(), "vram_gb": 0, "backend": "vulkan", "is_unified_memory": False}
                    elif 'INTEL' in line.upper():
                        return {"name": line.split(':')[-1].strip(), "vram_gb": 0, "backend": "vulkan", "is_unified_memory": False}
    except Exception:
        pass
    
    return {"name": "Unknown (Linux)", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False}


def _get_nvidia_gpu_info():
    """获取 NVIDIA GPU 信息 (跨平台 + Windows 多路径)"""
    import shutil
    import sys
    
    # Windows 上 nvidia-smi 可能不在 PATH 中
    nvidia_smi_paths = ['nvidia-smi']
    if sys.platform == 'win32':
        nvidia_smi_paths.extend([
            r'C:\Windows\System32\nvidia-smi.exe',
            r'C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe'
        ])
    
    for nvidia_smi in nvidia_smi_paths:
        try:
            # 检查命令是否存在
            import os
            if not os.path.isabs(nvidia_smi) and not shutil.which(nvidia_smi):
                continue
            if os.path.isabs(nvidia_smi) and not os.path.exists(nvidia_smi):
                continue
            
            # 获取 GPU 名称
            name_result = subprocess.run(
                [nvidia_smi, '--query-gpu=name', '--format=csv,noheader'],
                capture_output=True,
                text=True,
                timeout=5
            )
            # 获取显存
            vram_result = subprocess.run(
                [nvidia_smi, '--query-gpu=memory.total', '--format=csv,noheader,nounits'],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if name_result.returncode == 0 and vram_result.returncode == 0:
                name = name_result.stdout.strip().split('\n')[0]
                vram_mb = int(vram_result.stdout.strip().split('\n')[0])
                return {
                    "name": name,
                    "vram_gb": round(vram_mb / 1024, 1),
                    "backend": "cuda",
                    "is_unified_memory": False
                }
        except Exception:
            continue
    
    return {"name": "", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False}


def _get_amd_gpu_info():
    """获取 AMD GPU 信息 (Linux)"""
    try:
        # 尝试 amd-smi
        result = subprocess.run(
            ['amd-smi', 'static', '--json'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            if data and len(data) > 0:
                gpu = data[0]
                name = gpu.get('asic', {}).get('name', 'AMD GPU')
                vram_mb = gpu.get('vram', {}).get('size', 0)
                return {
                    "name": name,
                    "vram_gb": round(vram_mb / 1024, 1) if vram_mb > 0 else 0,
                    "backend": "vulkan",
                    "is_unified_memory": False
                }
    except Exception:
        pass
    
    # 回退到 /sys/class/drm
    try:
        import os
        drm_path = '/sys/class/drm'
        if os.path.exists(drm_path):
            for card in os.listdir(drm_path):
                if card.startswith('card') and '-' not in card:
                    vendor_path = os.path.join(drm_path, card, 'device', 'vendor')
                    if os.path.exists(vendor_path):
                        with open(vendor_path, 'r') as f:
                            vendor_id = f.read().strip()
                        # AMD vendor ID: 0x1002
                        if vendor_id == '0x1002':
                            # 尝试获取显存大小
                            vram_path = os.path.join(drm_path, card, 'device', 'mem_info_vram_total')
                            vram_gb = 0
                            if os.path.exists(vram_path):
                                with open(vram_path, 'r') as f:
                                    vram_bytes = int(f.read().strip())
                                    vram_gb = round(vram_bytes / (1024**3), 1)
                            return {
                                "name": "AMD GPU",
                                "vram_gb": vram_gb,
                                "backend": "vulkan",
                                "is_unified_memory": False
                            }
    except Exception:
        pass
    
    return {"name": "", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False}


def _get_system_ram():
    """获取系统内存 (跨平台)"""
    try:
        if sys.platform == 'win32':
            result = subprocess.run(
                ['wmic', 'computersystem', 'get', 'totalphysicalmemory'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1 and lines[1].strip().isdigit():
                    return int(lines[1].strip()) / (1024**3)
        elif sys.platform == 'darwin':
            result = subprocess.run(
                ['sysctl', '-n', 'hw.memsize'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip().isdigit():
                return int(result.stdout.strip()) / (1024**3)
        else:
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    if line.startswith('MemTotal:'):
                        parts = line.split()
                        if len(parts) >= 2:
                            return int(parts[1]) / (1024**2)
    except Exception:
        pass
    return 8.0


def calculate_max_safe_ctx(vram_gb, ram_gb, model_size_gb=5.0):
    """
    根据显存/内存计算安全的上下文大小
    
    GGUF Q4_K_M (8B) 经验法则:
    - 模型需要 ~5GB
    - 每 4K 上下文增加 ~0.5GB
    """
    available_memory = vram_gb if vram_gb > 0 else ram_gb
    reserved = 2.0 if vram_gb > 0 else 4.0
    available_for_ctx = available_memory - model_size_gb - reserved
    
    if available_for_ctx <= 0:
        return 2048
    
    max_ctx = int(available_for_ctx * 8192)
    max_ctx = max(2048, min(max_ctx, 32768))
    max_ctx = (max_ctx // 1024) * 1024
    
    return max_ctx


def main():
    import io
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    
    gpu_info = get_gpu_info()
    ram_gb = _get_system_ram()
    vram_gb = gpu_info.get("vram_gb", 0)
    
    max_safe_ctx = calculate_max_safe_ctx(vram_gb, ram_gb)
    recommended_ctx = (int(max_safe_ctx * 0.8) // 1024) * 1024
    
    result = {
        "gpu_name": gpu_info.get("name", "Unknown"),
        "gpu_backend": gpu_info.get("backend", "cpu"),
        "vram_gb": round(vram_gb, 1),
        "ram_gb": round(ram_gb, 1),
        "max_safe_ctx": max_safe_ctx,
        "recommended_ctx": recommended_ctx,
        "is_cpu_only": vram_gb <= 0 and not gpu_info.get("is_unified_memory", False),
        "is_unified_memory": gpu_info.get("is_unified_memory", False)
    }
    
    print(f"__HW_SPEC_JSON_START__{json.dumps(result)}__HW_SPEC_JSON_END__")


if __name__ == "__main__":
    main()
