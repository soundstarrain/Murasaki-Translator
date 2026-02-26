import sys
from pathlib import Path

import pytest

MODULE_DIR = Path(__file__).resolve().parents[2]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

from env_fixer import VulkanChecker


@pytest.mark.unit
def test_extract_vulkan_version():
    output = "Vulkan Instance Version: 1.3.280\n"
    assert VulkanChecker._extract_vulkan_version(output) == "1.3.280"


@pytest.mark.unit
def test_extract_vulkan_devices_handles_intel_and_amd_lines():
    output = (
        "GPU0:\tIntel(R) UHD Graphics 770\n"
        "GPU1: AMD Radeon RX 7800 XT\n"
        "GPU1: AMD Radeon RX 7800 XT\n"
    )
    devices = VulkanChecker._extract_vulkan_devices(output)
    assert devices == ["Intel(R) UHD Graphics 770", "AMD Radeon RX 7800 XT"]
