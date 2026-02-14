import pytest

from murasaki_translator.utils.line_aligner import LineAligner


@pytest.mark.unit
def test_line_aligner_src_more_than_dst():
    src = ["a", "b", "c"]
    dst = ["x", "y"]
    aligned = LineAligner.align(src, dst)
    assert aligned == [("a", "x"), ("b", "x"), ("c", "y")]


@pytest.mark.unit
def test_line_aligner_dst_more_than_src():
    src = ["a", "b"]
    dst = ["x", "y", "z", "w"]
    aligned = LineAligner.align(src, dst)
    assert aligned == [("a", "x"), ("a", "y"), ("b", "z"), ("b", "w")]


@pytest.mark.unit
def test_line_aligner_preview():
    src = "a\nb"
    dst = "x\ny"
    aligned_src, aligned_dst = LineAligner.align_for_preview(src, dst, separator="\n\n")
    assert aligned_src == "a\n\nb"
    assert aligned_dst == "x\n\ny"
