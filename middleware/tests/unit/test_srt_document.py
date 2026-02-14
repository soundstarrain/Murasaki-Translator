from pathlib import Path

import pytest

from murasaki_translator.documents.srt import SrtDocument
from murasaki_translator.core.chunker import TextBlock


@pytest.mark.unit
def test_srt_document_load_and_save(tmp_path: Path):
    content = """1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n"""
    src = tmp_path / "a.srt"
    src.write_text(content, encoding="utf-8")

    doc = SrtDocument(str(src))
    items = doc.load()
    assert len(items) == 2

    blocks = [
        TextBlock(id=idx, prompt_text=item["text"], metadata=item.get("meta"))
        for idx, item in enumerate(items)
    ]
    out_path = tmp_path / "out.srt"
    doc.save(str(out_path), blocks)
    saved = out_path.read_text(encoding="utf-8")
    assert "00:00:01,000 --> 00:00:02,000" in saved
    assert "Hello" in saved
