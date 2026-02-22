import os
import sys

from murasaki_flow_v2 import api_server as flow_v2_api_server
from murasaki_flow_v2 import main as flow_v2_main


def _without_path(target_path: str) -> list[str]:
    target_norm = os.path.normcase(os.path.abspath(target_path))
    return [
        item
        for item in list(sys.path)
        if os.path.normcase(os.path.abspath(item or "")) != target_norm
    ]


def test_flow_v2_main_bootstrap_inserts_middleware_path(monkeypatch):
    middleware_dir = os.path.dirname(
        os.path.dirname(os.path.abspath(flow_v2_main.__file__)),
    )
    monkeypatch.setattr(sys, "path", _without_path(middleware_dir))

    flow_v2_main._bootstrap_package_path()

    assert sys.path[0] == middleware_dir


def test_flow_v2_api_server_bootstrap_inserts_middleware_path(monkeypatch):
    middleware_dir = os.path.dirname(
        os.path.dirname(os.path.abspath(flow_v2_api_server.__file__)),
    )
    monkeypatch.setattr(sys, "path", _without_path(middleware_dir))

    flow_v2_api_server._bootstrap_package_path()

    assert sys.path[0] == middleware_dir
