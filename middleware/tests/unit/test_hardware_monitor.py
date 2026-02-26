import sys
from pathlib import Path

import pytest

MODULE_DIR = Path(__file__).resolve().parents[2]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from murasaki_translator.utils import monitor as monitor_module


@pytest.mark.unit
def test_hardware_monitor_prefers_nvidia_backend(monkeypatch):
    monkeypatch.setattr(monitor_module.sys, "platform", "linux")
    calls = {"nvidia": 0, "amd": 0, "generic": 0}

    def fake_init_nvidia(self):
        calls["nvidia"] += 1
        self.backend = "nvidia"
        self.enabled = True
        self.name = "NVIDIA GPU"
        return True

    def fake_init_amd(self):
        calls["amd"] += 1
        return True

    def fake_init_generic(self):
        calls["generic"] += 1
        return True

    monkeypatch.setattr(monitor_module.HardwareMonitor, "_init_nvidia", fake_init_nvidia)
    monkeypatch.setattr(monitor_module.HardwareMonitor, "_init_amd", fake_init_amd)
    monkeypatch.setattr(monitor_module.HardwareMonitor, "_init_generic", fake_init_generic)

    monitor = monitor_module.HardwareMonitor()
    assert monitor.backend == "nvidia"
    assert monitor.enabled is True
    assert calls == {"nvidia": 1, "amd": 0, "generic": 0}


@pytest.mark.unit
def test_hardware_monitor_keeps_macos_path(monkeypatch):
    monkeypatch.setattr(monitor_module.sys, "platform", "darwin")
    calls = {"macos": 0, "nvidia": 0, "amd": 0, "generic": 0}

    def fake_init_macos(self):
        calls["macos"] += 1
        self.backend = "macos"
        self.enabled = True
        self.name = "Apple GPU"

    def fake_init_nvidia(self):
        calls["nvidia"] += 1
        return False

    def fake_init_amd(self):
        calls["amd"] += 1
        return False

    def fake_init_generic(self):
        calls["generic"] += 1
        return False

    monkeypatch.setattr(monitor_module.HardwareMonitor, "_init_macos", fake_init_macos)
    monkeypatch.setattr(monitor_module.HardwareMonitor, "_init_nvidia", fake_init_nvidia)
    monkeypatch.setattr(monitor_module.HardwareMonitor, "_init_amd", fake_init_amd)
    monkeypatch.setattr(monitor_module.HardwareMonitor, "_init_generic", fake_init_generic)

    monitor = monitor_module.HardwareMonitor()
    assert monitor.backend == "macos"
    assert monitor.enabled is True
    assert calls == {"macos": 1, "nvidia": 0, "amd": 0, "generic": 0}


@pytest.mark.unit
def test_hardware_monitor_falls_back_to_generic_for_intel(monkeypatch):
    monkeypatch.setattr(monitor_module.sys, "platform", "win32")

    monkeypatch.setattr(
        monitor_module.HardwareMonitor,
        "_init_nvidia",
        lambda self: False,
    )
    monkeypatch.setattr(
        monitor_module.HardwareMonitor,
        "_init_amd",
        lambda self: False,
    )
    monkeypatch.setattr(
        monitor_module.HardwareMonitor,
        "_detect_windows_generic_gpu",
        lambda self: ("Intel(R) UHD Graphics 770", 0.0, True),
    )
    monkeypatch.setattr(
        monitor_module.HardwareMonitor,
        "_get_system_ram_gb",
        lambda self: 16.0,
    )

    monitor = monitor_module.HardwareMonitor()
    assert monitor.backend == "generic"
    assert monitor.enabled is True
    status = monitor.get_status()
    assert status is not None
    assert status["name"] == "Intel(R) UHD Graphics 770"
    assert status["vram_total_gb"] == pytest.approx(16.0)
    assert status["gpu_util"] == 0

