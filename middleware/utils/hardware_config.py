"""
跨平台硬件配置管理模块
支持 Windows/macOS/Linux 和 NVIDIA/AMD/Intel GPU
"""
import os
import subprocess
import sys
import math


class ContextManager:
    """上下文大小管理器"""
    
    # 常量
    MODEL_SIZE_GB = 5.5
    SYSTEM_RESERVE_GB = 1.5
    KV_CACHE_PER_1K_TOKEN_MB = 0.75 * 1024  # 0.75GB = 768MB
    
    MIN_CTX = 512
    HARD_LIMIT_CTX = 32768

    @staticmethod
    def get_total_vram_gb():
        """
        跨平台获取 GPU 显存 (GB)
        支持 NVIDIA, AMD, macOS Metal (统一内存)
        """
        if sys.platform == 'darwin':
            return ContextManager._get_macos_memory()
        
        # Windows/Linux: 尝试 NVIDIA
        vram = ContextManager._get_nvidia_vram()
        if vram > 0:
            return vram
        
        # 回退: 尝试 AMD
        vram = ContextManager._get_amd_vram()
        if vram > 0:
            return vram
        
        # Windows 回退: wmic
        if sys.platform == 'win32':
            return ContextManager._get_windows_vram()
        
        return 0.0
    
    @staticmethod
    def _get_nvidia_vram():
        """获取 NVIDIA GPU 显存"""
        try:
            result = subprocess.run(
                ['nvidia-smi', '--query-gpu=memory.total', '--format=csv,noheader,nounits'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                vram_mb = float(result.stdout.strip().split('\n')[0])
                return vram_mb / 1024.0
        except Exception:
            pass
        return 0.0
    
    @staticmethod
    def _get_amd_vram():
        """获取 AMD GPU 显存"""
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
                    vram_mb = data[0].get('vram', {}).get('size', 0)
                    return vram_mb / 1024.0
        except Exception:
            pass
        return 0.0
    
    @staticmethod
    def _get_windows_vram():
        """Windows: 使用 wmic 获取显存"""
        try:
            result = subprocess.run(
                ['wmic', 'path', 'win32_VideoController', 'get', 'AdapterRAM', '/format:csv'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip() and 'Node' not in l]
                for line in lines:
                    parts = line.split(',')
                    if len(parts) >= 2:
                        ram = parts[-1].strip()
                        if ram and ram.isdigit():
                            return int(ram) / (1024**3)
        except Exception:
            pass
        return 0.0
    
    @staticmethod
    def _get_macos_memory():
        """macOS: Apple Silicon 使用统一内存"""
        try:
            result = subprocess.run(
                ['sysctl', '-n', 'hw.memsize'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                return int(result.stdout.strip()) / (1024**3)
        except Exception:
            pass
        return 8.0

    @staticmethod
    def calculate_max_context(total_vram_gb):
        if total_vram_gb <= 0:
            return 4096  # CPU/集成显卡回退值

        available_for_ctx = total_vram_gb - ContextManager.MODEL_SIZE_GB - ContextManager.SYSTEM_RESERVE_GB
        
        if available_for_ctx <= 0:
            return ContextManager.MIN_CTX

        # 公式: 可用显存 / 0.75GB * 1000 tokens
        max_ctx = (available_for_ctx / 0.75) * 1000
        
        # 限制范围
        max_ctx = max(ContextManager.MIN_CTX, min(max_ctx, ContextManager.HARD_LIMIT_CTX))
        
        # 向下取整到 256
        return int(max_ctx // 256 * 256)

    @staticmethod
    def get_recommendation(total_vram_gb, max_safe_ctx):
        # 硬编码规则
        if total_vram_gb >= 22:  # 3090/4090 (24GB)
            return 16384
        if total_vram_gb >= 11:  # 3060/4070/4080 (12-16GB)
            return 8192
        if total_vram_gb >= 7.5:  # 8GB 显卡
            return 4096
        
        # 低配
        return min(4096, max_safe_ctx)

    @staticmethod
    def get_optimal_context_size():
        vram = ContextManager.get_total_vram_gb()
        max_ctx = ContextManager.calculate_max_context(vram)
        rec_ctx = ContextManager.get_recommendation(vram, max_ctx)
        
        return {
            "vram_gb": round(vram, 2),
            "max_safe_ctx": int(max_ctx),
            "recommended_ctx": int(rec_ctx),
            "min_ctx": ContextManager.MIN_CTX
        }
