from pathlib import Path

import pytest

from murasaki_translator.utils.alignment_handler import AlignmentHandler
from murasaki_translator.core.chunker import TextBlock


@pytest.mark.unit
def test_alignment_handler_load_and_process(tmp_path: Path):
    src = tmp_path / "input.txt"
    src.write_text("a\n\n b \n", encoding="utf-8")

    items, structure_map, total = AlignmentHandler.load_lines(str(src))
    assert total == 3
    assert structure_map == {1: 0, 2: 2}
    assert len(items) == 2
    assert "@id=1@" in items[0]["text"]

    cleaned = AlignmentHandler.process_result("@id=1@ hello @end=1@")
    assert cleaned == "hello"


@pytest.mark.unit
def test_alignment_handler_save_reconstructed(tmp_path: Path):
    out_path = tmp_path / "out.txt"
    translated_blocks = [
        TextBlock(
            id=1,
            prompt_text="@id=1@ foo @end=1@\n\n@id=2@ bar @end=2@",
            metadata=[],
        )
    ]
    AlignmentHandler.save_reconstructed(
        str(out_path),
        translated_blocks,
        structure_map={1: 0, 2: 2},
        total_physical_lines=3,
    )

    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert lines == ["foo", "", "bar"]


@pytest.mark.unit
def test_alignment_handler_save_reconstructed_loose_pair_fallback(tmp_path: Path):
    out_path = tmp_path / "out_loose.txt"
    translated_blocks = [
        TextBlock(
            id=1,
            prompt_text="@id=1@ foo\n@id=2@ bar @end=2@",
            metadata=[],
        )
    ]
    AlignmentHandler.save_reconstructed(
        str(out_path),
        translated_blocks,
        structure_map={1: 0, 2: 2},
        total_physical_lines=3,
    )

    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert lines == ["foo", "", "bar"]


@pytest.mark.unit
def test_alignment_handler_save_reconstructed_block_plain_text_fallback(tmp_path: Path):
    out_path = tmp_path / "out_plain_fallback.txt"
    translated_blocks = [
        TextBlock(
            id=1,
            prompt_text="foo\nbar",
            metadata=[],
        )
    ]
    source_blocks = [
        TextBlock(
            id=1,
            prompt_text="@id=1@ a @end=1@\n\n@id=2@ b @end=2@\n\n",
            metadata=[],
        )
    ]
    AlignmentHandler.save_reconstructed(
        str(out_path),
        translated_blocks,
        structure_map={1: 0, 2: 1},
        total_physical_lines=2,
        source_blocks=source_blocks,
    )

    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert lines == ["foo", "bar"]


@pytest.mark.unit
def test_alignment_handler_save_reconstructed_single_unresolved_id_maps_by_order(tmp_path: Path):
    out_path = tmp_path / "out_single_unresolved.txt"
    translated_blocks = [
        TextBlock(
            id=1,
            # id=1 parsed from anchors, id=2 remains plain text fallback.
            prompt_text="@id=1@ A @end=1@\nB",
            metadata=[],
        )
    ]
    source_blocks = [
        TextBlock(
            id=1,
            prompt_text="@id=1@ s1 @end=1@\n\n@id=2@ s2 @end=2@\n\n",
            metadata=[],
        )
    ]
    AlignmentHandler.save_reconstructed(
        str(out_path),
        translated_blocks,
        structure_map={1: 0, 2: 1},
        total_physical_lines=2,
        source_blocks=source_blocks,
    )

    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert lines == ["A", "B"]


@pytest.mark.unit
def test_alignment_handler_save_reconstructed_source_fallback(tmp_path: Path):
    out_path = tmp_path / "out_source_fallback.txt"
    translated_blocks = [
        TextBlock(
            id=1,
            prompt_text="",
            metadata=[],
        )
    ]
    source_blocks = [
        TextBlock(
            id=1,
            prompt_text="@id=1@ s1 @end=1@\n\n@id=2@ s2 @end=2@\n\n",
            metadata=[],
        )
    ]
    AlignmentHandler.save_reconstructed(
        str(out_path),
        translated_blocks,
        structure_map={1: 0, 2: 1},
        total_physical_lines=2,
        source_blocks=source_blocks,
    )

    lines = out_path.read_text(encoding="utf-8").splitlines()
    assert lines == ["s1", "s2"]
