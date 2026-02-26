"""
跨平台硬件检测模块
支持 Windows (NVIDIA/AMD/Intel), macOS (Metal), Linux (NVIDIA/AMD/Intel)
"""
import json
import subprocess
import sys
import re
import shutil


def _windows_creationflags():
    return subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0


def _run_windows_command(args, timeout=5):
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=_windows_creationflags()
        )
    except Exception:
        return None


def _parse_bytes_to_gb(raw_value):
    if raw_value is None:
        return 0.0
    try:
        text = str(raw_value).strip()
        if not text:
            return 0.0
        return int(float(text)) / (1024**3)
    except (ValueError, TypeError):
        return 0.0


def _classify_gpu_name(name, vram_gb=0.0):
    upper_name = str(name or "").upper()

    if 'NVIDIA' in upper_name:
        return {
            "backend": "cuda",
            "is_unified_memory": False,
            "priority": 300
        }

    if 'AMD' in upper_name or 'RADEON' in upper_name or 'ATI' in upper_name:
        integrated_hint = 'APU' in upper_name or 'RADEON(TM) GRAPHICS' in upper_name
        return {
            "backend": "vulkan",
            "is_unified_memory": bool(vram_gb <= 0 and integrated_hint),
            "priority": 220 if vram_gb > 0 else 180
        }

    if 'INTEL' in upper_name:
        is_arc = 'ARC' in upper_name
        integrated_hint = any(
            token in upper_name for token in ['UHD', 'IRIS', 'HD GRAPHICS', 'XE GRAPHICS']
        )
        return {
            "backend": "vulkan",
            "is_unified_memory": bool(vram_gb <= 0 and (integrated_hint or not is_arc)),
            "priority": 210 if is_arc else 160
        }

    return {
        "backend": "vulkan",
        "is_unified_memory": False,
        "priority": 120 if vram_gb > 0 else 80
    }


def _pick_best_gpu_candidate(candidates):
    if not candidates:
        return None
    best = max(candidates, key=lambda item: (item["priority"], item["vram_gb"]))
    return {
        "name": best["name"],
        "vram_gb": round(best["vram_gb"], 1),
        "backend": best["backend"],
        "is_unified_memory": best["is_unified_memory"]
    }


def _parse_windows_gpu_rows(rows):
    candidates = []
    for row in rows:
        name = str(row.get('Name', '')).strip()
        if not name:
            continue
        if 'Microsoft' in name or 'Basic' in name:
            continue

        vram_gb = _parse_bytes_to_gb(row.get('AdapterRAM'))
        classified = _classify_gpu_name(name, vram_gb)
        candidates.append({
            "name": name,
            "vram_gb": vram_gb,
            "backend": classified["backend"],
            "is_unified_memory": classified["is_unified_memory"],
            "priority": classified["priority"]
        })
    return _pick_best_gpu_candidate(candidates)


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
    """Windows: 优先 nvidia-smi，回退 PowerShell CIM，再回退 WMIC"""
    # 1. 尝试 NVIDIA GPU
    nvidia_info = _get_nvidia_gpu_info()
    if nvidia_info["vram_gb"] > 0:
        return nvidia_info

    # 2. 优先 PowerShell CIM（WMIC 在新版 Windows 可能缺失/卡顿）
    try:
        result = _run_windows_command(
            [
                'powershell',
                '-NoProfile',
                '-Command',
                'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress'
            ],
            timeout=8
        )
        if result and result.returncode == 0 and result.stdout.strip():
            parsed = json.loads(result.stdout.strip())
            rows = parsed if isinstance(parsed, list) else [parsed]
            gpu = _parse_windows_gpu_rows(rows)
            if gpu:
                return gpu
    except Exception:
        pass

    # 3. 最后回退 WMIC（仅在命令可用时）
    if shutil.which('wmic'):
        try:
            result = _run_windows_command(
                ['wmic', 'path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv'],
                timeout=6
            )
            if result and result.returncode == 0:
                lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip() and 'Node' not in l]
                rows = []
                for line in lines:
                    parts = line.split(',')
                    if len(parts) < 3:
                        continue
                    rows.append({
                        'Name': parts[2].strip(),
                        'AdapterRAM': parts[1].strip()
                    })
                gpu = _parse_windows_gpu_rows(rows)
                if gpu:
                    return gpu
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
    
    # 3. 回退到 lspci 检测（按供应商优先级挑选，避免混合显卡误选）
    try:
        result = subprocess.run(
            ['lspci'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            candidates = []
            for line in result.stdout.split('\n'):
                if 'VGA' in line or '3D' in line:
                    name = line.split(':')[-1].strip()
                    if not name:
                        continue
                    classified = _classify_gpu_name(name, 0.0)
                    candidates.append({
                        "name": name,
                        "vram_gb": 0.0,
                        "backend": classified["backend"],
                        "is_unified_memory": classified["is_unified_memory"],
                        "priority": classified["priority"]
                    })
            gpu = _pick_best_gpu_candidate(candidates)
            if gpu:
                return gpu
    except Exception:
        pass
    
    return {"name": "Unknown (Linux)", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False}


def _get_nvidia_gpu_info():
    """获取 NVIDIA GPU 信息 (跨平台 + Windows 多路径)"""
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
            # 先走 CIM，避免 WMIC 在部分机器上长时间卡住。
            result = _run_windows_command(
                [
                    'powershell',
                    '-NoProfile',
                    '-Command',
                    '(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory'
                ],
                timeout=5
            )
            if result and result.returncode == 0:
                ram_gb = _parse_bytes_to_gb(result.stdout.strip())
                if ram_gb > 0:
                    return ram_gb

            if shutil.which('wmic'):
                result = _run_windows_command(
                    ['wmic', 'computersystem', 'get', 'totalphysicalmemory'],
                    timeout=4
                )
                if result and result.returncode == 0:
                    lines = result.stdout.strip().split('\n')
                    if len(lines) > 1:
                        ram_gb = _parse_bytes_to_gb(lines[1].strip())
                        if ram_gb > 0:
                            return ram_gb
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
