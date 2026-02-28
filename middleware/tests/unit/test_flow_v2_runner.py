"""Tests for PipelineRunner internal helpers and concurrency utilities."""

import json
import threading
import time
import pytest

import murasaki_flow_v2.pipelines.runner as flow_v2_runner
from murasaki_flow_v2.pipelines.runner import PipelineRunner, PipelineStopRequested
from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.parsers.base import ParserError
from murasaki_flow_v2.providers.base import ProviderError, ProviderResponse
from murasaki_flow_v2.utils.adaptive_concurrency import AdaptiveConcurrency

try:
    from murasaki_translator.core.chunker import TextBlock
except ImportError:
    from dataclasses import dataclass, field
    from typing import List, Any

    @dataclass
    class TextBlock:
        id: int
        prompt_text: str
        metadata: List[Any] = field(default_factory=list)


def _make_runner(tmp_path):
    return PipelineRunner(ProfileStore(str(tmp_path)), {})


# ---------------------------------------------------------------------------
# _block_line_range
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_block_line_range_single():
    block = TextBlock(id=1, prompt_text="hello", metadata=[3])
    start, end = PipelineRunner._block_line_range(block)
    assert start == 3
    assert end == 4


@pytest.mark.unit
def test_flow_v2_runner_block_line_range_multi():
    block = TextBlock(id=1, prompt_text="a\nb\nc", metadata=[2, 3, 4])
    start, end = PipelineRunner._block_line_range(block)
    assert start == 2
    assert end == 5


@pytest.mark.unit
def test_flow_v2_runner_block_line_range_empty_metadata():
    block = TextBlock(id=1, prompt_text="hello", metadata=[])
    assert PipelineRunner._block_line_range(block) == (0, 0)


@pytest.mark.unit
def test_flow_v2_runner_block_line_range_non_int_ignored():
    block = TextBlock(id=1, prompt_text="hello", metadata=["tag", 5, None, 2])
    start, end = PipelineRunner._block_line_range(block)
    assert start == 2
    assert end == 6


@pytest.mark.unit
def test_flow_v2_runner_block_line_range_none_metadata():
    block = TextBlock(id=1, prompt_text="hello", metadata=None)
    assert PipelineRunner._block_line_range(block) == (0, 0)


@pytest.mark.unit
def test_flow_v2_runner_build_block_fallback_text_uses_full_metadata_range():
    source_lines = ["L0", "L1", "L2", "L3", "L4"]
    block = TextBlock(id=1, prompt_text="fallback", metadata=[1, 2, 3])
    result = PipelineRunner._build_block_fallback_text(
        source_lines,
        block,
        line_index=1,
    )
    assert result == "L1\nL2\nL3"


@pytest.mark.unit
def test_flow_v2_runner_build_block_fallback_text_prefers_target_line_ids():
    source_lines = ["L0", "L1", "L2", "L3", "L4"]
    block = TextBlock(id=1, prompt_text="fallback", metadata=[1, 2, 3])
    result = PipelineRunner._build_block_fallback_text(
        source_lines,
        block,
        line_index=1,
        target_line_ids=[0, 2, 4],
    )
    assert result == "L0\nL2\nL4"


@pytest.mark.unit
def test_flow_v2_runner_build_block_fallback_text_falls_back_to_prompt_text():
    block = TextBlock(id=1, prompt_text="raw block text", metadata=[])
    result = PipelineRunner._build_block_fallback_text([], block, line_index=None)
    assert result == "raw block text"


@pytest.mark.unit
def test_flow_v2_runner_collect_quality_output_lines_flattens_blocks():
    blocks = [
        TextBlock(id=1, prompt_text="A\nB", metadata=[0, 1]),
        TextBlock(id=2, prompt_text="C", metadata=[2]),
    ]
    assert PipelineRunner._collect_quality_output_lines(blocks) == ["A", "B", "C"]


@pytest.mark.unit
def test_flow_v2_runner_resolve_warning_block_prefers_metadata():
    blocks = [
        TextBlock(id=1, prompt_text="a", metadata=[0]),
        TextBlock(id=2, prompt_text="b", metadata=[1]),
        TextBlock(id=3, prompt_text="c", metadata=[2]),
    ]
    assert PipelineRunner._resolve_warning_block(blocks, 2) == 2


@pytest.mark.unit
def test_flow_v2_runner_resolve_warning_block_fallback_and_bounds():
    blocks = [
        TextBlock(id=1, prompt_text="a", metadata=[]),
        TextBlock(id=2, prompt_text="b", metadata=[]),
    ]
    assert PipelineRunner._resolve_warning_block(blocks, 1) == 1
    assert PipelineRunner._resolve_warning_block(blocks, 2) == 2
    assert PipelineRunner._resolve_warning_block(blocks, 10) == 0


@pytest.mark.unit
def test_flow_v2_runner_should_use_double_newline_separator():
    assert (
        PipelineRunner._should_use_double_newline_separator(
            [
                {
                    "type": "format",
                    "pattern": "ensure_double_newline",
                    "active": True,
                }
            ]
        )
        is True
    )
    assert (
        PipelineRunner._should_use_double_newline_separator(
            [
                {
                    "type": "format",
                    "pattern": "ensure_double_newline",
                    "active": False,
                }
            ]
        )
        is False
    )
    assert PipelineRunner._should_use_double_newline_separator([]) is False


@pytest.mark.unit
def test_flow_v2_runner_save_txt_blocks_double_separator(tmp_path):
    path = tmp_path / "out.txt"
    blocks = [
        TextBlock(id=1, prompt_text="A", metadata=[0]),
        TextBlock(id=2, prompt_text="B", metadata=[1]),
    ]
    PipelineRunner._save_txt_blocks(str(path), blocks, separator="\n\n")
    assert path.read_text(encoding="utf-8") == "A\n\nB\n\n"


@pytest.mark.unit
def test_flow_v2_runner_save_txt_blocks_double_separator_skips_blank_indices(tmp_path):
    path = tmp_path / "out.txt"
    blocks = [
        TextBlock(id=1, prompt_text="A", metadata=[0]),
        TextBlock(id=2, prompt_text="", metadata=[1]),
        TextBlock(id=3, prompt_text="B", metadata=[2]),
    ]
    PipelineRunner._save_txt_blocks(
        str(path),
        blocks,
        separator="\n\n",
        skip_blank_indices={1},
    )
    assert path.read_text(encoding="utf-8") == "A\n\nB\n\n"


@pytest.mark.unit
def test_flow_v2_runner_normalize_txt_blocks_strips_all_trailing_newlines():
    blocks = [
        TextBlock(id=1, prompt_text="A\n\n", metadata=[0]),
        TextBlock(id=2, prompt_text="B\r\n", metadata=[1]),
        TextBlock(id=3, prompt_text="", metadata=[2]),
    ]
    PipelineRunner._normalize_txt_blocks(blocks)
    assert [block.prompt_text for block in blocks] == ["A", "B", ""]


@pytest.mark.unit
def test_flow_v2_runner_resolve_rules_from_json_path(tmp_path):
    runner = _make_runner(tmp_path)
    rules = [{"type": "format", "pattern": "ensure_double_newline", "active": True}]
    rules_path = tmp_path / "rules_post.json"
    rules_path.write_text(json.dumps(rules, ensure_ascii=False), encoding="utf-8")
    assert runner._resolve_rules(str(rules_path)) == rules


@pytest.mark.unit
def test_flow_v2_runner_sanitize_post_rules_for_subtitle():
    source_rules = [
        {"type": "format", "pattern": "ensure_double_newline", "active": True},
        {"type": "format", "pattern": "clean_empty_lines", "active": True},
        {"type": "format", "pattern": "number_fixer", "active": True},
    ]
    sanitized = PipelineRunner._sanitize_post_rules_for_input(
        source_rules,
        "sample.srt",
    )
    assert [rule["pattern"] for rule in sanitized] == ["number_fixer"]


@pytest.mark.unit
def test_flow_v2_runner_resolve_protect_patterns_base():
    txt_patterns = PipelineRunner._resolve_protect_patterns_base("novel.txt")
    assert isinstance(txt_patterns, list)
    assert txt_patterns

    subtitle = PipelineRunner._resolve_protect_patterns_base("episode.ass")
    assert subtitle is None

    epub = PipelineRunner._resolve_protect_patterns_base("book.epub")
    assert epub is None


@pytest.mark.unit
def test_flow_v2_runner_should_enable_text_protect_for_file():
    assert PipelineRunner._should_enable_text_protect_for_file("novel.txt") is True
    assert PipelineRunner._should_enable_text_protect_for_file("episode.srt") is False
    assert PipelineRunner._should_enable_text_protect_for_file("book.epub") is False


@pytest.mark.unit
def test_flow_v2_runner_detect_anchor_mode():
    epub_text = "@id=11@\nhello\n@end=11@"
    assert PipelineRunner._detect_anchor_mode("book.epub", epub_text) == "epub"

    alignment_text = "@id=1@\nfoo\n@end=1@"
    assert PipelineRunner._detect_anchor_mode("comic.txt", alignment_text) == "alignment"

    plain_text = "just plain text"
    assert PipelineRunner._detect_anchor_mode("novel.txt", plain_text) == ""


@pytest.mark.unit
def test_flow_v2_runner_extract_single_anchor_wrapper():
    wrapped = "@id=1001@\nhello\n@end=1001@"
    parsed = PipelineRunner._extract_single_anchor_wrapper(wrapped)
    assert parsed == {"id": "1001", "inner_text": "hello"}

    mixed = "@id=1@\na\n@end=1@\n@id=2@\nb\n@end=2@"
    assert PipelineRunner._extract_single_anchor_wrapper(mixed) is None


# ---------------------------------------------------------------------------
# _build_context
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_build_context_no_block_end(tmp_path):
    runner = _make_runner(tmp_path)
    lines = ["L0", "L1", "L2", "L3", "L4"]
    cfg = {"before_lines": 2, "after_lines": 2}
    ctx = runner._build_context(lines, 2, cfg)
    assert ctx["before"] == "L0\nL1"
    assert ctx["after"] == "L3\nL4"


@pytest.mark.unit
def test_flow_v2_runner_build_context_block_end_shifts_after(tmp_path):
    runner = _make_runner(tmp_path)
    lines = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"]
    cfg = {"before_lines": 2, "after_lines": 2}
    ctx = runner._build_context(lines, 2, cfg, block_end=5)
    assert ctx["before"] == "L0\nL1"
    assert ctx["after"] == "L5\nL6"


@pytest.mark.unit
def test_flow_v2_runner_build_context_block_end_at_tail(tmp_path):
    runner = _make_runner(tmp_path)
    lines = ["L0", "L1", "L2", "L3"]
    cfg = {"before_lines": 1, "after_lines": 3}
    ctx = runner._build_context(lines, 2, cfg, block_end=4)
    assert ctx["before"] == "L1"
    assert ctx["after"] == ""


@pytest.mark.unit
def test_flow_v2_runner_build_context_zero(tmp_path):
    runner = _make_runner(tmp_path)
    lines = ["L0", "L1"]
    cfg = {"before_lines": 0, "after_lines": 0}
    assert runner._build_context(lines, 0, cfg) == {"before": "", "after": ""}


# ---------------------------------------------------------------------------
# _extract_source_lines
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_build_resume_fingerprint_changes_with_prompt_profile(tmp_path):
    runner = _make_runner(tmp_path)
    base_kwargs = {
        "input_path": "input.txt",
        "pipeline_id": "pipeline_demo",
        "chunk_type": "line",
        "pipeline": {"id": "pipeline_demo", "prompt": "prompt_default"},
        "provider_profile": {"id": "provider_demo", "model": "demo-model"},
        "prompt_profile": {"id": "prompt_default", "user_template": "{{source}}"},
        "parser_profile": {"id": "parser_default", "type": "plain"},
        "line_policy_profile": {"id": "line_tolerant", "type": "tolerant"},
        "chunk_policy_profile": {"id": "chunk_line", "chunk_type": "line"},
        "settings": {"temperature": 0.2},
        "processing_cfg": {"source_lang": "ja"},
        "pre_rules": [],
        "post_rules": [],
        "source_format": "auto",
    }
    fp_before = runner._build_resume_fingerprint(**base_kwargs)
    fp_after = runner._build_resume_fingerprint(
        **{
            **base_kwargs,
            "prompt_profile": {
                "id": "prompt_default",
                "user_template": "prefix {{source}} suffix",
            },
        }
    )
    assert fp_before["config_hash"] != fp_after["config_hash"]


@pytest.mark.unit
def test_flow_v2_runner_load_resume_file_requires_fingerprint_when_expected(tmp_path):
    resume_path = tmp_path / "resume.temp.jsonl"
    resume_path.write_text(
        json.dumps({"type": "block", "index": 0, "src": "A", "dst": "B"}, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
    entries, matched = PipelineRunner._load_resume_file(
        str(resume_path),
        expected={
            "input": "input.txt",
            "pipeline": "pipe_x",
            "chunk_type": "line",
            "config_hash": "hash_x",
        },
    )
    assert entries == {}
    assert matched is False


@pytest.mark.unit
def test_flow_v2_runner_load_resume_file_matches_config_hash(tmp_path):
    resume_path = tmp_path / "resume.temp.jsonl"
    header = {
        "type": "fingerprint",
        "input": "input.txt",
        "pipeline": "pipe_x",
        "chunk_type": "line",
        "config_hash": "hash_ok",
    }
    body = {"type": "block", "index": 1, "src": "A", "dst": "B"}
    resume_path.write_text(
        "\n".join(
            [
                json.dumps(header, ensure_ascii=False),
                json.dumps(body, ensure_ascii=False),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    entries, matched = PipelineRunner._load_resume_file(
        str(resume_path),
        expected={
            "input": "input.txt",
            "pipeline": "pipe_x",
            "chunk_type": "line",
            "config_hash": "hash_ok",
        },
    )
    assert matched is True
    assert entries[1]["dst"] == "B"


@pytest.mark.unit
def test_flow_v2_runner_extract_source_lines(tmp_path):
    runner = _make_runner(tmp_path)
    items = [{"text": "hello\n", "meta": 0}, {"text": "world", "meta": 1}]
    assert runner._extract_source_lines(items) == ["hello", "world"]


@pytest.mark.unit
def test_flow_v2_runner_extract_source_lines_empty(tmp_path):
    runner = _make_runner(tmp_path)
    assert runner._extract_source_lines([]) == []


@pytest.mark.unit
def test_flow_v2_runner_extract_source_lines_missing_text(tmp_path):
    runner = _make_runner(tmp_path)
    assert runner._extract_source_lines([{"meta": 0}]) == [""]


# ---------------------------------------------------------------------------
# _load_glossary
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_load_glossary_none(tmp_path):
    runner = _make_runner(tmp_path)
    assert runner._load_glossary(None) == ""


@pytest.mark.unit
def test_flow_v2_runner_load_glossary_file(tmp_path):
    runner = _make_runner(tmp_path)
    g = tmp_path / "glossary.txt"
    g.write_text("term1\tvalue1\nterm2\tvalue2\n", encoding="utf-8")
    result = runner._load_glossary(str(g))
    assert "term1" in result and "value1" in result


@pytest.mark.unit
def test_flow_v2_runner_load_glossary_inline_dict(tmp_path):
    runner = _make_runner(tmp_path)
    result = runner._load_glossary({"foo": "bar"})
    assert "foo" in result and "bar" in result


@pytest.mark.unit
def test_flow_v2_runner_load_glossary_inline_json(tmp_path):
    runner = _make_runner(tmp_path)
    result = runner._load_glossary("{\"foo\": \"bar\"}")
    assert "foo" in result and "bar" in result


# ---------------------------------------------------------------------------
# _resolve_source_window
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_resolve_source_window_default(tmp_path):
    runner = _make_runner(tmp_path)
    lines = ["a", "b", "c", "d", "e"]
    start, end = runner._resolve_source_window(lines, 2, {})
    assert start == 2 and end == 3


@pytest.mark.unit
def test_flow_v2_runner_resolve_source_window_explicit(tmp_path):
    runner = _make_runner(tmp_path)
    lines = ["a", "b", "c", "d", "e"]
    start, end = runner._resolve_source_window(lines, 1, {"source_lines": 3})
    assert start == 1 and end == 4


# ---------------------------------------------------------------------------
# _build_jsonl_range
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_build_jsonl_range_empty(tmp_path):
    runner = _make_runner(tmp_path)
    assert runner._build_jsonl_range(["a", "b"], 2, 2) == ""
    assert runner._build_jsonl_range(["a", "b"], 3, 2) == ""


@pytest.mark.unit
def test_flow_v2_runner_build_jsonl_range_normal(tmp_path):
    runner = _make_runner(tmp_path)
    result = runner._build_jsonl_range(["a", "b", "c"], 0, 2)
    assert '"1"' in result and '"2"' in result and '"3"' not in result


# ---------------------------------------------------------------------------
# Line policy gating
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_should_apply_line_policy_default():
    assert PipelineRunner._should_apply_line_policy({}, object(), "line") is True


@pytest.mark.unit
def test_flow_v2_runner_should_apply_line_policy_disabled():
    pipeline = {"apply_line_policy": False}
    assert PipelineRunner._should_apply_line_policy(pipeline, object(), "line") is False


@pytest.mark.unit
def test_flow_v2_runner_should_apply_line_policy_non_line_chunk():
    assert PipelineRunner._should_apply_line_policy({}, object(), "legacy") is False


# ---------------------------------------------------------------------------
# Kana residue retry for V2 block mode
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_resolve_kana_retry_settings_default():
    enabled, threshold, min_chars = PipelineRunner._resolve_kana_retry_settings({})
    assert enabled is True
    assert threshold == pytest.approx(0.30)
    assert min_chars == 32


@pytest.mark.unit
def test_flow_v2_runner_resolve_kana_retry_settings_custom():
    cfg = {
        "kana_retry_enabled": False,
        "kana_retry_threshold": 0.42,
        "kana_retry_min_chars": 32,
    }
    enabled, threshold, min_chars = PipelineRunner._resolve_kana_retry_settings(cfg)
    assert enabled is False
    assert threshold == pytest.approx(0.42)
    assert min_chars == 32


@pytest.mark.unit
def test_flow_v2_runner_resolve_kana_retry_settings_prefers_chunk_options():
    processing_cfg = {
        "kana_retry_enabled": False,
        "kana_retry_threshold": 0.42,
        "kana_retry_min_chars": 32,
    }
    chunk_options = {
        "kana_retry_enabled": True,
        "kana_retry_threshold": 0.55,
        "kana_retry_min_chars": 48,
    }
    enabled, threshold, min_chars = PipelineRunner._resolve_kana_retry_settings(
        processing_cfg,
        chunk_options,
    )
    assert enabled is True
    assert threshold == pytest.approx(0.55)
    assert min_chars == 48


@pytest.mark.unit
def test_flow_v2_runner_resolve_kana_retry_settings_invalid_fallback():
    cfg = {
        "kana_retry_enabled": "yes",
        "kana_retry_threshold": 9,
        "kana_retry_min_chars": -1,
    }
    enabled, threshold, min_chars = PipelineRunner._resolve_kana_retry_settings(cfg)
    assert enabled is True
    assert threshold == pytest.approx(0.30)
    assert min_chars == 32


@pytest.mark.unit
def test_flow_v2_runner_compute_kana_ratio_counts():
    ratio, kana_chars, effective_chars = PipelineRunner._compute_kana_ratio("春风かな123")
    assert kana_chars == 2
    assert effective_chars == 7
    assert ratio == pytest.approx(2 / 7)


@pytest.mark.unit
def test_flow_v2_runner_evaluate_kana_retry_triggers_in_block_ja():
    result = PipelineRunner._evaluate_kana_retry(
        "かなかなかなかなかなかなかなかなかなかな",
        source_lang="ja",
        chunk_type="block",
        enabled=True,
        threshold=0.30,
        min_chars=20,
    )
    assert result["eligible"] is True
    assert result["should_retry"] is True
    assert result["ratio"] >= 0.30


@pytest.mark.unit
def test_flow_v2_runner_evaluate_kana_retry_triggers_in_block_jp_alias():
    result = PipelineRunner._evaluate_kana_retry(
        "かなかなかなかなかなかなかなかなかなかな",
        source_lang="jp",
        chunk_type="block",
        enabled=True,
        threshold=0.30,
        min_chars=20,
    )
    assert result["eligible"] is True
    assert result["should_retry"] is True


@pytest.mark.unit
def test_flow_v2_runner_evaluate_kana_retry_not_triggered_for_line_mode():
    result = PipelineRunner._evaluate_kana_retry(
        "かなかなかなかなかなかなかなかなかなかな",
        source_lang="ja",
        chunk_type="line",
        enabled=True,
        threshold=0.30,
        min_chars=20,
    )
    assert result["eligible"] is False
    assert result["should_retry"] is False


@pytest.mark.unit
def test_flow_v2_runner_evaluate_kana_retry_not_triggered_when_too_short():
    result = PipelineRunner._evaluate_kana_retry(
        "かなかな",
        source_lang="ja",
        chunk_type="block",
        enabled=True,
        threshold=0.30,
        min_chars=20,
    )
    assert result["eligible"] is True
    assert result["effectiveChars"] < 20
    assert result["should_retry"] is False


@pytest.mark.unit
def test_flow_v2_runner_evaluate_kana_retry_not_triggered_without_explicit_source_lang():
    result = PipelineRunner._evaluate_kana_retry(
        "かなかなかなかなかなかなかなかなかなかな",
        source_lang="",
        chunk_type="block",
        enabled=True,
        threshold=0.30,
        min_chars=20,
    )
    assert result["eligible"] is False
    assert result["should_retry"] is False


# ---------------------------------------------------------------------------
# JSONL protection helpers
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_apply_protection_to_lines():
    try:
        from murasaki_translator.core.text_protector import TextProtector
    except ImportError:
        pytest.skip("TextProtector not available")

    lines = ["foo {bar}", "baz"]
    protector = TextProtector()
    protected, used = PipelineRunner._apply_protection_to_lines(
        lines, 0, 2, protector
    )
    assert used is protector
    assert len(protected) == len(lines)
    assert protected[0] != lines[0]

# ---------------------------------------------------------------------------
# JSONL source window / parse (migrated from test_flow_v2_runner_jsonl)
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_jsonl_source_window(tmp_path):
    runner = _make_runner(tmp_path)
    source_lines = ["L1", "L2", "L3", "L4", "L5", "L6"]
    context_cfg = {"before_lines": 3, "after_lines": 0, "source_lines": 5}
    result = runner._build_jsonl_source(source_lines, 3, context_cfg)
    assert result == "\n".join(
        ['jsonline{"4": "L4"}', 'jsonline{"5": "L5"}', 'jsonline{"6": "L6"}']
    )


@pytest.mark.unit
def test_flow_v2_runner_jsonl_parse_filters_ids(tmp_path):
    runner = _make_runner(tmp_path)
    text = 'jsonline{"3":"A"}\njsonline{"4":"B"}\njsonline{"7":"C"}'
    assert runner._parse_jsonl_response(text, [2, 3]) == "A\nB"


@pytest.mark.unit
def test_flow_v2_runner_jsonl_parse_missing_line(tmp_path):
    runner = _make_runner(tmp_path)
    text = 'jsonline{"3":"A"}'
    with pytest.raises(ParserError):
        runner._parse_jsonl_response(text, [2, 3])


# ---------------------------------------------------------------------------
# AdaptiveConcurrency
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_adaptive_concurrency_initial():
    ac = AdaptiveConcurrency(max_limit=8)
    assert ac.get_limit() == 4


@pytest.mark.unit
def test_flow_v2_runner_adaptive_concurrency_success_increases():
    ac = AdaptiveConcurrency(max_limit=8)
    initial = ac.get_limit()
    for _ in range(20):
        ac.note_success()
    assert ac.get_limit() >= initial


@pytest.mark.unit
def test_flow_v2_runner_adaptive_concurrency_error_decreases():
    ac = AdaptiveConcurrency(max_limit=8)
    for _ in range(10):
        ac.note_success()
    high = ac.get_limit()
    ac.note_error("rate_limit")
    assert ac.get_limit() <= high


@pytest.mark.unit
def test_flow_v2_runner_adaptive_concurrency_max_respected():
    ac = AdaptiveConcurrency(max_limit=4)
    for _ in range(100):
        ac.note_success()
    assert ac.get_limit() <= 4


@pytest.mark.unit
def test_flow_v2_runner_adaptive_concurrency_min_is_one():
    ac = AdaptiveConcurrency(max_limit=4)
    for _ in range(100):
        ac.note_error("server_error")
    assert ac.get_limit() >= 1


# ---------------------------------------------------------------------------
# Thread safety
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_concurrent_list_append_with_lock():
    errors = []
    lock = threading.Lock()

    def append_n(n):
        for i in range(n):
            with lock:
                errors.append(i)

    threads = [threading.Thread(target=append_n, args=(100,)) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(errors) == 1000


# ---------------------------------------------------------------------------
# ProcessingProcessor lock separation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_processing_lock_separation():
    try:
        from murasaki_flow_v2.utils.processing import (
            ProcessingProcessor,
            ProcessingOptions,
        )
    except ImportError:
        pytest.skip("processing dependencies not available")

    processor = ProcessingProcessor(
        ProcessingOptions(
            rules_pre=[],
            rules_post=[],
            glossary={},
            source_lang="ja",
            strict_line_count=False,
            enable_quality=False,
            enable_text_protect=False,
        )
    )
    assert processor._pre_lock is not processor._post_lock
    assert isinstance(processor._pre_lock, type(threading.Lock()))
    assert isinstance(processor._post_lock, type(threading.Lock()))


class _DummyDoc:
    def __init__(self, lines):
        self._lines = lines
        self.saved_path = None
        self.saved_blocks = []

    def load(self):
        return [{"text": line} for line in self._lines]

    def save(self, path, blocks):
        self.saved_path = path
        self.saved_blocks = blocks


class _DummyLineChunkPolicy:
    profile = {"chunk_type": "line", "type": "line"}

    def chunk(self, items):
        return [
            TextBlock(id=index + 1, prompt_text=item["text"], metadata=[index])
            for index, item in enumerate(items)
        ]


class _DummyBlockChunkPolicy:
    profile = {"chunk_type": "block", "type": "block"}

    def chunk(self, items):
        return [
            TextBlock(id=index + 1, prompt_text=item["text"], metadata=[])
            for index, item in enumerate(items)
        ]


@pytest.mark.unit
def test_flow_v2_runner_fallback_to_source_on_provider_error(tmp_path, monkeypatch):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            raise ProviderError("HTTP 503 provider_unavailable")

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            raise AssertionError("ProviderError path should not call parser")

    doc = _DummyDoc(["L1", "L2"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )

    output_path = str(tmp_path / "out.txt")
    result = runner.run("dummy-input.txt", output_path=output_path, save_cache=False)
    assert result == output_path
    assert [block.prompt_text for block in doc.saved_blocks] == ["L1", "L2"]

    line_error_path = tmp_path / "out.txt.line_errors.jsonl"
    assert line_error_path.exists()
    content = line_error_path.read_text(encoding="utf-8")
    assert '"status": "untranslated_fallback"' in content
    assert '"type": "provider_error"' in content


@pytest.mark.unit
def test_flow_v2_runner_fallback_to_source_on_parser_error(tmp_path, monkeypatch):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            return ProviderResponse(text="invalid", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            raise ParserError("empty_output")

    doc = _DummyDoc(["A", "B"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )

    output_path = str(tmp_path / "out.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)
    assert [block.prompt_text for block in doc.saved_blocks] == ["A", "B"]


@pytest.mark.unit
def test_flow_v2_runner_fallback_to_source_on_unexpected_parser_error(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            return ProviderResponse(text="raw", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            raise ValueError("unexpected_parse_failure")

    doc = _DummyDoc(["U1", "U2"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )

    output_path = str(tmp_path / "unexpected.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    assert [block.prompt_text for block in doc.saved_blocks] == ["U1", "U2"]
    line_error_path = tmp_path / "unexpected.txt.line_errors.jsonl"
    assert line_error_path.exists()
    content = line_error_path.read_text(encoding="utf-8")
    assert '"type": "unknown_error"' in content


@pytest.mark.unit
def test_flow_v2_runner_block_mode_fallback_does_not_abort_all(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 4},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            raise ProviderError("HTTP 500 upstream_error")

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            raise AssertionError("ProviderError path should not call parser")

    doc = _DummyDoc(["L1", "L2", "L3"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )

    output_path = str(tmp_path / "out.txt")
    result = runner.run("dummy-input.txt", output_path=output_path, save_cache=False)
    assert result == output_path
    assert [block.prompt_text for block in doc.saved_blocks] == ["L1", "L2", "L3"]


@pytest.mark.unit
def test_flow_v2_runner_block_mode_kana_residue_retries_and_records_reason(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 1, "concurrency": 1},
        "processing": {
            "source_lang": "ja",
            "kana_retry_enabled": True,
            "kana_retry_threshold": 0.30,
            "kana_retry_min_chars": 20,
        },
    }

    class _Provider:
        profile = {"model": "stub-model", "base_url": "http://localhost:8000/v1"}

        def __init__(self):
            self.calls = 0

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            self.calls += 1
            if self.calls == 1:
                return ProviderResponse(text="かなかなかなかなかなかなかなかなかなかな", raw={})
            return ProviderResponse(text="这是中文输出结果。", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    provider = _Provider()
    captured_events = []
    doc = _DummyDoc(["原文一行"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: provider)
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )
    monkeypatch.setattr(
        flow_v2_runner,
        "emit_api_stats_event",
        lambda payload: captured_events.append(payload),
    )

    output_path = str(tmp_path / "kana_retry.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    assert provider.calls == 2
    assert [block.prompt_text for block in doc.saved_blocks] == ["这是中文输出结果。"]

    retry_events = [
        event for event in captured_events if event.get("phase") == "request_retry"
    ]
    assert retry_events
    assert any(event.get("errorType") == "kana_residue" for event in retry_events)
    matched_event = next(
        event for event in retry_events if event.get("errorType") == "kana_residue"
    )
    retry_meta = matched_event.get("meta") or {}
    assert retry_meta.get("kanaRetryThreshold") == pytest.approx(0.30)
    assert (retry_meta.get("kanaRetryRatio") or 0) >= 0.30


@pytest.mark.unit
def test_flow_v2_runner_block_mode_kana_residue_disabled_without_explicit_source_lang(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 1, "concurrency": 1},
        "processing": {
            "kana_retry_enabled": True,
            "kana_retry_threshold": 0.30,
            "kana_retry_min_chars": 20,
        },
    }

    class _Provider:
        profile = {"model": "stub-model", "base_url": "http://localhost:8000/v1"}

        def __init__(self):
            self.calls = 0

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            self.calls += 1
            return ProviderResponse(text="かなかなかなかなかなかなかなかなかなかな", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    provider = _Provider()
    captured_events = []
    doc = _DummyDoc(["原文一行"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: provider)
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )
    monkeypatch.setattr(
        flow_v2_runner,
        "emit_api_stats_event",
        lambda payload: captured_events.append(payload),
    )

    output_path = str(tmp_path / "kana_no_lang.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    assert provider.calls == 1
    assert [block.prompt_text for block in doc.saved_blocks] == ["かなかなかなかなかなかなかなかなかなかな"]
    retry_events = [
        event for event in captured_events if event.get("phase") == "request_retry"
    ]
    assert not any(event.get("errorType") == "kana_residue" for event in retry_events)


@pytest.mark.unit
def test_flow_v2_runner_block_mode_kana_residue_reads_chunk_options_source_lang(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 1, "concurrency": 1},
        "processing": {},
    }

    class _Provider:
        profile = {"model": "stub-model", "base_url": "http://localhost:8000/v1"}

        def __init__(self):
            self.calls = 0

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            self.calls += 1
            if self.calls == 1:
                return ProviderResponse(
                    text="かなかなかなかなかなかなかなかなかなかなかなかな",
                    raw={},
                )
            return ProviderResponse(text="中文输出", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    class _ChunkPolicyWithKanaOptions(_DummyBlockChunkPolicy):
        profile = {
            "chunk_type": "block",
            "type": "block",
            "options": {
                "kana_retry_enabled": True,
                "kana_retry_threshold": 0.30,
                "kana_retry_min_chars": 20,
                "kana_retry_source_lang": "ja",
            },
        }

    provider = _Provider()
    captured_events = []
    doc = _DummyDoc(["source line"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: provider)
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _ChunkPolicyWithKanaOptions(),
    )
    monkeypatch.setattr(
        flow_v2_runner,
        "emit_api_stats_event",
        lambda payload: captured_events.append(payload),
    )

    output_path = str(tmp_path / "kana_chunk_option.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    assert provider.calls == 2
    retry_events = [
        event for event in captured_events if event.get("phase") == "request_retry"
    ]
    assert any(event.get("errorType") == "kana_residue" for event in retry_events)


@pytest.mark.unit
def test_flow_v2_runner_block_mode_anchor_repair_success_without_retry(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 1, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def __init__(self):
            self.calls = 0

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            self.calls += 1
            # Old alignment style: @id ... @id (no @end), should be auto-repaired.
            return ProviderResponse(text="@id=1@\n译文\n@id=1@", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    provider = _Provider()
    captured_events = []
    doc = _DummyDoc(["@id=1001@\nsource\n@end=1001@"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: provider)
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )
    monkeypatch.setattr(
        flow_v2_runner,
        "emit_api_stats_event",
        lambda payload: captured_events.append(payload),
    )

    output_path = str(tmp_path / "anchor_repair_ok.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    assert provider.calls == 1
    assert [block.prompt_text for block in doc.saved_blocks] == [
        "@id=1001@\n译文\n@end=1001@"
    ]
    retry_events = [
        event for event in captured_events if event.get("phase") == "request_retry"
    ]
    assert not any(event.get("errorType") == "anchor_missing" for event in retry_events)


@pytest.mark.unit
def test_flow_v2_runner_block_mode_anchor_repair_fail_then_retry(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 1, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def __init__(self):
            self.calls = 0

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            self.calls += 1
            if self.calls == 1:
                # Missing anchor segment for id=2, repair should fail and trigger retry.
                return ProviderResponse(text="@id=1@\nA\n@end=1@", raw={})
            return ProviderResponse(
                text="@id=1@\nA\n@end=1@\n@id=2@\nB\n@end=2@",
                raw={},
            )

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    provider = _Provider()
    captured_events = []
    doc = _DummyDoc(["@id=1001@\nsource1\n@end=1001@\n@id=1002@\nsource2\n@end=1002@"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: provider)
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )
    monkeypatch.setattr(
        flow_v2_runner,
        "emit_api_stats_event",
        lambda payload: captured_events.append(payload),
    )

    output_path = str(tmp_path / "anchor_repair_retry.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    assert provider.calls == 2
    assert [block.prompt_text for block in doc.saved_blocks] == [
        "@id=1001@\nA\n@end=1001@\n@id=1002@\nB\n@end=1002@"
    ]
    retry_events = [
        event for event in captured_events if event.get("phase") == "request_retry"
    ]
    assert any(event.get("errorType") == "anchor_missing" for event in retry_events)
    retry_meta = next(
        event.get("meta", {})
        for event in retry_events
        if event.get("errorType") == "anchor_missing"
    )
    assert retry_meta.get("format") == "alignment"
    assert int(retry_meta.get("missing_count") or 0) >= 1


@pytest.mark.unit
def test_flow_v2_runner_line_mode_single_anchor_wrapper_unwrap_and_rewrap(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def __init__(self):
            self.calls = 0

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            self.calls += 1
            return ProviderResponse(text="@id=9@译文@end=9@", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    provider = _Provider()
    captured_sources = []

    def _capture_messages(_prompt_profile, **kwargs):
        captured_sources.append(str(kwargs.get("source_text") or ""))
        return [{"role": "user", "content": kwargs.get("source_text", "")}]

    doc = _DummyDoc(["@id=1001@\n源文\n@end=1001@"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        _capture_messages,
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: provider)
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyLineChunkPolicy(),
    )

    output_path = str(tmp_path / "line_anchor_wrap.txt")
    runner.run("book.epub", output_path=output_path, save_cache=False)

    assert provider.calls == 1
    assert captured_sources
    assert "@id=" not in captured_sources[0]
    assert captured_sources[0].strip() == "源文"
    assert [block.prompt_text for block in doc.saved_blocks] == [
        "@id=1001@\n译文\n@end=1001@"
    ]


@pytest.mark.unit
def test_flow_v2_runner_line_mode_single_anchor_wrapper_keeps_preprocessed_body(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
        "processing": {
            "rules_pre": [
                {"type": "format", "pattern": "dummy_pre", "active": True}
            ]
        },
    }

    class _FakeProcessingProcessor:
        def __init__(self, options):
            self.options = options

        @property
        def has_pre_rules(self):
            return True

        @property
        def has_post_rules(self):
            return False

        def apply_pre(self, text: str):
            return text.replace("source", "processed-source")

        @staticmethod
        def create_protector():
            return None

        @staticmethod
        def apply_post(text: str, **_kwargs):
            return text

    class _Provider:
        profile = {"model": "stub-model"}

        def __init__(self):
            self.calls = 0

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            self.calls += 1
            return ProviderResponse(text="@id=9@translated@end=9@", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    provider = _Provider()
    captured_sources = []

    def _capture_messages(_prompt_profile, **kwargs):
        captured_sources.append(str(kwargs.get("source_text") or ""))
        return [{"role": "user", "content": kwargs.get("source_text", "")}]

    doc = _DummyDoc(["@id=1001@\nsource\n@end=1001@"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        _capture_messages,
    )
    monkeypatch.setattr(
        flow_v2_runner.v2_processing,
        "ProcessingProcessor",
        _FakeProcessingProcessor,
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: provider)
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyLineChunkPolicy(),
    )

    output_path = str(tmp_path / "line_anchor_wrap_preprocessed.txt")
    runner.run("book.epub", output_path=output_path, save_cache=False)

    assert provider.calls == 1
    assert captured_sources
    assert captured_sources[0].strip() == "processed-source"
    assert [block.prompt_text for block in doc.saved_blocks] == [
        "@id=1001@\ntranslated\n@end=1001@"
    ]


@pytest.mark.unit
def test_flow_v2_runner_chunk_mode_context_works_without_line_metadata(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            return ProviderResponse(text="T", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            return type("Parsed", (), {"text": "T"})()

    captured_contexts = []

    def _capture_messages(_prompt_profile, **kwargs):
        captured_contexts.append(
            (kwargs.get("context_before", ""), kwargs.get("context_after", ""))
        )
        return [{"role": "user", "content": kwargs.get("source_text", "")}]

    doc = _DummyDoc(["C1", "C2", "C3"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        _capture_messages,
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts,
        "get_prompt",
        lambda _ref: {
            "user_template": "{{source}}",
            "context": {"before_lines": 1, "after_lines": 1},
        },
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )

    output_path = str(tmp_path / "ctx_out.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    assert captured_contexts
    assert captured_contexts[0][1] == "C2"


@pytest.mark.unit
def test_flow_v2_runner_extract_relevant_glossary_matches_v1_behavior():
    glossary = {
        "キリヒト": "桐人",
        "先生": "老师",
        "一": "壹",
        "炭焼き窯": "炭窑",
    }
    source = "キリヒトは炭焼き窯へ向かった。"
    matched = PipelineRunner._extract_relevant_glossary(glossary, source, limit=20)
    assert matched == {
        "キリヒト": "桐人",
        "炭焼き窯": "炭窑",
    }


@pytest.mark.unit
def test_flow_v2_runner_api_stats_event_contains_response_meta(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Request:
        def __init__(self):
            self.model = "stub-model"
            self.messages = [{"role": "user", "content": "x"}]
            self.temperature = None
            self.max_tokens = None
            self.extra = {"top_p": 1}
            self.headers = {"X-Test": "1"}
            self.provider_id = "endpoint_1"
            self.request_id = "req_meta_1"
            self.meta = {"endpoint_id": "ep_1", "endpoint_label": "node-a"}

    class _Provider:
        profile = {
            "type": "openai_compat",
            "model": "stub-model",
            "base_url": "http://localhost:8000/v1",
        }

        def build_request(self, _messages, _settings):
            return _Request()

        def send(self, _request):
            return ProviderResponse(
                text="translated",
                raw={
                    "data": {
                        "id": "resp_1",
                        "model": "stub-model",
                        "choices": [{"finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 11, "completion_tokens": 13},
                    },
                    "usage": {"prompt_tokens": 11, "completion_tokens": 13},
                    "request": {
                        "url": "http://localhost:8000/v1/chat/completions",
                        "headers": {"X-Test": "1"},
                        "payload": {"model": "stub-model", "messages": [{"role": "user", "content": "x"}]},
                    },
                    "response": {
                        "status_code": 200,
                        "headers": {"content-type": "application/json"},
                    },
                },
                status_code=200,
                duration_ms=120,
                url="http://localhost:8000/v1/chat/completions",
                request_headers={"X-Test": "1"},
                response_headers={"content-type": "application/json"},
            )

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            return type("Parsed", (), {"text": "translated"})()

    captured_events = []

    doc = _DummyDoc(["L1"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )
    monkeypatch.setattr(
        flow_v2_runner,
        "emit_api_stats_event",
        lambda payload: captured_events.append(payload),
    )

    output_path = str(tmp_path / "stats_meta.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    phases = [event.get("phase") for event in captured_events]
    assert "request_start" in phases
    assert "request_end" in phases

    end_event = next(
        event for event in captured_events if event.get("phase") == "request_end"
    )
    end_meta = end_event.get("meta") or {}
    assert end_meta.get("chunkType") == "line"
    assert end_meta.get("parserRef") == "parser_stub"
    assert end_meta.get("blockLineIds") == [0]
    assert end_meta.get("targetLineIds") == [0]
    assert end_meta.get("responseId") == "resp_1"
    assert end_meta.get("responseModel") == "stub-model"
    assert end_meta.get("finishReason") == "stop"
    assert (end_meta.get("usage") or {}).get("prompt_tokens") == 11
    assert end_event.get("requestPayload", {}).get("model") == "stub-model"
    assert (end_event.get("responseHeaders") or {}).get("content-type") == "application/json"


@pytest.mark.unit
def test_flow_v2_runner_request_error_payload_uses_merged_request_payload(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Request:
        def __init__(self):
            self.model = "stub-model"
            self.messages = [{"role": "user", "content": "x"}]
            self.temperature = None
            self.max_tokens = None
            self.extra = {"top_p": 0.95, "max_tokens": 4096}
            self.headers = {"X-Test": "1"}
            self.provider_id = "endpoint_1"
            self.request_id = "req_err_1"
            self.meta = {"endpoint_id": "ep_1", "endpoint_label": "node-a"}

    class _Provider:
        profile = {
            "type": "openai_compat",
            "model": "stub-model",
            "base_url": "http://localhost:8000/v1",
        }

        def build_request(self, _messages, _settings):
            return _Request()

        def send(self, _request):
            raise ProviderError(
                "OpenAI-compatible HTTP 524: timeout",
                error_type="http_error",
                status_code=524,
                duration_ms=15000,
                url="http://localhost:8000/v1/chat/completions",
                response_text="timeout",
                request_headers={"X-Test": "1"},
                response_headers={"server": "cloudflare", "cf-ray": "test-ray"},
            )

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            raise AssertionError("ProviderError path should not call parser")

    captured_events = []
    doc = _DummyDoc(["L1"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )
    monkeypatch.setattr(
        flow_v2_runner,
        "emit_api_stats_event",
        lambda payload: captured_events.append(payload),
    )

    output_path = str(tmp_path / "stats_error_payload.txt")
    runner.run("dummy-input.txt", output_path=output_path, save_cache=False)

    err_event = next(
        event for event in captured_events if event.get("phase") == "request_error"
    )
    request_payload = err_event.get("requestPayload") or {}
    assert request_payload.get("model") == "stub-model"
    assert request_payload.get("messages") == [{"role": "user", "content": "x"}]
    assert request_payload.get("top_p") == 0.95
    assert request_payload.get("max_tokens") == 4096
    assert "extra" not in request_payload
    assert (err_event.get("requestHeaders") or {}).get("X-Test") == "1"
    assert (err_event.get("responseHeaders") or {}).get("server") == "cloudflare"
    assert (err_event.get("responsePayload") or {}).get("statusCode") == 524
    assert (err_event.get("responsePayload") or {}).get("responseText") == "timeout"


@pytest.mark.unit
def test_flow_v2_runner_realtime_cache_survives_mid_run_abort(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            return ProviderResponse(text="OK", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            return type("Parsed", (), {"text": "T"})()

    call_counter = {"count": 0}

    def _raise_after_first(self, *_args, **_kwargs):
        call_counter["count"] += 1
        if call_counter["count"] >= 1:
            raise RuntimeError("forced_abort")

    doc = _DummyDoc(["A", "B"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyLineChunkPolicy(),
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.ProgressTracker.block_done",
        _raise_after_first,
    )

    output_path = str(tmp_path / "abort.txt")
    with pytest.raises(RuntimeError, match="forced_abort"):
        runner.run("dummy-input.txt", output_path=output_path, save_cache=True)

    cache_path = tmp_path / "abort.txt.cache.json"
    assert cache_path.exists()
    cache_data = json.loads(cache_path.read_text(encoding="utf-8"))
    assert len(cache_data.get("blocks", [])) >= 1


@pytest.mark.unit
def test_flow_v2_runner_resume_from_existing_output_when_temp_cache_missing(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    call_counter = {"count": 0}

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            call_counter["count"] += 1
            return ProviderResponse(text="T3", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    input_doc = _DummyDoc(["S1", "S2", "S3"])
    output_doc = _DummyDoc(["T1", "T2"])
    output_path = str(tmp_path / "resume.txt")
    (tmp_path / "resume.txt").write_text("T1\nT2\n", encoding="utf-8")

    def _get_document(path):
        if path == "dummy-input.txt":
            return input_doc
        if path == output_path:
            return output_doc
        raise AssertionError(f"unexpected path: {path}")

    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        _get_document,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )

    runner.run(
        "dummy-input.txt",
        output_path=output_path,
        resume=True,
        save_cache=False,
    )

    assert call_counter["count"] == 1
    assert [block.prompt_text for block in input_doc.saved_blocks] == ["T1", "T2", "T3"]


@pytest.mark.unit
def test_flow_v2_runner_resume_accepts_relaxed_fingerprint_match(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "id": "pipe_x",
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    call_counter = {"count": 0}

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            call_counter["count"] += 1
            return ProviderResponse(text="T2", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    input_doc = _DummyDoc(["S1", "S2"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: input_doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )

    output_path = str(tmp_path / "resume_soft.txt")
    temp_path = tmp_path / "resume_soft.txt.temp.jsonl"
    temp_path.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "type": "fingerprint",
                        "version": 2,
                        "input": "dummy-input.txt",
                        "pipeline": "pipe_x",
                        "chunk_type": "line",
                        "config_hash": "outdated_hash",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {"type": "block", "index": 0, "src": "S1", "dst": "T1"},
                    ensure_ascii=False,
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    runner.run(
        "dummy-input.txt",
        output_path=output_path,
        resume=True,
        save_cache=False,
    )

    assert call_counter["count"] == 1
    assert [block.prompt_text for block in input_doc.saved_blocks] == ["T1", "T2"]


@pytest.mark.unit
def test_flow_v2_runner_stop_flag_preserves_resume_artifacts(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            return ProviderResponse(text="OK", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, _text):
            return type("Parsed", (), {"text": "T"})()

    stop_flag = tmp_path / "stop.flag"
    original_block_done = flow_v2_runner.ProgressTracker.block_done

    def _block_done_and_request_stop(self, *args, **kwargs):
        result = original_block_done(self, *args, **kwargs)
        if not stop_flag.exists():
            stop_flag.write_text("1", encoding="utf-8")
        return result

    doc = _DummyDoc(["A", "B", "C"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyLineChunkPolicy(),
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.ProgressTracker.block_done",
        _block_done_and_request_stop,
    )

    output_path = str(tmp_path / "stop.txt")
    with pytest.raises(PipelineStopRequested, match="stop_requested"):
        runner.run(
            "dummy-input.txt",
            output_path=output_path,
            save_cache=True,
            stop_flag_path=str(stop_flag),
        )

    cache_path = tmp_path / "stop.txt.cache.json"
    temp_path = tmp_path / "stop.txt.temp.jsonl"
    interrupted_path = tmp_path / "stop.txt.interrupted.txt"
    assert cache_path.exists()
    assert temp_path.exists()
    assert interrupted_path.exists()
    cache_data = json.loads(cache_path.read_text(encoding="utf-8"))
    assert len(cache_data.get("blocks", [])) >= 1
    assert interrupted_path.read_text(encoding="utf-8").strip() != ""


@pytest.mark.unit
def test_flow_v2_runner_txt_line_mode_ignores_blank_lines_in_api_count(
    tmp_path,
    monkeypatch,
    capsys,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
        "processing": {
            "rules_post": [
                {"type": "format", "pattern": "ensure_double_newline", "active": True}
            ]
        },
    }

    call_counter = {"count": 0}

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            call_counter["count"] += 1
            return ProviderResponse(text=f"T{call_counter['count']}", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )

    input_path = tmp_path / "input.txt"
    input_path.write_text("L1\n\nL2\n\n\nL3\n", encoding="utf-8")
    output_path = str(tmp_path / "out.txt")

    runner.run(str(input_path), output_path=output_path, save_cache=False)

    assert call_counter["count"] == 3
    output_text = (tmp_path / "out.txt").read_text(encoding="utf-8")
    assert output_text == "T1\n\nT2\n\nT3\n\n"
    assert "\n\n\n" not in output_text

    log_text = capsys.readouterr().out
    final_rows = [
        json.loads(line.split("JSON_FINAL:", 1)[1])
        for line in log_text.splitlines()
        if "JSON_FINAL:" in line
    ]
    progress_rows = [
        json.loads(line.split("JSON_PROGRESS:", 1)[1])
        for line in log_text.splitlines()
        if "JSON_PROGRESS:" in line
    ]
    assert final_rows
    assert final_rows[-1]["sourceLines"] == 3
    assert progress_rows
    assert progress_rows[-1]["total"] == 3


@pytest.mark.unit
def test_flow_v2_runner_strict_concurrency_uses_fixed_inflight_limit(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 2},
    }

    state = {"active": 0, "max_active": 0, "count": 0}
    lock = threading.Lock()

    class _Provider:
        profile = {"model": "stub-model", "strict_concurrency": True}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            with lock:
                state["active"] += 1
                state["count"] += 1
                state["max_active"] = max(state["max_active"], state["active"])
            try:
                time.sleep(0.02)
                return ProviderResponse(text="OK", raw={})
            finally:
                with lock:
                    state["active"] -= 1

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    doc = _DummyDoc(["A", "B", "C", "D"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies, "get_chunk_policy", lambda _ref: _DummyLineChunkPolicy()
    )

    runner.run("dummy-input.txt", output_path=str(tmp_path / "strict.txt"), save_cache=False)

    assert state["count"] == 4
    assert state["max_active"] == 2


@pytest.mark.unit
def test_flow_v2_runner_txt_block_mode_uses_double_newline_separator(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    call_counter = {"count": 0}

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            call_counter["count"] += 1
            return ProviderResponse(text=f"T{call_counter['count']}", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )

    input_path = tmp_path / "block_input.txt"
    input_path.write_text("L1\nL2\nL3\n", encoding="utf-8")
    output_path = tmp_path / "block_output.txt"

    runner.run(str(input_path), output_path=str(output_path), save_cache=False)

    assert output_path.read_text(encoding="utf-8") == "T1\n\nT2\n\nT3\n\n"


@pytest.mark.unit
def test_flow_v2_runner_stop_preview_uses_double_newline_in_block_mode(
    tmp_path,
    monkeypatch,
):
    runner = _make_runner(tmp_path)
    runner.pipeline = {
        "provider": "provider_stub",
        "prompt": "prompt_stub",
        "parser": "parser_stub",
        "chunk_policy": "chunk_stub",
        "settings": {"max_retries": 0, "concurrency": 1},
    }

    class _Provider:
        profile = {"model": "stub-model"}

        def build_request(self, _messages, _settings):
            return object()

        def send(self, _request):
            return ProviderResponse(text="T", raw={})

    class _Parser:
        profile = {"type": "plain"}

        def parse(self, text):
            return type("Parsed", (), {"text": text})()

    stop_flag = tmp_path / "stop_block.flag"
    done_state = {"count": 0}
    original_block_done = flow_v2_runner.ProgressTracker.block_done

    def _block_done_and_request_stop(self, *args, **kwargs):
        result = original_block_done(self, *args, **kwargs)
        done_state["count"] += 1
        if done_state["count"] >= 2 and not stop_flag.exists():
            stop_flag.write_text("1", encoding="utf-8")
        return result

    doc = _DummyDoc(["S1", "S2", "S3"])
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.DocumentFactory.get_document",
        lambda _path: doc,
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.build_messages",
        lambda *_args, **_kwargs: [{"role": "user", "content": "x"}],
    )
    monkeypatch.setattr(runner.providers, "get_provider", lambda _ref: _Provider())
    monkeypatch.setattr(runner.parsers, "get_parser", lambda _ref: _Parser())
    monkeypatch.setattr(
        runner.prompts, "get_prompt", lambda _ref: {"user_template": "{{source}}"}
    )
    monkeypatch.setattr(
        runner.chunk_policies,
        "get_chunk_policy",
        lambda _ref: _DummyBlockChunkPolicy(),
    )
    monkeypatch.setattr(
        "murasaki_flow_v2.pipelines.runner.ProgressTracker.block_done",
        _block_done_and_request_stop,
    )

    output_path = tmp_path / "stop_block.txt"
    with pytest.raises(PipelineStopRequested, match="stop_requested"):
        runner.run(
            "dummy-input.txt",
            output_path=str(output_path),
            save_cache=False,
            stop_flag_path=str(stop_flag),
        )

    interrupted_path = tmp_path / "stop_block.txt.interrupted.txt"
    assert interrupted_path.exists()
    assert interrupted_path.read_text(encoding="utf-8") == "T\n\nT\n\n"
