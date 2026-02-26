import json
import sys
from pathlib import Path

import pytest

MODULE_DIR = Path(__file__).resolve().parents[2]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

import get_specs


class DummyCompletedProcess:
    def __init__(self, returncode=0, stdout=""):
        self.returncode = returncode
        self.stdout = stdout


@pytest.mark.unit
def test_parse_windows_gpu_rows_marks_intel_igpu_as_unified():
    gpu = get_specs._parse_windows_gpu_rows(
        [{"Name": "Intel(R) UHD Graphics", "AdapterRAM": ""}]
    )
    assert gpu is not None
    assert gpu["backend"] == "vulkan"
    assert gpu["is_unified_memory"] is True
    assert gpu["vram_gb"] == 0.0


@pytest.mark.unit
def test_parse_windows_gpu_rows_keeps_nvidia_as_discrete():
    gpu = get_specs._parse_windows_gpu_rows(
        [{"Name": "NVIDIA GeForce RTX 4060", "AdapterRAM": "8589934592"}]
    )
    assert gpu is not None
    assert gpu["backend"] == "cuda"
    assert gpu["is_unified_memory"] is False
    assert gpu["vram_gb"] == 8.0


@pytest.mark.unit
def test_parse_windows_gpu_rows_prioritizes_nvidia_over_intel():
    gpu = get_specs._parse_windows_gpu_rows(
        [
            {"Name": "Intel(R) UHD Graphics 770", "AdapterRAM": ""},
            {"Name": "NVIDIA GeForce RTX 4070", "AdapterRAM": "12884901888"},
        ]
    )
    assert gpu is not None
    assert gpu["name"] == "NVIDIA GeForce RTX 4070"
    assert gpu["backend"] == "cuda"
    assert gpu["is_unified_memory"] is False
    assert gpu["vram_gb"] == 12.0


@pytest.mark.unit
def test_parse_windows_gpu_rows_intel_arc_not_treated_as_unified():
    gpu = get_specs._parse_windows_gpu_rows(
        [{"Name": "Intel(R) Arc(TM) A770 Graphics", "AdapterRAM": ""}]
    )
    assert gpu is not None
    assert gpu["backend"] == "vulkan"
    assert gpu["is_unified_memory"] is False


@pytest.mark.unit
def test_parse_windows_gpu_rows_prefers_amd_over_intel_when_no_nvidia():
    gpu = get_specs._parse_windows_gpu_rows(
        [
            {"Name": "Intel(R) UHD Graphics 730", "AdapterRAM": ""},
            {"Name": "AMD Radeon RX 7800 XT", "AdapterRAM": "17179869184"},
        ]
    )
    assert gpu is not None
    assert gpu["name"] == "AMD Radeon RX 7800 XT"
    assert gpu["backend"] == "vulkan"
    assert gpu["is_unified_memory"] is False
    assert gpu["vram_gb"] == 16.0


@pytest.mark.unit
def test_get_windows_gpu_info_prefers_powershell(monkeypatch):
    monkeypatch.setattr(
        get_specs,
        "_get_nvidia_gpu_info",
        lambda: {"name": "", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False},
    )

    calls = []

    def fake_run_windows_command(args, timeout=5):
        calls.append(args[0])
        if args[0] == "powershell":
            payload = json.dumps(
                {"Name": "Intel(R) Iris(R) Xe Graphics", "AdapterRAM": None}
            )
            return DummyCompletedProcess(returncode=0, stdout=payload)
        raise AssertionError("wmic should not be called when powershell succeeded")

    monkeypatch.setattr(get_specs, "_run_windows_command", fake_run_windows_command)
    monkeypatch.setattr(get_specs.shutil, "which", lambda _name: "wmic")

    gpu = get_specs._get_windows_gpu_info()
    assert gpu["name"] == "Intel(R) Iris(R) Xe Graphics"
    assert gpu["backend"] == "vulkan"
    assert gpu["is_unified_memory"] is True
    assert calls == ["powershell"]


@pytest.mark.unit
def test_get_system_ram_windows_prefers_powershell(monkeypatch):
    monkeypatch.setattr(get_specs.sys, "platform", "win32")
    calls = []

    def fake_run_windows_command(args, timeout=5):
        calls.append(args[0])
        if args[0] == "powershell":
            return DummyCompletedProcess(returncode=0, stdout="17179869184\n")
        raise AssertionError("wmic should not be called when powershell succeeded")

    monkeypatch.setattr(get_specs, "_run_windows_command", fake_run_windows_command)
    monkeypatch.setattr(get_specs.shutil, "which", lambda _name: "wmic")

    ram_gb = get_specs._get_system_ram()
    assert ram_gb == pytest.approx(16.0, rel=1e-3)
    assert calls == ["powershell"]


@pytest.mark.unit
def test_get_linux_gpu_info_lspci_prefers_nvidia(monkeypatch):
    monkeypatch.setattr(
        get_specs,
        "_get_nvidia_gpu_info",
        lambda: {"name": "", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False},
    )
    monkeypatch.setattr(
        get_specs,
        "_get_amd_gpu_info",
        lambda: {"name": "", "vram_gb": 0, "backend": "cpu", "is_unified_memory": False},
    )

    def fake_run(args, capture_output=True, text=True, timeout=5):
        if args == ["lspci"]:
            return DummyCompletedProcess(
                returncode=0,
                stdout=(
                    "00:02.0 VGA compatible controller: Intel Corporation UHD Graphics\n"
                    "01:00.0 VGA compatible controller: NVIDIA Corporation AD104 [GeForce RTX 4070]\n"
                ),
            )
        raise AssertionError(f"unexpected command: {args}")

    monkeypatch.setattr(get_specs.subprocess, "run", fake_run)

    gpu = get_specs._get_linux_gpu_info()
    assert gpu["backend"] == "cuda"
    assert "GeForce RTX 4070" in gpu["name"]
    assert gpu["is_unified_memory"] is False


@pytest.mark.unit
def test_get_gpu_info_dispatches_to_macos_impl(monkeypatch):
    monkeypatch.setattr(get_specs.sys, "platform", "darwin")
    expected = {
        "name": "Apple M3",
        "vram_gb": 16.0,
        "backend": "metal",
        "is_unified_memory": True,
    }
    monkeypatch.setattr(get_specs, "_get_macos_gpu_info", lambda: expected)
    assert get_specs.get_gpu_info() == expected
