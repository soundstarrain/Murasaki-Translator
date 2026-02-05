import json
import subprocess
import re
import os

def get_nvidia_vram():
    """Get NVIDIA GPU VRAM in GB"""
    try:
        # Using --query-gpu to get memory info
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=memory.total', '--format=csv,noheader,nounits'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if lines and lines[0].isdigit():
                vram_mb = int(lines[0])
                return vram_mb / 1024  # Convert to GB
    except Exception:
        pass
    return 0

def get_system_ram():
    """Get System RAM in GB (Cross-platform)"""
    import sys
    try:
        if sys.platform == 'win32':
            # Windows: Use wmic
            result = subprocess.run(
                ['wmic', 'computersystem', 'get', 'totalphysicalmemory'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                lines = result.stdout.strip().split('\n')
                if len(lines) > 1 and lines[1].strip().isdigit():
                    bytes_val = int(lines[1].strip())
                    return bytes_val / (1024**3)
        elif sys.platform == 'darwin':
            # macOS: Use sysctl
            result = subprocess.run(
                ['sysctl', '-n', 'hw.memsize'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip().isdigit():
                return int(result.stdout.strip()) / (1024**3)
        else:
            # Linux: Read /proc/meminfo
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    if line.startswith('MemTotal:'):
                        # Format: "MemTotal:       16384000 kB"
                        parts = line.split()
                        if len(parts) >= 2:
                            return int(parts[1]) / (1024**2)  # kB to GB
    except Exception:
        pass
    return 8.0  # Fallback to 8GB

def calculate_max_safe_ctx(vram_gb, ram_gb, model_size_gb=5.0):
    """
    Calculate safe context size based on VRAM or RAM.
    
    Rule of thumb for GGUF Q4_K_M (8B):
    - Model needs ~5GB.
    - Each 4K context adds ~0.5GB.
    """
    # Use VRAM if available, otherwise use System RAM
    available_memory = vram_gb if vram_gb > 0 else ram_gb
    
    # Reserve memory for OS + Headroom
    reserved = 2.0 if vram_gb > 0 else 4.0
    
    available_for_ctx = available_memory - model_size_gb - reserved
    
    if available_for_ctx <= 0:
        return 2048  # Minimal fallback
    
    # Estimate: ~8192 tokens per GB
    max_ctx = int(available_for_ctx * 8192)
    
    # Clamp to reasonable range
    max_ctx = max(2048, min(max_ctx, 32768))
    
    # Round to nearest 1024
    max_ctx = (max_ctx // 1024) * 1024
    
    return max_ctx

def main():
    # Force UTF-8 for Windows stdout to prevent encoding-related JSON parse errors
    import sys
    import io
    if sys.platform == 'win32':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

    vram_gb = get_nvidia_vram()
    ram_gb = get_system_ram()
    
    max_safe_ctx = calculate_max_safe_ctx(vram_gb, ram_gb)
    
    # Recommended is 80% of max safe
    recommended_ctx = (int(max_safe_ctx * 0.8) // 1024) * 1024
    
    result = {
        "vram_gb": round(vram_gb, 1),
        "ram_gb": round(ram_gb, 1),
        "max_safe_ctx": max_safe_ctx,
        "recommended_ctx": recommended_ctx,
        "is_cpu_only": vram_gb <= 0
    }
    
    # Use highly unique markers to prevent collision
    print(f"__HW_SPEC_JSON_START__{json.dumps(result)}__HW_SPEC_JSON_END__")

if __name__ == "__main__":
    main()
