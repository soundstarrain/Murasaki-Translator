import os
import subprocess
import platform
import math

class ContextManager:
    # Constants
    MODEL_SIZE_GB = 5.5
    SYSTEM_RESERVE_GB = 1.5
    KV_CACHE_PER_1K_TOKEN_MB = 0.75 * 1024 # 0.75GB = 768MB
    
    MIN_CTX = 512
    HARD_LIMIT_CTX = 32768

    @staticmethod
    def get_total_vram_gb():
        """
        Attempts to get Total VRAM in GB using nvidia-smi.
        Returns 0 if no NVIDIA GPU found.
        """
        try:
            if platform.system() == "Windows":
                cmd = "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits"
                output = subprocess.check_output(cmd, shell=True).decode("utf-8").strip()
                # nvidia-smi returns MB
                vram_mb = float(output.split('\n')[0])
                return vram_mb / 1024.0
        except Exception:
            pass
        return 0.0

    @staticmethod
    def calculate_max_context(total_vram_gb):
        if total_vram_gb <= 0:
            return 4096 # Fallback for CPU/Integrated

        available_for_ctx = total_vram_gb - ContextManager.MODEL_SIZE_GB - ContextManager.SYSTEM_RESERVE_GB
        
        if available_for_ctx <= 0:
            return ContextManager.MIN_CTX

        # Formula: (Available_GB * 1024) / (0.75 * 1024 / 1024) * 1000 
        # Simplified: Available_GB / 0.75 * 1000 * (1024 conversion?)
        # Let's align strictly with User Formula:
        # Max_Safe_Ctx = (Available_for_Ctx * 1024) / 0.75 * 1000
        # Wait, the user said "0.75GB per 1k token".
        # So: Tokens = Available_GB / 0.75 * 1000
        # Example: 1 GB available / 0.75 = 1.33 * 1000 = 1333 tokens.
        
        max_ctx = (available_for_ctx / 0.75) * 1000
        
        # Clamp
        max_ctx = max(ContextManager.MIN_CTX, min(max_ctx, ContextManager.HARD_LIMIT_CTX))
        
        # Round down to nearest 256
        return int(max_ctx // 256 * 256)

    @staticmethod
    def get_recommendation(total_vram_gb, max_safe_ctx):
        # Hardcoded rules
        if total_vram_gb >= 22: # 3090/4090 (24GB)
            return 16384
        if total_vram_gb >= 11: # 3060/4070/4080 (12GB - 16GB)
            return 8192
        if total_vram_gb >= 7.5: # 8GB cards
            return 4096
        
        # Low specs
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
