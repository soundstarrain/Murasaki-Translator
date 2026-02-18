import pytest

from murasaki_flow_v2.policies.chunk_policy import LineChunkPolicy
from murasaki_flow_v2.policies.line_policy import (
    LinePolicyError,
    StrictLinePolicy,
    TolerantLinePolicy,
)
from murasaki_flow_v2.utils.line_aligner import align_lines


@pytest.mark.unit
def test_flow_v2_align_lines_basic():
    src = ["a", "", "b"]
    dst = ["x"]
    assert align_lines(src, dst) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_policy_strict_error():
    policy = StrictLinePolicy({"options": {"on_mismatch": "error"}})
    with pytest.raises(LinePolicyError):
        policy.apply(["a", "b"], ["x"])


@pytest.mark.unit
def test_flow_v2_line_policy_strict_retry():
    policy = StrictLinePolicy({"options": {"on_mismatch": "retry"}})
    with pytest.raises(LinePolicyError):
        policy.apply(["a", "b"], ["x"])


@pytest.mark.unit
def test_flow_v2_line_policy_strict_pad():
    policy = StrictLinePolicy({"options": {"on_mismatch": "pad"}})
    assert policy.apply(["a", "b", "c"], ["x"]) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_policy_strict_truncate():
    policy = StrictLinePolicy({"options": {"on_mismatch": "truncate"}})
    assert policy.apply(["a", "b"], ["x", "y", "z"]) == ["x", "y"]


@pytest.mark.unit
def test_flow_v2_line_policy_strict_align():
    policy = StrictLinePolicy({"options": {"on_mismatch": "align"}})
    assert policy.apply(["a", "", "b"], ["x"]) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_policy_tolerant():
    policy = TolerantLinePolicy({})
    assert policy.apply(["a", "", "b"], ["x"]) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_line_policy_quality_empty_line():
    policy = TolerantLinePolicy({"options": {"checks": ["empty_line"]}})
    with pytest.raises(LinePolicyError):
        policy.apply(["a"], [""])


@pytest.mark.unit
def test_flow_v2_line_policy_quality_similarity():
    policy = TolerantLinePolicy({"options": {"checks": ["similarity"]}})
    with pytest.raises(LinePolicyError):
        policy.apply(["これはテスト文章です"], ["これはテスト文章です"])


@pytest.mark.unit
def test_flow_v2_line_policy_quality_similarity_short_skipped():
    policy = TolerantLinePolicy({"options": {"checks": ["similarity"]}})
    assert policy.apply(["hello"], ["hello"]) == ["hello"]


@pytest.mark.unit
def test_flow_v2_line_policy_quality_kana_trace():
    policy = TolerantLinePolicy({"options": {"checks": ["kana_trace"], "source_lang": "ja"}})
    with pytest.raises(LinePolicyError):
        policy.apply(["hello"], ["テスト"])


@pytest.mark.unit
def test_flow_v2_line_chunk_policy_strict():
    policy = LineChunkPolicy({"options": {"strict": True, "keep_empty": True}})
    items = [
        {"text": "hello\n", "meta": 0},
        {"text": "\n", "meta": 1},
        {"text": "world", "meta": 2},
    ]
    blocks = policy.chunk(items)
    assert [b.prompt_text for b in blocks] == ["hello", "", "world"]


# ---------------------------------------------------------------------------
# align_lines edge cases
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_flow_v2_align_lines_dst_excess_merges():
    src = ["a", "b"]
    dst = ["x", "y", "z", "w"]
    result = align_lines(src, dst)
    assert len(result) == 2
    assert result[0] == "x"
    assert "y" in result[1] and "z" in result[1] and "w" in result[1]


@pytest.mark.unit
def test_flow_v2_align_lines_exact_match():
    assert align_lines(["a", "b", "c"], ["x", "y", "z"]) == ["x", "y", "z"]


@pytest.mark.unit
def test_flow_v2_align_lines_dst_fewer_pads():
    assert align_lines(["a", "b", "c"], ["x"]) == ["x", "", ""]


@pytest.mark.unit
def test_flow_v2_align_lines_empty_src():
    assert align_lines([], ["a", "b"]) == ["a", "b"]


@pytest.mark.unit
def test_flow_v2_align_lines_empty_dst():
    assert align_lines(["a", "b"], []) == ["", ""]


@pytest.mark.unit
def test_flow_v2_align_lines_preserves_empty_structure():
    src = ["a", "", "b"]
    dst = ["x", "", "y", "extra"]
    result = align_lines(src, dst)
    assert len(result) == 3
    assert result[0] == "x"
    assert result[1] == ""
    assert "y" in result[2] and "extra" in result[2]
