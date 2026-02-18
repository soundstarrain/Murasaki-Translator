"""Tests for PipelineRunner internal helpers and concurrency utilities."""

import threading
import pytest

from murasaki_flow_v2.pipelines.runner import PipelineRunner
from murasaki_flow_v2.registry.profile_store import ProfileStore
from murasaki_flow_v2.parsers.base import ParserError
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
# V1CompatProcessor lock separation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_runner_v1_compat_lock_separation():
    try:
        from murasaki_flow_v2.utils.v1_compat import V1CompatProcessor, V1CompatOptions
    except ImportError:
        pytest.skip("v1_compat dependencies not available")

    processor = V1CompatProcessor(
        V1CompatOptions(
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
