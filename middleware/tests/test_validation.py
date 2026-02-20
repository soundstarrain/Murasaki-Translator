from __future__ import annotations

from pathlib import Path
import sys
import textwrap

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.validation import validate_profile


def write_yaml(path: Path, content: str) -> None:
    payload = textwrap.dedent(content).strip() + "\n"
    path.write_text(payload, encoding="utf-8")


def prepare_profiles(tmp_path: Path) -> Path:
    base = tmp_path / "profiles"
    (base / "api").mkdir(parents=True)
    (base / "prompt").mkdir()
    (base / "parser").mkdir()
    (base / "policy").mkdir()
    (base / "chunk").mkdir()
    (base / "pipeline").mkdir()

    write_yaml(
        base / "api" / "api_test.yaml",
        """
        id: api_test
        name: Test API
        type: openai_compat
        base_url: https://api.example.com/v1
        model: test-model
        """,
    )
    write_yaml(
        base / "chunk" / "chunk_line_default.yaml",
        """
        id: chunk_line_default
        name: Default Line Chunk
        chunk_type: line
        options:
          strict: true
          keep_empty: true
        """,
    )
    write_yaml(
        base / "policy" / "line_tolerant.yaml",
        """
        id: line_tolerant
        name: Default Line Policy
        type: tolerant
        options:
          on_mismatch: retry
          trim: true
          similarity_threshold: 0.8
          checks:
            - similarity
        """,
    )
    return base


@pytest.mark.unit
def test_pipeline_requires_jsonl_prompt(tmp_path: Path) -> None:
    base = prepare_profiles(tmp_path)
    write_yaml(
        base / "prompt" / "prompt_plain.yaml",
        """
        id: prompt_plain
        name: Plain Prompt
        system_template: |
          Translate the input line by line.
        user_template: |
          {{source}}
        """,
    )
    write_yaml(
        base / "parser" / "parser_jsonl.yaml",
        """
        id: parser_jsonl
        name: JSONL Parser
        type: jsonl
        options:
          path: translation
        """,
    )
    pipeline = {
        "id": "pipeline_test",
        "provider": "api_test",
        "prompt": "prompt_plain",
        "parser": "parser_jsonl",
        "chunk_policy": "chunk_line_default",
        "line_policy": "line_tolerant",
        "apply_line_policy": True,
    }
    store = ProfileStore(str(base))
    result = validate_profile("pipeline", pipeline, store=store)
    assert "parser_requires_jsonl_prompt" in result.errors


@pytest.mark.unit
def test_pipeline_requires_json_prompt(tmp_path: Path) -> None:
    base = prepare_profiles(tmp_path)
    write_yaml(
        base / "prompt" / "prompt_plain.yaml",
        """
        id: prompt_plain
        name: Plain Prompt
        system_template: |
          Translate the input text.
        user_template: |
          {{source}}
        """,
    )
    write_yaml(
        base / "parser" / "parser_json.yaml",
        """
        id: parser_json
        name: JSON Parser
        type: json_object
        options:
          path: translation
        """,
    )
    pipeline = {
        "id": "pipeline_test",
        "provider": "api_test",
        "prompt": "prompt_plain",
        "parser": "parser_json",
        "chunk_policy": "chunk_line_default",
        "line_policy": "line_tolerant",
        "apply_line_policy": True,
    }
    store = ProfileStore(str(base))
    result = validate_profile("pipeline", pipeline, store=store)
    assert "parser_requires_json_prompt" in result.errors


@pytest.mark.unit
def test_invalid_profile_id_rejected(tmp_path: Path) -> None:
    base = prepare_profiles(tmp_path)
    store = ProfileStore(str(base))
    profile = {
        "id": "../evil",
        "name": "Bad",
        "type": "openai_compat",
        "base_url": "https://api.example.com/v1",
        "model": "test-model",
    }
    result = validate_profile("api", profile, store=store)
    assert "invalid_id" in result.errors
