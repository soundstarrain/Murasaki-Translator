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

    cleaned = AlignmentHandler.process_result("@id=1@ hello @id=1@")
    assert cleaned == "hello"


@pytest.mark.unit
def test_alignment_handler_save_reconstructed(tmp_path: Path):
    out_path = tmp_path / "out.txt"
    translated_blocks = [
        TextBlock(
            id=1,
            prompt_text="@id=1@ foo @id=1@\n\n@id=2@ bar @id=2@",
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
