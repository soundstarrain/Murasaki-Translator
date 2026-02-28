import pytest

from murasaki_translator.core.chunker import Chunker


@pytest.mark.unit
def test_chunker_line_mode_skips_empty():
    chunker = Chunker(mode="line")
    items = [
        "a\n",
        "\n",
        "b",
        "   ",
    ]
    blocks = chunker.process(items)
    assert [b.prompt_text for b in blocks] == ["a", "b"]


@pytest.mark.unit
def test_chunker_chunk_mode_splits_on_size():
    chunker = Chunker(target_chars=5, max_chars=8, mode="chunk", enable_balance=False)
    items = [
        "hello ",
        "world ",
        "again",
    ]
    blocks = chunker.process(items)
    assert len(blocks) >= 2
    assert "hello " in blocks[0].prompt_text


@pytest.mark.unit
def test_chunker_skips_balance_when_metadata_present():
    chunker = Chunker(target_chars=10, max_chars=20, mode="chunk", enable_balance=True)
    items = [
        {"text": "aaaaa\n", "meta": {"id": 1}},
        {"text": "bb\n", "meta": {"id": 2}},
    ]
    blocks = chunker.process(items)
    assert len(blocks) == 1
    assert blocks[0].metadata == [{"id": 1}, {"id": 2}]


@pytest.mark.unit
def test_chunker_alignment_numeric_check_ignores_end_anchor_digits():
    chunker = Chunker(target_chars=40, max_chars=200, mode="chunk", enable_balance=False)
    items = [
        {"text": "@id=1@ 内容A。 @end=1@。\n", "meta": "alignment_structural"},
        {"text": "@id=2@ 内容B。 @end=2@。\n", "meta": "alignment_structural"},
    ]
    blocks = chunker.process(items)
    assert len(blocks) == 2
