import pytest

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.parsers.registry import ParserRegistry


@pytest.mark.unit
def test_profile_store_load(tmp_path):
    api_dir = tmp_path / "api"
    api_dir.mkdir()
    profile_path = api_dir / "demo.yaml"
    profile_path.write_text("id: demo\nname: Demo API\ntype: openai_compat\n", encoding="utf-8")
    store = ProfileStore(str(tmp_path))
    profile = store.load_profile("api", "demo")
    assert profile["id"] == "demo"
    assert profile["name"] == "Demo API"


@pytest.mark.unit
def test_parser_registry_plain(tmp_path):
    parser_dir = tmp_path / "parser"
    parser_dir.mkdir()
    profile_path = parser_dir / "plain.yaml"
    profile_path.write_text("id: parser_plain\nname: Plain\ntype: plain\n", encoding="utf-8")
    store = ProfileStore(str(tmp_path))
    registry = ParserRegistry(store)
    parser = registry.get_parser("parser_plain")
    output = parser.parse("hello")
    assert output.text == "hello"


@pytest.mark.unit
def test_profile_store_blocks_external_path(tmp_path):
    base = tmp_path / "profiles"
    (base / "api").mkdir(parents=True)
    outside = tmp_path / "outside.yaml"
    outside.write_text("id: api_outside\nname: Outside\ntype: openai_compat\n", encoding="utf-8")
    store = ProfileStore(str(base))
    resolved = store.resolve_profile_path("api", str(outside))
    assert resolved is None


@pytest.mark.unit
def test_profile_store_list_chunk_type(tmp_path):
    chunk_dir = tmp_path / "chunk"
    chunk_dir.mkdir()
    profile_path = chunk_dir / "demo.yaml"
    profile_path.write_text("id: chunk_demo\nchunk_type: line\n", encoding="utf-8")
    store = ProfileStore(str(tmp_path))
    profiles = store.list_profiles("chunk")
    assert len(profiles) == 1
    assert profiles[0].chunk_type == "line"
