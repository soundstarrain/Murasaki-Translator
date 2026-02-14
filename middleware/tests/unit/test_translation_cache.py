from pathlib import Path

import pytest

from murasaki_translator.core.cache import TranslationCache, get_cache_path, load_cache


@pytest.mark.unit
def test_translation_cache_save_and_load(tmp_path: Path):
    output_path = tmp_path / "out.txt"
    cache = TranslationCache(str(output_path), source_path="src.txt")
    cache.add_block(0, "a", "A")
    cache.add_block(1, "b", "B")

    ok = cache.save(model_name="m1", glossary_path="g.json", concurrency=2)
    assert ok is True

    new_cache = TranslationCache(str(output_path))
    loaded = new_cache.load()
    assert loaded is True
    assert new_cache.metadata.get("modelName") == "m1"
    assert len(new_cache.blocks) == 2
    assert new_cache.get_block(1).dst == "B"


@pytest.mark.unit
def test_translation_cache_update_block(tmp_path: Path):
    output_path = tmp_path / "out.txt"
    cache = TranslationCache(str(output_path))
    cache.add_block(0, "a", "A")
    updated = cache.update_block(0, dst="AA", status="edited")
    assert updated is True
    block = cache.get_block(0)
    assert block.dst == "AA"
    assert block.status == "edited"


@pytest.mark.unit
def test_translation_cache_replace_block(tmp_path: Path):
    output_path = tmp_path / "out.txt"
    cache = TranslationCache(str(output_path))
    cache.add_block(0, "a", "A")
    cache.add_block(0, "a2", "A2")
    block = cache.get_block(0)
    assert block.src == "a2"
    assert block.dst == "A2"


@pytest.mark.unit
def test_translation_cache_stats_and_export(tmp_path: Path):
    output_path = tmp_path / "out.txt"
    cache = TranslationCache(str(output_path))
    cache.add_block(0, "a", "A", warnings=["w1"])
    cache.add_block(1, "b", "B")
    stats = cache.get_stats()
    assert stats["blockCount"] == 2
    assert stats["withWarnings"] == 1
    assert cache.export_to_text() == "A\nB"


@pytest.mark.unit
def test_translation_cache_clear(tmp_path: Path):
    output_path = tmp_path / "out.txt"
    cache = TranslationCache(str(output_path))
    cache.add_block(0, "a", "A")
    cache.clear()
    assert cache.get_stats()["blockCount"] == 0


@pytest.mark.unit
def test_cache_path_helpers(tmp_path: Path):
    output_path = tmp_path / "out.txt"
    cache = TranslationCache(str(output_path))
    cache.add_block(0, "a", "A")
    assert cache.save() is True

    expected_path = get_cache_path(str(output_path))
    assert expected_path.endswith(".cache.json")

    loaded = load_cache(str(output_path))
    assert loaded is not None
    assert loaded.get_block(0).dst == "A"


@pytest.mark.unit
def test_translation_cache_load_corrupt_keeps_blocks(tmp_path: Path):
    output_path = tmp_path / "out.txt"
    cache = TranslationCache(str(output_path))
    cache.add_block(0, "a", "A")
    # Write corrupt cache file
    cache_path = cache.cache_path
    Path(cache_path).write_text("{oops}", encoding="utf-8")

    ok = cache.load()
    assert ok is False
    assert cache.get_block(0).dst == "A"
