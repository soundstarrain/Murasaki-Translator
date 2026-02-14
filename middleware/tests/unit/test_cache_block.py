import pytest

from murasaki_translator.core.cache import CacheBlock


@pytest.mark.unit
def test_cache_block_line_counts_ignore_blank():
    block = CacheBlock(index=0, src="a\n\nb\n", dst="x\n\n\n")
    assert block.src_lines == 2
    assert block.dst_lines == 1


@pytest.mark.unit
def test_cache_block_to_dict_retry_history_optional():
    block = CacheBlock(index=1, src="a", dst="b", retry_history=[])
    data = block.to_dict()
    assert "retryHistory" not in data

    block.retry_history = [{"reason": "glossary"}]
    data = block.to_dict()
    assert "retryHistory" in data
