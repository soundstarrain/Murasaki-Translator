import pytest

from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.validation import validate_profile


@pytest.mark.unit
def test_flow_v2_validation_api_missing_fields():
    result = validate_profile("api", {"id": "api1", "type": "openai_compat"})
    assert "missing_base_url" in result.errors
    assert "missing_model" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_api_invalid_rpm():
    result = validate_profile(
        "api",
        {
            "id": "api1",
            "type": "openai_compat",
            "base_url": "https://api.example.com/v1",
            "model": "demo",
            "rpm": 0,
        },
    )
    assert "invalid_rpm" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pipeline_missing_refs(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    data = {
        "id": "pipe1",
        "provider": "missing_api",
        "prompt": "missing_prompt",
        "parser": "missing_parser",
        "chunk_policy": "missing_chunk",
    }
    result = validate_profile("pipeline", data, store=store)
    assert any(item.startswith("missing_reference:api:") for item in result.errors)
    assert any(item.startswith("missing_reference:prompt:") for item in result.errors)


@pytest.mark.unit
def test_flow_v2_validation_pipeline_missing_required():
    data = {"id": "pipe1"}
    result = validate_profile("pipeline", data)
    assert "missing_field:provider" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pipeline_line_policy_required():
    data = {
        "id": "pipe1",
        "provider": "api1",
        "prompt": "prompt1",
        "parser": "parser1",
        "chunk_policy": "chunk1",
        "apply_line_policy": True,
    }
    result = validate_profile("pipeline", data)
    assert "missing_field:line_policy" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pipeline_line_policy_requires_line_chunk(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    (tmp_path / "chunk" / "legacy_chunk.yaml").write_text(
        "id: legacy_chunk\nchunk_type: legacy\noptions: {}\n",
        encoding="utf-8",
    )
    data = {
        "id": "pipe1",
        "provider": "api1",
        "prompt": "prompt1",
        "parser": "parser1",
        "chunk_policy": "legacy_chunk",
        "apply_line_policy": True,
        "line_policy": "line_policy_1",
    }
    result = validate_profile("pipeline", data, store=store)
    assert "line_policy_requires_line_chunk" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pipeline_line_chunk_missing_policy(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    (tmp_path / "chunk" / "line_chunk.yaml").write_text(
        "id: line_chunk\nchunk_type: line\noptions: {}\n",
        encoding="utf-8",
    )
    data = {
        "id": "pipe1",
        "provider": "api1",
        "prompt": "prompt1",
        "parser": "parser1",
        "chunk_policy": "line_chunk",
    }
    result = validate_profile("pipeline", data, store=store)
    assert "line_chunk_missing_line_policy" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pipeline_invalid_concurrency():
    data = {
        "id": "pipe1",
        "provider": "api1",
        "prompt": "prompt1",
        "parser": "parser1",
        "chunk_policy": "chunk1",
        "settings": {"concurrency": -1},
    }
    result = validate_profile("pipeline", data)
    assert "invalid_concurrency" not in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pool_member_missing(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    data = {
        "id": "pool_api",
        "type": "pool",
        "members": ["missing_api"],
    }
    result = validate_profile("api", data, store=store)
    assert any(item.startswith("missing_reference:api:") for item in result.errors)


@pytest.mark.unit
def test_flow_v2_validation_pool_missing_endpoints():
    data = {
        "id": "pool_api",
        "type": "pool",
    }
    result = validate_profile("api", data)
    assert "missing_pool_endpoints" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pool_endpoints_requires_model():
    data = {
        "id": "pool_api",
        "type": "pool",
        "endpoints": [{"base_url": "https://api.example.com/v1"}],
    }
    result = validate_profile("api", data)
    assert "missing_pool_model" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_pool_endpoints_model_ok():
    data = {
        "id": "pool_api",
        "type": "pool",
        "endpoints": [
            {"base_url": "https://api.example.com/v1", "model": "demo-model"}
        ],
    }
    result = validate_profile("api", data)
    assert not result.errors


@pytest.mark.unit
def test_flow_v2_validation_prompt_missing_source():
    data = {"id": "prompt1", "user_template": "Translate please"}
    result = validate_profile("prompt", data)
    assert "prompt_missing_source" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_parser_prompt_mismatch(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    (tmp_path / "prompt" / "prompt_plain.yaml").write_text(
        "id: prompt_plain\nuser_template: \"{{source}}\"\n",
        encoding="utf-8",
    )
    (tmp_path / "parser" / "parser_tagged.yaml").write_text(
        "id: parser_tagged\ntype: tagged_line\noptions: {}\n",
        encoding="utf-8",
    )
    (tmp_path / "chunk" / "line_chunk.yaml").write_text(
        "id: line_chunk\nchunk_type: line\noptions: {}\n",
        encoding="utf-8",
    )
    data = {
        "id": "pipe1",
        "provider": "api1",
        "prompt": "prompt_plain",
        "parser": "parser_tagged",
        "chunk_policy": "line_chunk",
        "apply_line_policy": True,
        "line_policy": "line_policy_1",
    }
    result = validate_profile("pipeline", data, store=store)
    assert "parser_requires_tagged_prompt" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_parser_requires_json_prompt(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    (tmp_path / "api" / "api1.yaml").write_text(
        "id: api1\ntype: openai_compat\nbase_url: https://api.example.com/v1\nmodel: demo\n",
        encoding="utf-8",
    )
    (tmp_path / "prompt" / "prompt_plain.yaml").write_text(
        "id: prompt_plain\nuser_template: \"{{source}}\"\n",
        encoding="utf-8",
    )
    (tmp_path / "parser" / "parser_json.yaml").write_text(
        "id: parser_json\ntype: json_object\noptions:\n  path: translation\n",
        encoding="utf-8",
    )
    (tmp_path / "policy" / "line_policy.yaml").write_text(
        "id: line_policy\ntype: tolerant\noptions: {}\n",
        encoding="utf-8",
    )
    (tmp_path / "chunk" / "line_chunk.yaml").write_text(
        "id: line_chunk\nchunk_type: line\noptions: {}\n",
        encoding="utf-8",
    )
    data = {
        "id": "pipe1",
        "provider": "api1",
        "prompt": "prompt_plain",
        "parser": "parser_json",
        "chunk_policy": "line_chunk",
        "apply_line_policy": True,
        "line_policy": "line_policy",
    }
    result = validate_profile("pipeline", data, store=store)
    assert "parser_requires_json_prompt" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_parser_requires_jsonl_prompt(tmp_path):
    store = ProfileStore(str(tmp_path))
    store.ensure_dirs(["api", "prompt", "parser", "policy", "chunk", "pipeline"])
    (tmp_path / "api" / "api1.yaml").write_text(
        "id: api1\ntype: openai_compat\nbase_url: https://api.example.com/v1\nmodel: demo\n",
        encoding="utf-8",
    )
    (tmp_path / "prompt" / "prompt_plain.yaml").write_text(
        "id: prompt_plain\nuser_template: \"{{source}}\"\n",
        encoding="utf-8",
    )
    (tmp_path / "parser" / "parser_jsonl.yaml").write_text(
        "id: parser_jsonl\ntype: jsonl\noptions:\n  path: translation\n",
        encoding="utf-8",
    )
    (tmp_path / "policy" / "line_policy.yaml").write_text(
        "id: line_policy\ntype: tolerant\noptions: {}\n",
        encoding="utf-8",
    )
    (tmp_path / "chunk" / "line_chunk.yaml").write_text(
        "id: line_chunk\nchunk_type: line\noptions: {}\n",
        encoding="utf-8",
    )
    data = {
        "id": "pipe1",
        "provider": "api1",
        "prompt": "prompt_plain",
        "parser": "parser_jsonl",
        "chunk_policy": "line_chunk",
        "apply_line_policy": True,
        "line_policy": "line_policy",
    }
    result = validate_profile("pipeline", data, store=store)
    assert "parser_requires_jsonl_prompt" in result.errors


@pytest.mark.unit
def test_flow_v2_validation_parser_missing_python_script():
    result = validate_profile(
        "parser",
        {"id": "parser_python", "type": "python", "options": {}},
    )
    assert "missing_script" in result.errors
