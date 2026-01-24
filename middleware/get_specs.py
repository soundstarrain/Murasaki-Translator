#!/usr/bin/env python3
"""
Hardware Specs Detector for Murasaki Translator GUI
Returns VRAM info and calculates recommended context size
"""
import json
import subprocess
import re

def get_nvidia_vram():
    """Get NVIDIA GPU VRAM in GB"""
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=memory.total', '--format=csv,noheader,nounits'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            # Parse first GPU's VRAM (in MB)
            vram_mb = int(result.stdout.strip().split('\n')[0])
            return vram_mb / 1024  # Convert to GB
    except Exception as e:
        pass
    return 0

def calculate_max_safe_ctx(vram_gb: float, model_size_b: float = 8.0):
    """
    Calculate safe context size based on VRAM and model size.
    
    Rule of thumb for GGUF Q4_K_M models:
    - 8B model base: ~5GB VRAM
    - Each 4K context adds ~0.5-1GB VRAM
    
    Returns max_safe_ctx in tokens.
    """
    if vram_gb <= 0:
        return 4096  # Fallback
    
    # Base VRAM needed for 8B Q4 model
    base_vram = 5.0
    
    # Available VRAM for context (leave 1GB headroom)
    available_for_ctx = vram_gb - base_vram - 1.0
    
    if available_for_ctx <= 0:
        return 2048  # Minimal context
    
    # Estimate: ~0.5GB per 4K context
    ctx_per_gb = 4096 / 0.5  # ~8192 tokens per GB
    max_ctx = int(available_for_ctx * ctx_per_gb)
    
    # Clamp to reasonable range
    max_ctx = max(2048, min(max_ctx, 32768))
    
    # Round to nearest 1024
    max_ctx = (max_ctx // 1024) * 1024
    
    return max_ctx

def main():
    vram_gb = get_nvidia_vram()
    max_safe_ctx = calculate_max_safe_ctx(vram_gb)
    
    # Recommended is 80% of max safe
    recommended_ctx = (int(max_safe_ctx * 0.8) // 1024) * 1024
    
    result = {
        "vram_gb": round(vram_gb, 1),
        "max_safe_ctx": max_safe_ctx,
        "recommended_ctx": recommended_ctx
    }
    
    print(json.dumps(result))

if __name__ == "__main__":
    main()
