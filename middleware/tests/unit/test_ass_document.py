from pathlib import Path

import pytest

from murasaki_translator.documents.ass import AssDocument
from murasaki_translator.core.chunker import TextBlock


@pytest.mark.unit
def test_ass_document_load_and_save(tmp_path: Path):
    content = """[Script Info]
Title: Test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello
"""
    src = tmp_path / "a.ass"
    src.write_text(content, encoding="utf-8-sig")

    doc = AssDocument(str(src))
    items = doc.load()
    assert len(items) == 1
    assert "00:00:01,000 --> 00:00:02,000" in items[0]["text"]

    block = TextBlock(id=1, prompt_text="1\n00:00:01,000 --> 00:00:02,000\nTranslated\n\n")
    out_path = tmp_path / "out.ass"
    doc.save(str(out_path), [block])

    saved = out_path.read_text(encoding="utf-8-sig")
    assert "Dialogue:" in saved
    assert "Translated" in saved
