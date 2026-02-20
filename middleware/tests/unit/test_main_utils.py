import json
from pathlib import Path

import pytest

from murasaki_translator.main import (
    load_glossary,
    load_rules,
    load_existing_output,
    get_missed_terms,
    build_retry_feedback,
    calculate_skip_blocks,
    _normalize_anchor_stream,
    _parse_protect_pattern_lines,
    _parse_protect_pattern_payload,
    _merge_protect_patterns,
    _allow_text_protect,
)
from murasaki_translator.core.chunker import TextBlock


@pytest.mark.unit
def test_load_glossary_dict(tmp_path: Path):
    path = tmp_path / "g.json"
    path.write_text(json.dumps({"a": "A"}), encoding="utf-8")
    data = load_glossary(str(path))
    assert data == {"a": "A"}


@pytest.mark.unit
def test_load_glossary_list(tmp_path: Path):
    path = tmp_path / "g.json"
    payload = [{"src": "a", "dst": "A"}, {"jp": "b", "zh": "B"}]
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    data = load_glossary(str(path))
    assert data["a"] == "A"
    assert data["b"] == "B"


@pytest.mark.unit
def test_load_rules_invalid_json(tmp_path: Path):
    path = tmp_path / "rules.json"
    path.write_text("{oops}", encoding="utf-8")
    data = load_rules(str(path))
    assert data == []


@pytest.mark.unit
def test_load_glossary_missing_path():
    data = load_glossary("missing.json")
    assert data == {}


@pytest.mark.unit
def test_load_rules_missing_path():
    data = load_rules("missing.json")
    assert data == []


@pytest.mark.unit
def test_load_existing_output_detects_summary(tmp_path: Path):
    path = tmp_path / "out.txt"
    path.write_text("Translation Summary\n====================\n", encoding="utf-8")
    lines, content, ok = load_existing_output(str(path))
    assert ok is False
    assert lines == -1


@pytest.mark.unit
def test_load_existing_output_lines(tmp_path: Path):
    path = tmp_path / "out.txt"
    path.write_text("a\n\nb\n", encoding="utf-8")
    lines, content, ok = load_existing_output(str(path))
    assert ok is True
    assert lines == 3
    assert content == ["a", "", "b"]


@pytest.mark.unit
def test_get_missed_terms_and_feedback():
    missed = get_missed_terms("foo bar", "foo", {"foo": "FOO", "bar": "BAR"})
    assert ("bar", "BAR") in missed
    feedback = build_retry_feedback(missed, 0.0)
    assert "BAR" in feedback


@pytest.mark.unit
def test_calculate_skip_blocks():
    blocks = [
        TextBlock(id=1, prompt_text="a\n"),
        TextBlock(id=2, prompt_text="b\n"),
        TextBlock(id=3, prompt_text="c\n"),
    ]
    skipped = calculate_skip_blocks(blocks, existing_lines=2, is_chunk_mode=False)
    assert skipped == 1


@pytest.mark.unit
def test_calculate_skip_blocks_chunk_mode():
    blocks = [
        TextBlock(id=1, prompt_text="a\n"),
        TextBlock(id=2, prompt_text="b\n"),
    ]
    skipped = calculate_skip_blocks(blocks, existing_lines=2, is_chunk_mode=True)
    assert skipped == 0


@pytest.mark.unit
def test_normalize_anchor_stream():
    text = "＠ｉｄ＝２＠\nhello\n＠ｅｎｄ＝２＠"
    normalized = _normalize_anchor_stream(text)
    assert normalized == "@id=2@\nhello\n@end=2@"


@pytest.mark.unit
def test_parse_protect_pattern_lines():
    lines = ["# comment", "// comment", "", " +foo ", "!bar", "baz"]
    additions, removals = _parse_protect_pattern_lines(lines)
    assert additions == ["foo", "baz"]
    assert removals == ["bar"]


@pytest.mark.unit
def test_parse_protect_pattern_payload():
    assert _parse_protect_pattern_payload(None) == []
    assert _parse_protect_pattern_payload(["a", " ", "b"]) == ["a", "b"]
    assert _parse_protect_pattern_payload('["x", "y"]') == ["x", "y"]
    assert _parse_protect_pattern_payload("x\n\ny") == ["x", "y"]


@pytest.mark.unit
def test_merge_protect_patterns():
    merged = _merge_protect_patterns(["a", "b"], ["b", "c"], ["a"])
    assert merged == ["b", "c"]


@pytest.mark.unit
def test_allow_text_protect_alignment_mode_txt():
    args = type("Args", (), {"alignment_mode": True, "single_block": None})()
    assert _allow_text_protect("story.txt", args) is True
    assert _allow_text_protect("story.srt", args) is False


@pytest.mark.unit
def test_allow_text_protect_alignment_mode_single_block():
    args = type("Args", (), {"alignment_mode": True, "single_block": "hello"})()
    assert _allow_text_protect(None, args) is True
