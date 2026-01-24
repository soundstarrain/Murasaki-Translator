import time

class HardwareMonitor:
    def __init__(self, gpu_index=0):
        self.gpu_index = gpu_index
        self.enabled = False
        self.pynvml = None
        
        try:
            import pynvml
            self.pynvml = pynvml
            self.pynvml.nvmlInit()
            self.handle = self.pynvml.nvmlDeviceGetHandleByIndex(gpu_index)
            self.name = self.pynvml.nvmlDeviceGetName(self.handle)
            # Handle bytes vs str difference in monitor
            if isinstance(self.name, bytes):
                self.name = self.name.decode('utf-8')
            self.enabled = True
        except ImportError:
            print("[HardwareMonitor] pynvml not installed. Monitoring disabled.")
        except Exception as e:
            print(f"[HardwareMonitor] Initialization failed: {e}")

    def get_status(self):
        if not self.enabled:
            return None
        try:
            mem_info = self.pynvml.nvmlDeviceGetMemoryInfo(self.handle)
            util = self.pynvml.nvmlDeviceGetUtilizationRates(self.handle)
            
            return {
                "name": self.name,
                "vram_used_gb": round(mem_info.used / 1024**3, 2),
                "vram_total_gb": round(mem_info.total / 1024**3, 2),
                "vram_percent": round(mem_info.used / mem_info.total * 100, 1),
                "gpu_util": util.gpu,
                "mem_util": util.memory
            }
        except Exception as e:
            # print(f"[HardwareMonitor] Read error: {e}") # Reduce spam
            return None

    def close(self):
        if self.enabled:
            try:
                self.pynvml.nvmlShutdown()
            except:
                pass
